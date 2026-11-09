package clawdb_test

import (
	"context"
	"os"
	"testing"

	clawdb "github.com/Claw-DB/claw-sdk/sdks/go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMain(m *testing.M) {
	if os.Getenv("CLAWDB_INTEGRATION") != "1" {
		os.Exit(0) // skip integration tests in CI by default
	}
	os.Exit(m.Run())
}

func TestNew_DefaultConfig(t *testing.T) {
	db, err := clawdb.New()
	require.NoError(t, err)
	assert.NotNil(t, db)
	db.Close()
}

func TestFromAPIKey(t *testing.T) {
	db, err := clawdb.FromAPIKey("test-key", "http://localhost:50050")
	require.NoError(t, err)
	assert.NotNil(t, db)
	db.Close()
}

func TestMemory_RememberEmpty(t *testing.T) {
	db, _ := clawdb.New(clawdb.Options{Endpoint: "http://localhost:50050"})
	_, err := db.Memory.Remember(context.Background(), "", nil)
	assert.Error(t, err)
	cErr, ok := err.(*clawdb.ClawDBError)
	require.True(t, ok)
	assert.Equal(t, clawdb.ErrorCodeValidation, cErr.Code)
}

func TestMemory_SearchTopKExceeded(t *testing.T) {
	db, _ := clawdb.New()
	_, err := db.Memory.Search(context.Background(), "query", &clawdb.SearchOptions{TopK: 101})
	assert.Error(t, err)
}

func TestMemory_RecallEmpty(t *testing.T) {
	db, _ := clawdb.New()
	_, err := db.Memory.Recall(context.Background(), []string{})
	assert.Error(t, err)
}

func TestErrorCodes(t *testing.T) {
	err401 := clawdb.FromHTTPResponse(401, "unauthorized")
	assert.Equal(t, clawdb.ErrorCodeAuth, err401.Code)

	err404 := clawdb.FromHTTPResponse(404, "not found")
	assert.Equal(t, clawdb.ErrorCodeNotFound, err404.Code)

	err429 := clawdb.FromHTTPResponse(429, "rate limited")
	assert.Equal(t, clawdb.ErrorCodeRateLimit, err429.Code)
	assert.True(t, err429.IsRateLimited())

	err503 := clawdb.FromHTTPResponse(503, "unavailable")
	assert.True(t, err503.IsRetriable())
}

func TestSession_IsExpired(t *testing.T) {
	s := &clawdb.Session{}
	assert.False(t, s.IsExpired())
}

func TestConfig_LoadFromEnv(t *testing.T) {
	t.Setenv("CLAWDB_ENDPOINT", "http://custom:9090")
	t.Setenv("CLAWDB_API_KEY", "key123")
	cfg := clawdb.LoadConfig()
	assert.Equal(t, "http://custom:9090", cfg.Endpoint)
	assert.Equal(t, "key123", cfg.APIKey)
}
