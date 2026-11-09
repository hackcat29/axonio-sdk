import os
from glob import glob

from setuptools import find_packages, setup

package_name = "axonio_ros2"

# Project metadata lives in pyproject.toml; this file only adds the ament
# (colcon) data files that pyproject cannot express.
setup(
    packages=find_packages(exclude=["tests*", "examples*"]),
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
        (os.path.join("share", package_name, "launch"), glob("launch/*.launch.py")),
        (os.path.join("share", package_name, "config"), glob("config/*.yaml")),
    ],
)
