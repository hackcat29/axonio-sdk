#!/usr/bin/env python3
"""Example 3: project remembered obstacles onto a costmap-style grid.

Runs offline: it fills a local index by hand. In a robot, fill it from
`AxonioClient.pull_fleet_deltas` (see example 2).
"""

from typing import List, Tuple

from axonio_ros2 import SpatialMemoryIndex, SpatialMemoryRecord


def project_to_costmap_grid(obstacles: List[Tuple[SpatialMemoryRecord, float]], grid_size: int = 20, resolution: float = 0.5) -> List[str]:
    """An ASCII costmap around the robot (R) with remembered obstacles (X)."""
    grid = [["·" for _ in range(grid_size)] for _ in range(grid_size)]
    center = grid_size // 2
    grid[center][center] = "R"
    for obstacle, _ in obstacles:
        gx = center + int(obstacle.x / resolution)
        gy = center + int(obstacle.y / resolution)
        if 0 <= gx < grid_size and 0 <= gy < grid_size:
            grid[gy][gx] = "X"
    return [" ".join(row) for row in grid]


def main() -> None:
    index = SpatialMemoryIndex()
    index.insert(SpatialMemoryRecord(x=2.0, y=1.5, obstacle_type="spilled_box"))
    index.insert(SpatialMemoryRecord(x=-3.0, y=-2.0, obstacle_type="pallet"))
    index.insert(SpatialMemoryRecord(x=1.0, y=-4.0, obstacle_type="worker_cart"))

    nearby = index.query_radius(x=0.0, y=0.0, radius=10.0)
    print(f"{len(nearby)} remembered obstacles inside the costmap footprint\n")
    for row in project_to_costmap_grid(nearby):
        print(row)


if __name__ == "__main__":
    main()
