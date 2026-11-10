//! # Axonio
//!
//! Rust client for [Axonio](https://axonio.xyz): persistent memory for AI agents.
//! Formerly the `clawdb-client` crate.
//!
//! ```no_run
//! use axonio::{Axonio, SearchOptions};
//!
//! #[tokio::main]
//! async fn main() -> axonio::Result<()> {
//!     // Reads AXONIO_API_KEY; an API key alone means the Axonio cloud.
//!     let db = Axonio::from_env()?;
//!
//!     let id = db.remember("The user prefers concise answers").await?;
//!     for hit in db.search("how should I phrase answers?", SearchOptions::default()).await? {
//!         println!("[{:.2}] {}", hit.score, hit.content);
//!     }
//!     db.delete_memory(&id).await?;
//!     db.close().await;
//!     Ok(())
//! }
//! ```
//!
//! For a self-hosted server use `Axonio::builder().endpoint("https://db.example.com")`
//! or set `AXONIO_URL`.

pub mod builder;
pub mod client;
pub mod error;
pub mod models;
mod transport;

pub use builder::AxonioBuilder;
pub use client::Axonio;
pub use error::{Error, Result};
pub use models::{
    BranchInfo, DiffResult, HealthResponse, MemoryRecord, MergeResult, ReflectJob, RememberOptions,
    SearchHit, SearchOptions, SessionInfo, SyncActionResult, SyncResult, SyncStatusResult, TxInfo,
};
pub use transport::{stable_agent_id, CLOUD_ENDPOINT};

/// The crate version.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
