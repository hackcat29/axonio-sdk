"""Sync BranchClient — a thin alias into memory.py to avoid circular imports."""
from axonio.memory import BranchClient

__all__ = ["BranchClient"]
