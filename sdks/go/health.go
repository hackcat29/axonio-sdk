package axonio

import (
	"context"
	"net/http"
)

// HealthStatus reports server health information.
type HealthStatus struct {
	OK         bool                   `json:"ok"`
	Status     string                 `json:"status"`
	Version    string                 `json:"version"`
	Components map[string]interface{} `json:"components"`
	UptimeSecs float64                `json:"uptime_secs"`
	RequestID  string                 `json:"request_id"`
}

// HealthClient checks service readiness. It needs no session.
type HealthClient struct {
	*httpClient
}

// Check reports the health of the configured endpoint. GET /v1/health
func (h *HealthClient) Check(ctx context.Context) (*HealthStatus, error) {
	out, err := h.core.callPublic(ctx, http.MethodGet, "/v1/health")
	if err != nil {
		return nil, err
	}
	var status HealthStatus
	decodeInto(out, &status)
	status.OK = status.OK || status.Status == "ok" || status.Status == "healthy"
	return &status, nil
}

// Ready checks readiness. GET /v1/ready
func (h *HealthClient) Ready(ctx context.Context) (bool, error) {
	if _, err := h.core.callPublic(ctx, http.MethodGet, "/v1/ready"); err != nil {
		return false, err
	}
	return true, nil
}
