package axonio

import (
	"context"
	"encoding/json"
)

// SyncClient manages synchronisation with the Axonio cloud.
type SyncClient struct {
	*httpClient
}

// Sync pushes then pulls. POST /v1/sync
func (s *SyncClient) Sync(ctx context.Context) (*SyncResult, error) {
	out, err := s.post(ctx, "/v1/sync", nil)
	if err != nil {
		return nil, err
	}
	var result SyncResult
	decodeInto(out, &result)
	return &result, nil
}

func (s *SyncClient) action(ctx context.Context, path string) (*SyncActionResult, error) {
	out, err := s.post(ctx, path, nil)
	if err != nil {
		return nil, err
	}
	raw, _ := json.Marshal(out)
	result := &SyncActionResult{SummaryJSON: string(raw)}
	result.RequestID, _ = asMap(out)["request_id"].(string)
	return result, nil
}

// Push pushes local memories to the cloud. POST /v1/sync/push
func (s *SyncClient) Push(ctx context.Context) (*SyncActionResult, error) {
	return s.action(ctx, "/v1/sync/push")
}

// Pull pulls remote memories from the cloud. POST /v1/sync/pull
func (s *SyncClient) Pull(ctx context.Context) (*SyncActionResult, error) {
	return s.action(ctx, "/v1/sync/pull")
}

// Reconcile reconciles divergent state. POST /v1/sync/reconcile
func (s *SyncClient) Reconcile(ctx context.Context) (*SyncActionResult, error) {
	return s.action(ctx, "/v1/sync/reconcile")
}

// Status returns sync status. GET /v1/sync/status
func (s *SyncClient) Status(ctx context.Context) (*SyncStatusResult, error) {
	out, err := s.get(ctx, "/v1/sync/status", nil)
	if err != nil {
		return nil, err
	}
	raw, _ := json.Marshal(out)
	result := &SyncStatusResult{StatusJSON: string(raw)}
	result.RequestID, _ = asMap(out)["request_id"].(string)
	return result, nil
}
