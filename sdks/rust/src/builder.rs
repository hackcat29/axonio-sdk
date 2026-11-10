use std::env;

use crate::client::Axonio;
use crate::error::Result;
use crate::transport::CLOUD_ENDPOINT;

/// Builds an [`Axonio`] client.
#[derive(Debug, Default, Clone)]
pub struct AxonioBuilder {
    endpoint: Option<String>,
    api_key: Option<String>,
    agent_id: Option<String>,
    role: Option<String>,
    timeout_ms: Option<u64>,
}

/// The first non-empty `AXONIO_<name>`, then `CLAWDB_<name>`.
fn env_var(names: &[&str]) -> Option<String> {
    for name in names {
        for prefix in ["AXONIO_", "CLAWDB_"] {
            if let Ok(v) = env::var(format!("{prefix}{name}")) {
                let v = v.trim().to_string();
                if !v.is_empty() {
                    return Some(v);
                }
            }
        }
    }
    None
}

impl AxonioBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Server URL. Leave unset to use the Axonio cloud (with an API key) or a
    /// local server on `http://localhost:50050`.
    pub fn endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.endpoint = Some(endpoint.into());
        self
    }

    pub fn api_key(mut self, api_key: impl Into<String>) -> Self {
        self.api_key = Some(api_key.into());
        self
    }

    /// Any name; it maps to a stable UUID.
    pub fn agent_id(mut self, agent_id: impl Into<String>) -> Self {
        self.agent_id = Some(agent_id.into());
        self
    }

    pub fn role(mut self, role: impl Into<String>) -> Self {
        self.role = Some(role.into());
        self
    }

    pub fn timeout_ms(mut self, ms: u64) -> Self {
        self.timeout_ms = Some(ms);
        self
    }

    /// Reads `AXONIO_URL` / `AXONIO_ENDPOINT`, `AXONIO_API_KEY`, `AXONIO_AGENT_ID`,
    /// `AXONIO_ROLE` and `AXONIO_TIMEOUT_MS`, falling back to the older `CLAWDB_*`
    /// names. Values already set on the builder win.
    pub fn from_env() -> Self {
        Self {
            endpoint: env_var(&["URL", "ENDPOINT"]),
            api_key: env_var(&["API_KEY"]),
            agent_id: env_var(&["AGENT_ID"]),
            role: env_var(&["ROLE"]),
            timeout_ms: env_var(&["TIMEOUT_MS"]).and_then(|v| v.parse().ok()),
        }
    }

    /// Fills unset fields from the environment.
    pub fn with_env(self) -> Self {
        let env = Self::from_env();
        Self {
            endpoint: self.endpoint.or(env.endpoint),
            api_key: self.api_key.or(env.api_key),
            agent_id: self.agent_id.or(env.agent_id),
            role: self.role.or(env.role),
            timeout_ms: self.timeout_ms.or(env.timeout_ms),
        }
    }

    /// Builds the client. No network call happens until the first request.
    pub fn build(self) -> Result<Axonio> {
        let api_key = self.api_key.unwrap_or_default();
        let endpoint = match self.endpoint {
            Some(e) => e,
            None if !api_key.is_empty() => CLOUD_ENDPOINT.to_string(),
            None => "http://localhost:50050".to_string(),
        };
        Axonio::new_internal(
            endpoint,
            api_key,
            self.agent_id.unwrap_or_else(|| "default-agent".into()),
            self.role.unwrap_or_else(|| "assistant".into()),
            self.timeout_ms.unwrap_or(30_000),
        )
    }
}
