"""Axonio client for robots: spatial memories stored in Axonio, with an offline queue.

A spatial event (an obstacle, a blocked aisle, a landmark) is stored as an
ordinary Axonio memory, so it also shows up in the dashboard, in search and for
any agent connected through the MCP server:

* the content is one readable sentence, e.g.
  ``pallet spill at (14.50, 8.20, 0.00) in frame map, confidence 0.98, reported by amr_01``
* the tags carry the store, robot and obstacle class (``store:robot-fleet-memory``,
  ``robot:amr_01``, ``obstacle:pallet_spill``)
* the metadata carries the exact numbers, which search results return

``list`` results carry no metadata, so records are also decoded from the
sentence and tags. Either way a record round-trips.
"""

from __future__ import annotations

import logging
import math
import re
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional
from urllib.parse import urlparse

logger = logging.getLogger("axonio_ros2.client")

BASE_TAG = "axonio-ros2"
STORE_TAG = "store:"
ROBOT_TAG = "robot:"
OBSTACLE_TAG = "obstacle:"

_NUM = r"(-?\d+(?:\.\d+)?)"
_SENTENCE = re.compile(rf"at \({_NUM}, {_NUM}, {_NUM}\) in frame ([^\s,]+), confidence {_NUM}")
_TAIL = re.compile(r"(?:, reported by \S+?)?(?:\. (.*))?$", re.S)
_FRACTION = re.compile(r"(\.\d{6})\d+")


@dataclass
class SpatialMemoryRecord:
    """A spatial memory: an obstacle, landmark or navigation failure at a point."""

    id: Optional[str] = None
    frame_id: str = "map"
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    obstacle_type: str = "general_obstacle"
    confidence: float = 1.0
    tags: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SpatialMemoryRecord":
        return cls(
            id=data.get("id"),
            frame_id=data.get("frame_id", "map"),
            x=float(data.get("x", 0.0)),
            y=float(data.get("y", 0.0)),
            z=float(data.get("z", 0.0)),
            obstacle_type=data.get("obstacle_type", "general_obstacle"),
            confidence=float(data.get("confidence", 1.0)),
            tags=list(data.get("tags", [])),
            metadata=dict(data.get("metadata", {})),
            timestamp=float(data.get("timestamp", time.time())),
        )

    def distance_to(self, x: float, y: float) -> float:
        return math.hypot(self.x - x, self.y - y)


@dataclass
class QueryResult:
    """Records from a search, with how long the round trip took."""

    records: List[SpatialMemoryRecord]
    latency_ms: float
    total_count: int


def describe(record: SpatialMemoryRecord, robot_id: str = "") -> str:
    """The sentence stored as the memory's content."""
    text = (
        f"{record.obstacle_type.replace('_', ' ')} at ({record.x:.2f}, {record.y:.2f}, {record.z:.2f}) "
        f"in frame {record.frame_id}, confidence {record.confidence:.2f}"
    )
    if robot_id:
        text += f", reported by {robot_id}"
    notes = str(record.metadata.get("notes", "")).strip()
    if notes:
        text += f". {notes}"
    return text


def build_tags(record: SpatialMemoryRecord, store_name: str, robot_id: str = "") -> List[str]:
    tags = [BASE_TAG, STORE_TAG + store_name, OBSTACLE_TAG + record.obstacle_type]
    if robot_id:
        tags.append(ROBOT_TAG + robot_id)
    for tag in record.tags:
        if tag not in tags:
            tags.append(tag)
    return tags


def _tag_value(tags: List[str], prefix: str) -> Optional[str]:
    for tag in tags:
        if tag.startswith(prefix):
            return tag[len(prefix):]
    return None


