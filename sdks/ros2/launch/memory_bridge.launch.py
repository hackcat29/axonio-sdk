"""Launch the Axonio spatial memory bridge."""

import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    pkg_dir = get_package_share_directory("axonio_ros2")
    default_config = os.path.join(pkg_dir, "config", "bridge_params.yaml")

    return LaunchDescription(
        [
            DeclareLaunchArgument("robot_id", default_value="amr_01", description="This robot's id"),
            DeclareLaunchArgument(
                "api_key_file", default_value="", description="File holding the API key (or export AXONIO_API_KEY)"
            ),
            DeclareLaunchArgument("config_file", default_value=default_config, description="Bridge parameters YAML"),
            Node(
                package="axonio_ros2",
                executable="memory_node",
                name="axonio_spatial_memory_bridge",
                output="screen",
                parameters=[
                    LaunchConfiguration("config_file"),
                    {
                        "robot_id": LaunchConfiguration("robot_id"),
                        "api_key_file": LaunchConfiguration("api_key_file"),
                    },
                ],
            ),
        ]
    )
