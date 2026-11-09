"""Axonio spatial memory bridge: a ROS2 node that shares what a robot sees with its fleet."""

import json
import logging
import os
import time
from typing import List, Optional, Tuple

try:
    import rclpy
    from geometry_msgs.msg import Point
    from rclpy.node import Node
    from rclpy.qos import HistoryPolicy, QoSProfile, ReliabilityPolicy
    from std_msgs.msg import String
except ImportError:
    # Plain Python (tests, scripts) without a ROS2 install.
    Node = object
    rclpy = None

from .client import AxonioClient, SpatialMemoryRecord
from .spatial_index import SpatialMemoryIndex

logger = logging.getLogger("axonio_ros2.node")


def resolve_api_key(param_value: str = "", key_file: str = "") -> str:
    """The API key from AXONIO_API_KEY (CLAWDB_API_KEY still works), then a file
    (for example a mounted secret), then the deprecated ROS parameter.
    Never logged."""
    for name in ("AXONIO_API_KEY", "CLAWDB_API_KEY"):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    if key_file:
        with open(key_file, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    return param_value or ""


class AxonioSpatialMemoryNode(Node if rclpy else object):
    """Records obstacles into Axonio and pulls the rest of the fleet's back out.

    A local :class:`SpatialMemoryIndex` answers planner queries without a network
    round trip; Axonio is the shared, durable copy.
    """

    def __init__(self, node_name: str = "axonio_spatial_memory_bridge", client: Optional[AxonioClient] = None):
        self.endpoint = ""
        self.robot_id = "amr-01"
        self.store_name = "robot-fleet-memory"
        self.frame_id = "map"
        self.sync_rate = 1.0
        self.ttl = 7200.0
        api_key = ""

        if rclpy:
            super().__init__(node_name)
            self.declare_parameters(
                namespace="",
                parameters=[
                    # Deprecated: ROS parameters are readable by any node on the DDS
                    # domain. Prefer AXONIO_API_KEY or api_key_file.
                    ("api_key", ""),
                    ("api_key_file", ""),
                    ("endpoint", ""),
                    ("robot_id", self.robot_id),
                    ("store_name", self.store_name),
                    ("frame_id", self.frame_id),
                    ("sync_rate_hz", self.sync_rate),
                    ("local_ttl_seconds", self.ttl),
                ],
            )
            api_key = resolve_api_key(self.get_parameter("api_key").value, self.get_parameter("api_key_file").value)
            if self.get_parameter("api_key").value:
                self.get_logger().warning(
                    "api_key as a ROS parameter is visible to every node on this DDS domain; "
                    "use the AXONIO_API_KEY env var or api_key_file instead."
                )
                from rclpy.parameter import Parameter

                self.set_parameters([Parameter("api_key", Parameter.Type.STRING, "")])
            self.endpoint = self.get_parameter("endpoint").value
            self.robot_id = self.get_parameter("robot_id").value
            self.store_name = self.get_parameter("store_name").value
            self.frame_id = self.get_parameter("frame_id").value
            self.sync_rate = self.get_parameter("sync_rate_hz").value
            self.ttl = self.get_parameter("local_ttl_seconds").value
        else:
            api_key = resolve_api_key()

        self.index = SpatialMemoryIndex(memory_ttl_seconds=self.ttl)
        self.client = client or AxonioClient(
            api_key=api_key,
            endpoint=self.endpoint or None,
            store_name=self.store_name,
            robot_id=self.robot_id,
        )
        # Newest record time seen from the server (its clock, not this robot's).
        self.last_sync_time = 0.0

        if rclpy:
            qos = QoSProfile(reliability=ReliabilityPolicy.RELIABLE, history=HistoryPolicy.KEEP_LAST, depth=10)
            self.fleet_pub = self.create_publisher(String, "~/fleet_updates", qos)
            self.obstacle_sub = self.create_subscription(Point, "~/detected_obstacle", self._on_obstacle_point, qos)
            if self.sync_rate > 0:
                self.sync_timer = self.create_timer(1.0 / self.sync_rate, self._sync_fleet_callback)
            self.get_logger().info(
                f"Axonio spatial memory bridge ready for robot '{self.robot_id}' (store '{self.store_name}')"
            )

    def record_obstacle(
        self,
        x: float,
        y: float,
        z: float = 0.0,
        obstacle_class: str = "pallet_blockage",
        confidence: float = 1.0,
        notes: str = "",
        frame_id: Optional[str] = None,
    ) -> SpatialMemoryRecord:
        """Add an obstacle to the local index at once and send it to Axonio."""
        rec = SpatialMemoryRecord(
            frame_id=frame_id or self.frame_id,
            x=x,
            y=y,
            z=z,
            obstacle_type=obstacle_class,
            confidence=confidence,
            metadata={"robot_id": self.robot_id, "notes": notes} if notes else {"robot_id": self.robot_id},
            timestamp=time.time(),
        )
        self.index.insert(rec)
        result = self.client.record_spatial_event(rec)
        if rclpy:
            state = "stored in Axonio" if result.get("status") == "stored" else "queued, Axonio is unreachable"
            self.get_logger().info(f"Obstacle [{obstacle_class}] at ({x:.2f}, {y:.2f}): {state}")
        return rec

    def query_nearby(self, x: float, y: float, radius: float = 5.0) -> List[Tuple[SpatialMemoryRecord, float]]:
        """Obstacles within ``radius`` meters, from the local index."""
        return self.index.query_radius(x, y, radius, frame_id=self.frame_id)

    def _on_obstacle_point(self, msg: "Point") -> None:
        self.record_obstacle(x=msg.x, y=msg.y, z=msg.z, obstacle_class="sensor_point")

    def sync_fleet(self) -> List[SpatialMemoryRecord]:
        """Pull other robots' new records into the local index. Returns the new ones."""
        deltas = self.client.pull_fleet_deltas(since_timestamp=self.last_sync_time)
        fresh = [d for d in deltas if not (d.id and self.index.get(d.id))]
        for delta in fresh:
            self.index.insert(delta)
        if deltas:
            self.last_sync_time = max(self.last_sync_time, max(d.timestamp for d in deltas))
        return fresh

    def _sync_fleet_callback(self) -> None:
        fresh = self.sync_fleet()
        if fresh and rclpy:
            msg = String()
            msg.data = json.dumps([d.to_dict() for d in fresh])
            self.fleet_pub.publish(msg)
            self.get_logger().debug(f"Received {len(fresh)} spatial memories from the fleet.")


def main(args=None):
    if not rclpy:
        print("rclpy is not installed. Run this inside a ROS2 environment.")
        return

    rclpy.init(args=args)
    node = AxonioSpatialMemoryNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.client.close()
        node.destroy_node()
        rclpy.shutdown()


#: Name used before the rename to Axonio.
ClawSpatialMemoryNode = AxonioSpatialMemoryNode

if __name__ == "__main__":
    main()
