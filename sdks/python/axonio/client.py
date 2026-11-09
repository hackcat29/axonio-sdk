"""Sync ClawDB client."""
from __future__ import annotations

import asyncio
from typing import Any

import structlog

from axonio._http import HttpCore
from axonio.branches import BranchClient
from axonio.config import ClawDBConfig
from axonio.memory import MemoryClient
from axonio.provision import resolve_endpoint
from axonio.reflect import ReflectClient
from axonio.session import SessionClient
from axonio.sync_client import SyncClientWrapper
from axonio.transactions import TxClient

log = structlog.get_logger(__name__)


class ClawDB:
    """Synchronous ClawDB client.

    Talks to the server's HTTP API: the hosted cloud
    (https://api.axonio.xyz/api/v1/gateway, the default when only an API key
    is set) or a self-hosted clawdb-server.
    """

    def __init__(
        self,
        *,
        endpoint: str | None = None,
        api_key: str | None = None,
        agent_id: str | None = None,
        **kwargs: Any,
    ) -> None:
        overrides: dict[str, Any] = {}
        if endpoint:
            overrides["endpoint"] = endpoint
        if api_key:
            overrides["api_key"] = api_key
        if agent_id:
            overrides["agent_id"] = agent_id
        overrides.update(kwargs)
        self._config = ClawDBConfig(**overrides)
        self._core: HttpCore | None = None
        self._session_client: SessionClient | None = None
        self._memory_client: MemoryClient | None = None
        self._branch_client: BranchClient | None = None
        self._sync_client: SyncClientWrapper | None = None
        self._reflect_client: ReflectClient | None = None
        self._tx_client: TxClient | None = None

    @classmethod
    def from_env(cls) -> "ClawDB":
        return cls()

    @classmethod
    def from_api_key(cls, api_key: str, endpoint: str | None = None) -> "ClawDB":
        from axonio._http import CLOUD_ENDPOINT

        return cls(api_key=api_key, endpoint=endpoint or CLOUD_ENDPOINT)

    @classmethod
    def auto_provision(cls) -> "ClawDB":
        try:
            result = asyncio.run(resolve_endpoint())
        except RuntimeError:
            # Already on an event loop: fall back to env defaults.
            return cls.from_env()
        return cls(endpoint=result.endpoint, api_key=result.api_key)

    def _should_resolve_endpoint(self) -> bool:
        return self._config.endpoint in ("", "http://localhost:50050")

    def _apply_key_only_default(self) -> bool:
        """An API key with no endpoint means the hosted cloud, as in the TypeScript SDK."""
        if self._config.api_key and self._should_resolve_endpoint():
            from axonio._http import CLOUD_ENDPOINT

            self._config.endpoint = CLOUD_ENDPOINT
            return True
        return False

    def connect(self) -> None:
        if self._core is not None:
            return
        if self._should_resolve_endpoint() and not self._apply_key_only_default():
            try:
                result = asyncio.run(resolve_endpoint())
                self._config.endpoint = result.endpoint
                if result.api_key and not self._config.api_key:
                    self._config.api_key = result.api_key
            except RuntimeError:
                pass
        self._core = HttpCore(
            self._config.endpoint,
            api_key=self._config.api_key,
            agent_id=self._config.agent_id,
            role=self._config.role,
            timeout_ms=self._config.timeout_ms,
        )
        self._session_client = SessionClient(self._core)
        self._session_client.create()
        log.info("axonio.connected", endpoint=self._core.base_url, agent_id=self._config.agent_id)

    def disconnect(self) -> None:
        if self._session_client:
            self._session_client.revoke()
        if self._core:
            self._core.close()
        self._core = None
        self._session_client = None
        self._memory_client = self._branch_client = None
        self._sync_client = self._reflect_client = self._tx_client = None
        log.info("axonio.disconnected")

    def __enter__(self) -> "ClawDB":
        self.connect()
        return self

    def __exit__(self, *args: Any) -> None:
        self.disconnect()

    def _require_core(self) -> HttpCore:
        if self._core is None:
            self.connect()
        assert self._core is not None
        return self._core

    def health(self) -> dict[str, Any]:
        """Server health, including which components are enabled."""
        return self._require_core().call("Health")

    @property
    def session(self) -> SessionClient:
        self._require_core()
        assert self._session_client is not None
        return self._session_client

    @property
    def memory(self) -> MemoryClient:
        if self._memory_client is None:
            self._memory_client = MemoryClient(self._require_core())
        return self._memory_client

    @property
    def branches(self) -> BranchClient:
        if self._branch_client is None:
            self._branch_client = BranchClient(self._require_core())
        return self._branch_client

    @property
    def sync(self) -> SyncClientWrapper:
        if self._sync_client is None:
            self._sync_client = SyncClientWrapper(self._require_core())
        return self._sync_client

    @property
    def reflect(self) -> ReflectClient:
        if self._reflect_client is None:
            self._reflect_client = ReflectClient(self._require_core())
        return self._reflect_client

    @property
    def tx(self) -> TxClient:
        if self._tx_client is None:
            self._tx_client = TxClient(self._require_core())
        return self._tx_client
