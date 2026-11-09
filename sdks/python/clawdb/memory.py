"""Sync MemoryClient and BranchClient for the ClawDB Python SDK."""
from __future__ import annotations

import re
from typing import Any

from clawdb._http import HttpCore
from clawdb.errors import ClawDBError, ClawDBValidationError
from clawdb.models import BranchInfo, DiffResult, MemoryRecord, MergeResult, SearchResult

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


def require_content(content: str) -> None:
    if not content or not content.strip():
        raise ClawDBValidationError("content must be a non-empty string", field="content", constraint="non-empty")


def check_top_k(top_k: int) -> None:
    if top_k > 100:
        raise ClawDBValidationError("top_k cannot exceed 100", field="top_k", constraint="<=100")


def check_ids(memory_ids: list[str]) -> None:
    if not memory_ids:
        raise ClawDBValidationError("memory_ids must be non-empty", field="memory_ids")
    for mid in memory_ids:
        if not UUID_RE.match(mid):
            raise ClawDBValidationError(f"Invalid UUID: {mid}", field="memory_ids", constraint="uuid")


def to_memory(m: Any) -> MemoryRecord:
    m = m if isinstance(m, dict) else {}
    return MemoryRecord(id=str(m.get("id", "")), content=str(m.get("content", "")), memory_type=str(m.get("memory_type", "")), tags=list(m.get("tags") or []))


def to_hit(h: Any) -> SearchResult:
    h = h if isinstance(h, dict) else {}
    meta = h.get("metadata")
    return SearchResult(
        id=str(h.get("id", "")),
        content=str(h.get("content", "")),
        score=float(h.get("score") or 0.0),
        memory_type=str(h.get("memory_type", "")),
        tags=list(h.get("tags") or []),
        metadata=meta if isinstance(meta, dict) else {},
    )


def remember_payload(content: str, memory_type: str, tags: list[str] | None, metadata: dict[str, Any] | None) -> dict[str, Any]:
    return {"content": content, "type": memory_type, "tags": tags or [], "metadata": metadata or {}}


class MemoryClient:
    def __init__(self, core: HttpCore) -> None:
        self._core = core

    def remember(
        self,
        content: str,
        *,
        memory_type: str = "context",
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        ttl_days: int | None = None,
    ) -> str:
        """Stores a memory and returns its id. (`ttl_days` is accepted for
        compatibility; the server has no per-memory expiry yet.)"""
        require_content(content)
        return str(self._core.call("Remember", remember_payload(content, memory_type, tags, metadata)).get("memory_id", ""))

    def remember_typed(
        self,
        content: str,
        *,
        memory_type: str = "context",
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **_: Any,
    ) -> str:
        require_content(content)
        return str(self._core.call("Remember", remember_payload(content, memory_type, tags, metadata)).get("memory_id", ""))

    def search(
        self,
        query: str,
        *,
        top_k: int = 5,
        semantic: bool = True,
        filter: dict[str, Any] | None = None,
        alpha: float = 0.7,
    ) -> list[SearchResult]:
        """Searches memory; punctuation and hyphens in `query` are safe.
        (`filter` and `alpha` are accepted for compatibility.)"""
        check_top_k(top_k)
        return [to_hit(h) for h in self._core.call("Search", {"query": query, "top_k": top_k, "semantic": semantic}).get("hits", [])]

    def recall(self, memory_ids: list[str]) -> list[MemoryRecord]:
        check_ids(memory_ids)
        return [to_memory(self._core.call("GetMemory", {"memory_id": mid})) for mid in memory_ids]

    def update(self, memory_id: str, content: str) -> bool:
        require_content(content)
        return bool(self._core.call("UpdateMemory", {"memory_id": memory_id, "content": content}).get("updated"))

    def delete(self, memory_id: str) -> bool:
        return bool(self._core.call("DeleteMemory", {"memory_id": memory_id}).get("deleted"))

    def forget(self, memory_id: str) -> None:
        """Deletes a memory (same as `delete`, matching the async client)."""
        self.delete(memory_id)

    def list(self, *, memory_type: str | None = None, limit: int = 50, **_: Any) -> list[MemoryRecord]:
        return [to_memory(m) for m in self._core.call("ListMemories", {"type": memory_type or "", "limit": limit}).get("memories", [])]

    def score(self, memory_id: str) -> dict[str, float]:
        raise ClawDBError("UNIMPLEMENTED", "Memory scoring is not available on the server")


class BranchClient:
    def __init__(self, core: HttpCore) -> None:
        self._core = core

    def fork(self, name: str, *, from_branch: str = "") -> BranchInfo:
        """Creates a branch from `from_branch` (a branch id; default trunk)."""
        payload: dict[str, Any] = {"name": name}
        if from_branch and UUID_RE.match(from_branch):
            payload["from"] = from_branch
        r = self._core.call("Branch", payload)
        return BranchInfo(branch_id=r.get("branch_id", ""), name=r.get("name") or name)

    def list(self, *, status: str | None = None) -> list[BranchInfo]:
        return [BranchInfo.model_validate(b) for b in self._core.call("ListBranches").get("branches", [])]

    def get(self, branch_id: str) -> BranchInfo:
        return BranchInfo.model_validate(self._core.call("GetBranch", {"branch_id": branch_id}))

    def get_by_name(self, name: str) -> BranchInfo:
        return BranchInfo.model_validate(self._core.call("GetBranchByName", {"name": name}))

    def get_trunk(self) -> BranchInfo:
        return BranchInfo.model_validate(self._core.call("GetTrunkBranch"))

    def diff(self, branch_id: str, target: str = "") -> DiffResult:
        """Diffs a branch against `target`: a branch id, a name, or trunk."""
        return DiffResult.model_validate(self._core.call("Diff", {"branch_id": branch_id, "target": target}))

    def merge(self, source: str, *, target: str = "", strategy: str = "") -> MergeResult:
        """Merges branch `source` into `target`: an id, a name, or trunk."""
        return MergeResult.model_validate(self._core.call("Merge", {"source": source, "target": target, "strategy": strategy}))

    def discard(self, branch_id: str) -> bool:
        return bool(self._core.call("DiscardBranch", {"branch_id": branch_id}).get("discarded"))

    def archive(self, branch_id: str) -> bool:
        return bool(self._core.call("ArchiveBranch", {"branch_id": branch_id}).get("archived"))
