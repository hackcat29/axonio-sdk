"""OpenAI Agents (function calling) integration for ClawDB."""
from __future__ import annotations

import json
from typing import Any

from axonio.async_client import AsyncClawDB


def _make_tool(name: str, description: str, parameters: dict[str, Any]) -> dict[str, Any]:
    return {"type": "function", "function": {"name": name, "description": description, "parameters": parameters}}


class ClawDBMemoryTool:
    """Provides OpenAI function-calling tool definitions for ClawDB memory operations."""

    def __init__(self, db: AsyncClawDB) -> None:
        self._db = db

    def as_tools(self) -> list[dict[str, Any]]:
        return [
            _make_tool(
                "clawdb_remember",
                "Store a new memory in ClawDB.",
                {
                    "type": "object",
                    "properties": {
                        "content": {"type": "string"},
                        "memory_type": {"type": "string", "default": "context"},
                        "tags": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["content"],
                },
            ),
            _make_tool(
                "clawdb_search",
                "Search ClawDB memories semantically.",
                {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "top_k": {"type": "integer", "default": 5},
                    },
                    "required": ["query"],
                },
            ),
            _make_tool(
                "clawdb_recall",
                "Retrieve specific memories by ID.",
                {
                    "type": "object",
                    "properties": {"memory_ids": {"type": "array", "items": {"type": "string"}}},
                    "required": ["memory_ids"],
                },
            ),
            _make_tool(
                "clawdb_forget",
                "Delete a memory by ID.",
                {
                    "type": "object",
                    "properties": {"memory_id": {"type": "string"}},
                    "required": ["memory_id"],
                },
            ),
        ]

    async def handle_call(self, function_name: str, arguments: str) -> str:
        args = json.loads(arguments)
        if function_name == "clawdb_remember":
            memory_id = await self._db.memory.remember(**args)
            return json.dumps({"memory_id": memory_id})
        if function_name == "clawdb_search":
            results = await self._db.memory.search(**args)
            return json.dumps([{"content": r.content, "score": r.score, "id": r.id} for r in results])
        if function_name == "clawdb_recall":
            memories = await self._db.memory.recall(args["memory_ids"])
            return json.dumps([{"id": m.id, "content": m.content} for m in memories])
        if function_name == "clawdb_forget":
            await self._db.memory.forget(args["memory_id"])
            return json.dumps({"ok": True})
        raise ValueError(f"Unknown function: {function_name}")
