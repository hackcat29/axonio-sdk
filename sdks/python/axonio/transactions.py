"""Transactional memory client for ClawDB."""
from __future__ import annotations

from typing import Any

from axonio._http import HttpCore
from axonio.models import TxInfo


class TxClient:
    """Stages memories and writes them atomically on commit. The id returned
    when staging is the id the memory is stored under."""

    def __init__(self, core: HttpCore) -> None:
        self._core = core

    def begin(self) -> TxInfo:
        return TxInfo.model_validate(self._core.call("BeginTx"))

    def remember(self, tx_id: str, content: str) -> str:
        return str(self._core.call("TxRemember", {"tx_id": tx_id, "content": content}).get("memory_id", ""))

    def remember_typed(self, tx_id: str, content: str, *, type: str = "context", tags: list[str] | None = None, metadata: dict[str, Any] | None = None) -> str:
        payload = {"tx_id": tx_id, "content": content, "type": type, "tags": tags or [], "metadata": metadata or {}}
        return str(self._core.call("TxRememberTyped", payload).get("memory_id", ""))

    def commit(self, tx_id: str) -> bool:
        return bool(self._core.call("CommitTx", {"tx_id": tx_id}).get("committed"))

    def rollback(self, tx_id: str) -> bool:
        return bool(self._core.call("RollbackTx", {"tx_id": tx_id}).get("rolled_back"))
