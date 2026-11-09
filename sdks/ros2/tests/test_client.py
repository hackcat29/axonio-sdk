from __future__ import annotations

from unittest.mock import patch

import pytest

from axonio_ros2.client import (
    AxonioClient,
    ClawClient,
    SpatialMemoryRecord,
    build_tags,
    decode_memory,
    describe,
)
from tests.fakes import FakeDB


def make_client(robot_id: str = "amr_01", store: str = "fleet") -> tuple[AxonioClient, FakeDB]:
    db = FakeDB()
    return AxonioClient(store_name=store, robot_id=robot_id, db=db), db


def pallet(**kw) -> SpatialMemoryRecord:
    base = dict(x=14.5, y=8.2, z=0.0, obstacle_type="pallet_spill", confidence=0.98, tags=["aisle_4"], timestamp=5_000.0)
    base.update(kw)
    return SpatialMemoryRecord(**base)


def test_record_serialization_round_trip() -> None:
    rec = SpatialMemoryRecord(frame_id="odom", x=10.5, y=-4.2, obstacle_type="pallet", confidence=0.95, tags=["a"], metadata={"k": 1})
    again = SpatialMemoryRecord.from_dict(rec.to_dict())
    assert (again.frame_id, again.x, again.y, again.confidence, again.tags, again.metadata) == ("odom", 10.5, -4.2, 0.95, ["a"], {"k": 1})


def test_stored_memory_is_readable_and_tagged() -> None:
    client, db = make_client()
    result = client.record_spatial_event(pallet(metadata={"notes": "Aisle blocked"}))
    assert result["status"] == "stored"
    row = db.memory.rows[0]
    assert row["content"] == "pallet spill at (14.50, 8.20, 0.00) in frame map, confidence 0.98, reported by amr_01. Aisle blocked"
    assert row["tags"][:4] == ["axonio-ros2", "store:fleet", "obstacle:pallet_spill", "robot:amr_01"]
    assert "aisle_4" in row["tags"]
    assert row["metadata"]["x"] == 14.5 and row["metadata"]["recorded_at"] == 5_000.0


def test_record_round_trips_through_search_metadata() -> None:
    client, db = make_client()
    client.record_spatial_event(pallet(z=0.25, frame_id="odom"))
    hit = db.memory.search("anything")[0]
    rec = decode_memory(hit.id, hit.content, hit.tags, "fleet", hit.metadata)
    assert rec is not None
    assert (rec.x, rec.y, rec.z, rec.frame_id, rec.confidence, rec.obstacle_type) == (14.5, 8.2, 0.25, "odom", 0.98, "pallet_spill")
    assert rec.timestamp == 5_000.0
    assert rec.tags == ["aisle_4"]
    assert rec.metadata["robot_id"] == "amr_01"


def test_record_round_trips_through_list_without_metadata() -> None:
    client, db = make_client()
    client.record_spatial_event(pallet(x=-3.0, y=-2.5))
    mem = db.memory.list()[0]
    rec = decode_memory(mem.id, mem.content, mem.tags, "fleet", created_at=mem.created_at)
    assert rec is not None
    assert (rec.x, rec.y, rec.obstacle_type, rec.confidence) == (-3.0, -2.5, "pallet_spill", 0.98)
    assert rec.metadata["robot_id"] == "amr_01"
    assert "notes" not in rec.metadata
    assert rec.timestamp == pytest.approx(db.memory.clock, abs=0.01)


def test_foreign_memories_are_ignored() -> None:
    assert decode_memory("1", "Customer prefers email", ["crm"], "fleet") is None
    other_store = describe(pallet())
    assert decode_memory("1", other_store, build_tags(pallet(), "other-store"), "fleet") is None
    assert decode_memory("1", "tagged but no coordinates", ["axonio-ros2", "store:fleet"], "fleet") is None


def test_offline_writes_are_queued_and_flushed_in_order() -> None:
    client, db = make_client()
    db.memory.online = False
    first = client.record_spatial_event(pallet(x=1.0))
    second = client.record_spatial_event(pallet(x=2.0))
    assert first["status"] == second["status"] == "offline_cached"
    assert client.pending_count == 2 and db.memory.rows == []

    db.memory.online = True
    assert client.record_spatial_event(pallet(x=3.0))["status"] == "stored"
    assert [r["metadata"]["x"] for r in db.memory.rows] == [1.0, 2.0, 3.0]
    assert client.pending_count == 0


