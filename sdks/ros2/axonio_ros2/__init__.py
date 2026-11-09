"""Axonio ROS2 SDK: persistent, fleet-wide spatial memory for robots.

:license: MIT, see LICENSE for more details.
"""

from .client import AxonioClient, ClawClient, QueryResult, SpatialMemoryRecord
from .node import AxonioSpatialMemoryNode, ClawSpatialMemoryNode
from .spatial_index import SpatialMemoryIndex

__version__ = "0.5.0"
__all__ = [
    "AxonioClient",
    "AxonioSpatialMemoryNode",
    "QueryResult",
    "SpatialMemoryIndex",
    "SpatialMemoryRecord",
    # Names used before the rename to Axonio.
    "ClawClient",
    "ClawSpatialMemoryNode",
]
