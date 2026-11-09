"""HTTP transport for the ClawDB Python SDK.

Every client talks to the server's HTTP API (``/v1/...``): the hosted Axonio
gateway, or a self-hosted clawdb-server's HTTP port. One route table maps each
operation to a request and reshapes the reply, and both the sync and async
cores use it, so they can't drift apart.

Sessions are opened on first use with a one-hour TTL, renewed a minute before
they expire, and renewed once (then the call retried) if the server rejects
the token. Network errors and 502/503/504 are retried with backoff; 429 waits
for ``Retry-After``.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable
from urllib.parse import quote, urlsplit, urlunsplit

import httpx

from axonio.errors import (
    ClawDBAccessDeniedError,
    ClawDBAuthError,
    ClawDBError,
    ClawDBInternalError,
    ClawDBNotFoundError,
    ClawDBRateLimitError,
    ClawDBTimeoutError,
    ClawDBUnavailableError,
    ClawDBValidationError,
)

#: The hosted cloud. Requests carry the API key; the gateway routes them to the
#: workspace's own ClawDB instance.
CLOUD_ENDPOINT = "https://api.axonio.xyz/api/v1/gateway"
#: Retired default cloud hosts; requests to them are sent to CLOUD_ENDPOINT.
_LEGACY_CLOUD_HOSTS = {"cloud.clawdb.dev"}

SESSION_TTL_SECS = 3600
_RENEW_MARGIN_SECS = 60
_MAX_ATTEMPTS = 3
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


def http_base_url(endpoint: str) -> str:
    """The HTTP API base for a configured endpoint.

    - A retired cloud host becomes the current cloud gateway.
    - A URL with a path (such as the cloud gateway) is used as-is.
    - A bare server address on the gRPC port 50050 maps to its HTTP port 8080,
      so the long-standing default ``http://localhost:50050`` keeps working.
    - Any other bare address is assumed to be the HTTP API already.
    """
    endpoint = (endpoint or "").strip() or "http://localhost:50050"
    if "://" not in endpoint:
        endpoint = f"http://{endpoint}"
    parts = urlsplit(endpoint)
    if parts.hostname in _LEGACY_CLOUD_HOSTS:
        return CLOUD_ENDPOINT
    path = parts.path.rstrip("/")
    if path:
        return urlunsplit((parts.scheme, parts.netloc, path, "", ""))
    netloc = parts.netloc
    if parts.port == 50050:
        netloc = netloc.rsplit(":", 1)[0] + ":8080"
    return urlunsplit((parts.scheme, netloc, "", "", ""))


def stable_agent_id(agent_id: str) -> str:
    """The server needs a UUID agent id. Any other id maps to a stable UUID,
    byte-for-byte the same as the TypeScript SDK, so one agent name means one
    agent across both SDKs."""
    if _UUID_RE.match(agent_id):
        return agent_id
    digest = list(hashlib.sha256(agent_id.encode()).hexdigest()[:32])
    digest[12] = "5"
    digest[16] = format((int(digest[16], 16) & 0x3) | 0x8, "x")
    h = "".join(digest)
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


# ── Routes ───────────────────────────────────────────────────────────────────


@dataclass
class _Route:
    method: str
    path: str
    params: dict[str, Any] = field(default_factory=dict)
    body: Any = None
    reply: Callable[[Any], dict[str, Any]] | None = None


def _q(value: Any) -> str:
    return quote(str(value), safe="")


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _branch(value: Any) -> dict[str, Any]:
    b = _as_dict(value)
    return {"branch_id": str(b.get("id") or b.get("branch_id") or ""), "name": str(b.get("name") or ""), "branch_json": json.dumps(b)}


def _route(op: str, p: dict[str, Any]) -> _Route:
    if op == "Health":
        return _Route("GET", "/v1/health")
    if op == "CreateSession":
        return _Route("POST", "/v1/sessions", body={k: p[k] for k in ("agent_id", "role", "scopes", "ttl_secs")})
    if op == "ValidateSession":
        return _Route("GET", "/v1/sessions/me")
    if op == "RevokeSession":
        return _Route("DELETE", f"/v1/sessions/{_q(p['session_id'])}", reply=lambda _: {"revoked": True})
    if op == "ActiveSessionCount":
        return _Route("GET", "/v1/sessions/active/count")

    if op == "Remember":
        body = {"content": p["content"], "type": p.get("type") or "context", "tags": p.get("tags") or [], "metadata": p.get("metadata") or {}}
        return _Route("POST", "/v1/memories", body=body)
    if op == "UpdateMemory":
        return _Route("PATCH", f"/v1/memories/{_q(p['memory_id'])}", body={"content": p["content"]})
    if op == "DeleteMemory":
        return _Route("DELETE", f"/v1/memories/{_q(p['memory_id'])}", reply=lambda _: {"deleted": True})
    if op == "GetMemory":
        return _Route("GET", f"/v1/memories/{_q(p['memory_id'])}")
    if op == "Search":
        params = {"q": p["query"], "top_k": p.get("top_k", 5), "semantic": "true" if p.get("semantic", True) else "false"}
        return _Route("GET", "/v1/memories/search", params=params, reply=lambda j: {"hits": _as_list(j)})
    if op == "ListMemories":
        params = {"limit": p.get("limit", 50)}
        if p.get("type"):
            params["type"] = p["type"]
        return _Route("GET", "/v1/memories", params=params, reply=lambda j: {"memories": _as_list(j)})

    if op == "Branch":
        body = {"name": p["name"]}
        if p.get("from"):
            body["from"] = p["from"]
        return _Route("POST", "/v1/branches", body=body, reply=lambda j: {"branch_id": str(_as_dict(j).get("branch_id") or _as_dict(j).get("id") or ""), "name": str(_as_dict(j).get("name") or "")})
    if op == "ListBranches":
        return _Route("GET", "/v1/branches", reply=lambda j: {"branches": [_branch(b) for b in _as_list(j)]})
    if op == "GetBranch":
        return _Route("GET", f"/v1/branches/{_q(p['branch_id'])}", reply=_branch)
    if op == "GetBranchByName":
        return _Route("GET", f"/v1/branches/by-name/{_q(p['name'])}", reply=_branch)
    if op == "GetTrunkBranch":
        return _Route("GET", "/v1/branches/trunk", reply=_branch)
    if op == "Diff":
        def diff_reply(j: Any) -> dict[str, Any]:
            d = _as_dict(j)
            stats = _as_dict(d.get("stats"))
            return {
                **{k: int(stats.get(k, d.get(k, 0)) or 0) for k in ("added", "removed", "modified", "unchanged")},
                "divergence_score": float(d.get("divergence_score") or 0.0),
                "diff_json": json.dumps(d),
            }
        return _Route("GET", f"/v1/branches/{_q(p['branch_id'])}/diff", params={"target": p.get("target") or ""}, reply=diff_reply)
    if op == "Merge":
        def merge_reply(j: Any) -> dict[str, Any]:
            r = _as_dict(j)
            conflicts = r.get("conflicts")
            return {
                "success": bool(r.get("success", True)),
                "applied": int(r.get("applied") or 0),
                "skipped": int(r.get("skipped") or 0),
                "conflicts": len(conflicts) if isinstance(conflicts, list) else int(conflicts or 0),
                "duration_ms": int(r.get("duration_ms") or 0),
                "conflicts_json": json.dumps(conflicts if isinstance(conflicts, list) else []),
            }
        body = {"target": p.get("target") or ""}
        if p.get("strategy"):
            body["strategy"] = p["strategy"]
        return _Route("POST", f"/v1/branches/{_q(p['source'])}/merge", body=body, reply=merge_reply)
    if op == "DiscardBranch":
        return _Route("DELETE", f"/v1/branches/{_q(p['branch_id'])}", reply=lambda _: {"discarded": True})
    if op == "ArchiveBranch":
        return _Route("POST", f"/v1/branches/{_q(p['branch_id'])}/archive", reply=lambda _: {"archived": True})

    if op == "Sync":
        return _Route("POST", "/v1/sync")
    if op in ("PushSync", "PullSync", "ReconcileSync"):
        path = {"PushSync": "/v1/sync/push", "PullSync": "/v1/sync/pull", "ReconcileSync": "/v1/sync/reconcile"}[op]
        return _Route("POST", path, reply=lambda j: {"summary_json": json.dumps(j if j is not None else {})})
    if op == "SyncStatus":
        return _Route("GET", "/v1/sync/status", reply=lambda j: {"status_json": json.dumps(j if j is not None else {})})

    wrap = lambda j: {"json": j}  # noqa: E731
    if op == "Reflect":
        return _Route("POST", "/v1/reflect")
    if op == "ReflectGetJob":
        return _Route("GET", f"/v1/reflect/jobs/{_q(p['job_id'])}", reply=wrap)
    if op == "ReflectListJobs":
        params = {k: v for k, v in {"agent_id": p.get("agent_id"), "status": p.get("status"), "limit": p.get("limit"), "offset": p.get("offset")}.items() if v not in (None, "")}
        return _Route("GET", "/v1/reflect/jobs", params=params, reply=wrap)
    if op in ("ReflectGetFacts", "ReflectGetPreferences", "ReflectGetContradictions"):
        kind = {"ReflectGetFacts": "facts", "ReflectGetPreferences": "preferences", "ReflectGetContradictions": "contradictions"}[op]
        return _Route("GET", f"/v1/reflect/{kind}/{_q(p['agent_id'])}", reply=wrap)
    if op == "ReflectResolveContradiction":
        body = {"strategy": p.get("strategy") or "", "merged_value": p.get("merged_value")}
        return _Route("POST", f"/v1/reflect/contradictions/{_q(p['agent_id'])}/{_q(p['contradiction_id'])}/resolve", body=body, reply=wrap)

    if op == "BeginTx":
        return _Route("POST", "/v1/tx")
    if op == "TxRemember":
        return _Route("POST", f"/v1/tx/{_q(p['tx_id'])}/memories", body={"content": p["content"]})
    if op == "TxRememberTyped":
        body = {"content": p["content"], "type": p.get("type") or "context", "tags": p.get("tags") or [], "metadata": p.get("metadata") or {}}
        return _Route("POST", f"/v1/tx/{_q(p['tx_id'])}/memories/typed", body=body)
    if op == "CommitTx":
        return _Route("POST", f"/v1/tx/{_q(p['tx_id'])}/commit")
    if op == "RollbackTx":
        return _Route("POST", f"/v1/tx/{_q(p['tx_id'])}/rollback")
    raise ClawDBValidationError(f"Unknown operation: {op}")


# ── Errors ───────────────────────────────────────────────────────────────────


class _SessionRejected(Exception):
    """The instance rejected the session token; a new session may fix it."""


def _error_for(response: httpx.Response, op: str) -> ClawDBError:
    request_id = response.headers.get("x-request-id")
    try:
        body = _as_dict(response.json())
    except ValueError:
        body = {"error": response.text}
    reason = str(body.get("error") or body.get("message") or response.reason_phrase or f"HTTP {response.status_code}")
    detail = body.get("detail") or (f"requires {body['required']}" if body.get("required") else "")
    message = f"{reason}: {detail}" if detail else reason
    status = response.status_code
    if status == 401:
        return ClawDBAuthError(message, request_id=request_id, details=body)
    if status in (402, 403):
        return ClawDBAccessDeniedError(message, resource=op, action="call", request_id=request_id, details=body)
    if status == 404:
        return ClawDBNotFoundError(message, entity_type=op, entity_id="unknown", request_id=request_id, details=body)
    if status in (400, 409, 422):
        return ClawDBValidationError(message, request_id=request_id, details=body)
    if status == 429:
        retry_after = response.headers.get("retry-after")
        retry_ms = int(float(retry_after) * 1000) if retry_after and retry_after.replace(".", "", 1).isdigit() else 1000
        return ClawDBRateLimitError(message, retry_after_ms=retry_ms, request_id=request_id, details=body)
    if status in (502, 503):
        return ClawDBUnavailableError(message, request_id=request_id, details=body)
    if status in (408, 504):
        return ClawDBTimeoutError(message, request_id=request_id, details=body)
    return ClawDBInternalError(message, request_id=request_id, details=body)


def _is_session_rejection(response: httpx.Response) -> bool:
    # The instance answers a bad session with {"error":"unauthorized"}; the
    # gateway answers a bad API key with "invalid_api_key".
    if response.status_code != 401:
        return False
    try:
        return _as_dict(response.json()).get("error") == "unauthorized"
    except ValueError:
        return False


# ── Cores ────────────────────────────────────────────────────────────────────


class _CoreBase:
    def __init__(self, endpoint: str, *, api_key: str = "", agent_id: str = "default-agent", role: str = "assistant", timeout_ms: int = 30000) -> None:
        self.base_url = http_base_url(endpoint)
        self.api_key = api_key or ""
        self.agent_id = stable_agent_id(agent_id or "default-agent")
        self.role = role or "assistant"
        self.timeout = max(timeout_ms, 1) / 1000.0
        self.session_id: str | None = None
        self.token: str | None = None
        self._expires_at: float | None = None

    def _session_fresh(self) -> bool:
        if not self.token:
            return False
        return self._expires_at is None or time.time() < self._expires_at - _RENEW_MARGIN_SECS

    def _remember_session(self, body: dict[str, Any]) -> dict[str, Any]:
        token = str(body.get("token") or "")
        if not token:
            raise ClawDBAuthError("Server returned a session without a token", details=body)
        self.token = token
        self.session_id = str(body.get("session_id") or body.get("id") or "") or None
        expires = str(body.get("expires_at") or "")
        try:
            from datetime import datetime

            self._expires_at = datetime.fromisoformat(expires.replace("Z", "+00:00")).timestamp()
        except ValueError:
            self._expires_at = None
        return body

    def forget_session(self) -> None:
        self.token = None
        self.session_id = None
        self._expires_at = None

    def _session_payload(self) -> dict[str, Any]:
        return {"agent_id": self.agent_id, "role": self.role, "scopes": ["*"], "ttl_secs": SESSION_TTL_SECS}

    def _request_kwargs(self, route: _Route, with_session: bool) -> dict[str, Any]:
        headers = {"accept": "application/json", "x-agent-id": self.agent_id}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        # x-claw-session, not Authorization: the gateway replaces Authorization
        # (the API key) before forwarding to the instance.
        if with_session and self.token:
            headers["x-claw-session"] = self.token
        kwargs: dict[str, Any] = {"headers": headers, "params": {k: v for k, v in route.params.items() if v is not None}}
        if route.body is not None:
            kwargs["json"] = route.body
        return kwargs

    @staticmethod
    def _decode(response: httpx.Response, route: _Route) -> dict[str, Any]:
        data: Any = None
        if response.content:
            try:
                data = response.json()
            except ValueError:
                data = {"message": response.text}
        result = route.reply(data) if route.reply else _as_dict(data)
        request_id = response.headers.get("x-request-id")
        if request_id and "request_id" not in result:
            result = {**result, "request_id": request_id}
        return result

    @staticmethod
    def _backoff(attempt: int) -> float:
        return min(0.2 * (2**attempt), 2.0)


class HttpCore(_CoreBase):
    """Synchronous HTTP core."""

    def __init__(self, endpoint: str, **kwargs: Any) -> None:
        super().__init__(endpoint, **kwargs)
        self._client = httpx.Client(timeout=self.timeout)
        self._lock = threading.Lock()

    def close(self) -> None:
        self._client.close()

    def open_session(self) -> dict[str, Any]:
        with self._lock:
            return self._remember_session(self._send("CreateSession", self._session_payload(), with_session=False))

    def _ensure_session(self) -> None:
        if not self._session_fresh():
            self.open_session()

    def _send(self, op: str, payload: dict[str, Any], *, with_session: bool) -> dict[str, Any]:
        route = _route(op, payload)
        url = f"{self.base_url}{route.path}"
        for attempt in range(_MAX_ATTEMPTS):
            try:
                response = self._client.request(route.method, url, **self._request_kwargs(route, with_session))
            except httpx.TimeoutException as exc:
                if attempt == _MAX_ATTEMPTS - 1:
                    raise ClawDBTimeoutError(f"{op} timed out", timeout_ms=int(self.timeout * 1000)) from exc
            except httpx.HTTPError as exc:
                if attempt == _MAX_ATTEMPTS - 1:
                    raise ClawDBUnavailableError(f"Could not reach {self.base_url}: {exc}") from exc
            else:
                if response.is_success:
                    return self._decode(response, route)
                if with_session and _is_session_rejection(response):
                    raise _SessionRejected()
                error = _error_for(response, op)
                if isinstance(error, ClawDBRateLimitError) and attempt < _MAX_ATTEMPTS - 1:
                    time.sleep(error.retry_after_ms / 1000.0)
                    continue
                if not isinstance(error, (ClawDBUnavailableError, ClawDBTimeoutError)) or attempt == _MAX_ATTEMPTS - 1:
                    raise error
            time.sleep(self._backoff(attempt))
        raise ClawDBUnavailableError(f"{op}: retries exhausted")

    def call(self, op: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload or {}
        if op in ("Health", "CreateSession"):
            return self._send(op, payload, with_session=False)
        self._ensure_session()
        try:
            return self._send(op, payload, with_session=True)
        except _SessionRejected:
            # Expired or revoked: open a new session and retry once.
            self.forget_session()
            self._ensure_session()
            try:
                return self._send(op, payload, with_session=True)
            except _SessionRejected:
                raise ClawDBAuthError("The server rejected a freshly opened session") from None


class AsyncHttpCore(_CoreBase):
    """Asynchronous HTTP core."""

    def __init__(self, endpoint: str, **kwargs: Any) -> None:
        super().__init__(endpoint, **kwargs)
        self._client = httpx.AsyncClient(timeout=self.timeout)
        self._lock = asyncio.Lock()

    async def close(self) -> None:
        await self._client.aclose()

    async def open_session(self) -> dict[str, Any]:
        async with self._lock:
            return self._remember_session(await self._send("CreateSession", self._session_payload(), with_session=False))

    async def _ensure_session(self) -> None:
        if not self._session_fresh():
            await self.open_session()

    async def _send(self, op: str, payload: dict[str, Any], *, with_session: bool) -> dict[str, Any]:
        route = _route(op, payload)
        url = f"{self.base_url}{route.path}"
        for attempt in range(_MAX_ATTEMPTS):
            try:
                response = await self._client.request(route.method, url, **self._request_kwargs(route, with_session))
            except httpx.TimeoutException as exc:
                if attempt == _MAX_ATTEMPTS - 1:
                    raise ClawDBTimeoutError(f"{op} timed out", timeout_ms=int(self.timeout * 1000)) from exc
            except httpx.HTTPError as exc:
                if attempt == _MAX_ATTEMPTS - 1:
                    raise ClawDBUnavailableError(f"Could not reach {self.base_url}: {exc}") from exc
            else:
                if response.is_success:
                    return self._decode(response, route)
                if with_session and _is_session_rejection(response):
                    raise _SessionRejected()
                error = _error_for(response, op)
                if isinstance(error, ClawDBRateLimitError) and attempt < _MAX_ATTEMPTS - 1:
                    await asyncio.sleep(error.retry_after_ms / 1000.0)
                    continue
                if not isinstance(error, (ClawDBUnavailableError, ClawDBTimeoutError)) or attempt == _MAX_ATTEMPTS - 1:
                    raise error
            await asyncio.sleep(self._backoff(attempt))
        raise ClawDBUnavailableError(f"{op}: retries exhausted")

    async def call(self, op: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload or {}
        if op in ("Health", "CreateSession"):
            return await self._send(op, payload, with_session=False)
        await self._ensure_session()
        try:
            return await self._send(op, payload, with_session=True)
        except _SessionRejected:
            self.forget_session()
            await self._ensure_session()
            try:
                return await self._send(op, payload, with_session=True)
            except _SessionRejected:
                raise ClawDBAuthError("The server rejected a freshly opened session") from None


def new_uuid() -> str:
    return str(uuid.uuid4())
