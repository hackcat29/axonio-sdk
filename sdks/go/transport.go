package axonio

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// CloudEndpoint is the hosted Axonio cloud. Requests carry the API key and the
// gateway routes them to the workspace's own instance.
const CloudEndpoint = "https://api.axonio.xyz/api/v1/gateway"

const (
	sessionTTLSecs     = 3600
	sessionRenewMargin = time.Minute
	maxAttempts        = 3
)

var uuidRE = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// stableAgentID maps any agent name to a UUID. The server needs a UUID; other
// ids map to a stable one, byte-for-byte the same as the TypeScript and Python
// SDKs, so one agent name means one agent across all of them.
func stableAgentID(agentID string) string {
	if agentID == "" {
		agentID = "default-agent"
	}
	if uuidRE.MatchString(agentID) {
		return agentID
	}
	sum := sha256.Sum256([]byte(agentID))
	h := []byte(hex.EncodeToString(sum[:])[:32])
	h[12] = '5'
	variant, _ := strconv.ParseInt(string(h[16]), 16, 64)
	h[16] = strconv.FormatInt((variant&0x3)|0x8, 16)[0]
	s := string(h)
	return fmt.Sprintf("%s-%s-%s-%s-%s", s[0:8], s[8:12], s[12:16], s[16:20], s[20:32])
}

// baseURL is the HTTP API base for a configured endpoint. A URL with a path
// (such as the cloud gateway) is used as-is; a bare address on the gRPC port
// 50050 maps to its HTTP port 8080, so the long-standing default keeps working.
func baseURL(endpoint string) string {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		endpoint = "http://localhost:50050"
	}
	if !strings.Contains(endpoint, "://") {
		endpoint = "http://" + endpoint
	}
	u, err := url.Parse(endpoint)
	if err != nil {
		return strings.TrimRight(endpoint, "/")
	}
	if u.Hostname() == "cloud.clawdb.dev" {
		return CloudEndpoint
	}
	if p := strings.TrimRight(u.Path, "/"); p != "" {
		u.Path = p
		return u.String()
	}
	if u.Port() == "50050" {
		u.Host = u.Hostname() + ":8080"
	}
	u.Path = ""
	return strings.TrimRight(u.String(), "/")
}

// core is the HTTP transport every sub-client shares. It opens a session on
// first use, renews it a minute before it expires (and once more, retrying the
// call, if the server rejects the token), and retries network errors and
// 502/503/504 with backoff; 429 waits for Retry-After.
type core struct {
	cfg     *Config
	base    string
	agentID string
	http    *http.Client

	mu        sync.Mutex
	token     string
	sessionID string
	expires   time.Time
}

func newCore(cfg *Config) *core {
	return &core{
		cfg:     cfg,
		base:    baseURL(cfg.Endpoint),
		agentID: stableAgentID(cfg.AgentID),
		http:    &http.Client{Timeout: cfg.Timeout},
	}
}

func (c *core) sessionFresh() bool {
	if c.token == "" {
		return false
	}
	return c.expires.IsZero() || time.Now().Before(c.expires.Add(-sessionRenewMargin))
}

func (c *core) forgetSession() {
	c.mu.Lock()
	c.token, c.sessionID, c.expires = "", "", time.Time{}
	c.mu.Unlock()
}

// openSession creates a session and remembers it.
func (c *core) openSession(ctx context.Context, agentID, role string, scopes []string, ttlSecs int) (map[string]interface{}, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.openSessionLocked(ctx, agentID, role, scopes, ttlSecs)
}

func (c *core) openSessionLocked(ctx context.Context, agentID, role string, scopes []string, ttlSecs int) (map[string]interface{}, error) {
	if agentID == "" {
		agentID = c.agentID
	} else {
		agentID = stableAgentID(agentID)
	}
	if role == "" {
		role = orDefault(c.cfg.Role, "assistant")
	}
	if len(scopes) == 0 {
		scopes = []string{"*"}
	}
	if ttlSecs <= 0 {
		ttlSecs = sessionTTLSecs
	}
	data, err := c.send(ctx, http.MethodPost, "/v1/sessions", nil, map[string]interface{}{
		"agent_id": agentID, "role": role, "scopes": scopes, "ttl_secs": ttlSecs,
	}, false)
	if err != nil {
		return nil, err
	}
	body := asMap(data)
	token, _ := body["token"].(string)
	if token == "" {
		return nil, &Error{Code: ErrorCodeAuth, Message: "server returned a session without a token"}
	}
	c.token = token
	if id, _ := body["session_id"].(string); id != "" {
		c.sessionID = id
	} else if id, _ := body["id"].(string); id != "" {
		c.sessionID = id
	}
	c.expires = time.Time{}
	if exp, _ := body["expires_at"].(string); exp != "" {
		if t, perr := time.Parse(time.RFC3339Nano, exp); perr == nil {
			c.expires = t
		}
	}
	return body, nil
}

func (c *core) ensureSession(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sessionFresh() {
		return nil
	}
	_, err := c.openSessionLocked(ctx, "", "", nil, 0)
	return err
}

func (c *core) snapshotToken() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.token
}

