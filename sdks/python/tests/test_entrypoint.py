from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from axonio import AsyncClawDB, ClawDB, clawdb


def test_clawdb_returns_sync_client_without_event_loop() -> None:
    with patch.object(ClawDB, "auto_provision", return_value=ClawDB.from_env()) as mocked:
        db = clawdb()
        assert isinstance(db, ClawDB)
        mocked.assert_called_once()


async def _call_async_shorthand() -> AsyncClawDB:
    with patch.object(AsyncClawDB, "auto_provision", new=AsyncMock(return_value=AsyncClawDB.from_env())) as mocked:
        db = await clawdb()
        assert isinstance(db, AsyncClawDB)
        mocked.assert_called_once()
        return db


def test_clawdb_returns_async_client_in_loop() -> None:
    asyncio.run(_call_async_shorthand())
