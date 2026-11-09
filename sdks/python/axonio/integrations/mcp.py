"""MCP (Model Context Protocol) server adapter for ClawDB."""
from __future__ import annotations

import json
from typing import Any

from axonio.async_client import AsyncClawDB

try:
    from mcp.server import Server  # type: ignore[import]
    from mcp.server.models import InitializationOptions  # type: ignore[import]
    from mcp import types as mcp_types  # type: ignore[import]
    _HAS_MCP = True
except ImportError:
    _HAS_MCP = False


def create_mcp_server(db: AsyncClawDB) -> Any:
    """Create an MCP server that exposes ClawDB tools."""
    if not _HAS_MCP:
        raise ImportError("Install the 'mcp' package to use the MCP adapter: pip install mcp")

    server = Server("clawdb")

    @server.list_tools()
    async def list_tools() -> list[Any]:
        return [
            mcp_types.Tool(name="clawdb_remember", description="Store a memory in ClawDB", inputSchema={"type": "object", "properties": {"content": {"type": "string"}, "memory_type": {"type": "string"}}, "required": ["content"]}),
            mcp_types.Tool(name="clawdb_search", description="Search memories semantically", inputSchema={"type": "object", "properties": {"query": {"type": "string"}, "top_k": {"type": "integer"}}, "required": ["query"]}),
            mcp_types.Tool(name="clawdb_recall", description="Retrieve memories by ID", inputSchema={"type": "object", "properties": {"memory_ids": {"type": "array", "items": {"type": "string"}}}, "required": ["memory_ids"]}),
            mcp_types.Tool(name="clawdb_branch", description="Fork a new memory branch", inputSchema={"type": "object", "properties": {"name": {"type": "string"}, "parent": {"type": "string"}}, "required": ["name"]}),
            mcp_types.Tool(name="clawdb_sync", description="Sync memories with ClawDB Cloud", inputSchema={"type": "object", "properties": {}}),
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any]) -> list[Any]:
        if name == "clawdb_remember":
            memory_id = await db.memory.remember(**arguments)
            return [mcp_types.TextContent(type="text", text=json.dumps({"memory_id": memory_id}))]
        if name == "clawdb_search":
            results = await db.memory.search(**arguments)
            return [mcp_types.TextContent(type="text", text=json.dumps([{"content": r.content, "score": r.score} for r in results]))]
        if name == "clawdb_recall":
            memories = await db.memory.recall(arguments["memory_ids"])
            return [mcp_types.TextContent(type="text", text=json.dumps([{"id": m.id, "content": m.content} for m in memories]))]
        if name == "clawdb_branch":
            branch = await db.branches.fork(arguments["name"], parent=arguments.get("parent"))
            return [mcp_types.TextContent(type="text", text=json.dumps(branch.model_dump(mode="json")))]
        if name == "clawdb_sync":
            result = await db.sync.sync()
            return [mcp_types.TextContent(type="text", text=json.dumps(result.model_dump(mode="json")))]
        raise ValueError(f"Unknown tool: {name}")

    return server
