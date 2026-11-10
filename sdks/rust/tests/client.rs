mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axonio::{stable_agent_id, Axonio, Error, RememberOptions, SearchOptions};
use common::{ok, start, Req, Resp};

const MEMORY_ID: &str = "11111111-1111-4111-8111-111111111111";

/// The parts of the Axonio HTTP API the SDK uses.
fn api(req: &Req, _n: usize) -> Resp {
    if req.path == "/v1/health" {
        return ok(r#"{"status":"ok","version":"1.2.3","components":{"core":true}}"#);
    }
    if req.path == "/v1/sessions" && req.method == "POST" {
        let exp = (chrono::Utc::now() + chrono::Duration::hours(1)).to_rfc3339();
        return ok(&format!(
            r#"{{"session_id":"sess-1","token":"tok-1","expires_at":"{exp}"}}"#
        ));
    }
    if !req.headers.contains_key("x-claw-session") {
        return Resp {
            status: 401,
            body: r#"{"error":"unauthorized"}"#.into(),
        };
    }
    match (req.method.as_str(), req.path.as_str()) {
        ("POST", "/v1/memories") => ok(&format!(r#"{{"memory_id":"{MEMORY_ID}"}}"#)),
        ("GET", "/v1/memories/search") => ok(
            r#"[{"id":"a","content":"likes dark mode","score":0.8,"memory_type":"semantic","tags":["ui"],"metadata":{"memory_id":"a","metadata":{"k":1}}}]"#,
        ),
        ("GET", "/v1/memories") => ok(
            r#"[{"id":"3","content":"c","created_at":"2026-11-09T23:41:51.054126868Z"},{"id":"2","content":"b"}]"#,
        ),
        ("GET", "/v1/memories/missing") => Resp {
            status: 404,
            body: r#"{"error":"memory not found"}"#.into(),
        },
        ("GET", "/v1/branches") => ok(r#"[{"id":"b1","name":"trunk"},{"id":"b2","name":"exp"}]"#),
        ("GET", "/v1/branches/b2/diff") => {
            ok(r#"{"stats":{"added":2,"removed":1},"divergence_score":0.25}"#)
        }
        ("POST", "/v1/branches/b2/merge") => ok(r#"{"applied":3,"conflicts":[{"id":"x"}]}"#),
        ("POST", "/v1/tx") => ok(r#"{"tx_id":"tx-1"}"#),
        ("POST", "/v1/tx/tx-1/commit") => ok(r#"{"committed":true}"#),
        ("DELETE", _) => ok("{}"),
        _ => ok("{}"),
    }
}

fn client(url: &str) -> Axonio {
    Axonio::builder()
        .endpoint(url)
        .api_key("ck_live_test")
        .build()
        .unwrap()
}

#[tokio::test]
async fn remember_opens_a_session_and_sends_both_credentials() {
    let fake = start(api).await;
    let db = client(&fake.url);
    let id = db
        .remember_typed(
            "hello",
            RememberOptions {
                tags: Some(vec!["a".into()]),
                metadata: Some(serde_json::json!({"x": 1})),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(id, MEMORY_ID);
    assert_eq!(fake.calls(), ["POST /v1/sessions", "POST /v1/memories"]);
    let last = fake.last();
    assert_eq!(last.headers["authorization"], "Bearer ck_live_test");
    assert_eq!(last.headers["x-claw-session"], "tok-1");
    assert_eq!(last.body["content"], "hello");
    assert_eq!(last.body["type"], "context");
    assert_eq!(last.body["metadata"]["x"], 1);
    assert_eq!(last.headers["x-agent-id"], stable_agent_id("default-agent"));
}

#[tokio::test]
async fn the_session_is_opened_once_and_reused() {
    let fake = start(api).await;
    let db = client(&fake.url);
    for _ in 0..3 {
        db.remember("x").await.unwrap();
    }
    assert_eq!(
        fake.calls()
            .iter()
            .filter(|c| *c == "POST /v1/sessions")
            .count(),
        1
    );
}

#[tokio::test]
async fn a_rejected_token_opens_a_new_session_and_retries_once() {
    let rejected = Arc::new(AtomicUsize::new(0));
    let r = rejected.clone();
    let fake = start(move |req, n| {
        if req.path == "/v1/memories" && r.fetch_add(1, Ordering::SeqCst) == 0 {
            return Resp {
                status: 401,
                body: r#"{"error":"unauthorized"}"#.into(),
            };
        }
        api(req, n)
    })
    .await;
    let db = client(&fake.url);
    assert_eq!(db.remember("x").await.unwrap(), MEMORY_ID);
    assert_eq!(
        fake.calls()
            .iter()
            .filter(|c| *c == "POST /v1/sessions")
            .count(),
        2
    );
}

#[tokio::test]
async fn a_persistently_rejected_session_is_an_auth_error() {
    let fake = start(|req, n| {
        if req.path == "/v1/memories" {
            Resp {
                status: 401,
                body: r#"{"error":"unauthorized"}"#.into(),
            }
        } else {
            api(req, n)
        }
    })
    .await;
    let err = client(&fake.url).remember("x").await.unwrap_err();
    assert!(matches!(err, Error::Auth(_)), "{err:?}");
}

#[tokio::test]
async fn search_uses_the_q_parameter_and_is_semantic_by_default() {
    let fake = start(api).await;
    let db = client(&fake.url);
    let hits = db
        .search("dark-mode? & more", SearchOptions::default())
        .await
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].content, "likes dark mode");
    assert!((hits[0].score - 0.8).abs() < 1e-6);
    assert_eq!(hits[0].metadata.as_ref().unwrap()["metadata"]["k"], 1);
    let q = fake.last().query;
    assert_eq!(q["q"], "dark-mode? & more");
    assert_eq!(q["top_k"], "5");
    assert_eq!(q["semantic"], "true");

    db.search(
        "q",
        SearchOptions {
            top_k: Some(9),
            semantic: Some(false),
        },
    )
    .await
    .unwrap();
    let q = fake.last().query;
    assert_eq!(
        (q["top_k"].as_str(), q["semantic"].as_str()),
        ("9", "false")
    );
}

#[tokio::test]
async fn validation_happens_before_the_network() {
    let fake = start(api).await;
    let db = client(&fake.url);
    assert!(matches!(
        db.remember("   ").await,
        Err(Error::Validation { .. })
    ));
    assert!(matches!(
        db.search(
            "x",
            SearchOptions {
                top_k: Some(101),
                semantic: None
            }
        )
        .await,
        Err(Error::Validation { .. })
    ));
    assert!(matches!(
        db.recall(&[]).await,
        Err(Error::Validation { .. })
    ));
    assert!(matches!(
        db.recall(&["nope"]).await,
        Err(Error::Validation { .. })
    ));
    assert!(fake.calls().is_empty());
}

#[tokio::test]
async fn list_parses_timestamps_and_missing_ones() {
    let fake = start(api).await;
    let list = client(&fake.url)
        .list_memories(None, Some(2))
        .await
        .unwrap();
    assert_eq!(list.len(), 2);
    assert!(list[0].created_at.is_some());
    assert!(list[1].created_at.is_none());
    assert_eq!(fake.last().query["limit"], "2");
}

#[tokio::test]
async fn errors_carry_the_servers_message() {
    let fake = start(api).await;
    let err = client(&fake.url).get_memory("missing").await.unwrap_err();
    match err {
        Error::NotFound(m) => assert_eq!(m, "memory not found"),
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn transient_failures_are_retried() {
    let fake = start(|req, n| {
        if req.path == "/v1/health" && n <= 2 {
            Resp {
                status: 503,
                body: r#"{"error":"instance_unavailable"}"#.into(),
            }
        } else {
            api(req, n)
        }
    })
    .await;
    let health = client(&fake.url).health().await.unwrap();
    assert_eq!(health.status, "ok");
    assert_eq!(health.version.as_deref(), Some("1.2.3"));
    assert_eq!(fake.calls().len(), 3);
}

#[tokio::test]
async fn health_needs_no_session() {
    let fake = start(api).await;
    client(&fake.url).health().await.unwrap();
    assert_eq!(fake.calls(), ["GET /v1/health"]);
}

#[tokio::test]
async fn branches_use_the_servers_ids() {
    let fake = start(api).await;
    let db = client(&fake.url);
    let branches = db.list_branches().await.unwrap();
    assert_eq!(
        (branches[1].branch_id.as_str(), branches[1].name.as_str()),
        ("b2", "exp")
    );
    let diff = db.diff("b2", "").await.unwrap();
    assert_eq!((diff.added, diff.removed), (2, 1));
    assert!((diff.divergence_score - 0.25).abs() < 1e-9);
    let merge = db.merge("b2", "", "").await.unwrap();
    assert_eq!((merge.applied, merge.conflicts), (3, 1));
}

#[tokio::test]
async fn transactions_round_trip() {
    let fake = start(api).await;
    let db = client(&fake.url);
    let tx = db.begin_tx().await.unwrap();
    assert_eq!(tx.tx_id, "tx-1");
    assert!(db.commit_tx(&tx.tx_id).await.unwrap());
}

#[tokio::test]
async fn close_revokes_the_session() {
    let fake = start(api).await;
    let db = client(&fake.url);
    db.remember("x").await.unwrap();
    db.close().await;
    assert_eq!(fake.last().method, "DELETE");
    assert_eq!(fake.last().path, "/v1/sessions/sess-1");
}

#[test]
fn agent_ids_match_the_other_sdks() {
    assert_eq!(
        stable_agent_id("default-agent"),
        "d6655ec8-2748-5e44-af9b-0a58d87726b3"
    );
    assert_eq!(
        stable_agent_id("my-agent"),
        "178890c4-e2da-5e09-bf88-145042177f7f"
    );
    let uuid = "d6655ec8-2748-5e44-af9b-0a58d87726b3";
    assert_eq!(stable_agent_id(uuid), uuid);
}

#[test]
fn endpoints_map_to_the_http_api() {
    let b = |e: &str| {
        Axonio::builder()
            .endpoint(e)
            .build()
            .unwrap()
            .endpoint()
            .to_string()
    };
    assert_eq!(b("http://localhost:50050"), "http://localhost:8080");
    assert_eq!(b("localhost:50050"), "http://localhost:8080");
    assert_eq!(b("https://db.example.com/"), "https://db.example.com");
    assert_eq!(
        b("https://api.axonio.xyz/api/v1/gateway/"),
        "https://api.axonio.xyz/api/v1/gateway"
    );
    assert_eq!(b("https://cloud.clawdb.dev"), axonio::CLOUD_ENDPOINT);
    assert!(matches!(
        Axonio::builder().endpoint("not a url !!").build(),
        Err(Error::InvalidUrl(_))
    ));
}

#[test]
fn an_api_key_alone_means_the_cloud() {
    let db = Axonio::from_api_key("ck_live_x", None).unwrap();
    assert_eq!(db.endpoint(), axonio::CLOUD_ENDPOINT);
    let local = Axonio::builder().build().unwrap();
    assert_eq!(local.endpoint(), "http://localhost:8080");
}

#[test]
fn error_mapping() {
    assert!(matches!(Error::from_http(401, "x", None), Error::Auth(_)));
    assert!(matches!(
        Error::from_http(403, "x", None),
        Error::AccessDenied(_)
    ));
    assert!(matches!(
        Error::from_http(404, "x", None),
        Error::NotFound(_)
    ));
    assert!(matches!(
        Error::from_http(422, "x", None),
        Error::Validation { .. }
    ));
    assert!(matches!(
        Error::from_http(429, "x", Some(2500)),
        Error::RateLimit {
            retry_after_ms: 2500
        }
    ));
    assert!(matches!(
        Error::from_http(503, "x", None),
        Error::Unavailable(_)
    ));
    assert!(matches!(
        Error::from_http(500, "boom", None),
        Error::Http { status: 500, .. }
    ));
    assert!(Error::Unavailable("d".into()).is_retriable());
    assert!(!Error::Auth("k".into()).is_retriable());
}

/// Live test against the Axonio cloud: `AXONIO_LIVE_KEY=ck_live_... cargo test -- --ignored`
#[tokio::test]
#[ignore]
async fn live_cloud() {
    let key = std::env::var("AXONIO_LIVE_KEY").expect("set AXONIO_LIVE_KEY");
    let db = Axonio::from_api_key(key, None).unwrap();
    let id = db
        .remember_typed(
            "rust sdk live test: the user prefers dark mode",
            RememberOptions {
                tags: Some(vec!["rust-sdk-live-test".into()]),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    let hits = db
        .search("which theme does the user like", SearchOptions::default())
        .await
        .unwrap();
    let found = hits.iter().any(|h| h.id == id);
    let rec = db.get_memory(&id).await.unwrap();
    db.delete_memory(&id).await.unwrap();
    db.close().await;
    assert!(found, "paraphrase search should find the memory");
    assert_eq!(rec.id, id);
}
