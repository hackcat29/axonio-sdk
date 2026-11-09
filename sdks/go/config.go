package axonio

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds the client settings.
type Config struct {
	Endpoint  string
	APIKey    string
	AgentID   string
	Workspace string
	Role      string
	Region    string
	Timeout   time.Duration
	TLS       bool
	LogLevel  string

	endpointSet bool
}

// DefaultConfig returns a Config populated with defaults.
func DefaultConfig() *Config {
	return &Config{
		Endpoint:  "http://localhost:50050",
		AgentID:   "default-agent",
		Workspace: "default",
		Role:      "assistant",
		Region:    "local",
		Timeout:   30 * time.Second,
		LogLevel:  "info",
	}
}

// env returns the first non-empty AXONIO_<name>, then CLAWDB_<name>.
func env(names ...string) string {
	for _, name := range names {
		for _, prefix := range []string{"AXONIO_", "CLAWDB_"} {
			if v := strings.TrimSpace(os.Getenv(prefix + name)); v != "" {
				return v
			}
		}
	}
	return ""
}

// LoadConfig builds a Config from environment variables (AXONIO_*, with the
// older CLAWDB_* names as a fallback), then defaults.
func LoadConfig() *Config {
	cfg := DefaultConfig()
	if v := env("URL", "ENDPOINT"); v != "" {
		cfg.Endpoint = v
		cfg.endpointSet = true
	}
	if v := env("API_KEY"); v != "" {
		cfg.APIKey = v
	}
	if v := env("AGENT_ID"); v != "" {
		cfg.AgentID = v
	}
	if v := env("WORKSPACE"); v != "" {
		cfg.Workspace = v
	}
	if v := env("ROLE"); v != "" {
		cfg.Role = v
	}
	if v := env("REGION"); v != "" {
		cfg.Region = v
	}
	if v := env("TIMEOUT_MS"); v != "" {
		if ms, err := strconv.ParseInt(v, 10, 64); err == nil && ms > 0 {
			cfg.Timeout = time.Duration(ms) * time.Millisecond
		}
	}
	if v := env("TLS"); v == "true" || v == "1" {
		cfg.TLS = true
	}
	return cfg
}
