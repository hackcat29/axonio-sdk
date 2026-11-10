# clawdb-ros2

Renamed to **[axonio-ros2](https://pypi.org/project/axonio-ros2/)**. This package only installs it and keeps `import clawdb_ros2` working.

```bash
pip install axonio-ros2
```

```python
from axonio_ros2 import AxonioClient, SpatialMemoryRecord
```

Version 0.4.2 of `clawdb-ros2` called API endpoints that do not exist, so robots using it never stored anything. `axonio-ros2` 0.5.0 is a rewrite on the `axonio` SDK. The old `workspace_id` argument is accepted and ignored; the API key identifies the workspace. The key now comes from `AXONIO_API_KEY` (or `CLAWDB_API_KEY`).
