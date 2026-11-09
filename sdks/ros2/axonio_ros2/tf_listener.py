"""
Coordinate Frame & TF2 Transform Utilities for Spatial Memory Mapping
"""

import math
from typing import Tuple, Optional

class TransformHelper:
    """
    Helper for converting local robot frames (base_link, base_footprint) to global map frame.
    """

    @staticmethod
    def transform_point_2d(
        x_local: float,
        y_local: float,
        robot_x: float,
        robot_y: float,
        robot_yaw: float
    ) -> Tuple[float, float]:
        """
        Transforms (x_local, y_local) relative to robot pose into global (x_map, y_map).
        """
        cos_yaw = math.cos(robot_yaw)
        sin_yaw = math.sin(robot_yaw)

        x_map = robot_x + (x_local * cos_yaw - y_local * sin_yaw)
        y_map = robot_y + (x_local * sin_yaw + y_local * cos_yaw)
        return x_map, y_map
