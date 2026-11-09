"""Exercise the rclpy code paths of the node with a stand-in for rclpy.

No ROS install is needed: a small fake provides the parts the node touches
(parameters, publishers, subscriptions, timers). It checks our logic, not ROS.
"""

from __future__ import annotations

import importlib
import sys
import types
from typing import Any, Dict

import pytest

from tests.fakes import FakeDB


class FakeNode:
    overrides: Dict[str, Any] = {}

    def __init__(self, name: str) -> None:
        self.name = name
        self.params: Dict[str, Any] = {}
        self.published: list = []
        self.timers: list = []
        self.subs: list = []
        self.logs: list = []

    def declare_parameters(self, namespace, parameters):
        for key, default in parameters:
            self.params[key] = self.overrides.get(key, default)

    def get_parameter(self, key):
        return types.SimpleNamespace(value=self.params[key])

    def set_parameters(self, params):
        for p in params:
            self.params[p.name] = p.value

    def create_publisher(self, msg_type, topic, qos):
        pub = types.SimpleNamespace(topic=topic, publish=self.published.append)
        return pub

    def create_subscription(self, msg_type, topic, callback, qos):
        self.subs.append((topic, callback))

    def create_timer(self, period, callback):
        self.timers.append((period, callback))

    def get_logger(self):
        log = lambda msg: self.logs.append(msg)  # noqa: E731
        return types.SimpleNamespace(info=log, warning=log, debug=log)

    def destroy_node(self):
        pass


@pytest.fixture()
def ros_node_module(monkeypatch):
    FakeNode.overrides = {}
    rclpy = types.ModuleType("rclpy")
    node_mod = types.ModuleType("rclpy.node")
    node_mod.Node = FakeNode
    qos = types.ModuleType("rclpy.qos")
    qos.QoSProfile = lambda **kw: kw
    qos.ReliabilityPolicy = types.SimpleNamespace(RELIABLE=1)
    qos.HistoryPolicy = types.SimpleNamespace(KEEP_LAST=1)
    parameter = types.ModuleType("rclpy.parameter")

    class Parameter:
        class Type:
            STRING = "string"

        def __init__(self, name, type_, value):
            self.name, self.value = name, value

    parameter.Parameter = Parameter
    std = types.ModuleType("std_msgs.msg")
    std.String = type("String", (), {"data": ""})
    geo = types.ModuleType("geometry_msgs.msg")
    geo.Point = type("Point", (), {})
    for name, mod in {
        "rclpy": rclpy, "rclpy.node": node_mod, "rclpy.qos": qos, "rclpy.parameter": parameter,
        "std_msgs": types.ModuleType("std_msgs"), "std_msgs.msg": std,
        "geometry_msgs": types.ModuleType("geometry_msgs"), "geometry_msgs.msg": geo,
    }.items():
        monkeypatch.setitem(sys.modules, name, mod)
    for name in ("AXONIO_API_KEY", "CLAWDB_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    module = importlib.reload(importlib.import_module("axonio_ros2.node"))
    yield module
    monkeypatch.undo()
    importlib.reload(importlib.import_module("axonio_ros2.node"))


def test_node_reads_parameters_and_wires_ros(ros_node_module) -> None:
    FakeNode.overrides = {"robot_id": "amr_07", "store_name": "plant", "frame_id": "odom", "sync_rate_hz": 2.0}
    from axonio_ros2.client import AxonioClient

    client = AxonioClient(store_name="plant", robot_id="amr_07", db=FakeDB())
    node = ros_node_module.AxonioSpatialMemoryNode(client=client)

    assert (node.robot_id, node.store_name, node.frame_id) == ("amr_07", "plant", "odom")
    assert node.timers[0][0] == 0.5
    assert node.subs[0][0] == "~/detected_obstacle"


def test_api_key_parameter_is_read_then_wiped_with_a_warning(ros_node_module) -> None:
    FakeNode.overrides = {"api_key": "ck_live_secret"}
    node = ros_node_module.AxonioSpatialMemoryNode()
    assert node.client.api_key == "ck_live_secret"
    assert node.params["api_key"] == ""
    assert any("visible to every node" in m for m in node.logs)


def test_sensor_point_and_fleet_publish(ros_node_module) -> None:
    from axonio_ros2.client import AxonioClient, SpatialMemoryRecord

    db = FakeDB()
    node = ros_node_module.AxonioSpatialMemoryNode(client=AxonioClient(store_name="robot-fleet-memory", robot_id="amr-01", db=db))
    node._on_obstacle_point(types.SimpleNamespace(x=1.0, y=2.0, z=0.0))
    assert db.memory.rows[0]["metadata"]["obstacle_type"] == "sensor_point"

    other = AxonioClient(store_name="robot-fleet-memory", robot_id="amr-02", db=db)
    other.record_spatial_event(SpatialMemoryRecord(x=5.0, y=5.0, obstacle_type="spill"))
    node._sync_fleet_callback()
    assert len(node.published) == 1 and "spill" in node.published[0].data
    node._sync_fleet_callback()
    assert len(node.published) == 1
