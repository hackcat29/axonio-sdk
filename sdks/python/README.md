# axonio

Official Python client for [Axonio](https://axonio.xyz): persistent memory for AI agents, with sync and async APIs.

> Formerly `clawdb`. `pip install axonio` now installs this package, and `import clawdb` still works; `AXONIO_*` environment variables take precedence over `CLAWDB_*`. Pure Python over HTTPS: no gRPC toolchain or generated code to install.

## Install

```bash
pip install axonio
```

## Quick Start

### Hosted (Axonio cloud)

Create an API key in the dashboard. With only `AXONIO_API_KEY` set, the client
connects to the hosted gateway (`https://api.axonio.xyz/api/v1/gateway`).

```python
from axonio import Axonio

with Axonio(api_key="ck_live_...", endpoint="https://api.axonio.xyz/api/v1/gateway") as db:
    memory_id = db.memory.remember("Customer prefers weekly updates", tags=["customer"])
    hits = db.memory.search("how often should we update the customer?", top_k=5)
    branch = db.branches.fork("customer-experiment")
    print(memory_id, [h.content for h in hits], branch.branch_id)
```

### Self-hosted

Point `endpoint` at your clawdb-server. A bare address on the gRPC port
(`http://localhost:50050`, the default) is mapped to the server's HTTP port
(8080); any other URL is used as the HTTP API.

```python
db = Axonio(endpoint="http://localhost:8080", agent_id="py-agent")
```

### Async

```python
from axonio import AsyncAxonio

async with AsyncAxonio(api_key="ck_live_...", endpoint="https://api.axonio.xyz/api/v1/gateway") as db:
    await db.memory.remember("Ship the changelog on Friday", memory_type="task")
    hits = await db.memory.search("release plan")
```

## Behaviour

- Sessions are opened on connect, last an hour, are renewed before they
  expire, and are renewed automatically if the server rejects one.
- Network errors and 502/503/504 are retried with backoff; 429 honours
  `Retry-After`.
- Errors are typed: `ClawDBAuthError`, `ClawDBAccessDeniedError`,
  `ClawDBNotFoundError`, `ClawDBValidationError`, `ClawDBRateLimitError`,
  `ClawDBUnavailableError`, `ClawDBTimeoutError`.
- Agent ids that aren't UUIDs map to a stable UUID, the same one the
  TypeScript SDK derives, so an agent name means one agent in both SDKs.

## Client Variants

- `Axonio` for synchronous code (also exported as `ClawDB`)
- `AsyncAxonio` for asyncio applications (also `AsyncClawDB`)
- `axonio()` helper for environment-aware client creation

## API Surface

- `db.health()`, `db.session` (validate, refresh, revoke, active count)
- `db.memory`: remember, remember_typed, search, recall, update, delete, forget, list
- `db.branches`: fork, list, get, get_by_name, get_trunk, diff, merge, discard, archive
  (`target` accepts a branch id, a name, or trunk)
- `db.sync`: sync, push, pull, reconcile, status
- `db.reflect`: trigger, get_job, list_jobs, get_facts, get_preferences,
  get_contradictions, resolve_contradiction
- `db.tx`: begin, remember, remember_typed, commit, rollback
