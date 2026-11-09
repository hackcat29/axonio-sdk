package axonio

import "context"

// SessionClient provides session operations. The client opens and renews its
// own session; use this to inspect or end sessions.
type SessionClient struct {
	*httpClient
}

// Create opens a new session for agentID (any name; it maps to a stable UUID)
// and makes it the one the client uses.
func (s *SessionClient) Create(ctx context.Context, agentID, role string, scopes []string, ttlSecs int) (*Session, error) {
	out, err := s.core.openSession(ctx, agentID, role, scopes, ttlSecs)
	if err != nil {
		return nil, err
	}
	var sess Session
	decodeInto(out, &sess)
	return &sess, nil
}

// Validate returns the current session. GET /v1/sessions/me
func (s *SessionClient) Validate(ctx context.Context) (map[string]interface{}, error) {
	out, err := s.get(ctx, "/v1/sessions/me", nil)
	return asMap(out), err
}

// Revoke ends a session by id. DELETE /v1/sessions/:id
func (s *SessionClient) Revoke(ctx context.Context, sessionID string) (bool, error) {
	if _, err := s.delete(ctx, "/v1/sessions/"+seg(sessionID)); err != nil {
		return false, err
	}
	return true, nil
}

// ActiveCount returns the number of active sessions. GET /v1/sessions/active/count
func (s *SessionClient) ActiveCount(ctx context.Context) (int, error) {
	out, err := s.get(ctx, "/v1/sessions/active/count", nil)
	if err != nil {
		return 0, err
	}
	count, _ := asMap(out)["count"].(float64)
	return int(count), nil
}
