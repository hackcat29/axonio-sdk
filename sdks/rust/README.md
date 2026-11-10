# axonio

Rust client for [Axonio](https://axonio.xyz): persistent memory for AI agents.

Formerly the `clawdb-client` crate. That crate belongs to a GitHub account that is no longer available, so the client continues here as `axonio`. The old crate's calls did not work against a real server (its search used a route that does not exist and it never opened a session); this is a rewrite with the same method names where they made sense.

## Install

```toml
[dependencies]
axonio = "0.2"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

TLS is rustls; no system OpenSSL is needed.

## Quick start

Create an API key in the Axonio dashboard and export it:

```bash
export AXONIO_API_KEY="ck_live_..."
```

```rust
use axonio::{Axonio, RememberOptions, SearchOptions};

#[tokio::main]
async fn main() -> axonio::Result<()> {
    let db = Axonio::from_env()?; // an API key alone means the Axonio cloud

    let id = db
        .remember_typed(
            "The user prefers concise answers",
            RememberOptions { tags: Some(vec!["preferences".into()]), ..Default::default() },
        )
        .await?;

    // Matches by meaning, not only keywords.
    for hit in db.search("how should I phrase answers?", SearchOptions::default()).await? {
        println!("[{:.2}] {}", hit.score, hit.content);
    }

    db.delete_memory(&id).await?;
    db.close().await;
    Ok(())
}
```

For a self-hosted server: `Axonio::builder().endpoint("https://db.example.com").api_key(key).build()?`, or set `AXONIO_URL`.

## Behaviour

- A session is opened on the first call, renewed a minute before it expires, and renewed once more (retrying the call) if the server rejects it. `db.connect().await` opens it up front so a bad key fails early. Clones of the client share the session.
- Network errors, timeouts and 502/503/504 are retried with backoff; 429 waits for `Retry-After`.
- Environment variables are read as `AXONIO_*` first, then the older `CLAWDB_*`: `API_KEY`, `URL`, `AGENT_ID`, `ROLE`, `TIMEOUT_MS`.
- The agent id can be any name; it maps to a stable UUID, identical across the TypeScript, Python, Go and Rust SDKs.
- Errors are `axonio::Error`; `is_retriable()` tells transient from permanent.

## What it covers

Memory (`remember`, `remember_typed`, `search`, `get_memory`, `recall`, `list_memories`, `update_memory`, `delete_memory`), branches (`branch`, `list_branches`, `diff`, `merge`, `discard_branch`, `archive_branch`, ...), transactions, reflection, sync, sessions and health.

## Test

```bash
cargo test
AXONIO_LIVE_KEY=ck_live_... cargo test --test client live_cloud -- --ignored   # against the Axonio cloud
```

## License

Apache-2.0
