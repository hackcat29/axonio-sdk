from __future__ import annotations

import random
import time

from axonio_ros2.client import SpatialMemoryRecord
from axonio_ros2.spatial_index import SpatialMemoryIndex


def rec(x: float, y: float, **kw) -> SpatialMemoryRecord:
    return SpatialMemoryRecord(x=x, y=y, **kw)


def test_radius_query_is_sorted_by_distance() -> None:
    index = SpatialMemoryIndex()
    for x in (3.0, 1.0, 2.0, 30.0):
        index.insert(rec(x, 0.0))
    found = index.query_radius(0.0, 0.0, 5.0)
    assert [r.x for r, _ in found] == [1.0, 2.0, 3.0]
    assert [round(d, 3) for _, d in found] == [1.0, 2.0, 3.0]


def test_matches_a_brute_force_scan_across_cell_borders_and_negatives() -> None:
    random.seed(7)
    index = SpatialMemoryIndex(cell_size=2.0)
    records = [rec(random.uniform(-30, 30), random.uniform(-30, 30)) for _ in range(400)]
    for r in records:
        index.insert(r)
    for _ in range(25):
        qx, qy, radius = random.uniform(-25, 25), random.uniform(-25, 25), random.uniform(0.5, 9)
        expected = sorted((r for r in records if (r.x - qx) ** 2 + (r.y - qy) ** 2 <= radius**2), key=id)
        got = sorted((r for r, _ in index.query_radius(qx, qy, radius, max_results=1000)), key=id)
        assert got == expected


def test_frames_are_separate() -> None:
    index = SpatialMemoryIndex()
    index.insert(rec(1.0, 1.0, frame_id="map"))
    index.insert(rec(1.0, 1.0, frame_id="odom"))
    assert len(index.query_radius(1.0, 1.0, 1.0, frame_id="odom")) == 1
    assert index.query_radius(1.0, 1.0, 1.0, frame_id="other") == []


def test_expired_records_are_dropped() -> None:
    index = SpatialMemoryIndex(memory_ttl_seconds=10.0)
    index.insert(rec(1.0, 1.0, id="old", timestamp=time.time() - 60))
    index.insert(rec(1.5, 1.0, id="new"))
    assert [r.id for r, _ in index.query_radius(1.0, 1.0, 5.0)] == ["new"]
    assert index.count() == 1 and index.get("old") is None


def test_a_record_with_the_same_id_replaces_the_old_one() -> None:
    index = SpatialMemoryIndex()
    index.insert(rec(1.0, 1.0, id="m1", obstacle_type="a"))
    index.insert(rec(40.0, 40.0, id="m1", obstacle_type="b"))
    assert index.count() == 1
    assert index.query_radius(1.0, 1.0, 3.0) == []
    assert index.get("m1").obstacle_type == "b"


def test_max_results_and_clear() -> None:
    index = SpatialMemoryIndex()
    for i in range(10):
        index.insert(rec(float(i) / 10, 0.0))
    assert len(index.query_radius(0.0, 0.0, 5.0, max_results=3)) == 3
    index.clear()
    assert index.count() == 0 and index.query_radius(0.0, 0.0, 5.0) == []


def test_ten_thousand_records_stay_fast() -> None:
    random.seed(1)
    index = SpatialMemoryIndex()
    for _ in range(10_000):
        index.insert(rec(random.uniform(0, 200), random.uniform(0, 200)))
    started = time.perf_counter()
    for _ in range(100):
        index.query_radius(100.0, 100.0, 5.0)
    per_query_ms = (time.perf_counter() - started) * 1000 / 100
    assert per_query_ms < 5.0
