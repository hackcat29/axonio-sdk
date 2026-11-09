#!/usr/bin/env python3
"""Example 2: several robots share one spatial memory.

A scout drone reports hazards; a ground robot keeps its local index current by
pulling what the rest of the fleet has written (what the bridge node does on a
timer). Set AXONIO_API_KEY first.
"""

import os
import time

from axonio_ros2 import AxonioClient, SpatialMemoryIndex, SpatialMemoryRecord


def main() -> None:
    api_key = os.environ.get("AXONIO_API_KEY", "")
    store = "robot-fleet-memory"
    drone = AxonioClient(api_key=api_key, store_name=store, robot_id="drone-01")
    ground = AxonioClient(api_key=api_key, store_name=store, robot_id="amr-03")

    for x, y, kind in [(10.2, 4.5, "spilled_liquid"), (28.4, 19.1, "forklift_loading"), (5.0, 12.0, "temporary_scaffolding")]:
        drone.record_spatial_event(SpatialMemoryRecord(x=x, y=y, obstacle_type=kind))
        print(f"[drone-01] reported {kind} at ({x}, {y})")

    index = SpatialMemoryIndex(memory_ttl_seconds=7200.0)
    since = 0.0
    for _ in range(5):  # the bridge node does this at sync_rate_hz
        fresh = ground.pull_fleet_deltas(since_timestamp=since)
        for record in fresh:
            index.insert(record)
            since = max(since, record.timestamp)
        if index.count() >= 3:
            break
        time.sleep(1.0)

    started = time.perf_counter()
    nearby = index.query_radius(x=9.0, y=4.0, radius=10.0)
    micros = (time.perf_counter() - started) * 1_000_000
    print(f"[amr-03] {len(nearby)} hazard(s) within 10 m, local query took {micros:.0f} microseconds")
    for record, distance in nearby:
        print(f"  {record.obstacle_type} {distance:.2f} m away")


if __name__ == "__main__":
    main()
