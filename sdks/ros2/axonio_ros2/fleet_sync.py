"""Standalone fleet memory watcher: prints what the rest of the fleet records."""

import argparse
import os
import time

from .client import AxonioClient
from .node import resolve_api_key


def main():
    parser = argparse.ArgumentParser(description="Axonio fleet memory watcher")
    parser.add_argument("--api-key-file", default="", help="File holding the API key (or set AXONIO_API_KEY)")
    parser.add_argument("--endpoint", default=os.environ.get("AXONIO_URL", ""), help="Self-hosted server URL (default: Axonio cloud)")
    parser.add_argument("--store", default="robot-fleet-memory", help="Spatial memory store name")
    parser.add_argument("--robot-id", default="", help="This machine's id (its own records are skipped)")
    parser.add_argument("--interval", type=float, default=2.0, help="Seconds between checks")
    args = parser.parse_args()

    api_key = resolve_api_key(key_file=args.api_key_file)
    if not api_key:
        parser.error("no API key: set AXONIO_API_KEY or pass --api-key-file")

    client = AxonioClient(api_key=api_key, endpoint=args.endpoint or None, store_name=args.store, robot_id=args.robot_id)
    print(f"Axonio fleet watcher started (store: {args.store})")

    since = 0.0
    try:
        while True:
            deltas = client.pull_fleet_deltas(since_timestamp=since)
            if deltas:
                since = max(since, max(d.timestamp for d in deltas))
                print(f"[{time.strftime('%X')}] {len(deltas)} new from the fleet:")
                for d in deltas:
                    print(f"  {d.obstacle_type} at ({d.x:.2f}, {d.y:.2f}) in {d.frame_id}")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        client.close()


if __name__ == "__main__":
    main()
