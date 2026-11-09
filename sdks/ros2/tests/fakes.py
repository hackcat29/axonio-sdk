from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from axonio.models import MemoryRecord, SearchResult


class FakeMemory:
    """Behaves like the Axonio server: `search` returns nested metadata, `list`
    returns newest-first records with no metadata."""

    def __init__(self) -> None:
        self.rows: List[Dict[str, Any]] = []
        self.online = True
        self.clock = time.time()

    def remember(self, content: str, *, memory_type: str = "context", tags: Optional[List[str]] = None, metadata: Optional[Dict[str, Any]] = None, **_: Any) -> str:
        if not self.online:
            raise ConnectionError("offline")
        self.clock += 1
        row = {
            "id": f"mem-{len(self.rows) + 1}",
            "content": content,
            "tags": list(tags or []),
            "metadata": dict(metadata or {}),
            "created_at": datetime.fromtimestamp(self.clock, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "789Z",
        }
        self.rows.append(row)
        return row["id"]

    def list(self, *, limit: int = 50, **_: Any) -> List[MemoryRecord]:
        if not self.online:
            raise ConnectionError("offline")
        return [
            MemoryRecord(id=r["id"], content=r["content"], memory_type="Semantic", tags=r["tags"], created_at=r["created_at"])
            for r in reversed(self.rows)
        ][:limit]

    def search(self, query: str, *, top_k: int = 5, **_: Any) -> List[SearchResult]:
        if not self.online:
            raise ConnectionError("offline")
        return [
            SearchResult(
                id=r["id"],
                content=r["content"],
                score=0.5,
                tags=r["tags"],
                metadata={"memory_id": r["id"], "metadata": r["metadata"], "tags": r["tags"]},
            )
            for r in reversed(self.rows)
        ][:top_k]


class FakeDB:
    def __init__(self) -> None:
        self.memory = FakeMemory()
        self.disconnected = False

    def disconnect(self) -> None:
        self.disconnected = True
