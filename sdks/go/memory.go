package axonio

import (
	"context"
	"net/url"
	"strconv"
)

// MemoryClient provides memory operations.
type MemoryClient struct {
	*httpClient
}

func memoryPayload(content string, opts *RememberOptions) map[string]interface{} {
	payload := map[string]interface{}{"content": content, "type": "context", "tags": []string{}, "metadata": map[string]interface{}{}}
	if opts != nil {
		if opts.MemoryType != "" {
			payload["type"] = string(opts.MemoryType)
		}
		if opts.Tags != nil {
			payload["tags"] = opts.Tags
		}
		if opts.Metadata != nil {
			payload["metadata"] = opts.Metadata
		}
	}
	return payload
}

func requireContent(content string) error {
	if len(content) == 0 || len(trimSpace(content)) == 0 {
		return &Error{Code: ErrorCodeValidation, Message: "content must be a non-empty string"}
	}
	return nil
}

func trimSpace(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\n' || s[start] == '\t' || s[start] == '\r') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\n' || s[end-1] == '\t' || s[end-1] == '\r') {
		end--
	}
	return s[start:end]
}

// Remember stores a memory and returns its id. POST /v1/memories
func (m *MemoryClient) Remember(ctx context.Context, content string, opts *RememberOptions) (string, error) {
	if err := requireContent(content); err != nil {
		return "", err
	}
	out, err := m.post(ctx, "/v1/memories", memoryPayload(content, opts))
	if err != nil {
		return "", err
	}
	id, _ := asMap(out)["memory_id"].(string)
	return id, nil
}

// RememberTyped is Remember; kept for compatibility with the other SDKs.
func (m *MemoryClient) RememberTyped(ctx context.Context, content string, opts *RememberOptions) (string, error) {
	return m.Remember(ctx, content, opts)
}

// Update replaces a memory's content. PATCH /v1/memories/:id
func (m *MemoryClient) Update(ctx context.Context, memoryID, content string) (bool, error) {
	if err := requireContent(content); err != nil {
		return false, err
	}
	out, err := m.patch(ctx, "/v1/memories/"+seg(memoryID), map[string]interface{}{"content": content})
	if err != nil {
		return false, err
	}
	updated, _ := asMap(out)["updated"].(bool)
	return updated, nil
}

// Search finds memories by meaning and keywords. Punctuation and hyphens in
// the query are safe. GET /v1/memories/search
func (m *MemoryClient) Search(ctx context.Context, query string, opts *SearchOptions) ([]SearchHit, error) {
	topK, semantic := 5, true
	if opts != nil {
		if opts.TopK > 0 {
			topK = opts.TopK
		}
		semantic = !opts.KeywordOnly
	}
	if topK > 100 {
		return nil, &Error{Code: ErrorCodeValidation, Message: "top_k cannot exceed 100"}
	}
	q := url.Values{"q": {query}, "top_k": {strconv.Itoa(topK)}, "semantic": {strconv.FormatBool(semantic)}}
	out, err := m.get(ctx, "/v1/memories/search", q)
	if err != nil {
		return nil, err
	}
	var hits []SearchHit
	decodeInto(asList(out), &hits)
	return hits, nil
}

// Get retrieves one memory. GET /v1/memories/:id
func (m *MemoryClient) Get(ctx context.Context, memoryID string) (*MemoryRecord, error) {
	out, err := m.get(ctx, "/v1/memories/"+seg(memoryID), nil)
	if err != nil {
		return nil, err
	}
	var rec MemoryRecord
	decodeInto(out, &rec)
	return &rec, nil
}

// Recall retrieves specific memories by id.
func (m *MemoryClient) Recall(ctx context.Context, memoryIDs []string) ([]MemoryRecord, error) {
	if len(memoryIDs) == 0 {
		return nil, &Error{Code: ErrorCodeValidation, Message: "memory_ids must be non-empty"}
	}
	records := make([]MemoryRecord, 0, len(memoryIDs))
	for _, id := range memoryIDs {
		if !uuidRE.MatchString(id) {
			return nil, &Error{Code: ErrorCodeValidation, Message: "invalid UUID: " + id}
		}
		rec, err := m.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		records = append(records, *rec)
	}
	return records, nil
}

// Forget deletes a memory. DELETE /v1/memories/:id
func (m *MemoryClient) Forget(ctx context.Context, memoryID string) error {
	_, err := m.delete(ctx, "/v1/memories/"+seg(memoryID))
	return err
}

// List returns the newest memories first. The server has no paging offset, so a
// non-zero offset skips that many results on the client. GET /v1/memories
func (m *MemoryClient) List(ctx context.Context, memoryType string, limit, offset int) ([]MemoryRecord, error) {
	if limit <= 0 {
		limit = 50
	}
	q := url.Values{"limit": {strconv.Itoa(limit + offset)}}
	if memoryType != "" {
		q.Set("type", memoryType)
	}
	out, err := m.get(ctx, "/v1/memories", q)
	if err != nil {
		return nil, err
	}
	var memories []MemoryRecord
	decodeInto(asList(out), &memories)
	if offset > 0 {
		if offset >= len(memories) {
			return []MemoryRecord{}, nil
		}
		memories = memories[offset:]
	}
	return memories, nil
}
