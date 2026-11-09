from __future__ import annotations

from axonio_ros2.client import AxonioClient, SpatialMemoryRecord
from axonio_ros2.node import AxonioSpatialMemoryNode, resolve_api_key
from tests.fakes import FakeDB


def make_node(robot_id: str = "amr_01"):
    db = FakeDB()
    client = AxonioClient(store_name="fleet", robot_id=robot_id, db=db)
    node = AxonioSpatialMemoryNode(client=client)
    node.robot_id = robot_id
    return node, db


def test_record_obstacle_is_local_at_once_and_stored() -> None:
    node, db = make_node()
    rec = node.record_obstacle(x=5.0, y=3.0, obstacle_class="forklift_pallet", confidence=0.99, notes="Aisle blocked")
    assert (rec.x, rec.y, rec.obstacle_type) == (5.0, 3.0, "forklift_pallet")

    nearby = node.query_nearby(5.0, 3.0, radius=1.0)
    assert len(nearby) == 1 and nearby[0][0].obstacle_type == "forklift_pallet"
    assert len(db.memory.rows) == 1 and "Aisle blocked" in db.memory.rows[0]["content"]


def test_record_obstacle_keeps_working_offline() -> None:
    node, db = make_node()
    db.memory.online = False
    node.record_obstacle(x=1.0, y=1.0)
    assert len(node.query_nearby(1.0, 1.0, 1.0)) == 1
    assert node.client.pending_count == 1


def test_sync_pulls_other_robots_once() -> None:
    node, db = make_node("amr_01")
    other = AxonioClient(store_name="fleet", robot_id="amr_02", db=db)
    other.record_spatial_event(SpatialMemoryRecord(x=2.0, y=2.0, obstacle_type="spill"))

    first = node.sync_fleet()
    assert [r.obstacle_type for r in first] == ["spill"]
    assert len(node.query_nearby(2.0, 2.0, 1.0)) == 1
    assert node.last_sync_time > 0

    assert node.sync_fleet() == []
    other.record_spatial_event(SpatialMemoryRecord(x=8.0, y=8.0, obstacle_type="cart"))
    assert [r.obstacle_type for r in node.sync_fleet()] == ["cart"]


def test_api_key_precedence(monkeypatch, tmp_path) -> None:
    key_file = tmp_path / "key"
    key_file.write_text("from-file\n")
    for name in ("AXONIO_API_KEY", "CLAWDB_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    assert resolve_api_key("from-param", str(key_file)) == "from-file"
    assert resolve_api_key("from-param", "") == "from-param"
    monkeypatch.setenv("CLAWDB_API_KEY", "old-env")
    assert resolve_api_key("from-param", str(key_file)) == "old-env"
    monkeypatch.setenv("AXONIO_API_KEY", "new-env")
    assert resolve_api_key("from-param", str(key_file)) == "new-env"
