package axonio_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	axonio "github.com/hackcat29/axonio-sdk/sdks/go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeServer mimics the parts of the Axonio HTTP API the SDK uses.
type fakeServer struct {
	*httptest.Server
	mu        sync.Mutex
	sessions  int32
	reject    int32 // reject the next N session-authenticated calls with 401 unauthorized
	calls     []string
	lastBody  map[string]interface{}
	lastQuery map[string][]string
	headers   http.Header
	failures  int32 // answer the next N requests with 503
	expiresIn time.Duration
}

func newFake(t *testing.T) *fakeServer {
	f := &fakeServer{expiresIn: time.Hour}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.calls = append(f.calls, r.Method+" "+r.URL.Path)
		f.headers = r.Header.Clone()
		f.lastQuery = r.URL.Query()
		f.lastBody = nil
		_ = json.NewDecoder(r.Body).Decode(&f.lastBody)
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("x-request-id", "req-1")

		if atomic.LoadInt32(&f.failures) > 0 {
			atomic.AddInt32(&f.failures, -1)
			w.WriteHeader(503)
			_, _ = w.Write([]byte(`{"error":"instance_unavailable"}`))
			return
		}
		if r.URL.Path == "/v1/health" {
			_, _ = w.Write([]byte(`{"status":"ok","components":{"core":true}}`))
			return
		}
		if r.URL.Path == "/v1/sessions" && r.Method == "POST" {
			n := atomic.AddInt32(&f.sessions, 1)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"session_id": "sess-" + string(rune('0'+n)), "token": "tok-" + string(rune('0'+n)),
				"expires_at": time.Now().Add(f.expiresIn).UTC().Format(time.RFC3339Nano),
			})
			return
		}
		if r.Header.Get("x-claw-session") == "" || atomic.LoadInt32(&f.reject) > 0 {
			if atomic.LoadInt32(&f.reject) > 0 {
				atomic.AddInt32(&f.reject, -1)
			}
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
			return
		}
		switch {
		case r.URL.Path == "/v1/memories" && r.Method == "POST":
			_, _ = w.Write([]byte(`{"memory_id":"11111111-1111-4111-8111-111111111111"}`))
		case r.URL.Path == "/v1/memories/search":
			_, _ = w.Write([]byte(`[{"id":"a","content":"likes dark mode","score":0.8,"memory_type":"semantic","tags":["ui"],"metadata":{"k":1}}]`))
		case r.URL.Path == "/v1/memories" && r.Method == "GET":
			_, _ = w.Write([]byte(`[{"id":"3","content":"c","created_at":"2026-11-09T23:41:51.054126868Z"},{"id":"2","content":"b"},{"id":"1","content":"a"}]`))
		case r.URL.Path == "/v1/branches":
			_, _ = w.Write([]byte(`[{"id":"b1","name":"trunk"},{"id":"b2","name":"exp"}]`))
		case strings.HasSuffix(r.URL.Path, "/diff"):
			_, _ = w.Write([]byte(`{"stats":{"added":2,"removed":1},"divergence_score":0.25}`))
		case strings.HasSuffix(r.URL.Path, "/merge"):
			_, _ = w.Write([]byte(`{"applied":3,"conflicts":[{"id":"x"}]}`))
		case r.URL.Path == "/v1/memories/missing":
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"error":"memory not found"}`))
		case r.Method == "DELETE":
			w.WriteHeader(204)
		default:
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	t.Cleanup(f.Close)
	return f
}

func client(t *testing.T, f *fakeServer, extra ...interface{}) *axonio.Axonio {
	t.Helper()
	args := append([]interface{}{axonio.WithEndpoint(f.URL), axonio.WithAPIKey("ck_live_test")}, extra...)
	db, err := axonio.New(args...)
	require.NoError(t, err)
	return db
}

func TestRememberOpensASessionAndSendsBothCredentials(t *testing.T) {
	f := newFake(t)
	db := client(t, f)
	id, err := db.Memory.Remember(context.Background(), "hello", &axonio.RememberOptions{Tags: []string{"a"}, Metadata: map[string]interface{}{"x": 1}})
	require.NoError(t, err)
	assert.Equal(t, "11111111-1111-4111-8111-111111111111", id)
	assert.Equal(t, []string{"POST /v1/sessions", "POST /v1/memories"}, f.calls)
	assert.Equal(t, "Bearer ck_live_test", f.headers.Get("Authorization"))
	assert.Equal(t, "tok-1", f.headers.Get("x-claw-session"))
	assert.Equal(t, "hello", f.lastBody["content"])
	assert.Equal(t, "context", f.lastBody["type"])
	assert.Equal(t, map[string]interface{}{"x": float64(1)}, f.lastBody["metadata"])
}

func TestSessionIsOpenedOnceAndReused(t *testing.T) {
	f := newFake(t)
	db := client(t, f)
	for i := 0; i < 3; i++ {
		_, err := db.Memory.Remember(context.Background(), "x", nil)
		require.NoError(t, err)
	}
	assert.EqualValues(t, 1, f.sessions)
}

func TestSessionIsRenewedBeforeItExpires(t *testing.T) {
	f := newFake(t)
	f.expiresIn = 30 * time.Second // inside the one-minute renewal margin
	db := client(t, f)
	_, _ = db.Memory.Remember(context.Background(), "x", nil)
	_, _ = db.Memory.Remember(context.Background(), "y", nil)
	assert.EqualValues(t, 2, f.sessions)
}

func TestRejectedTokenOpensANewSessionAndRetriesOnce(t *testing.T) {
	f := newFake(t)
	db := client(t, f)
	_, err := db.Memory.Remember(context.Background(), "x", nil)
	require.NoError(t, err)
	atomic.StoreInt32(&f.reject, 1)
	id, err := db.Memory.Remember(context.Background(), "y", nil)
	require.NoError(t, err)
	assert.NotEmpty(t, id)
	assert.EqualValues(t, 2, f.sessions)
	assert.Equal(t, "tok-2", f.headers.Get("x-claw-session"))
}

func TestPersistentlyRejectedSessionFailsWithAuthError(t *testing.T) {
	f := newFake(t)
	db := client(t, f)
	atomic.StoreInt32(&f.reject, 100)
	_, err := db.Memory.Remember(context.Background(), "x", nil)
	var apiErr *axonio.Error
	require.ErrorAs(t, err, &apiErr)
	assert.Equal(t, axonio.ErrorCodeAuth, apiErr.Code)
}

func TestSearchUsesQParameterAndSemanticByDefault(t *testing.T) {
	f := newFake(t)
	db := client(t, f)
	hits, err := db.Memory.Search(context.Background(), "dark-mode? & more", nil)
	require.NoError(t, err)
	require.Len(t, hits, 1)
	assert.Equal(t, "likes dark mode", hits[0].Content)
	assert.InDelta(t, 0.8, hits[0].Score, 0.001)
	assert.Equal(t, []string{"dark-mode? & more"}, f.lastQuery["q"])
	assert.Equal(t, []string{"5"}, f.lastQuery["top_k"])
	assert.Equal(t, []string{"true"}, f.lastQuery["semantic"])

	_, err = db.Memory.Search(context.Background(), "q", &axonio.SearchOptions{TopK: 9, KeywordOnly: true})
	require.NoError(t, err)
	assert.Equal(t, []string{"false"}, f.lastQuery["semantic"])
	assert.Equal(t, []string{"9"}, f.lastQuery["top_k"])
}

func TestSearchTopKLimit(t *testing.T) {
	f := newFake(t)
	_, err := client(t, f).Memory.Search(context.Background(), "x", &axonio.SearchOptions{TopK: 101})
	require.Error(t, err)
	assert.Empty(t, f.calls)
}

func TestListParsesTimestampsAndOffset(t *testing.T) {
	f := newFake(t)
	db := client(t, f)
	all, err := db.Memory.List(context.Background(), "", 3, 0)
	require.NoError(t, err)
	require.Len(t, all, 3)
	assert.Equal(t, 2026, all[0].CreatedAt.Year())
	assert.Equal(t, []string{"3"}, f.lastQuery["limit"])

	page, err := db.Memory.List(context.Background(), "", 2, 1)
	require.NoError(t, err)
	assert.Equal(t, []string{"3"}, f.lastQuery["limit"])
	assert.Equal(t, "2", page[0].ID)
}

func TestValidationHappensBeforeTheNetwork(t *testing.T) {
	f := newFake(t)
	db := client(t, f)
	_, err := db.Memory.Remember(context.Background(), "   ", nil)
	require.Error(t, err)
	_, err = db.Memory.Recall(context.Background(), nil)
	require.Error(t, err)
	_, err = db.Memory.Recall(context.Background(), []string{"not-a-uuid"})
	require.Error(t, err)
	assert.Empty(t, f.calls)
}

func TestErrorsCarryTheServersMessageAndStatus(t *testing.T) {
	f := newFake(t)
	_, err := client(t, f).Memory.Get(context.Background(), "missing")
	var apiErr *axonio.Error
	require.ErrorAs(t, err, &apiErr)
	assert.True(t, apiErr.IsNotFound())
	assert.Equal(t, "memory not found", apiErr.Message)
	assert.Equal(t, 404, apiErr.Status)
	assert.Equal(t, "req-1", apiErr.RequestID)
}

func TestTransientFailuresAreRetried(t *testing.T) {
	f := newFake(t)
	db := client(t, f)
	atomic.StoreInt32(&f.failures, 2)
	_, err := db.Health.Check(context.Background())
	require.NoError(t, err)
}

func TestHealthNeedsNoSession(t *testing.T) {
	f := newFake(t)
	status, err := client(t, f).Health.Check(context.Background())
	require.NoError(t, err)
	assert.True(t, status.OK)
	assert.Equal(t, []string{"GET /v1/health"}, f.calls)
}

func TestBranchesUseIdsFromTheServer(t *testing.T) {
	f := newFake(t)
	db := client(t, f)
	branches, err := db.Branch.List(context.Background(), "")
	require.NoError(t, err)
	assert.Equal(t, "b2", branches[1].BranchID)
	assert.Equal(t, "exp", branches[1].Name)

	diff, err := db.Branch.Diff(context.Background(), "b2", "")
	require.NoError(t, err)
	assert.Equal(t, 2, diff.Added)
	assert.Equal(t, 1, diff.Removed)
	assert.InDelta(t, 0.25, diff.DivergenceScore, 0.001)

	merge, err := db.Branch.Merge(context.Background(), "b2", "", "")
	require.NoError(t, err)
	assert.Equal(t, 3, merge.Applied)
	assert.Equal(t, 1, merge.Conflicts)
}

func TestAnAPIKeyAloneMeansTheCloud(t *testing.T) {
	for _, name := range []string{"AXONIO_URL", "AXONIO_ENDPOINT", "CLAWDB_URL", "CLAWDB_ENDPOINT", "AXONIO_API_KEY", "CLAWDB_API_KEY"} {
		t.Setenv(name, "")
	}
	db, err := axonio.FromAPIKey("ck_live_x", "")
	require.NoError(t, err)
	require.NotNil(t, db)
	assert.Equal(t, "https://api.axonio.xyz/api/v1/gateway", axonio.CloudEndpoint)

	t.Setenv("AXONIO_API_KEY", "ck_live_env")
	cfg := axonio.LoadConfig()
	assert.Equal(t, "ck_live_env", cfg.APIKey)
}

func TestEnvironmentNamesPreferAxonio(t *testing.T) {
	t.Setenv("CLAWDB_API_KEY", "old")
	assert.Equal(t, "old", axonio.LoadConfig().APIKey)
	t.Setenv("AXONIO_API_KEY", "new")
	assert.Equal(t, "new", axonio.LoadConfig().APIKey)
	t.Setenv("AXONIO_TIMEOUT_MS", "1500")
	assert.Equal(t, 1500*time.Millisecond, axonio.LoadConfig().Timeout)
}

func TestErrorCodes(t *testing.T) {
	for status, code := range map[int]axonio.ErrorCode{
		401: axonio.ErrorCodeAuth, 403: axonio.ErrorCodeAccessDenied, 404: axonio.ErrorCodeNotFound,
		429: axonio.ErrorCodeRateLimit, 503: axonio.ErrorCodeUnavailable, 504: axonio.ErrorCodeTimeout,
		422: axonio.ErrorCodeValidation, 500: axonio.ErrorCodeInternal,
	} {
		assert.Equal(t, code, axonio.FromHTTPResponse(status, `{"error":"x"}`).Code, "status %d", status)
	}
}

func TestSessionIsExpired(t *testing.T) {
	assert.False(t, (&axonio.Session{}).IsExpired())
	assert.True(t, (&axonio.Session{ExpiresAt: time.Now().Add(-time.Minute)}).IsExpired())
}

func TestOldNamesStillCompile(t *testing.T) {
	var _ *axonio.ClawDB = (*axonio.Axonio)(nil)
	var _ *axonio.ClawDBError = (*axonio.Error)(nil)
}

// Live test against a real server: AXONIO_LIVE_KEY=ck_live_... go test -run Live
func TestLiveCloud(t *testing.T) {
	key := os.Getenv("AXONIO_LIVE_KEY")
	if key == "" {
		t.Skip("set AXONIO_LIVE_KEY to run against the Axonio cloud")
	}
	db, err := axonio.FromAPIKey(key, "")
	require.NoError(t, err)
	ctx := context.Background()
	id, err := db.Memory.Remember(ctx, "go sdk live test: the user prefers dark mode", &axonio.RememberOptions{Tags: []string{"go-sdk-live-test"}})
	require.NoError(t, err)
	defer db.Memory.Forget(ctx, id)
	time.Sleep(time.Second)
	hits, err := db.Memory.Search(ctx, "which theme does the user like", nil)
	require.NoError(t, err)
	found := false
	for _, h := range hits {
		found = found || h.ID == id
	}
	assert.True(t, found, "paraphrase search should find the memory")
	rec, err := db.Memory.Get(ctx, id)
	require.NoError(t, err)
	assert.Equal(t, id, rec.ID)
}
