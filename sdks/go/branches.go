package axonio

import (
	"context"
	"encoding/json"
	"net/url"
)

// BranchesClient provides branch management operations.
type BranchesClient struct {
	*httpClient
}

// Fork creates a branch. `from` is a branch id; empty means trunk. POST /v1/branches
func (b *BranchesClient) Fork(ctx context.Context, name string, from string) (*BranchInfo, error) {
	payload := map[string]interface{}{"name": name}
	if uuidRE.MatchString(from) {
		payload["from"] = from
	}
	out, err := b.post(ctx, "/v1/branches", payload)
	if err != nil {
		return nil, err
	}
	info := branchFrom(out)
	if info.Name == "" {
		info.Name = name
	}
	return &info, nil
}

// List returns all branches. GET /v1/branches
func (b *BranchesClient) List(ctx context.Context, status string) ([]BranchInfo, error) {
	out, err := b.get(ctx, "/v1/branches", nil)
	if err != nil {
		return nil, err
	}
	items := asList(out)
	branches := make([]BranchInfo, 0, len(items))
	for _, item := range items {
		branches = append(branches, branchFrom(item))
	}
	return branches, nil
}

// GetTrunk returns the trunk branch. GET /v1/branches/trunk
func (b *BranchesClient) GetTrunk(ctx context.Context) (*BranchInfo, error) {
	return b.one(ctx, "/v1/branches/trunk")
}

// GetByName returns a branch by name. GET /v1/branches/by-name/:name
func (b *BranchesClient) GetByName(ctx context.Context, name string) (*BranchInfo, error) {
	return b.one(ctx, "/v1/branches/by-name/"+seg(name))
}

// Get returns a branch by id. GET /v1/branches/:id
func (b *BranchesClient) Get(ctx context.Context, branchID string) (*BranchInfo, error) {
	return b.one(ctx, "/v1/branches/"+seg(branchID))
}

func (b *BranchesClient) one(ctx context.Context, path string) (*BranchInfo, error) {
	out, err := b.get(ctx, path, nil)
	if err != nil {
		return nil, err
	}
	info := branchFrom(out)
	return &info, nil
}

// Discard deletes a branch. DELETE /v1/branches/:id
func (b *BranchesClient) Discard(ctx context.Context, branchID string) error {
	_, err := b.delete(ctx, "/v1/branches/"+seg(branchID))
	return err
}

// Archive archives a branch. POST /v1/branches/:id/archive
func (b *BranchesClient) Archive(ctx context.Context, branchID string) error {
	_, err := b.post(ctx, "/v1/branches/"+seg(branchID)+"/archive", nil)
	return err
}

// Merge merges the source branch (id or name) into target (id, name, or empty
// for trunk). POST /v1/branches/:source/merge
func (b *BranchesClient) Merge(ctx context.Context, source, target, strategy string) (*MergeResult, error) {
	body := map[string]interface{}{"target": target}
	if strategy != "" {
		body["strategy"] = strategy
	}
	out, err := b.post(ctx, "/v1/branches/"+seg(source)+"/merge", body)
	if err != nil {
		return nil, err
	}
	m := asMap(out)
	result := &MergeResult{Success: true}
	if v, ok := m["success"].(bool); ok {
		result.Success = v
	}
	result.Applied = intOf(m["applied"])
	result.Skipped = intOf(m["skipped"])
	result.DurationMs = intOf(m["duration_ms"])
	if conflicts, ok := m["conflicts"].([]interface{}); ok {
		result.Conflicts = len(conflicts)
	} else {
		result.Conflicts = intOf(m["conflicts"])
	}
	result.RequestID, _ = m["request_id"].(string)
	return result, nil
}

// Diff compares a branch with target (id, name, or empty for trunk).
// GET /v1/branches/:id/diff
func (b *BranchesClient) Diff(ctx context.Context, branchID, target string) (*DiffResult, error) {
	out, err := b.get(ctx, "/v1/branches/"+seg(branchID)+"/diff", url.Values{"target": {target}})
	if err != nil {
		return nil, err
	}
	m := asMap(out)
	stats := asMap(m["stats"])
	pick := func(key string) int {
		if v, ok := stats[key]; ok {
			return intOf(v)
		}
		return intOf(m[key])
	}
	raw, _ := json.Marshal(m)
	result := &DiffResult{
		Added: pick("added"), Removed: pick("removed"), Modified: pick("modified"), Unchanged: pick("unchanged"),
		DiffJSON: string(raw),
	}
	result.DivergenceScore, _ = m["divergence_score"].(float64)
	result.RequestID, _ = m["request_id"].(string)
	return result, nil
}

func intOf(v interface{}) int {
	f, _ := v.(float64)
	return int(f)
}
