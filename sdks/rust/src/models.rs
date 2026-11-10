use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A stored memory.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MemoryRecord {
    pub id: String,
    pub content: String,
    #[serde(default)]
    pub memory_type: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub updated_at: Option<DateTime<Utc>>,
}

/// One search result.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SearchHit {
    pub id: String,
    pub content: String,
    #[serde(default)]
    pub score: f64,
    #[serde(default)]
    pub memory_type: String,
    #[serde(default)]
    pub tags: Vec<String>,
    /// The memory's stored metadata is under `metadata["metadata"]`.
    #[serde(default)]
    pub metadata: Option<Value>,
    #[serde(default)]
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BranchInfo {
    pub branch_id: String,
    pub name: String,
    pub branch_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MergeResult {
    pub success: bool,
    pub applied: u32,
    pub skipped: u32,
    pub conflicts: u32,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DiffResult {
    pub added: u32,
    pub removed: u32,
    pub modified: u32,
    pub unchanged: u32,
    pub divergence_score: f64,
    pub diff_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncResult {
    pub pushed: u32,
    pub pulled: u32,
    pub conflicts: u32,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncActionResult {
    pub summary_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncStatusResult {
    pub status_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ReflectJob {
    pub job_id: String,
    pub status: String,
    pub message: Option<String>,
    pub skipped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TxInfo {
    pub tx_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionInfo {
    pub session_id: String,
    pub role: String,
    pub scopes: Vec<String>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HealthResponse {
    pub status: String,
    pub version: Option<String>,
    /// Which server components are on (`vector`, `reflect`, ...).
    pub components: Option<Value>,
}

/// Optional fields when storing a memory.
#[derive(Debug, Clone, Default)]
pub struct RememberOptions {
    /// `"context"` (default), `"task"`, `"tool_output"`, ...
    pub memory_type: Option<String>,
    pub tags: Option<Vec<String>>,
    pub metadata: Option<Value>,
}

/// Optional fields for [`crate::Axonio::search`].
#[derive(Debug, Clone, Default)]
pub struct SearchOptions {
    /// Up to 100; default 5.
    pub top_k: Option<u32>,
    /// Match by meaning as well as keywords. Default true.
    pub semantic: Option<bool>,
}
