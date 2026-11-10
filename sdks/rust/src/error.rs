use thiserror::Error;

/// Everything a call can fail with.
#[derive(Debug, Error)]
pub enum Error {
    /// The API key or session was rejected.
    #[error("authentication failed: {0}")]
    Auth(String),

    /// The key is valid but lacks the scope or plan for this call.
    #[error("access denied: {0}")]
    AccessDenied(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("rate limited; retry after {retry_after_ms}ms")]
    RateLimit { retry_after_ms: u64 },

    #[error("service unavailable: {0}")]
    Unavailable(String),

    #[error("request timed out after {timeout_ms}ms")]
    Timeout { timeout_ms: u64 },

    #[error("invalid `{field}`: {constraint}")]
    Validation { field: String, constraint: String },

    #[error("configuration error: {0}")]
    Config(String),

    /// Any other error response.
    #[error("HTTP {status}: {body}")]
    Http { status: u16, body: String },

    #[error("JSON error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("invalid URL: {0}")]
    InvalidUrl(#[from] url::ParseError),

    #[error("network error: {0}")]
    Network(String),
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    /// Whether retrying the same call later may succeed.
    pub fn is_retriable(&self) -> bool {
        matches!(
            self,
            Error::Unavailable(_)
                | Error::RateLimit { .. }
                | Error::Timeout { .. }
                | Error::Network(_)
        )
    }

    /// Maps an error response to an [`Error`], using the server's own message
    /// when it sent one. `retry_after_ms` comes from a `Retry-After` header.
    pub fn from_http(status: u16, body: &str, retry_after_ms: Option<u64>) -> Self {
        let parsed: Option<serde_json::Value> = serde_json::from_str(body).ok();
        let mut message = parsed
            .as_ref()
            .and_then(|v| v.get("error").or_else(|| v.get("message")))
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| body.to_string());
        if let Some(v) = &parsed {
            if let Some(detail) = v.get("detail").and_then(|d| d.as_str()) {
                message = format!("{message}: {detail}");
            } else if let Some(req) = v.get("required").and_then(|d| d.as_str()) {
                message = format!("{message}: requires {req}");
            }
        }
        match status {
            401 => Error::Auth(message),
            402 | 403 => Error::AccessDenied(message),
            404 => Error::NotFound(message),
            400 | 409 | 422 => Error::Validation {
                field: "request".into(),
                constraint: message,
            },
            429 => Error::RateLimit {
                retry_after_ms: retry_after_ms.unwrap_or(1000),
            },
            502 | 503 => Error::Unavailable(message),
            408 | 504 => Error::Timeout { timeout_ms: 0 },
            _ => Error::Http {
                status,
                body: message,
            },
        }
    }
}
