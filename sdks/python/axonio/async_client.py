"""Async ClawDB client and async sub-clients."""
from __future__ import annotations

from typing import Any, Awaitable, Callable

import structlog

from axonio._http import AsyncHttpCore
from axonio.config import ClawDBConfig
from axonio.errors import ClawDBError
from axonio.memory import UUID_RE, check_ids, check_top_k, remember_payload, require_content, to_hit, to_memory
from axonio.models import BranchInfo, DiffResult, MemoryRecord, MergeResult, ReflectJob, SearchResult, SyncActionResult, SyncResult, SyncStatusResult, TxInfo
from axonio.provision import resolve_endpoint
from axonio.sync_client import as_dict, jobs_from, to_job

log = structlog.get_logger(__name__)


class AsyncMemoryClient:
    def __init__(self, core: AsyncHttpCore) -> None:
        self._core = core

    async def remember(self, content: str, *, memory_type: str = "context", tags: list[str] | None = None, metadata: dict[str, Any] | None = None, ttl_days: int | None = None) -> str:
        require_content(content)
        return str((await self._core.call("Remember", remember_payload(content, memory_type, tags, metadata))).get("memory_id", ""))

    async def search(self, query: str, *, top_k: int = 5, semantic: bool = True, filter: dict[str, Any] | None = None, alpha: float = 0.7) -> list[SearchResult]:
        check_top_k(top_k)
        reply = await self._core.call("Search", {"query": query, "top_k": top_k, "semantic": semantic})
        return [to_hit(h) for h in reply.get("hits", [])]

    async def recall(self, memory_ids: list[str]) -> list[MemoryRecord]:
        check_ids(memory_ids)
        return [to_memory(await self._core.call("GetMemory", {"memory_id": mid})) for mid in memory_ids]

    async def update(self, memory_id: str, content: str) -> bool:
        require_content(content)
        return bool((await self._core.call("UpdateMemory", {"memory_id": memory_id, "content": content})).get("updated"))

    async def forget(self, memory_id: str) -> None:
        await self._core.call("DeleteMemory", {"memory_id": memory_id})

    async def delete(self, memory_id: str) -> bool:
        return bool((await self._core.call("DeleteMemory", {"memory_id": memory_id})).get("deleted"))

    async def list(self, *, memory_type: str | None = None, limit: int = 50, offset: int = 0) -> list[MemoryRecord]:
        reply = await self._core.call("ListMemories", {"type": memory_type or "", "limit": limit})
        return [to_memory(m) for m in reply.get("memories", [])]


class AsyncBranchClient:
    def __init__(self, core: AsyncHttpCore, db_factory: Callable[[], Any] | None = None) -> None:
        self._core = core
        self._db_factory = db_factory

    async def _branch_id(self, ref: str) -> str:
        """Accepts a branch id, a name, or "trunk"/"" for the trunk branch."""
        if ref and UUID_RE.match(ref):
            return ref
        if not ref or ref == "trunk":
            return str((await self._core.call("GetTrunkBranch")).get("branch_id", ""))
        return str((await self._core.call("GetBranchByName", {"name": ref})).get("branch_id", ""))

    async def fork(self, name: str, *, parent: str | None = None, description: str | None = None) -> BranchInfo:
        """Creates branch `name` from `parent` (id or name; default trunk)."""
        payload: dict[str, Any] = {"name": name}
        if parent and parent != "trunk":
            payload["from"] = await self._branch_id(parent)
        reply = await self._core.call("Branch", payload)
        return BranchInfo(branch_id=reply.get("branch_id", ""), name=reply.get("name") or name)

    async def list(self) -> list[BranchInfo]:
        return [BranchInfo.model_validate(b) for b in (await self._core.call("ListBranches")).get("branches", [])]

    async def diff(self, branch_a: str, branch_b: str = "trunk") -> dict[str, Any]:
        reply = await self._core.call("Diff", {"branch_id": await self._branch_id(branch_a), "target": branch_b})
        return DiffResult.model_validate(reply).model_dump()

    async def merge(self, source: str, *, into: str = "trunk", strategy: str = "union") -> dict[str, Any]:
        reply = await self._core.call("Merge", {"source": await self._branch_id(source), "target": into, "strategy": strategy})
        return MergeResult.model_validate(reply).model_dump()

    async def discard(self, name: str) -> None:
        """Discards a branch by id or name."""
        await self._core.call("DiscardBranch", {"branch_id": await self._branch_id(name)})

    async def simulate(self, name: str, fn: Callable[[Any], Awaitable[Any]]) -> tuple[Any, dict[str, Any]]:
        """Runs `fn(db)` against a throwaway branch of `name` and returns its
        result with the sandbox's diff against `name`. The sandbox is always
        discarded."""
        sandbox = await self.fork(f"sandbox-{name}-sim", parent=name)
        db = self._db_factory() if self._db_factory else None
        try:
            result = await fn(db)
            evaluation = await self.diff(sandbox.branch_id, name)
            return result, evaluation
        finally:
            try:
                await self._core.call("DiscardBranch", {"branch_id": sandbox.branch_id})
            except ClawDBError:
                pass


