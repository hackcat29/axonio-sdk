from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field

MemoryType = str
BranchStatus = str
ReflectJobStatus = str


class MemoryRecord(BaseModel):
    id: str = ""
    content: str = ""
    memory_type: str = ""
    tags: list[str] = Field(default_factory=list)


class SearchResult(BaseModel):
    id: str = ""
    content: str = ""
    score: float = 0.0
    memory_type: str = ""
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class BranchInfo(BaseModel):
    branch_id: str = ""
    name: str = ""
    branch_json: str = ""


class SyncResult(BaseModel):
    pushed: int = 0
    pulled: int = 0
    conflicts: int = 0
    duration_ms: int = 0
    request_id: str = ""


class SyncActionResult(BaseModel):
    summary_json: str = ""
    request_id: str = ""


class SyncStatusResult(BaseModel):
    status_json: str = ""
    request_id: str = ""


class ReflectJob(BaseModel):
    job_id: str = ""
    status: str = ""
    message: str = ""
    skipped: bool = False
    request_id: str = ""


class DiffResult(BaseModel):
    added: int = 0
    removed: int = 0
    modified: int = 0
    unchanged: int = 0
    divergence_score: float = 0.0
    diff_json: str = ""
    request_id: str = ""


class MergeResult(BaseModel):
    success: bool = False
    applied: int = 0
    skipped: int = 0
    conflicts: int = 0
    duration_ms: int = 0
    request_id: str = ""


class TxInfo(BaseModel):
    tx_id: str = ""
    request_id: str = ""

