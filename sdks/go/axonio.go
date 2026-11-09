// Package axonio is the Go SDK for Axonio: persistent memory for AI agents.
//
// Quick start (reads AXONIO_API_KEY; talks to the Axonio cloud):
//
//	db, err := axonio.New()
//	if err != nil { log.Fatal(err) }
//	defer db.Close()
//
//	id, err := db.Memory.Remember(ctx, "User prefers dark mode", nil)
//	hits, err := db.Memory.Search(ctx, "what theme does the user like?", nil)
//
// For a self-hosted server pass axonio.WithEndpoint("https://db.example.com"),
// or set AXONIO_URL.
package axonio

import "context"

// Version is the current SDK version.
const Version = "0.2.0"

// Axonio is the top-level client.
type Axonio struct {
	cfg  *Config
	core *core

	Memory  *MemoryClient
	Branch  *BranchesClient
	Sync    *SyncClient
	Reflect *ReflectClient
	Session *SessionClient
	Health  *HealthClient
	Tx      *TxClient
}

// ClawDB is the name this client had before the rename to Axonio.
type ClawDB = Axonio

// New creates a client from functional options and/or an Options struct. With
// only an API key (option or AXONIO_API_KEY) it talks to the Axonio cloud. A
// session is opened on the first call and renewed automatically.
func New(args ...interface{}) (*Axonio, error) {
	cfg := LoadConfig()
	for _, arg := range args {
		switch value := arg.(type) {
		case Option:
			value(cfg)
		case Options:
			applyOptionsStruct(cfg, value)
		case *Options:
			if value != nil {
				applyOptionsStruct(cfg, *value)
			}
		}
	}
	if !cfg.endpointSet && cfg.APIKey != "" {
		cfg.Endpoint = CloudEndpoint
	}
	return build(cfg), nil
}

// AutoProvision is New plus a search for a server: with no endpoint and no API
// key it uses a running local clawdb-server, starting one if it is installed.
func AutoProvision(args ...interface{}) (*Axonio, error) {
	cfg := LoadConfig()
	for _, arg := range args {
		switch value := arg.(type) {
		case Option:
			value(cfg)
		case Options:
			applyOptionsStruct(cfg, value)
		case *Options:
			if value != nil {
				applyOptionsStruct(cfg, *value)
			}
		}
	}
	if err := resolveEndpoint(cfg); err != nil {
		return nil, err
	}
	return build(cfg), nil
}

func build(cfg *Config) *Axonio {
	c := newCore(cfg)
	db := &Axonio{cfg: cfg, core: c}
	db.Memory = &MemoryClient{&httpClient{c}}
	db.Branch = &BranchesClient{&httpClient{c}}
	db.Sync = &SyncClient{&httpClient{c}}
	db.Reflect = &ReflectClient{&httpClient{c}}
	db.Session = &SessionClient{&httpClient{c}}
	db.Health = &HealthClient{&httpClient{c}}
	db.Tx = &TxClient{&httpClient{c}}
	return db
}

// FromEnv creates a client from environment variables.
func FromEnv() (*Axonio, error) {
	return New()
}

// FromAPIKey creates a client with an explicit API key. An empty endpoint
// means the Axonio cloud.
func FromAPIKey(apiKey, endpoint string) (*Axonio, error) {
	return New(Options{APIKey: apiKey, Endpoint: endpoint})
}

// Connect opens the session now instead of on the first call, so a bad key
// fails here.
func (db *Axonio) Connect(ctx context.Context) error {
	return db.core.ensureSession(ctx)
}

// Close revokes the session, if one is open. It is safe to call more than once.
func (db *Axonio) Close() {
	db.core.mu.Lock()
	id := db.core.sessionID
	db.core.mu.Unlock()
	if id != "" {
		_, _ = db.Session.Revoke(context.Background(), id)
	}
	db.core.forgetSession()
}
