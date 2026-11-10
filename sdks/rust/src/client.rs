use std::sync::Arc;

use reqwest::Method;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::builder::AxonioBuilder;
use crate::error::{Error, Result};
use crate::models::{
    BranchInfo, DiffResult, HealthResponse, MemoryRecord, MergeResult, ReflectJob, RememberOptions,
    SearchHit, SearchOptions, SessionInfo, SyncActionResult, SyncResult, SyncStatusResult, TxInfo,
};
use crate::transport::{base_url, stable_agent_id, Core};

/// The Axonio client. Cheap to clone; clones share one session.
///
/// A session is opened on the first call and renewed automatically.
#[derive(Clone)]
pub struct Axonio {
    core: Arc<Core>,
    endpoint: String,
}

fn str_of(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or_default().to_string()
}

fn items<T: DeserializeOwned>(v: &Value, key: &str) -> Vec<T> {
    let arr = if v.is_array() { v } else { &v[key] };
    serde_json::from_value(arr.clone()).unwrap_or_default()
}

fn one<T: DeserializeOwned + Default>(v: &Value) -> T {
    serde_json::from_value(v.clone()).unwrap_or_default()
}

fn branch_of(v: &Value) -> BranchInfo {
    let b = if v["branch"].is_object() {
        &v["branch"]
    } else {
        v
    };
    BranchInfo {
        branch_id: b["id"]
            .as_str()
            .or_else(|| b["branch_id"].as_str())
            .unwrap_or_default()
            .to_string(),
        name: str_of(b, "name"),
        branch_json: Some(b.to_string()),
    }
}

fn count_of(v: &Value, key: &str) -> u32 {
    match &v[key] {
        Value::Array(a) => a.len() as u32,
        other => other.as_u64().unwrap_or(0) as u32,
    }
}

