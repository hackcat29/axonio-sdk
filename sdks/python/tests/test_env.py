"""AXONIO_* environment variables win; the older CLAWDB_* names still work."""
from __future__ import annotations

import pytest

from axonio import Axonio, AsyncAxonio, AsyncClawDB, ClawDB
from axonio._http import CLOUD_ENDPOINT
from axonio.config import ClawDBConfig
from axonio.provision import ProvisionResult, resolve_endpoint

VARS = ["AXONIO_API_KEY", "AXONIO_URL", "AXONIO_AGENT_ID", "CLAWDB_API_KEY", "CLAWDB_URL", "CLAWDB_AGENT_ID", "CLAWDB_ENDPOINT"]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in VARS:
        monkeypatch.delenv(name, raising=False)


def test_config_prefers_axonio_names(monkeypatch):
    monkeypatch.setenv("CLAWDB_API_KEY", "old")
    monkeypatch.setenv("AXONIO_API_KEY", "new")
    monkeypatch.setenv("AXONIO_URL", "https://db.example.com/api")
    cfg = ClawDBConfig()
    assert cfg.api_key == "new"
    assert cfg.endpoint == "https://db.example.com/api"


def test_config_still_reads_clawdb_names(monkeypatch):
    monkeypatch.setenv("CLAWDB_API_KEY", "old")
    monkeypatch.setenv("CLAWDB_AGENT_ID", "legacy-agent")
    cfg = ClawDBConfig()
    assert cfg.api_key == "old" and cfg.agent_id == "legacy-agent"


@pytest.mark.asyncio
async def test_resolve_endpoint_prefers_axonio_names(monkeypatch):
    monkeypatch.setenv("CLAWDB_API_KEY", "old")
    monkeypatch.setenv("AXONIO_API_KEY", "new")
    assert await resolve_endpoint() == ProvisionResult(endpoint=CLOUD_ENDPOINT, api_key="new")


@pytest.mark.asyncio
async def test_resolve_endpoint_reads_legacy_names(monkeypatch):
    monkeypatch.setenv("CLAWDB_API_KEY", "old")
    assert await resolve_endpoint() == ProvisionResult(endpoint=CLOUD_ENDPOINT, api_key="old")


def test_axonio_names_are_the_same_classes():
    assert Axonio is ClawDB
    assert AsyncAxonio is AsyncClawDB
