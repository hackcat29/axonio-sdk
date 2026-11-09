# docs/MIGRATION.md — ClawDB Migration Guide

## Migrating from direct `clawdb` crate usage to SDK wrappers

This guide covers breaking changes when upgrading from direct proto/gRPC usage to the
official ClawDB SDKs.

---

## v0.1 → v0.1 SDK wrappers (initial SDK release)

### TypeScript: direct proto stubs → `axonio`

**Before** (raw gRPC):

```ts
import { ClawDBClient } from './generated/clawdb_grpc_pb';
import { RememberRequest } from './generated/clawdb_pb';

const client = new ClawDBClient('localhost:50050', credentials);
const req = new RememberRequest();
req.setContent('Deploy at 3 PM');
client.remember(req, (err, resp) => { ... });
```

**After** (`axonio`):

```ts
import { ClawDB } from 'axonio';
const db = new ClawDB({ endpoint: 'http://localhost:50050' });
await db.connect();
const id = await db.memory.remember('Deploy at 3 PM');
```

**Changes:**
- All methods are now `async/await`-first — no callbacks.
- Connection is managed by the SDK (`connect()` / `disconnect()`).
- Proto types are not exported — use the TypeScript types from `axonio-types`.

---

### Python: raw grpc stubs → `clawdb`

**Before**:

```python
import grpc
from clawdb_pb2_grpc import ClawDBStub
from clawdb_pb2 import RememberRequest

channel = grpc.insecure_channel("localhost:50050")
stub = ClawDBStub(channel)
resp = stub.Remember(RememberRequest(content="Deploy at 3 PM"))
```

**After**:

```python
from clawdb import ClawDB
db = ClawDB(endpoint="http://localhost:50050")
id = db.memory.remember("Deploy at 3 PM")
```

**Changes:**
- The `ClawDB` client handles channel lifecycle automatically.
- Use as a context manager for automatic teardown: `with ClawDB(...) as db:`.

---

### Rust: clawdb crate direct usage → builder API

**Before**:

```rust
let mut client = ClawdbClient::connect("http://localhost:50050").await?;
let resp = client.remember(tonic::Request::new(RememberRequest {
    content: "Deploy".into(), ..Default::default()
})).await?;
```

**After**:

```rust
let db = Client::builder().endpoint("http://localhost:50050").build().await?;
let id = db.memory().remember("Deploy").call().await?;
```

**Changes:**
- Builder pattern for client construction.
- All responses return typed Rust structs (not proto wrappers).
- Errors use `clawdb::Error` (wraps tonic Status).

---

### Go: raw tonic client → SDK

**Before**:

```go
conn, _ := grpc.Dial("localhost:50050", grpc.WithInsecure())
client := pb.NewClawDBClient(conn)
resp, _ := client.Remember(ctx, &pb.RememberRequest{Content: "Deploy"})
```

**After**:

```go
db, _ := clawdb.New(clawdb.Options{Endpoint: "http://localhost:50050"})
id, _ := db.Memory.Remember(ctx, "Deploy", nil)
```

---

## Config file changes

The config file moved from `clawdb.json` (pre-SDK) to `~/.clawdb/config.toml` (SDK v0.1+).

Run `clawdb config migrate` to automatically convert an existing config file.

---

## API key format

API keys now follow the format `ck_live_<token>` (live) or `ck_test_<token>` (test).
Old bare tokens are no longer accepted. Regenerate via the ClawDB dashboard.

---

## CLI package location and legacy wrapper migration

The canonical CLI package is now `axonio-cli` in `packages/cli/`.

If you previously referenced the legacy wrapper in `sdks/cli-wrapper/`, migrate to the canonical package:

1. Install or link `axonio-cli` from `packages/cli/`.
2. Use the `clawdb` command as before.
3. Stop consuming `sdks/cli-wrapper/` for new development.

Notes:
- The legacy wrapper is marked private and renamed to avoid package-name collisions.
- New CLI command behavior includes explicit `--json` support across command groups, including `memory`, `branch`, `sync`, `reflect`, `cloud`, and `mcp install-*` commands.