fn seg(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

fn require_content(content: &str) -> Result<()> {
    if content.trim().is_empty() {
        return Err(Error::Validation {
            field: "content".into(),
            constraint: "must be a non-empty string".into(),
        });
    }
    Ok(())
}

fn is_uuid_like(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}

impl Axonio {
    /// Starts a builder.
    pub fn builder() -> AxonioBuilder {
        AxonioBuilder::new()
    }

    /// A client configured from `AXONIO_*` environment variables. With only
    /// `AXONIO_API_KEY` set it talks to the Axonio cloud.
    pub fn from_env() -> Result<Self> {
        AxonioBuilder::from_env().build()
    }

    /// A client for an API key. `endpoint` of `None` means the Axonio cloud.
    pub fn from_api_key(api_key: impl Into<String>, endpoint: Option<&str>) -> Result<Self> {
        let mut builder = AxonioBuilder::new().api_key(api_key);
        if let Some(e) = endpoint {
            builder = builder.endpoint(e);
        }
        builder.build()
    }

    pub(crate) fn new_internal(
        endpoint: String,
        api_key: String,
        agent_id: String,
        role: String,
        timeout_ms: u64,
    ) -> Result<Self> {
        let base = base_url(&endpoint)?;
        let core = Core::new(
            base.clone(),
            api_key,
            stable_agent_id(&agent_id),
            role,
            timeout_ms,
        )?;
        Ok(Self {
            core: Arc::new(core),
            endpoint: base,
        })
    }

    /// The HTTP API base URL in use.
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    /// The agent id as sent to the server (a UUID).
    pub fn agent_id(&self) -> &str {
        &self.core.agent_id
    }

    /// Opens the session now instead of on the first call, so a bad key fails here.
    pub async fn connect(&self) -> Result<()> {
        self.core
            .call(Method::GET, "/v1/sessions/me", &[], None)
            .await
            .map(|_| ())
    }

    /// Revokes the open session, if any. Safe to call more than once.
    pub async fn close(&self) {
        if let Some(id) = self.core.session_id().await {
            let _ = self
                .core
                .call(
                    Method::DELETE,
                    &format!("/v1/sessions/{}", seg(&id)),
                    &[],
                    None,
                )
                .await;
        }
        self.core.forget_session().await;
    }

    async fn get(&self, path: &str, query: &[(&str, String)]) -> Result<Value> {
        self.core.call(Method::GET, path, query, None).await
    }

    async fn post(&self, path: &str, body: Option<Value>) -> Result<Value> {
        self.core.call(Method::POST, path, &[], body).await
    }

    // ─── Health ──────────────────────────────────────────────────────────

    /// Server health. Needs no session.
    pub async fn health(&self) -> Result<HealthResponse> {
        let v = self.core.call_public(Method::GET, "/v1/health").await?;
        Ok(HealthResponse {
            status: str_of(&v, "status"),
            version: v["version"].as_str().map(str::to_string),
            components: v.get("components").cloned(),
        })
    }

    /// Ok if the server answers.
    pub async fn ping(&self) -> Result<()> {
        self.health().await.map(|_| ())
    }

    // ─── Sessions ────────────────────────────────────────────────────────

    /// Opens a new session and makes it the active one.
    pub async fn create_session(
        &self,
        role: &str,
        scopes: &[&str],
        ttl_secs: u64,
    ) -> Result<SessionInfo> {
        let v = self.core.open_session(role, scopes, ttl_secs).await?;
        Ok(session_of(&v))
    }

    /// The current session.
    pub async fn validate_session(&self) -> Result<SessionInfo> {
        Ok(session_of(&self.get("/v1/sessions/me", &[]).await?))
    }

    pub async fn revoke_session(&self, session_id: &str) -> Result<bool> {
        self.core
            .call(
                Method::DELETE,
                &format!("/v1/sessions/{}", seg(session_id)),
                &[],
                None,
            )
            .await?;
        Ok(true)
    }

    pub async fn active_session_count(&self) -> Result<u64> {
        Ok(self.get("/v1/sessions/active/count", &[]).await?["count"]
            .as_u64()
            .unwrap_or(0))
    }

    // ─── Memory ──────────────────────────────────────────────────────────

    /// Stores a memory and returns its id.
    pub async fn remember(&self, content: impl Into<String>) -> Result<String> {
        self.remember_typed(content, RememberOptions::default())
            .await
    }

    /// Stores a memory with a type, tags and metadata.
    pub async fn remember_typed(
        &self,
        content: impl Into<String>,
        opts: RememberOptions,
    ) -> Result<String> {
        let content = content.into();
        require_content(&content)?;
        let v = self
            .post(
                "/v1/memories",
                Some(json!({
                    "content": content,
                    "type": opts.memory_type.unwrap_or_else(|| "context".into()),
                    "tags": opts.tags.unwrap_or_default(),
                    "metadata": opts.metadata.unwrap_or_else(|| json!({})),
                })),
            )
            .await?;
        Ok(str_of(&v, "memory_id"))
    }

    /// Replaces a memory's content.
    pub async fn update_memory(&self, memory_id: &str, content: impl Into<String>) -> Result<bool> {
        let content = content.into();
        require_content(&content)?;
        let v = self
            .core
            .call(
                Method::PATCH,
                &format!("/v1/memories/{}", seg(memory_id)),
                &[],
                Some(json!({ "content": content })),
            )
            .await?;
        Ok(v["updated"].as_bool().unwrap_or(false))
    }

    /// Searches by meaning and keywords. Punctuation and hyphens in `query` are safe.
    pub async fn search(
        &self,
        query: impl Into<String>,
        opts: SearchOptions,
    ) -> Result<Vec<SearchHit>> {
        let top_k = opts.top_k.unwrap_or(5);
        if top_k > 100 {
            return Err(Error::Validation {
                field: "top_k".into(),
                constraint: "cannot exceed 100".into(),
            });
        }
        let v = self
            .get(
                "/v1/memories/search",
                &[
                    ("q", query.into()),
                    ("top_k", top_k.to_string()),
                    ("semantic", opts.semantic.unwrap_or(true).to_string()),
                ],
            )
            .await?;
        Ok(items(&v, "hits"))
    }

    /// One memory by id.
    pub async fn get_memory(&self, memory_id: &str) -> Result<MemoryRecord> {
        Ok(one(&self
            .get(&format!("/v1/memories/{}", seg(memory_id)), &[])
            .await?))
    }

    /// Several memories by id.
    pub async fn recall(&self, ids: &[&str]) -> Result<Vec<MemoryRecord>> {
        if ids.is_empty() {
            return Err(Error::Validation {
                field: "ids".into(),
                constraint: "must be non-empty".into(),
            });
        }
        if let Some(bad) = ids.iter().find(|id| !is_uuid_like(id)) {
            return Err(Error::Validation {
                field: "ids".into(),
                constraint: format!("invalid UUID: {bad}"),
            });
        }
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            out.push(self.get_memory(id).await?);
        }
        Ok(out)
    }

    /// The newest memories first.
    pub async fn list_memories(
        &self,
        memory_type: Option<&str>,
        limit: Option<u32>,
    ) -> Result<Vec<MemoryRecord>> {
        let mut query = vec![("limit", limit.unwrap_or(50).to_string())];
        if let Some(t) = memory_type {
            query.push(("type", t.to_string()));
        }
        Ok(items(&self.get("/v1/memories", &query).await?, "memories"))
    }

    pub async fn delete_memory(&self, memory_id: &str) -> Result<bool> {
        self.core
            .call(
                Method::DELETE,
                &format!("/v1/memories/{}", seg(memory_id)),
                &[],
                None,
            )
            .await?;
        Ok(true)
    }

    // ─── Branches ────────────────────────────────────────────────────────

    /// Creates a branch. `from` is a branch id; `None` means trunk.
    pub async fn branch(&self, name: &str, from: Option<&str>) -> Result<BranchInfo> {
        let mut body = json!({ "name": name });
        if let Some(f) = from.filter(|f| is_uuid_like(f)) {
            body["from"] = json!(f);
        }
        let mut info = branch_of(&self.post("/v1/branches", Some(body)).await?);
        if info.name.is_empty() {
            info.name = name.to_string();
        }
        Ok(info)
    }

    pub async fn list_branches(&self) -> Result<Vec<BranchInfo>> {
        let v = self.get("/v1/branches", &[]).await?;
        let list = if v.is_array() {
            v.as_array().cloned().unwrap_or_default()
        } else {
            v["branches"].as_array().cloned().unwrap_or_default()
        };
        Ok(list.iter().map(branch_of).collect())
    }

    pub async fn get_branch(&self, branch_id: &str) -> Result<BranchInfo> {
        Ok(branch_of(
            &self
                .get(&format!("/v1/branches/{}", seg(branch_id)), &[])
                .await?,
        ))
    }

    pub async fn get_branch_by_name(&self, name: &str) -> Result<BranchInfo> {
        Ok(branch_of(
            &self
                .get(&format!("/v1/branches/by-name/{}", seg(name)), &[])
                .await?,
        ))
    }

    pub async fn get_trunk_branch(&self) -> Result<BranchInfo> {
        Ok(branch_of(&self.get("/v1/branches/trunk", &[]).await?))
    }

    /// Compares a branch with `target` (an id, a name, or empty for trunk).
    pub async fn diff(&self, branch_id: &str, target: &str) -> Result<DiffResult> {
        let v = self
            .get(
                &format!("/v1/branches/{}/diff", seg(branch_id)),
                &[("target", target.to_string())],
            )
            .await?;
        let stats = if v["stats"].is_object() {
            &v["stats"]
        } else {
            &v
        };
        Ok(DiffResult {
            added: count_of(stats, "added"),
            removed: count_of(stats, "removed"),
            modified: count_of(stats, "modified"),
            unchanged: count_of(stats, "unchanged"),
            divergence_score: v["divergence_score"].as_f64().unwrap_or(0.0),
            diff_json: Some(v.to_string()),
        })
    }

    /// Merges `source` (an id or name) into `target` (an id, a name, or empty for trunk).
    pub async fn merge(&self, source: &str, target: &str, strategy: &str) -> Result<MergeResult> {
        let mut body = json!({ "target": target });
        if !strategy.is_empty() {
            body["strategy"] = json!(strategy);
        }
        let v = self
            .post(&format!("/v1/branches/{}/merge", seg(source)), Some(body))
            .await?;
        Ok(MergeResult {
            success: v["success"].as_bool().unwrap_or(true),
            applied: count_of(&v, "applied"),
            skipped: count_of(&v, "skipped"),
            conflicts: count_of(&v, "conflicts"),
            duration_ms: v["duration_ms"].as_u64().unwrap_or(0),
        })
    }

    pub async fn discard_branch(&self, branch_id: &str) -> Result<bool> {
        self.core
            .call(
                Method::DELETE,
                &format!("/v1/branches/{}", seg(branch_id)),
                &[],
                None,
            )
            .await?;
        Ok(true)
    }

    pub async fn archive_branch(&self, branch_id: &str) -> Result<bool> {
        self.post(&format!("/v1/branches/{}/archive", seg(branch_id)), None)
            .await?;
        Ok(true)
    }

    // ─── Sync ────────────────────────────────────────────────────────────

    pub async fn sync(&self) -> Result<SyncResult> {
        Ok(one(&self.post("/v1/sync", None).await?))
    }

    async fn sync_action(&self, path: &str) -> Result<SyncActionResult> {
        Ok(SyncActionResult {
            summary_json: Some(self.post(path, None).await?.to_string()),
        })
    }

    pub async fn push_sync(&self) -> Result<SyncActionResult> {
        self.sync_action("/v1/sync/push").await
    }

    pub async fn pull_sync(&self) -> Result<SyncActionResult> {
        self.sync_action("/v1/sync/pull").await
    }

    pub async fn reconcile_sync(&self) -> Result<SyncActionResult> {
        self.sync_action("/v1/sync/reconcile").await
    }

    pub async fn sync_status(&self) -> Result<SyncStatusResult> {
        Ok(SyncStatusResult {
            status_json: Some(self.get("/v1/sync/status", &[]).await?.to_string()),
        })
    }

    // ─── Reflect ─────────────────────────────────────────────────────────

    /// Starts a reflection job over recent memories.
    pub async fn reflect(&self) -> Result<ReflectJob> {
        Ok(one(&self.post("/v1/reflect", None).await?))
    }

    pub async fn reflect_list_jobs(&self, agent_id: &str) -> Result<Vec<ReflectJob>> {
        let mut query = Vec::new();
        if !agent_id.is_empty() {
            query.push(("agent_id", agent_id.to_string()));
        }
        Ok(items(&self.get("/v1/reflect/jobs", &query).await?, "jobs"))
    }

    pub async fn reflect_get_job(&self, job_id: &str) -> Result<ReflectJob> {
        Ok(one(&self
            .get(&format!("/v1/reflect/jobs/{}", seg(job_id)), &[])
            .await?))
    }

    pub async fn reflect_get_facts(&self, agent_id: &str) -> Result<Value> {
        self.get(&format!("/v1/reflect/facts/{}", seg(agent_id)), &[])
            .await
    }

    pub async fn reflect_get_preferences(&self, agent_id: &str) -> Result<Value> {
        self.get(&format!("/v1/reflect/preferences/{}", seg(agent_id)), &[])
            .await
    }

    pub async fn reflect_get_contradictions(&self, agent_id: &str) -> Result<Value> {
        self.get(
            &format!("/v1/reflect/contradictions/{}", seg(agent_id)),
            &[],
        )
        .await
    }

    /// Resolves a contradiction. `merged_value` is the merged value, if the strategy needs one.
    pub async fn reflect_resolve_contradiction(
        &self,
        agent_id: &str,
        contradiction_id: &str,
        strategy: &str,
        merged_value: Option<Value>,
    ) -> Result<Value> {
        self.post(
            &format!(
                "/v1/reflect/contradictions/{}/{}/resolve",
                seg(agent_id),
                seg(contradiction_id)
            ),
            Some(json!({ "strategy": strategy, "merged_value": merged_value })),
        )
        .await
    }

    // ─── Transactions ────────────────────────────────────────────────────

    pub async fn begin_tx(&self) -> Result<TxInfo> {
        Ok(TxInfo {
            tx_id: str_of(&self.post("/v1/tx", None).await?, "tx_id"),
        })
    }

    /// Adds a memory to a transaction; returns the memory id.
    pub async fn tx_remember(&self, tx_id: &str, content: impl Into<String>) -> Result<String> {
        let content = content.into();
        require_content(&content)?;
        let v = self
            .post(
                &format!("/v1/tx/{}/memories", seg(tx_id)),
                Some(json!({ "content": content })),
            )
            .await?;
        Ok(str_of(&v, "memory_id"))
    }

    pub async fn tx_remember_typed(
        &self,
        tx_id: &str,
        content: impl Into<String>,
        opts: RememberOptions,
    ) -> Result<String> {
        let content = content.into();
        require_content(&content)?;
        let v = self
            .post(
                &format!("/v1/tx/{}/memories/typed", seg(tx_id)),
                Some(json!({
                    "content": content,
                    "type": opts.memory_type.unwrap_or_else(|| "context".into()),
                    "tags": opts.tags.unwrap_or_default(),
                    "metadata": opts.metadata.unwrap_or_else(|| json!({})),
                })),
            )
            .await?;
        Ok(str_of(&v, "memory_id"))
    }

    pub async fn commit_tx(&self, tx_id: &str) -> Result<bool> {
        Ok(self
            .post(&format!("/v1/tx/{}/commit", seg(tx_id)), None)
            .await?["committed"]
            .as_bool()
            .unwrap_or(false))
    }

    pub async fn rollback_tx(&self, tx_id: &str) -> Result<bool> {
        Ok(self
            .post(&format!("/v1/tx/{}/rollback", seg(tx_id)), None)
            .await?["rolled_back"]
            .as_bool()
            .unwrap_or(false))
    }
}

fn session_of(v: &Value) -> SessionInfo {
    SessionInfo {
        session_id: v["session_id"]
            .as_str()
            .or_else(|| v["id"].as_str())
            .unwrap_or_default()
            .to_string(),
        role: str_of(v, "role"),
        scopes: v["scopes"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|s| s.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        expires_at: v["expires_at"]
            .as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|t| t.with_timezone(&chrono::Utc)),
    }
}

impl std::fmt::Debug for Axonio {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Axonio")
            .field("endpoint", &self.endpoint)
            .field("agent_id", &self.core.agent_id)
            .finish()
    }
}