// call performs an authenticated request, opening or renewing the session as needed.
func (c *core) call(ctx context.Context, method, path string, query url.Values, body interface{}) (interface{}, error) {
	if err := c.ensureSession(ctx); err != nil {
		return nil, err
	}
	data, err := c.send(ctx, method, path, query, body, true)
	if err == errSessionRejected {
		// Expired or revoked: open a new session and retry once.
		c.forgetSession()
		if err := c.ensureSession(ctx); err != nil {
			return nil, err
		}
		data, err = c.send(ctx, method, path, query, body, true)
		if err == errSessionRejected {
			return nil, &Error{Code: ErrorCodeAuth, Message: "the server rejected a freshly opened session"}
		}
	}
	return data, err
}

// callPublic performs a request that needs no session (health checks).
func (c *core) callPublic(ctx context.Context, method, path string) (interface{}, error) {
	return c.send(ctx, method, path, nil, nil, false)
}

type sessionRejected struct{}

func (sessionRejected) Error() string { return "session rejected" }

var errSessionRejected = sessionRejected{}

func (c *core) send(ctx context.Context, method, path string, query url.Values, body interface{}, withSession bool) (interface{}, error) {
	var payload []byte
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, &Error{Code: ErrorCodeInternal, Message: err.Error()}
		}
		payload = b
	}
	target := c.base + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}

	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		var reader io.Reader
		if payload != nil {
			reader = bytes.NewReader(payload)
		}
		req, err := http.NewRequestWithContext(ctx, method, target, reader)
		if err != nil {
			return nil, &Error{Code: ErrorCodeInternal, Message: err.Error()}
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("x-agent-id", c.agentID)
		if payload != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if c.cfg.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
		}
		// x-claw-session, not Authorization: the gateway replaces Authorization
		// (the API key) before forwarding to the instance.
		if withSession {
			if token := c.snapshotToken(); token != "" {
				req.Header.Set("x-claw-session", token)
			}
		}

		resp, err := c.http.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return nil, &Error{Code: ErrorCodeTimeout, Message: ctx.Err().Error()}
			}
			lastErr = &Error{Code: ErrorCodeUnavailable, Message: fmt.Sprintf("could not reach %s: %s", c.base, err)}
			time.Sleep(backoff(attempt))
			continue
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode < 400 {
			return decodeBody(raw, resp.Header.Get("x-request-id")), nil
		}
		if withSession && resp.StatusCode == http.StatusUnauthorized && errorField(raw) == "unauthorized" {
			return nil, errSessionRejected
		}
		apiErr := errorFromHTTP(resp.StatusCode, raw, resp.Header)
		if apiErr.Code == ErrorCodeRateLimit && attempt < maxAttempts-1 {
			time.Sleep(time.Duration(apiErr.RetryAfter) * time.Millisecond)
			lastErr = apiErr
			continue
		}
		if apiErr.Code != ErrorCodeUnavailable && apiErr.Code != ErrorCodeTimeout {
			return nil, apiErr
		}
		lastErr = apiErr
		time.Sleep(backoff(attempt))
	}
	return nil, lastErr
}

func backoff(attempt int) time.Duration {
	d := 200 * time.Millisecond << attempt
	if d > 2*time.Second {
		d = 2 * time.Second
	}
	return d
}

func decodeBody(raw []byte, requestID string) interface{} {
	if len(bytes.TrimSpace(raw)) == 0 {
		if requestID != "" {
			return map[string]interface{}{"request_id": requestID}
		}
		return map[string]interface{}{}
	}
	var out interface{}
	if err := json.Unmarshal(raw, &out); err != nil {
		out = map[string]interface{}{"message": string(raw)}
	}
	if m, ok := out.(map[string]interface{}); ok && requestID != "" {
		if _, has := m["request_id"]; !has {
			m["request_id"] = requestID
		}
	}
	return out
}

func errorField(raw []byte) string {
	var body map[string]interface{}
	if json.Unmarshal(raw, &body) != nil {
		return ""
	}
	s, _ := body["error"].(string)
	return s
}

func asMap(v interface{}) map[string]interface{} {
	if m, ok := v.(map[string]interface{}); ok {
		return m
	}
	return map[string]interface{}{}
}

func asList(v interface{}) []interface{} {
	if l, ok := v.([]interface{}); ok {
		return l
	}
	return nil
}

func orDefault(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

// decodeInto converts a decoded JSON value into a typed struct.
func decodeInto(v interface{}, out interface{}) {
	raw, _ := json.Marshal(v)
	_ = json.Unmarshal(raw, out)
}

// httpClient is embedded by every sub-client.
type httpClient struct {
	core *core
}

func (c *httpClient) get(ctx context.Context, path string, query url.Values) (interface{}, error) {
	return c.core.call(ctx, http.MethodGet, path, query, nil)
}

func (c *httpClient) post(ctx context.Context, path string, body interface{}) (interface{}, error) {
	return c.core.call(ctx, http.MethodPost, path, nil, body)
}

func (c *httpClient) patch(ctx context.Context, path string, body interface{}) (interface{}, error) {
	return c.core.call(ctx, http.MethodPatch, path, nil, body)
}

func (c *httpClient) delete(ctx context.Context, path string) (interface{}, error) {
	return c.core.call(ctx, http.MethodDelete, path, nil, nil)
}

func seg(s string) string { return url.PathEscape(s) }
