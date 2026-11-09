"""In-memory spatial index for a robot's planning loop.

Records are hashed into square grid cells, so a radius query only looks at the
cells it overlaps instead of scanning every record. Entries expire after
``memory_ttl_seconds`` and a record with a known id replaces its older copy
(fleet sync can deliver the same record twice).
"""

from __future__ import annotations

import math
import time
from typing import Dict, List, Optional, Tuple

from .client import SpatialMemoryRecord


class SpatialMemoryIndex:
    def __init__(self, memory_ttl_seconds: float = 3600.0, cell_size: float = 2.0) -> None:
        if cell_size <= 0:
            raise ValueError("cell_size must be positive")
        self.ttl = memory_ttl_seconds
        self.cell_size = cell_size
        self._cells: Dict[Tuple[str, int, int], List[SpatialMemoryRecord]] = {}
        self._by_id: Dict[str, SpatialMemoryRecord] = {}
        self._count = 0

    def _key(self, frame_id: str, x: float, y: float) -> Tuple[str, int, int]:
        return (frame_id, math.floor(x / self.cell_size), math.floor(y / self.cell_size))

    def _remove(self, record: SpatialMemoryRecord) -> None:
        bucket = self._cells.get(self._key(record.frame_id, record.x, record.y))
        if bucket and record in bucket:
            bucket.remove(record)
            self._count -= 1

    def insert(self, record: SpatialMemoryRecord) -> None:
        """Add a record, replacing an earlier copy with the same id."""
        if record.id:
            old = self._by_id.get(record.id)
            if old is not None:
                self._remove(old)
            self._by_id[record.id] = record
        self._cells.setdefault(self._key(record.frame_id, record.x, record.y), []).append(record)
        self._count += 1

    def _expired(self, record: SpatialMemoryRecord, now: float) -> bool:
        return now - record.timestamp > self.ttl

    def query_radius(
        self,
        x: float,
        y: float,
        radius: float,
        frame_id: str = "map",
        max_results: int = 20,
    ) -> List[Tuple[SpatialMemoryRecord, float]]:
        """Records within ``radius`` meters of (x, y) in ``frame_id``, nearest first,
        as ``(record, distance)`` pairs. Expired records are dropped on the way."""
        now = time.time()
        lo_x, hi_x = math.floor((x - radius) / self.cell_size), math.floor((x + radius) / self.cell_size)
        lo_y, hi_y = math.floor((y - radius) / self.cell_size), math.floor((y + radius) / self.cell_size)
        radius_sq = radius * radius
        found: List[Tuple[SpatialMemoryRecord, float]] = []
        for cx in range(lo_x, hi_x + 1):
            for cy in range(lo_y, hi_y + 1):
                bucket = self._cells.get((frame_id, cx, cy))
                if not bucket:
                    continue
                for record in list(bucket):
                    if self._expired(record, now):
                        bucket.remove(record)
                        self._count -= 1
                        if record.id:
                            self._by_id.pop(record.id, None)
                        continue
                    dx, dy = record.x - x, record.y - y
                    dist_sq = dx * dx + dy * dy
                    if dist_sq <= radius_sq:
                        found.append((record, math.sqrt(dist_sq)))
        found.sort(key=lambda item: item[1])
        return found[:max_results]

    def get(self, record_id: str) -> Optional[SpatialMemoryRecord]:
        return self._by_id.get(record_id)

    def clear(self) -> None:
        self._cells.clear()
        self._by_id.clear()
        self._count = 0

    def count(self) -> int:
        return self._count