def test_pending_queue_is_bounded() -> None:
    db = FakeDB()
    db.memory.online = False
    client = AxonioClient(db=db, max_pending=3)
    for i in range(5):
        client.record_spatial_event(pallet(x=float(i)))
    assert client.pending_count == 3


def test_search_nearby_keeps_only_records_inside_the_radius() -> None:
    client, db = make_client()
    for x, frame in [(1.0, "map"), (4.0, "map"), (9.0, "map"), (1.5, "odom")]:
        client.record_spatial_event(pallet(x=x, y=0.0, frame_id=frame))
    result = client.search_nearby(0.0, 0.0, radius_meters=5.0, frame_id="map")
    assert [r.x for r in result.records] == [1.0, 4.0]
    assert result.total_count == 2


def test_search_nearby_survives_a_network_error() -> None:
    client, db = make_client()
    db.memory.online = False
    result = client.search_nearby(0.0, 0.0)
    assert result.records == [] and result.total_count == 0


def test_fleet_deltas_skip_own_records_and_old_ones() -> None:
    mine, db = make_client(robot_id="amr_01")
    theirs = AxonioClient(store_name="fleet", robot_id="amr_02", db=db)
    mine.record_spatial_event(pallet(x=1.0))
    theirs.record_spatial_event(pallet(x=2.0))
    theirs.record_spatial_event(pallet(x=3.0))

    deltas = mine.pull_fleet_deltas(since_timestamp=0.0)
    assert sorted(d.x for d in deltas) == [2.0, 3.0]
    assert all(d.metadata["robot_id"] == "amr_02" for d in deltas)

    newest = max(d.timestamp for d in deltas)
    assert mine.pull_fleet_deltas(since_timestamp=newest) == []


def test_other_stores_do_not_leak_in() -> None:
    a = AxonioClient(store_name="a", robot_id="r1", db=(db := FakeDB()))
    b = AxonioClient(store_name="b", robot_id="r2", db=db)
    b.record_spatial_event(pallet())
    assert a.load_recent() == []


def test_endpoint_must_be_https_except_localhost() -> None:
    with pytest.raises(ValueError):
        AxonioClient(api_key="k", endpoint="http://example.com/api")
    AxonioClient(api_key="k", endpoint="https://example.com/api")
    AxonioClient(api_key="k", endpoint="http://localhost:8080")
    AxonioClient(api_key="k", endpoint="http://127.0.0.1:8080")


def test_builds_the_axonio_sdk_client_lazily() -> None:
    with patch("axonio.ClawDB") as sdk:
        client = AxonioClient(api_key="ck_live_x", store_name="s", robot_id="amr_9", timeout_seconds=1.5)
        sdk.assert_not_called()
        client._client()
        sdk.assert_called_once_with(timeout_ms=1500, api_key="ck_live_x", agent_id="amr_9")

    with patch("axonio.ClawDB") as sdk:
        AxonioClient(api_key="k", endpoint="https://db.example.com/api/v1/gateway")._client()
        assert sdk.call_args.kwargs["endpoint"] == "https://db.example.com/api/v1/gateway"


def test_old_names_still_work() -> None:
    assert ClawClient is AxonioClient
    db = FakeDB()
    ClawClient(api_key="k", workspace_id="ws_1", db=db).record_spatial_event(pallet())
    assert len(db.memory.rows) == 1


def test_notes_survive_the_list_path() -> None:
    client, db = make_client()
    client.record_spatial_event(pallet(metadata={"notes": "Aisle blocked. Use corridor B"}))
    client.record_spatial_event(pallet(x=1.0))
    newest, older = db.memory.list()[0], db.memory.list()[1]
    assert decode_memory(older.id, older.content, older.tags, "fleet").metadata["notes"] == "Aisle blocked. Use corridor B"
    assert "notes" not in decode_memory(newest.id, newest.content, newest.tags, "fleet").metadata