class AsyncSyncClient:
    def __init__(self, core: AsyncHttpCore) -> None:
        self._core = core

    async def sync(self) -> SyncResult:
        return SyncResult.model_validate(await self._core.call("Sync"))

    async def push(self) -> SyncActionResult:
        return SyncActionResult.model_validate(await self._core.call("PushSync"))

    async def pull(self) -> SyncActionResult:
        return SyncActionResult.model_validate(await self._core.call("PullSync"))

    async def reconcile(self) -> SyncActionResult:
        return SyncActionResult.model_validate(await self._core.call("ReconcileSync"))

    async def status(self) -> SyncStatusResult:
        return SyncStatusResult.model_validate(await self._core.call("SyncStatus"))


class AsyncReflectClient:
    def __init__(self, core: AsyncHttpCore) -> None:
        self._core = core

    async def trigger(self) -> ReflectJob:
        return to_job(await self._core.call("Reflect"))

    async def get_job(self, job_id: str) -> ReflectJob:
        return to_job((await self._core.call("ReflectGetJob", {"job_id": job_id})).get("json"))

    async def list_jobs(self, agent_id: str, *, status: str = "", limit: int = 20, offset: int = 0) -> list[ReflectJob]:
        payload = {"agent_id": agent_id, "status": status, "limit": limit, "offset": offset}
        return jobs_from((await self._core.call("ReflectListJobs", payload)).get("json"))

    async def get_facts(self, agent_id: str) -> dict[str, Any]:
        return as_dict((await self._core.call("ReflectGetFacts", {"agent_id": agent_id})).get("json"))

    async def get_preferences(self, agent_id: str) -> dict[str, Any]:
        return as_dict((await self._core.call("ReflectGetPreferences", {"agent_id": agent_id})).get("json"))

    async def get_contradictions(self, agent_id: str) -> dict[str, Any]:
        return as_dict((await self._core.call("ReflectGetContradictions", {"agent_id": agent_id})).get("json"))


class AsyncTxClient:
    def __init__(self, core: AsyncHttpCore) -> None:
        self._core = core

    async def begin(self) -> TxInfo:
        return TxInfo.model_validate(await self._core.call("BeginTx"))

    async def remember(self, tx_id: str, content: str) -> str:
        return str((await self._core.call("TxRemember", {"tx_id": tx_id, "content": content})).get("memory_id", ""))

    async def remember_typed(self, tx_id: str, content: str, *, type: str = "context", tags: list[str] | None = None, metadata: dict[str, Any] | None = None) -> str:
        payload = {"tx_id": tx_id, "content": content, "type": type, "tags": tags or [], "metadata": metadata or {}}
        return str((await self._core.call("TxRememberTyped", payload)).get("memory_id", ""))

    async def commit(self, tx_id: str) -> bool:
        return bool((await self._core.call("CommitTx", {"tx_id": tx_id})).get("committed"))

    async def rollback(self, tx_id: str) -> bool:
        return bool((await self._core.call("RollbackTx", {"tx_id": tx_id})).get("rolled_back"))


