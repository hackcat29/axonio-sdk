"""Tests for the HTTP-based clients, with the server mocked by respx."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import respx

from clawdb._http import CLOUD_ENDPOINT, http_base_url, stable_agent_id
from clawdb.async_client import AsyncClawDB
from clawdb.client import ClawDB
from clawdb.errors import (
    ClawDBAccessDeniedError,
    ClawDBAuthError,
    ClawDBNotFoundError,
    ClawDBValidationError,
)

BASE = "https://gw.example/api/v1/gateway"
MEMORY_ID = "8d8ed51a-af3e-40db-a4e1-95a3dbfa15e1"


def _session(token: str = "tok-1") -> httpx.Response:
    expires = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    return httpx.Response(200, json={"token": token, "session_id": "s1", "id": "s1", "expires_at": expires})


@pytest.fixture
def server():
    with respx.mock(base_url=BASE, assert_all_called=False) as mock:
        mock.post("/v1/sessions").mock(return_value=_session())
        mock.delete("/v1/sessions/s1").mock(return_value=httpx.Response(204))
        yield mock


# ── endpoint handling ────────────────────────────────────────────────────────


def test_endpoint_mapping():
    assert http_base_url("https://cloud.clawdb.dev") == CLOUD_ENDPOINT
    assert http_base_url(CLOUD_ENDPOINT) == CLOUD_ENDPOINT
    assert http_base_url("http://localhost:50050") == "http://localhost:8080"
    assert http_base_url("db.internal:50050") == "http://db.internal:8080"
    assert http_base_url("http://db.internal:9000/") == "http://db.internal:9000"


def test_agent_id_matches_typescript_sdk():
    # Same derivation as the TS SDK's toStableSessionAgentId.
    assert stable_agent_id("ts-agent") == stable_agent_id("ts-agent")
    assert stable_agent_id(MEMORY_ID) == MEMORY_ID
    derived = stable_agent_id("default-agent")
    assert derived[14] == "5" and derived[19] in "89ab"


def test_from_api_key_defaults_to_cloud():
    db = AsyncClawDB.from_api_key("key123")
    assert db._config.api_key == "key123"
    assert db._config.endpoint == CLOUD_ENDPOINT
    assert ClawDB.from_api_key("k", "https://api.clawdb.io")._config.endpoint == "https://api.clawdb.io"


# ── async client ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_connect_opens_one_hour_session_and_sends_both_credentials(server):
    remember = server.post("/v1/memories").mock(return_value=httpx.Response(200, json={"memory_id": MEMORY_ID}))
    async with AsyncClawDB(endpoint=BASE, api_key="ck_live_x", agent_id="my-agent") as db:
        assert await db.memory.remember("hello", tags=["t"], metadata={"a": 1}) == MEMORY_ID

    session_body = json.loads(server.calls[0].request.content)
    assert session_body["ttl_secs"] == 3600
    assert session_body["agent_id"] == stable_agent_id("my-agent")
    sent = remember.calls[0].request
    assert sent.headers["authorization"] == "Bearer ck_live_x"
    assert sent.headers["x-claw-session"] == "tok-1"
    assert json.loads(sent.content) == {"content": "hello", "type": "context", "tags": ["t"], "metadata": {"a": 1}}


@pytest.mark.asyncio
async def test_remember_empty_raises(server):
    async with AsyncClawDB(endpoint=BASE, api_key="k") as db:
        with pytest.raises(ClawDBValidationError) as exc_info:
            await db.memory.remember("   ")
    assert exc_info.value.field == "content"


@pytest.mark.asyncio
async def test_search_passes_hyphenated_query_and_maps_hits(server):
    route = server.get("/v1/memories/search").mock(
        return_value=httpx.Response(200, json=[{"id": MEMORY_ID, "score": 1.0, "content": "north dock", "memory_type": "context", "tags": [], "metadata": None}])
    )
    async with AsyncClawDB(endpoint=BASE, api_key="k") as db:
        hits = await db.memory.search("north-dock", top_k=3)
    assert hits[0].id == MEMORY_ID and hits[0].score == 1.0 and hits[0].metadata == {}
    assert route.calls[0].request.url.params["q"] == "north-dock"


@pytest.mark.asyncio
async def test_search_top_k_too_large(server):
    async with AsyncClawDB(endpoint=BASE, api_key="k") as db:
        with pytest.raises(ClawDBValidationError):
            await db.memory.search("q", top_k=101)


@pytest.mark.asyncio
async def test_recall_validates_and_fetches_each_id(server):
    server.get(f"/v1/memories/{MEMORY_ID}").mock(return_value=httpx.Response(200, json={"id": MEMORY_ID, "content": "A", "memory_type": "context", "tags": []}))
    async with AsyncClawDB(endpoint=BASE, api_key="k") as db:
        with pytest.raises(ClawDBValidationError):
            await db.memory.recall([])
        with pytest.raises(ClawDBValidationError):
            await db.memory.recall(["not-a-uuid"])
        memories = await db.memory.recall([MEMORY_ID])
    assert memories[0].content == "A"


@pytest.mark.asyncio
async def test_forget_and_list(server):
    delete = server.delete(f"/v1/memories/{MEMORY_ID}").mock(return_value=httpx.Response(204))
    server.get("/v1/memories").mock(return_value=httpx.Response(200, json=[]))
    async with AsyncClawDB(endpoint=BASE, api_key="k") as db:
        await db.memory.forget(MEMORY_ID)
        assert await db.memory.list() == []
    assert delete.called


@pytest.mark.asyncio
async def test_rejected_session_is_renewed_once(server):
    server.post("/v1/sessions").mock(side_effect=[_session("tok-1"), _session("tok-2")])
    route = server.get("/v1/memories").mock(
        side_effect=[httpx.Response(401, json={"error": "unauthorized"}), httpx.Response(200, json=[])]
    )
    async with AsyncClawDB(endpoint=BASE, api_key="k") as db:
        assert await db.memory.list() == []
    assert route.calls[1].request.headers["x-claw-session"] == "tok-2"


@pytest.mark.asyncio
async def test_retry_on_unavailable(server):
    route = server.post("/v1/memories").mock(
        side_effect=[httpx.Response(503, json={"error": "instance_unavailable"}), httpx.Response(503), httpx.Response(200, json={"memory_id": MEMORY_ID})]
    )
    async with AsyncClawDB(endpoint=BASE, api_key="k") as db:
        assert await db.memory.remember("x") == MEMORY_ID
    assert route.call_count == 3


@pytest.mark.asyncio
async def test_branch_names_resolve_and_simulate_cleans_up(server):
    trunk = {"id": "c8000a2c-457b-4d9e-8a6b-345072bc437a", "name": "trunk"}
    sandbox = "cb4c9e92-d238-4deb-afa4-871aaf79e0e3"
    server.get("/v1/branches/trunk").mock(return_value=httpx.Response(200, json=trunk))
    fork = server.post("/v1/branches").mock(return_value=httpx.Response(200, json={"branch_id": sandbox, "name": "sandbox-trunk-sim"}))
    server.get(f"/v1/branches/{sandbox}/diff").mock(return_value=httpx.Response(200, json={"stats": {"added": 1, "removed": 0, "modified": 0, "unchanged": 2}, "divergence_score": 0.3}))
    discard = server.delete(f"/v1/branches/{sandbox}").mock(return_value=httpx.Response(204))

    async def work(db):
        return "done"

    async with AsyncClawDB(endpoint=BASE, api_key="k") as db:
        result, evaluation = await db.branches.simulate("trunk", work)
    assert result == "done" and evaluation["added"] == 1 and evaluation["divergence_score"] == 0.3
    assert "from" not in json.loads(fork.calls[0].request.content)
    assert discard.called


# ── sync client and errors ───────────────────────────────────────────────────


def test_sync_client_connects_lazily_and_maps_errors(server):
    server.get("/v1/branches/by-name/nope").mock(return_value=httpx.Response(404, json={"error": "not_found", "detail": "branch 'nope'"}))
    server.post("/v1/branches").mock(return_value=httpx.Response(400, json={"error": "invalid_request", "detail": "invalid branch name"}))
    server.post("/v1/sync").mock(return_value=httpx.Response(403, json={"error": "insufficient_scope", "required": "manage:sync"}))
    db = ClawDB(endpoint=BASE, api_key="k")
    with pytest.raises(ClawDBNotFoundError):
        db.branches.get_by_name("nope")
    with pytest.raises(ClawDBValidationError):
        db.branches.fork("has spaces")
    with pytest.raises(ClawDBAccessDeniedError) as denied:
        db.sync.sync()
    assert "manage:sync" in denied.value.message
    db.disconnect()


def test_bad_api_key_fails_without_looping():
    with respx.mock(base_url=BASE) as mock:
        route = mock.post("/v1/sessions").mock(return_value=httpx.Response(401, json={"error": "invalid_api_key"}))
        with pytest.raises(ClawDBAuthError):
            ClawDB(endpoint=BASE, api_key="wrong").connect()
    assert route.call_count == 1


def test_transaction_returns_stored_id(server):
    server.post("/v1/tx").mock(return_value=httpx.Response(200, json={"tx_id": "t1"}))
    server.post("/v1/tx/t1/memories/typed").mock(return_value=httpx.Response(200, json={"staged": True, "memory_id": MEMORY_ID}))
    server.post("/v1/tx/t1/commit").mock(return_value=httpx.Response(200, json={"committed": True}))
    with ClawDB(endpoint=BASE, api_key="k") as db:
        tx = db.tx.begin()
        assert db.tx.remember_typed(tx.tx_id, "staged") == MEMORY_ID
        assert db.tx.commit(tx.tx_id) is True