def _parse_time(value: str) -> Optional[float]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(_FRACTION.sub(r"\1", value).replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()
    except ValueError:
        return None


def decode_memory(
    memory_id: str,
    content: str,
    tags: List[str],
    store_name: str,
    metadata: Optional[Dict[str, Any]] = None,
    created_at: str = "",
) -> Optional[SpatialMemoryRecord]:
    """Turn an Axonio memory back into a spatial record, or None if it is not one
    of ours (a different store, or an ordinary memory)."""
    if BASE_TAG not in tags or (STORE_TAG + store_name) not in tags:
        return None

    # Search results nest the stored metadata one level down.
    meta: Dict[str, Any] = dict(metadata or {})
    if isinstance(meta.get("metadata"), dict):
        meta = dict(meta["metadata"])

    obstacle = meta.get("obstacle_type") or _tag_value(tags, OBSTACLE_TAG) or "general_obstacle"
    try:
        if all(k in meta for k in ("x", "y")):
            x, y, z = float(meta["x"]), float(meta["y"]), float(meta.get("z", 0.0))
            frame = str(meta.get("frame_id", "map"))
            confidence = float(meta.get("confidence", 1.0))
        else:
            found = _SENTENCE.search(content)
            if not found:
                return None
            x, y, z = float(found.group(1)), float(found.group(2)), float(found.group(3))
            frame = found.group(4)
            confidence = float(found.group(5))
            tail = _TAIL.match(content[found.end():])
            if tail and tail.group(1):
                meta["notes"] = tail.group(1)
    except (TypeError, ValueError):
        return None

    recorded = meta.get("recorded_at")
    timestamp = float(recorded) if isinstance(recorded, (int, float)) else (_parse_time(created_at) or time.time())
    extra = {k: v for k, v in meta.items() if k not in {"x", "y", "z", "frame_id", "obstacle_type", "confidence", "recorded_at"}}
    robot = _tag_value(tags, ROBOT_TAG)
    if robot and "robot_id" not in extra:
        extra["robot_id"] = robot
    user_tags = [t for t in tags if t != BASE_TAG and not t.startswith((STORE_TAG, ROBOT_TAG, OBSTACLE_TAG))]
    return SpatialMemoryRecord(
        id=memory_id or None,
        frame_id=frame,
        x=x,
        y=y,
        z=z,
        obstacle_type=str(obstacle),
        confidence=confidence,
        tags=user_tags,
        metadata=extra,
        timestamp=timestamp,
    )


class AxonioClient:
    """Reads and writes a robot fleet's spatial memory in Axonio.

    Authentication: ``api_key``, else ``AXONIO_API_KEY`` (``CLAWDB_API_KEY`` still
    works). With only a key the client talks to the hosted Axonio cloud; pass
    ``endpoint`` for a self-hosted server. Writes that fail (no network) are
    queued, up to ``max_pending``, and retried before the next call.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        endpoint: Optional[str] = None,
        store_name: str = "robot-fleet-memory",
        robot_id: str = "",
        timeout_seconds: float = 2.0,
        max_pending: int = 1000,
        workspace_id: Optional[str] = None,
        db: Any = None,
    ) -> None:
        if endpoint:
            parsed = urlparse(endpoint)
            # The API key is a bearer credential: never send it over plain HTTP,
            # except to a development server on this machine.
            if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
                raise ValueError("Axonio endpoint must use https:// (plain http is only allowed for localhost)")
        self.api_key = api_key or ""
        self.endpoint = endpoint.rstrip("/") if endpoint else None
        self.store_name = store_name
        self.robot_id = robot_id
        self.timeout = timeout_seconds
        # Informational only: the API key already identifies the workspace.
        self.workspace_id = workspace_id
        self._db = db
        self._lock = threading.RLock()
        self._pending: Deque[SpatialMemoryRecord] = deque(maxlen=max_pending)

    # -- connection ---------------------------------------------------------

    def _client(self) -> Any:
        with self._lock:
            if self._db is None:
                from axonio import ClawDB

                options: Dict[str, Any] = {"timeout_ms": int(self.timeout * 1000)}
                if self.api_key:
                    options["api_key"] = self.api_key
                if self.endpoint:
                    options["endpoint"] = self.endpoint
                if self.robot_id:
                    options["agent_id"] = self.robot_id
                self._db = ClawDB(**options)
            return self._db

    def close(self) -> None:
        with self._lock:
            if self._db is not None:
                try:
                    self._db.disconnect()
                except Exception:  # noqa: BLE001 - shutting down
                    pass
                self._db = None

    @property
    def pending_count(self) -> int:
        return len(self._pending)

    # -- writes -------------------------------------------------------------

    def _store(self, record: SpatialMemoryRecord) -> str:
        meta: Dict[str, Any] = {
            **record.metadata,
            "x": record.x,
            "y": record.y,
            "z": record.z,
            "frame_id": record.frame_id,
            "obstacle_type": record.obstacle_type,
            "confidence": record.confidence,
            "recorded_at": record.timestamp,
        }
        if self.robot_id:
            meta.setdefault("robot_id", self.robot_id)
        return self._client().memory.remember(
            describe(record, self.robot_id),
            memory_type="spatial",
            tags=build_tags(record, self.store_name, self.robot_id),
            metadata=meta,
        )

    def flush_pending(self) -> int:
        """Retry queued writes, oldest first. Returns how many were stored."""
        stored = 0
        with self._lock:
            while self._pending:
                record = self._pending[0]
                try:
                    record.id = self._store(record)
                except Exception as exc:  # noqa: BLE001 - still offline
                    logger.debug("flush stopped, still offline: %s", exc)
                    break
                self._pending.popleft()
                stored += 1
        return stored

    def record_spatial_event(self, record: SpatialMemoryRecord) -> Dict[str, Any]:
        """Store a spatial memory. Never raises: on a network failure the record is
        queued and ``{"status": "offline_cached"}`` is returned."""
        started = time.perf_counter()
        try:
            self.flush_pending()
            record.id = self._store(record)
        except Exception as exc:  # noqa: BLE001 - robots keep running offline
            logger.warning("Could not store spatial memory in Axonio, queued for retry: %s", exc)
            with self._lock:
                self._pending.append(record)
            return {"status": "offline_cached", "error": str(exc), "pending": self.pending_count}
        return {"status": "stored", "id": record.id, "latency_ms": (time.perf_counter() - started) * 1000.0}

    # -- reads --------------------------------------------------------------

    def search_nearby(
        self,
        x: float,
        y: float,
        radius_meters: float = 5.0,
        frame_id: str = "map",
        limit: int = 10,
    ) -> QueryResult:
        """Spatial memories within ``radius_meters`` of (x, y), nearest first.

        Search is by meaning, not by geometry: the server returns the closest
        matches to a description of the place and this method keeps the ones
        actually inside the radius. For exact radius queries on a hot path, keep a
        :class:`~axonio_ros2.SpatialMemoryIndex` filled with
        :meth:`load_recent` and :meth:`pull_fleet_deltas`.
        """
        started = time.perf_counter()
        try:
            hits = self._client().memory.search(
                f"obstacle near ({x:.2f}, {y:.2f}) in frame {frame_id}", top_k=min(100, max(limit * 5, 20))
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not query Axonio: %s", exc)
            return QueryResult([], (time.perf_counter() - started) * 1000.0, 0)

        found: List[SpatialMemoryRecord] = []
        for hit in hits:
            rec = decode_memory(hit.id, hit.content, hit.tags, self.store_name, hit.metadata)
            if rec and rec.frame_id == frame_id and rec.distance_to(x, y) <= radius_meters:
                found.append(rec)
        found.sort(key=lambda r: r.distance_to(x, y))
        found = found[:limit]
        return QueryResult(found, (time.perf_counter() - started) * 1000.0, len(found))

    def load_recent(self, limit: int = 100, since_timestamp: float = 0.0) -> List[SpatialMemoryRecord]:
        """The newest spatial memories of this store, optionally only those created
        after ``since_timestamp`` (seconds since the epoch)."""
        try:
            memories = self._client().memory.list(limit=limit)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not list Axonio memories: %s", exc)
            return []
        records: List[SpatialMemoryRecord] = []
        for mem in memories:
            rec = decode_memory(mem.id, mem.content, mem.tags, self.store_name, created_at=mem.created_at)
            if rec and rec.timestamp > since_timestamp:
                records.append(rec)
        return records

    def pull_fleet_deltas(self, since_timestamp: float, limit: int = 100) -> List[SpatialMemoryRecord]:
        """Memories written by the other robots in the fleet since ``since_timestamp``.
        This robot's own records are left out."""
        return [
            rec
            for rec in self.load_recent(limit=limit, since_timestamp=since_timestamp)
            if not (self.robot_id and rec.metadata.get("robot_id") == self.robot_id)
        ]


#: Name used before the rename to Axonio.
ClawClient = AxonioClient
