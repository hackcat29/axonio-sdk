"""LangChain integration for the ClawDB Python SDK."""
from __future__ import annotations

from typing import Any, List

try:
    from langchain_core.documents import Document
    from langchain_core.memory import BaseChatMemory
    from langchain_core.messages import BaseMessage
    from langchain_core.retrievers import BaseRetriever
    from langchain_core.callbacks import CallbackManagerForRetrieverRun, AsyncCallbackManagerForRetrieverRun
except ImportError as exc:
    raise ImportError("Install clawdb[langchain] to use LangChain integration: pip install clawdb[langchain]") from exc

from axonio.async_client import AsyncClawDB
from axonio.client import ClawDB


class ClawDBRetriever(BaseRetriever):
    """LangChain-compatible retriever backed by ClawDB semantic search."""

    db: Any  # ClawDB | AsyncClawDB
    top_k: int = 5
    memory_type: str | None = None
    alpha: float = 0.7

    model_config = {"arbitrary_types_allowed": True}

    def _get_relevant_documents(self, query: str, *, run_manager: CallbackManagerForRetrieverRun) -> List[Document]:
        assert isinstance(self.db, ClawDB), "Use ClawDB (sync) or override _aget_relevant_documents for async."
        results = self.db.memory.search(query, top_k=self.top_k, alpha=self.alpha)
        return [
            Document(
                page_content=r.content,
                metadata={"memory_id": r.id, "score": r.score, "type": r.memory_type, **r.metadata},
            )
            for r in results
        ]

    async def _aget_relevant_documents(self, query: str, *, run_manager: AsyncCallbackManagerForRetrieverRun) -> List[Document]:
        results = await self.db.memory.search(query, top_k=self.top_k, alpha=self.alpha)
        return [
            Document(
                page_content=r.content,
                metadata={"memory_id": r.id, "score": r.score, "type": r.memory_type, **r.metadata},
            )
            for r in results
        ]


class ClawDBMemoryBuffer(BaseChatMemory):
    """LangChain memory buffer that persists context in ClawDB."""

    db: Any  # AsyncClawDB
    top_k: int = 5

    model_config = {"arbitrary_types_allowed": True}

    @property
    def memory_variables(self) -> List[str]:
        return ["history", "retrieved_context"]

    async def asave_context(self, inputs: dict[str, Any], outputs: dict[str, Any]) -> None:
        await self.db.memory.remember(
            f"User: {inputs.get('input', '')}\nAssistant: {outputs.get('output', '')}",
            memory_type="message",
        )

    async def aload_memory_variables(self, inputs: dict[str, Any]) -> dict[str, Any]:
        query = inputs.get("input", "")
        results = await self.db.memory.search(query, top_k=self.top_k)
        docs = "\n".join(r.content for r in results)
        return {"history": [], "retrieved_context": docs}

    def save_context(self, inputs: dict[str, Any], outputs: dict[str, Any]) -> None:
        raise NotImplementedError("Use asave_context for async ClawDB memory.")

    def load_memory_variables(self, inputs: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError("Use aload_memory_variables for async ClawDB memory.")

    def clear(self) -> None:
        pass  # Manual management via db.memory.forget
