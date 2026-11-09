package axonio

import "time"

// Session holds an authenticated session.
type Session struct {
	ID        string    `json:"id"`
	SessionID string    `json:"session_id"`
	Token     string    `json:"token"`
	AgentID   string    `json:"agent_id"`
	Role      string    `json:"role"`
	Scopes    []string  `json:"scopes"`
	ExpiresAt time.Time `json:"expires_at"`
}

// IsExpired returns true if the session has passed its expiry.
func (s *Session) IsExpired() bool {
	if s.ExpiresAt.IsZero() {
		return false
	}
	return time.Now().After(s.ExpiresAt)
}
