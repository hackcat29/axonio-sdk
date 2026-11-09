"""Sync and reflect clients for the synchronous ClawDB client."""
from __future__ import annotations

import time
from typing import Any

from axonio._http import HttpCore
from axonio.errors import ClawDBTimeoutError
from axonio.models import ReflectJob, SyncActionResult, SyncResult, SyncStatusResult


def to_job(value: Any) -> ReflectJob:
    v = value if isinstance(value, dict) else {}
    return ReflectJob(
        job_id=str(v.get("job_id") or v.get("id") or ""),
        status=str(v.get("status") or ""),
        message=str(v.get("message") or ""),
        skipped=bool(v.get("skipped", False)),
        request_id=str(v.get("request_id") or ""),
    )


def jobs_from(value: Any) -> list[ReflectJob]:
    items = value.get("jobs") if isinstance(value, dict) else value
    return [to_job(i) for i in items] if isinstance(items, list) else []


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {"items": value}


class SyncClientWrapper:
    def __init__(self, core: HttpCore) -> None:
        self._core = core

    def sync(self) -> SyncResult:
        return SyncResult.model_validate(self._core.call("Sync"))

    def push(self) -> SyncActionResult:
        return SyncActionResult.model_validate(self._core.call("PushSync"))

    def pull(self) -> SyncActionResult:
        return SyncActionResult.model_validate(self._core.call("PullSync"))

    def reconcile(self) -> SyncActionResult:
        return SyncActionResult.model_validate(self._core.call("ReconcileSync"))

    def status(self) -> SyncStatusResult:
        return SyncStatusResult.model_validate(self._core.call("SyncStatus"))


class ReflectClient:
    def __init__(self, core: HttpCore) -> None:
        self._core = core

    def trigger(self) -> ReflectJob:
        return to_job(self._core.call("Reflect"))

    def get_job(self, job_id: str) -> ReflectJob:
        return to_job(self._core.call("ReflectGetJob", {"job_id": job_id}).get("json"))

    def list_jobs(self, agent_id: str, *, status: str = "", limit: int = 20, offset: int = 0) -> list[ReflectJob]:
        payload = {"agent_id": agent_id, "status": status, "limit": limit, "offset": offset}
        return jobs_from(self._core.call("ReflectListJobs", payload).get("json"))

    def get_facts(self, agent_id: str) -> dict[str, Any]:
        return as_dict(self._core.call("ReflectGetFacts", {"agent_id": agent_id}).get("json"))

    def get_preferences(self, agent_id: str) -> dict[str, Any]:
        return as_dict(self._core.call("ReflectGetPreferences", {"agent_id": agent_id}).get("json"))

    def get_contradictions(self, agent_id: str) -> dict[str, Any]:
        return as_dict(self._core.call("ReflectGetContradictions", {"agent_id": agent_id}).get("json"))

    def resolve_contradiction(self, agent_id: str, contradiction_id: str, *, strategy: str = "", merged_value_json: str = "") -> dict[str, Any]:
        import json

        merged = json.loads(merged_value_json) if merged_value_json else None
        payload = {"agent_id": agent_id, "contradiction_id": contradiction_id, "strategy": strategy, "merged_value": merged}
        return as_dict(self._core.call("ReflectResolveContradiction", payload).get("json"))

    def wait_for_completion(self, job_id: str, *, poll_interval_s: float = 2.0, timeout_s: float = 60.0) -> ReflectJob:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            job = self.get_job(job_id)
            if job.status in ("completed", "failed"):
                return job
            time.sleep(poll_interval_s)
        raise ClawDBTimeoutError("Reflect job timed out", timeout_ms=int(timeout_s * 1000))
