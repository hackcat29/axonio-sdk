from __future__ import annotations

from unittest.mock import patch

import pytest

from axonio._http import CLOUD_ENDPOINT
from axonio.async_client import AsyncClawDB
from axonio.client import ClawDB
from axonio.provision import ProvisionResult, resolve_endpoint


@pytest.mark.asyncio
async def test_resolve_endpoint_prefers_running_local_server(monkeypatch) -> None:
    monkeypatch.delenv("CLAWDB_URL", raising=False)
    monkeypatch.delenv("CLAWDB_API_KEY", raising=False)
    with patch("axonio.provision._is_port_open", return_value=True):
        result = await resolve_endpoint()
    assert result == ProvisionResult(endpoint="http://localhost:50050", api_key=None)


@pytest.mark.asyncio
async def test_api_key_alone_means_the_cloud(monkeypatch) -> None:
    monkeypatch.delenv("CLAWDB_URL", raising=False)
    monkeypatch.setenv("CLAWDB_API_KEY", "ck_live_x")
    assert await resolve_endpoint() == ProvisionResult(endpoint=CLOUD_ENDPOINT, api_key="ck_live_x")


@pytest.mark.asyncio
async def test_explicit_url_keeps_the_api_key(monkeypatch) -> None:
    monkeypatch.setenv("CLAWDB_URL", "https://db.example.com/api")
    monkeypatch.setenv("CLAWDB_API_KEY", "ck_live_x")
    assert await resolve_endpoint() == ProvisionResult(endpoint="https://db.example.com/api", api_key="ck_live_x")


def test_sync_connect_auto_resolves_local_endpoint() -> None:
    db = ClawDB()
    with patch("axonio.client.resolve_endpoint", return_value=ProvisionResult(endpoint="http://localhost:50050", api_key=None)), \
         patch("axonio.client.HttpCore.open_session", return_value={"token": "t"}) as open_session:
        db.connect()
    assert db._config.endpoint == "http://localhost:50050"
    assert db._core is not None and db._core.base_url == "http://localhost:8080"
    open_session.assert_called_once()


@pytest.mark.asyncio
async def test_async_connect_auto_resolves_local_endpoint() -> None:
    db = AsyncClawDB()

    async def fake_resolve() -> ProvisionResult:
        return ProvisionResult(endpoint="http://localhost:50050", api_key=None)

    async def fake_open(self):  # noqa: ANN001
        return {"token": "t"}

    with patch("axonio.async_client.resolve_endpoint", fake_resolve), \
         patch("axonio.async_client.AsyncHttpCore.open_session", fake_open):
        await db.connect()
    assert db._config.endpoint == "http://localhost:50050"
    assert db._core is not None and db._core.base_url == "http://localhost:8080"
