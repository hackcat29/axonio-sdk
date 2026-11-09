#!/usr/bin/env python3
"""Example 1: a warehouse AMR reports a blocked aisle; another robot avoids it.

Set AXONIO_API_KEY first (create a key in the Axonio dashboard). Without a key
the example still runs, but the records stay on this machine.
"""

import os
import time

from axonio_ros2 import AxonioClient, SpatialMemoryIndex, SpatialMemoryRecord


def main() -> None:
    api_key = os.environ.get("AXONIO_API_KEY", "")
    store = "warehouse-floor-memory"
    amr_01 = AxonioClient(api_key=api_key, store_name=store, robot_id="amr-01")
    amr_02 = AxonioClient(api_key=api_key, store_name=store, robot_id="amr-02")

    # AMR-01 meets a pallet spill at (14.5, 8.2) and reports it.
    obstacle = SpatialMemoryRecord(
        x=14.5,
        y=8.2,
        obstacle_type="pallet_spill",
        confidence=0.98,
        tags=["aisle_4", "high_severity"],
        metadata={"notes": "Aisle 4B blocked, 0.4 m clearance left"},
    )
    started = time.perf_counter()
    result = amr_01.record_spatial_event(obstacle)
    print(f"[amr-01] {result['status']} in {(time.perf_counter() - started) * 1000:.0f} ms")

    # AMR-02 starts up: it loads the fleet's recent memories into a local index,
    # then plans against that index without a network call per query.
    index = SpatialMemoryIndex(memory_ttl_seconds=3600.0)
    for record in amr_02.pull_fleet_deltas(since_timestamp=0.0):
        index.insert(record)

    nearby = index.query_radius(x=14.0, y=7.5, radius=5.0)
    if nearby:
        print(f"[amr-02] {len(nearby)} obstacle(s) near the planned path:")
        for record, distance in nearby:
            print(f"  {record.obstacle_type} {distance:.2f} m away ({record.metadata.get('notes', 'no notes')})")
        print("[amr-02] re-routing via corridor B")
    else:
        print("[amr-02] path clear")


if __name__ == "__main__":
    main()