class AsyncClawDB:
    """Fully async ClawDB client over the server's HTTP API."""

    def __init__(self, *, endpoint: str | None = None, api_key: str | None = None, agent_id: str | None = None, **kwargs: Any) -> None:
        overrides: dict[str, Any] = {}
        if endpoint:
            overrides["endpoint"] = endpoint
        if api_key:
            overrides["api_key"] = api_key
        if agent_id:
            overrides["agent_id"] = agent_id
        overrides.update(kwargs)
        self._config = ClawDBConfig(**overrides)
        self._core: AsyncHttpCore | None = None
        self._memory_client: AsyncMemoryClient | None = None
        self._branch_client: AsyncBranchClient | None = None
        self._sync_client: AsyncSyncClient | None = None
        self._reflect_client: AsyncReflectClient | None = None
        self._tx_client: AsyncTxClient | None = None

    @classmethod
    def from_env(cls) -> "AsyncClawDB":
        return cls()

    @classmethod
    def from_api_key(cls, api_key: str, endpoint: str | None = None) -> "AsyncClawDB":
        from axonio._http import CLOUD_ENDPOINT

        return cls(api_key=api_key, endpoint=endpoint or CLOUD_ENDPOINT)

    @classmethod
    async def auto_provision(cls) -> "AsyncClawDB":
        result = await resolve_endpoint()
        return cls(endpoint=result.endpoint, api_key=result.api_key)

    def _should_resolve_endpoint(self) -> bool:
        return self._config.endpoint in ("", "http://localhost:50050")

    def _apply_key_only_default(self) -> bool:
        """An API key with no endpoint means the hosted cloud, as in the TypeScript SDK."""
        if self._config.api_key and self._should_resolve_endpoint():
            from axonio._http import CLOUD_ENDPOINT

            self._config.endpoint = CLOUD_ENDPOINT
            return True
        return False

    async def connect(self) -> None:
        if self._core is not None:
            return
        if self._should_resolve_endpoint() and not self._apply_key_only_default():
            result = await resolve_endpoint()
            self._config.endpoint = result.endpoint
            if result.api_key and not self._config.api_key:
                self._config.api_key = result.api_key
        self._core = AsyncHttpCore(
            self._config.endpoint,
            api_key=self._config.api_key,
            agent_id=self._config.agent_id,
            role=self._config.role,
            timeout_ms=self._config.timeout_ms,
        )
        await self._core.open_session()
        log.info("axonio.async.connected", endpoint=self._core.base_url)

    async def disconnect(self) -> None:
        if self._core is None:
            return
        if self._core.session_id:
            try:
                await self._core.call("RevokeSession", {"session_id": self._core.session_id})
            except ClawDBError:
                pass
        await self._core.close()
        self._core = None
        self._memory_client = self._branch_client = None
        self._sync_client = self._reflect_client = self._tx_client = None

    async def __aenter__(self) -> "AsyncClawDB":
        await self.connect()
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.disconnect()

    def _require_core(self) -> AsyncHttpCore:
        if self._core is None:
            raise RuntimeError("Not connected. Await connect() or use 'async with'.")
        return self._core

    async def health(self) -> dict[str, Any]:
        return await self._require_core().call("Health")

    @property
    def memory(self) -> AsyncMemoryClient:
        if self._memory_client is None:
            self._memory_client = AsyncMemoryClient(self._require_core())
        return self._memory_client

    @property
    def branches(self) -> AsyncBranchClient:
        if self._branch_client is None:
            self._branch_client = AsyncBranchClient(self._require_core(), lambda: self)
        return self._branch_client

    @property
    def sync(self) -> AsyncSyncClient:
        if self._sync_client is None:
            self._sync_client = AsyncSyncClient(self._require_core())
        return self._sync_client

    @property
    def reflect(self) -> AsyncReflectClient:
        if self._reflect_client is None:
            self._reflect_client = AsyncReflectClient(self._require_core())
        return self._reflect_client

    @property
    def tx(self) -> AsyncTxClient:
        if self._tx_client is None:
            self._tx_client = AsyncTxClient(self._require_core())
        return self._tx_client
