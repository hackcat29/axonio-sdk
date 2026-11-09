"""Axonio Python SDK: persistent memory for AI agents."""

from __future__ import annotations

import asyncio
from typing import Awaitable

from axonio.async_client import AsyncClawDB
from axonio.client import ClawDB
from axonio.errors import (
    ClawDBAccessDeniedError,
    ClawDBAuthError,
    ClawDBError,
    ClawDBInternalError,
    ClawDBNotFoundError,
    ClawDBRateLimitError,
    ClawDBProvisionError,
    ClawDBTimeoutError,
    ClawDBUnavailableError,
    ClawDBValidationError,
)
from axonio.models import BranchInfo, DiffResult, MemoryRecord, MergeResult, ReflectJob, SearchResult, SyncActionResult, SyncResult, SyncStatusResult, TxInfo
from axonio.transactions import TxClient


def axonio() -> ClawDB | Awaitable[AsyncClawDB]:
    """Return sync client in sync code, or awaitable async client inside an event loop."""
    try:
        asyncio.get_running_loop()
        return AsyncClawDB.auto_provision()
    except RuntimeError:
        return ClawDB.auto_provision()

# `Axonio` / `AsyncAxonio` are the same classes as `ClawDB` / `AsyncClawDB`;
# `clawdb()` remains as an alias of `axonio()`.
Axonio = ClawDB
AsyncAxonio = AsyncClawDB
clawdb = axonio

__all__ = [
    "axonio",
    "Axonio",
    "AsyncAxonio",
    "clawdb",
    "ClawDB",
    "AsyncClawDB",
    "MemoryRecord",
    "SearchResult",
    "BranchInfo",
    "SyncResult",
    "ReflectJob",
    "ClawDBError",
    "ClawDBAuthError",
    "ClawDBAccessDeniedError",
    "ClawDBNotFoundError",
    "ClawDBRateLimitError",
    "ClawDBProvisionError",
    "ClawDBUnavailableError",
    "ClawDBTimeoutError",
    "ClawDBValidationError",
    "ClawDBInternalError",
]
