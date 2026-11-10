//! HTTP transport shared by every call: session handling, retries, errors.

use std::time::Duration;

use chrono::{DateTime, Utc};
use reqwest::{Method, StatusCode};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

use crate::error::{Error, Result};

/// The hosted Axonio cloud. Requests carry the API key and the gateway routes
/// them to the workspace's own instance.
pub const CLOUD_ENDPOINT: &str = "https://api.axonio.xyz/api/v1/gateway";

const SESSION_TTL_SECS: u64 = 3600;
const RENEW_MARGIN_SECS: i64 = 60;
const MAX_ATTEMPTS: u32 = 3;

/// The HTTP API base for a configured endpoint. A URL with a path (such as the
/// cloud gateway) is used as-is; a bare address on the gRPC port 50050 maps to
/// its HTTP port 8080, so the long-standing default keeps working.
pub(crate) fn base_url(endpoint: &str) -> Result<String> {
    let endpoint = endpoint.trim();
    let with_scheme = if endpoint.contains("://") {
        endpoint.to_string()
    } else {
        format!("http://{endpoint}")
    };
    let mut url = url::Url::parse(&with_scheme)?;
    if url.host_str() == Some("cloud.clawdb.dev") {
        return Ok(CLOUD_ENDPOINT.to_string());
    }
    if url.path().trim_end_matches('/').is_empty() {
        if url.port() == Some(50050) {
            let _ = url.set_port(Some(8080));
        }
        url.set_path("");
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn is_uuid(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 36 {
        return false;
    }
    for (i, c) in b.iter().enumerate() {
        match i {
            8 | 13 | 18 | 23 => {
                if *c != b'-' {
                    return false;
                }
            }
            _ => {
                if !c.is_ascii_hexdigit() {
                    return false;
                }
            }
        }
    }
    matches!(b[14], b'1'..=b'5') && matches!(b[19], b'8' | b'9' | b'a' | b'b' | b'A' | b'B')
}

/// The server needs a UUID agent id. Any other id maps to a stable UUID,
/// byte-for-byte the same as the TypeScript, Python and Go SDKs, so one agent
/// name means one agent across all of them.
pub fn stable_agent_id(agent_id: &str) -> String {
    let agent_id = if agent_id.is_empty() {
        "default-agent"
    } else {
        agent_id
    };
    if is_uuid(agent_id) {
        return agent_id.to_string();
    }
    let digest = Sha256::digest(agent_id.as_bytes());
    let mut hex: Vec<u8> = digest
        .iter()
        .flat_map(|b| format!("{b:02x}").into_bytes())
        .take(32)
        .collect();
    hex[12] = b'5';
    let variant = (hex[16] as char).to_digit(16).unwrap_or(0);
    hex[16] = std::char::from_digit((variant & 0x3) | 0x8, 16).unwrap_or('8') as u8;
    let h = String::from_utf8(hex).unwrap_or_default();
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

struct SessionState {
    token: String,
    id: String,
    expires: Option<DateTime<Utc>>,
}

impl SessionState {
    fn fresh(&self) -> bool {
        match self.expires {
            None => true,
            Some(t) => Utc::now() < t - chrono::Duration::seconds(RENEW_MARGIN_SECS),
        }
    }
}

pub(crate) struct Core {
    pub base: String,
    pub api_key: String,
    pub agent_id: String,
    pub role: String,
    pub timeout_ms: u64,
    http: reqwest::Client,
    session: Mutex<Option<SessionState>>,
}

enum Outcome {
    Done(Value),
    SessionRejected,
}

impl Core {
    pub fn new(
        base: String,
        api_key: String,
        agent_id: String,
        role: String,
        timeout_ms: u64,
    ) -> Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_millis(timeout_ms))
            .user_agent(concat!("axonio-rust/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| Error::Config(e.to_string()))?;
        Ok(Self {
            base,
            api_key,
            agent_id,
            role,
            timeout_ms,
            http,
            session: Mutex::new(None),
        })
    }

    /// Opens a session and remembers it as the active one.
    pub async fn open_session(&self, role: &str, scopes: &[&str], ttl_secs: u64) -> Result<Value> {
        let mut guard = self.session.lock().await;
        self.open_locked(&mut guard, role, scopes, ttl_secs).await
    }

    async fn open_locked(
        &self,
        guard: &mut Option<SessionState>,
        role: &str,
        scopes: &[&str],
        ttl_secs: u64,
    ) -> Result<Value> {
        let body = json!({
            "agent_id": self.agent_id,
            "role": role,
            "scopes": scopes,
            "ttl_secs": ttl_secs,
        });
        let reply = match self
            .send(Method::POST, "/v1/sessions", &[], Some(&body), None)
            .await?
        {
            Outcome::Done(v) => v,
            Outcome::SessionRejected => Value::Null,
        };
        let token = reply["token"].as_str().unwrap_or_default();
        if token.is_empty() {
            return Err(Error::Auth(
                "the server returned a session without a token".into(),
            ));
        }
        let id = reply["session_id"]
            .as_str()
            .or_else(|| reply["id"].as_str())
            .unwrap_or_default();
        let expires = reply["expires_at"]
            .as_str()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|t| t.with_timezone(&Utc));
        *guard = Some(SessionState {
            token: token.to_string(),
            id: id.to_string(),
            expires,
        });
        Ok(reply)
    }

    async fn token(&self) -> Result<String> {
        let mut guard = self.session.lock().await;
        if let Some(s) = guard.as_ref() {
            if s.fresh() {
                return Ok(s.token.clone());
            }
        }
        self.open_locked(&mut guard, &self.role, &["*"], SESSION_TTL_SECS)
            .await?;
        Ok(guard.as_ref().map(|s| s.token.clone()).unwrap_or_default())
    }

    pub async fn session_id(&self) -> Option<String> {
        self.session
            .lock()
            .await
            .as_ref()
            .map(|s| s.id.clone())
            .filter(|s| !s.is_empty())
    }

    pub async fn forget_session(&self) {
        *self.session.lock().await = None;
    }

    /// An authenticated call: opens or renews the session as needed.
    pub async fn call(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<Value>,
    ) -> Result<Value> {
        for renewed in [false, true] {
            let token = self.token().await?;
            match self
                .send(method.clone(), path, query, body.as_ref(), Some(&token))
                .await?
            {
                Outcome::Done(v) => return Ok(v),
                Outcome::SessionRejected if !renewed => self.forget_session().await,
                Outcome::SessionRejected => break,
            }
        }
        Err(Error::Auth(
            "the server rejected a freshly opened session".into(),
        ))
    }

    /// A call that needs no session (health checks).
    pub async fn call_public(&self, method: Method, path: &str) -> Result<Value> {
        match self.send(method, path, &[], None, None).await? {
            Outcome::Done(v) => Ok(v),
            Outcome::SessionRejected => Err(Error::Auth("unauthorized".into())),
        }
    }

    async fn send(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<&Value>,
        token: Option<&str>,
    ) -> Result<Outcome> {
        let url = format!("{}{}", self.base, path);
        let mut last: Option<Error> = None;
        for attempt in 0..MAX_ATTEMPTS {
            let mut req = self
                .http
                .request(method.clone(), &url)
                .header("accept", "application/json")
                .header("x-agent-id", &self.agent_id);
            if !query.is_empty() {
                req = req.query(query);
            }
            if !self.api_key.is_empty() {
                req = req.bearer_auth(&self.api_key);
            }
            // x-claw-session, not Authorization: the gateway replaces
            // Authorization (the API key) before forwarding to the instance.
            if let Some(t) = token {
                req = req.header("x-claw-session", t);
            }
            if let Some(b) = body {
                req = req.json(b);
            }

            match req.send().await {
                Err(e) if e.is_timeout() => {
                    last = Some(Error::Timeout {
                        timeout_ms: self.timeout_ms,
                    });
                }
                Err(e) => {
                    last = Some(Error::Network(format!(
                        "could not reach {}: {e}",
                        self.base
                    )));
                }
                Ok(resp) => {
                    let status = resp.status();
                    let request_id = resp
                        .headers()
                        .get("x-request-id")
                        .and_then(|v| v.to_str().ok())
                        .map(str::to_string);
                    let retry_after = resp
                        .headers()
                        .get("retry-after")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|s| s.parse::<f64>().ok())
                        .map(|s| (s * 1000.0) as u64);
                    let text = resp
                        .text()
                        .await
                        .map_err(|e| Error::Network(e.to_string()))?;
                    if status.is_success() {
                        return Ok(Outcome::Done(decode(&text, request_id)));
                    }
                    if token.is_some()
                        && status == StatusCode::UNAUTHORIZED
                        && error_field(&text) == "unauthorized"
                    {
                        return Ok(Outcome::SessionRejected);
                    }
                    let err = Error::from_http(status.as_u16(), &text, retry_after);
                    match &err {
                        Error::RateLimit { retry_after_ms } if attempt + 1 < MAX_ATTEMPTS => {
                            tokio::time::sleep(Duration::from_millis(*retry_after_ms)).await;
                            last = Some(err);
                            continue;
                        }
                        Error::Unavailable(_) | Error::Timeout { .. } => last = Some(err),
                        _ => return Err(err),
                    }
                }
            }
            if attempt + 1 < MAX_ATTEMPTS {
                tokio::time::sleep(Duration::from_millis((200u64 << attempt).min(2000))).await;
            }
        }
        Err(last.unwrap_or_else(|| Error::Unavailable("retries exhausted".into())))
    }
}

fn decode(text: &str, request_id: Option<String>) -> Value {
    let mut value: Value = if text.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(text).unwrap_or_else(|_| json!({ "message": text }))
    };
    if let (Some(obj), Some(id)) = (value.as_object_mut(), request_id) {
        obj.entry("request_id").or_insert(Value::String(id));
    }
    value
}

fn error_field(text: &str) -> String {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str().map(str::to_string)))
        .unwrap_or_default()
}
