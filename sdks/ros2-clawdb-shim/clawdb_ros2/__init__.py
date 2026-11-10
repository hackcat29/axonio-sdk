"""clawdb-ros2 has been renamed to axonio-ros2. This module re-exports it.

    pip install axonio-ros2
    from axonio_ros2 import AxonioClient
"""
import sys

import axonio_ros2 as _axonio_ros2
from axonio_ros2 import *  # noqa: F401,F403
from axonio_ros2 import __all__, __version__, client, fleet_sync, node, obstacle_subscriber, spatial_index, tf_listener  # noqa: F401

# `import clawdb_ros2.client` and the like keep working.
for _name in ("client", "fleet_sync", "node", "obstacle_subscriber", "spatial_index", "tf_listener"):
    sys.modules[f"{__name__}.{_name}"] = getattr(_axonio_ros2, _name)
