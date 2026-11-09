package axonio

import "context"

// TxClient provides transactional memory operations.
type TxClient struct {
	*httpClient
}

func (t *TxClient) memoryID(out interface{}) string {
	id, _ := asMap(out)["memory_id"].(string)
	return id
}

// Begin starts a transaction. POST /v1/tx
func (t *TxClient) Begin(ctx context.Context) (string, error) {
	out, err := t.post(ctx, "/v1/tx", nil)
	if err != nil {
		return "", err
	}
	txID, _ := asMap(out)["tx_id"].(string)
	return txID, nil
}

// Remember adds a memory to a transaction. POST /v1/tx/:id/memories
func (t *TxClient) Remember(ctx context.Context, txID, content string) (string, error) {
	if err := requireContent(content); err != nil {
		return "", err
	}
	out, err := t.post(ctx, "/v1/tx/"+seg(txID)+"/memories", map[string]interface{}{"content": content})
	if err != nil {
		return "", err
	}
	return t.memoryID(out), nil
}

// RememberTyped adds a typed memory to a transaction. POST /v1/tx/:id/memories/typed
func (t *TxClient) RememberTyped(ctx context.Context, txID, content, memType string, tags []string, metadata map[string]interface{}) (string, error) {
	if err := requireContent(content); err != nil {
		return "", err
	}
	if memType == "" {
		memType = "context"
	}
	if tags == nil {
		tags = []string{}
	}
	if metadata == nil {
		metadata = map[string]interface{}{}
	}
	out, err := t.post(ctx, "/v1/tx/"+seg(txID)+"/memories/typed", map[string]interface{}{
		"content": content, "type": memType, "tags": tags, "metadata": metadata,
	})
	if err != nil {
		return "", err
	}
	return t.memoryID(out), nil
}

// Commit commits a transaction. POST /v1/tx/:id/commit
func (t *TxClient) Commit(ctx context.Context, txID string) (bool, error) {
	out, err := t.post(ctx, "/v1/tx/"+seg(txID)+"/commit", nil)
	if err != nil {
		return false, err
	}
	committed, _ := asMap(out)["committed"].(bool)
	return committed, nil
}

// Rollback rolls back a transaction. POST /v1/tx/:id/rollback
func (t *TxClient) Rollback(ctx context.Context, txID string) (bool, error) {
	out, err := t.post(ctx, "/v1/tx/"+seg(txID)+"/rollback", nil)
	if err != nil {
		return false, err
	}
	rolledBack, _ := asMap(out)["rolled_back"].(bool)
	return rolledBack, nil
}
