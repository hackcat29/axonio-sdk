package axonio

import (
	"context"
	"encoding/json"
	"net/url"
	"strconv"
)

// ReflectClient triggers and monitors reflection jobs.
type ReflectClient struct {
	*httpClient
}

// Trigger starts a reflection job. POST /v1/reflect
func (r *ReflectClient) Trigger(ctx context.Context) (*ReflectJob, error) {
	out, err := r.post(ctx, "/v1/reflect", nil)
	if err != nil {
		return nil, err
	}
	var job ReflectJob
	decodeInto(out, &job)
	return &job, nil
}

// ListJobs lists reflection jobs. GET /v1/reflect/jobs
func (r *ReflectClient) ListJobs(ctx context.Context, agentID, status string, limit, offset int) ([]ReflectJob, error) {
	q := url.Values{}
	if agentID != "" {
		q.Set("agent_id", agentID)
	}
	if status != "" {
		q.Set("status", status)
	}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		q.Set("offset", strconv.Itoa(offset))
	}
	out, err := r.get(ctx, "/v1/reflect/jobs", q)
	if err != nil {
		return nil, err
	}
	// The server answers with either a bare list or {"jobs": [...]}.
	list := asList(out)
	if list == nil {
		list = asList(asMap(out)["jobs"])
	}
	var jobs []ReflectJob
	decodeInto(list, &jobs)
	return jobs, nil
}

// GetJob fetches a job. GET /v1/reflect/jobs/:job_id
func (r *ReflectClient) GetJob(ctx context.Context, jobID string) (*ReflectJob, error) {
	out, err := r.get(ctx, "/v1/reflect/jobs/"+seg(jobID), nil)
	if err != nil {
		return nil, err
	}
	var job ReflectJob
	decodeInto(out, &job)
	return &job, nil
}

func (r *ReflectClient) fetch(ctx context.Context, path string) (map[string]interface{}, error) {
	out, err := r.get(ctx, path, nil)
	if err != nil {
		return nil, err
	}
	if m, ok := out.(map[string]interface{}); ok {
		return m, nil
	}
	return map[string]interface{}{"items": out}, nil
}

// GetFacts returns extracted facts for an agent. GET /v1/reflect/facts/:agent_id
func (r *ReflectClient) GetFacts(ctx context.Context, agentID string) (map[string]interface{}, error) {
	return r.fetch(ctx, "/v1/reflect/facts/"+seg(agentID))
}

// GetPreferences returns learned preferences for an agent. GET /v1/reflect/preferences/:agent_id
func (r *ReflectClient) GetPreferences(ctx context.Context, agentID string) (map[string]interface{}, error) {
	return r.fetch(ctx, "/v1/reflect/preferences/"+seg(agentID))
}

// GetContradictions returns contradictions for an agent. GET /v1/reflect/contradictions/:agent_id
func (r *ReflectClient) GetContradictions(ctx context.Context, agentID string) (map[string]interface{}, error) {
	return r.fetch(ctx, "/v1/reflect/contradictions/"+seg(agentID))
}

// ResolveContradiction resolves a contradiction. mergedValueJSON is the merged
// value as JSON (or empty).
func (r *ReflectClient) ResolveContradiction(ctx context.Context, agentID, contradictionID, strategy, mergedValueJSON string) (map[string]interface{}, error) {
	var merged interface{}
	if mergedValueJSON != "" {
		if err := json.Unmarshal([]byte(mergedValueJSON), &merged); err != nil {
			merged = mergedValueJSON
		}
	}
	out, err := r.post(ctx, "/v1/reflect/contradictions/"+seg(agentID)+"/"+seg(contradictionID)+"/resolve",
		map[string]interface{}{"strategy": strategy, "merged_value": merged})
	if err != nil {
		return nil, err
	}
	if m, ok := out.(map[string]interface{}); ok {
		return m, nil
	}
	return map[string]interface{}{"result": out}, nil
}
