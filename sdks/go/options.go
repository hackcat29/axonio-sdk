package axonio

import "time"

// Option is a functional option for configuring the client.
type Option func(*Config)

// WithEndpoint sets the server endpoint.
func WithEndpoint(endpoint string) Option {
	return func(c *Config) { c.Endpoint = endpoint; c.endpointSet = true }
}

// WithAPIKey sets the API key.
func WithAPIKey(apiKey string) Option {
	return func(c *Config) { c.APIKey = apiKey }
}

// WithAgentID sets the agent identifier.
func WithAgentID(agentID string) Option {
	return func(c *Config) { c.AgentID = agentID }
}

// WithWorkspace sets the workspace name.
func WithWorkspace(workspace string) Option {
	return func(c *Config) { c.Workspace = workspace }
}

// WithRole sets the agent role.
func WithRole(role string) Option {
	return func(c *Config) { c.Role = role }
}

// WithTimeout sets the request timeout.
func WithTimeout(d time.Duration) Option {
	return func(c *Config) { c.Timeout = d }
}

// WithTLS enables TLS.
func WithTLS(enabled bool) Option {
	return func(c *Config) { c.TLS = enabled }
}

// WithInsecure disables TLS (convenience alias).
func WithInsecure() Option {
	return WithTLS(false)
}
