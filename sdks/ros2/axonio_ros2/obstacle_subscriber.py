"""
Perception Ingestion Helper for 2D/3D Obstacles and Point Clouds
"""

import math
from typing import List, Tuple

class LaserScanProcessor:
    """
    Extracts clusters and critical blockage events from 2D LaserScan arrays.
    """

    @staticmethod
    def extract_closest_obstacles(
        ranges: List[float],
        angle_min: float,
        angle_increment: float,
        range_min: float,
        range_max: float,
        cluster_threshold_meters: float = 0.5
    ) -> List[Tuple[float, float]]:
        """
        Filters and converts raw range arrays into (x, y) relative obstacle points.
        """
        points: List[Tuple[float, float]] = []

        for i, r in enumerate(ranges):
            if math.isnan(r) or math.isinf(r):
                continue
            if r < range_min or r > range_max:
                continue

            angle = angle_min + i * angle_increment
            x = r * math.cos(angle)
            y = r * math.sin(angle)
            points.append((x, y))

        return points
