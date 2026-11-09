# axonio-ros2

ROS2 package and Python SDK that give robots a shared, durable spatial memory in [Axonio](https://axonio.xyz). One robot reports an obstacle; every robot in the fleet can plan around it, and it is still there after a restart.

It is built on the [`axonio`](https://pypi.org/project/axonio/) Python SDK. Spatial events are stored as ordinary Axonio memories, so they also appear in the dashboard, in search, and to any AI agent connected through the Axonio MCP server.

Formerly `clawdb-ros2`.

## Install

```bash
pip install axonio-ros2          # Python 3.10 or newer (ROS 2 Humble and later)
```

Or inside a colcon workspace:

```bash
cd ~/ros2_ws/src
git clone https://github.com/hackcat29/axonio-sdk.git
ln -s axonio-sdk/sdks/ros2 axonio_ros2
pip install axonio
cd ~/ros2_ws && colcon build --packages-select axonio_ros2 && source install/setup.bash
```

Create an API key in the Axonio dashboard (Robots → Register Robot Node) and export it. The key is never put on the command line or in a ROS parameter, where any node on the DDS domain could read it.

```bash
export AXONIO_API_KEY="ck_live_..."      # or use api_key_file:=/run/secrets/axonio
```

## Run the bridge node

```bash
ros2 launch axonio_ros2 memory_bridge.launch.py robot_id:=amr_01
# or
ros2 run axonio_ros2 memory_node --ros-args -p robot_id:=amr_01
```

The node writes every obstacle it sees to Axonio, pulls what other robots recorded into a local index at `sync_rate_hz`, and publishes those new records on `~/fleet_updates`.

| Topic | Type | |
|---|---|---|
| `~/detected_obstacle` (sub) | `geometry_msgs/Point` | A point detection to remember |
| `~/fleet_updates` (pub) | `std_msgs/String` | JSON list of records new from other robots |

| Parameter | Default | |
|---|---|---|
| `endpoint` | `""` | Empty for the Axonio cloud, or a self-hosted server URL (`https://`, or `http://localhost`) |
| `api_key_file` | `""` | File holding the key, used when `AXONIO_API_KEY` is unset |
| `robot_id` | `amr-01` | This machine's id; its own records are not pulled back |
| `store_name` | `robot-fleet-memory` | Robots sharing a store share memory |
| `frame_id` | `map` | Coordinate frame of the records |
| `sync_rate_hz` | `1.0` | Fleet sync frequency (0 turns it off) |
| `local_ttl_seconds` | `7200.0` | How long a record stays in the local index |

## Use it from Python

```python
from axonio_ros2 import AxonioClient, SpatialMemoryIndex, SpatialMemoryRecord

client = AxonioClient(store_name="warehouse", robot_id="amr_01")   # key from AXONIO_API_KEY

client.record_spatial_event(
    SpatialMemoryRecord(x=14.5, y=8.2, obstacle_type="pallet_spill", confidence=0.98, tags=["aisle_4"])
)

# Plan against a local index: no network call per query.
index = SpatialMemoryIndex(memory_ttl_seconds=3600)
for record in client.pull_fleet_deltas(since_timestamp=0.0):
    index.insert(record)

for record, distance in index.query_radius(x=14.0, y=7.5, radius=5.0):
    print(record.obstacle_type, f"{distance:.2f} m")
```

`record_spatial_event` never raises. If Axonio is unreachable the record is queued (up to 1000) and sent before the next call, and `{"status": "offline_cached"}` is returned.

### What is stored

Each record is one Axonio memory:

```
content   pallet spill at (14.50, 8.20, 0.00) in frame map, confidence 0.98, reported by amr_01
tags      axonio-ros2, store:warehouse, obstacle:pallet_spill, robot:amr_01, aisle_4
metadata  x, y, z, frame_id, confidence, recorded_at, robot_id, ...
```

Because the content is a sentence, an agent can answer "which aisles were blocked today?" from the same data.

`pull_fleet_deltas` and `load_recent` read memories back with Axonio's list call, which returns content and tags but not metadata. They rebuild position, frame, class, confidence, robot id, tags and `notes` from those. Other `metadata` keys you attach are stored and returned by search (`search_nearby`), but not by the list-based sync.

### Searching the cloud

`client.search_nearby(x, y, radius_meters)` asks Axonio for the memories that best match the place and keeps those inside the radius. Search ranks by meaning, not geometry, so treat it as a lookup for cold starts and dashboards. For a planner loop, fill a `SpatialMemoryIndex` from `pull_fleet_deltas` and query that: about 0.07 ms per radius query with 100,000 records (grid-hashed, measured on a laptop).

## Examples

`examples/` has a warehouse AMR, a multi-robot fleet and a Nav2 costmap sketch.

## Test

```bash
pip install -e ".[dev]" && pytest
```

## License

MIT
