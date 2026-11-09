import {
  ClawDBAuthError,
  ClawDBError,
  ClawDBInternalError,
  ClawDBTimeoutError,
  ClawDBUnavailableError,
  fromGrpcStatus,
  fromHttpResponse
} from 'axonio-errors';
import type { ClawDBSession, MemoryRecord, ReflectJob, SyncResult } from 'axonio-types';

import type { AgentProfile, BatchOp, BranchEvaluation, ClawDBEvent, DiffResult, MergeConflict, MergeResult } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function withSession(session: ClawDBSession, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    ...payload,
    token: session.token,
    sessionToken: session.token,
    session_token: session.token,
    agentId: session.agentId,
    agent_id: session.agentId
  };
}

export function toDate(value: unknown, fallback = new Date()): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = Math.abs(value) < 1e11 ? value * 1000 : value;
    return new Date(millis);
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return toDate(numeric, fallback);
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return fallback;
}

export function toPlainObject(value: unknown): Record<string, unknown> {
  if (value == null) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  if (value instanceof Uint8Array) {
    try {
      const decoded = new TextDecoder().decode(value);
      return toPlainObject(decoded);
    } catch {
      return {};
    }
  }

  if (ArrayBuffer.isView(value)) {
    return toPlainObject(new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)));
  }

  if (typeof Buffer !== 'undefined' && value instanceof Buffer) {
    return toPlainObject(new Uint8Array(value));
  }

  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }

  return {};
}

export function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (typeof Buffer !== 'undefined' && value instanceof Buffer) {
    return new Uint8Array(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }

  if (typeof value === 'string') {
    return new TextEncoder().encode(value);
  }

  return new Uint8Array();
}

export function normalizeMemoryRecord(memory: unknown): MemoryRecord {
  const source = toPlainObject(memory);
  const metadata = source.metadata ?? source.metadataJson ?? source.metadata_json;

  const createdAt = toDate(source.createdAt ?? source.created_at);
  const updatedAt = toDate(source.updatedAt ?? source.updated_at ?? source.createdAt ?? source.created_at, createdAt);

  return {
    id: String(source.id ?? ''),
    agentId: String(source.agentId ?? source.agent_id ?? ''),
    content: String(source.content ?? ''),
    memoryType: String(source.memoryType ?? source.memory_type ?? 'context') as MemoryRecord['memoryType'],
    metadata: toPlainObject(metadata),
    tags: Array.isArray(source.tags) ? source.tags.map(String) : [],
    importanceScore: Number(source.importanceScore ?? source.importance_score ?? 0),
    isPromoted: Boolean(source.isPromoted ?? source.is_promoted ?? false),
    createdAt,
    updatedAt
  };
}

export function normalizeSearchResults(value: unknown): Array<{ memory: MemoryRecord; score: number }> {
  const source = toPlainObject(value);
  const results = Array.isArray(source.results) ? source.results : [];

  return results.map((item, index) => {
    const recordSource = toPlainObject(item);
    const nestedMemory = 'memory' in recordSource ? recordSource.memory : item;
    const score = Number(recordSource.score ?? recordSource.similarityScore ?? recordSource.similarity_score ?? 1 - index * 0.01);

    return {
      memory: normalizeMemoryRecord(nestedMemory),
      score: Number.isFinite(score) ? score : 0
    };
  });
}

export function normalizeBranchInfo(value: unknown) {
  const source = toPlainObject(value);

  return {
    id: String(source.id ?? source.branchId ?? source.branch_id ?? ''),
    name: String(source.name ?? source.branchName ?? source.branch_name ?? ''),
    status: String(source.status ?? 'active') as 'active' | 'dormant' | 'merged' | 'discarded' | 'archived',
    parentId: source.parentId == null && source.parent_id == null ? null : String(source.parentId ?? source.parent_id),
    createdAt: toDate(source.createdAt ?? source.created_at),
    divergenceScore: Number(source.divergenceScore ?? source.divergence_score ?? 0)
  };
}

export function normalizeDiffResult(value: unknown): DiffResult {
  const source = toPlainObject(value);
  const entityDiffs =
    Array.isArray(source.entityDiffs) ? source.entityDiffs : Array.isArray(source.entity_diffs) ? source.entity_diffs : [];

  const fallbackJson = source.diffJson ?? source.diff_json;
  const parsedJson = Object.keys(toPlainObject(fallbackJson)).length > 0 ? toPlainObject(fallbackJson) : toPlainObject(new TextDecoder().decode(toBytes(fallbackJson)));
  const parsedEntityDiffs = Array.isArray(parsedJson.entityDiffs) ? parsedJson.entityDiffs : entityDiffs;

  return {
    added: Number(source.added ?? 0),
    removed: Number(source.removed ?? 0),
    modified: Number(source.modified ?? 0),
    divergenceScore: Number(source.divergenceScore ?? source.divergence_score ?? 0),
    entityDiffs: parsedEntityDiffs.map((diff) => {
      const item = toPlainObject(diff);
      return {
        id: String(item.id ?? ''),
        changeType: String(item.changeType ?? item.change_type ?? 'modified') as 'added' | 'removed' | 'modified',
        before: item.before,
        after: item.after
      };
    })
  };
}

export function normalizeMergeResult(value: unknown): MergeResult {
  const source = toPlainObject(value);
  const explicitConflicts = Array.isArray(source.conflicts) ? source.conflicts : [];
  const conflictIds = Array.isArray(source.conflictIds) ? source.conflictIds : Array.isArray(source.conflict_ids) ? source.conflict_ids : [];

  const conflicts: MergeConflict[] =
    explicitConflicts.length > 0
      ? explicitConflicts.map((conflict) => {
          const item = toPlainObject(conflict);
          return {
            id: String(item.id ?? ''),
            reason: String(item.reason ?? 'conflict')
          };
        })
      : conflictIds.map((id) => ({ id: String(id), reason: 'conflict' }));

  return {
    applied: Number(source.applied ?? 0),
    conflicts,
    success: Boolean(source.success ?? conflicts.length === 0)
  };
}

export function evaluateBranchDiff(diff: DiffResult): BranchEvaluation {
  const totalChanges = diff.added + diff.removed + diff.modified;
  let recommendation: BranchEvaluation['recommendation'] = 'commit';

  if (totalChanges === 0) {
    recommendation = 'discard';
  } else if (diff.divergenceScore >= 0.65) {
    recommendation = 'review';
  }

  return {
    divergenceScore: diff.divergenceScore,
    entitiesAdded: diff.added,
    recommendation
  };
}

export function normalizeSyncResult(value: unknown): SyncResult {
  const source = toPlainObject(value);

  return {
    pushed: Number(source.pushed ?? 0),
    pulled: Number(source.pulled ?? 0),
    conflicts: Number(source.conflicts ?? 0),
    syncedAt: toDate(source.syncedAt ?? source.synced_at)
  };
}

export function normalizeReflectJob(value: unknown, fallbackStatus: ReflectJob['status'] = 'pending'): ReflectJob {
  const source = toPlainObject(value);

  return {
    jobId: String(source.jobId ?? source.job_id ?? ''),
    status: String(source.status ?? fallbackStatus) as ReflectJob['status'],
    processed: Number(source.processed ?? 0),
    archived: Number(source.archived ?? 0),
    promoted: Number(source.promoted ?? 0)
  };
}

export function normalizeAgentProfile(value: unknown): AgentProfile {
  const source = toPlainObject(value);

  return {
    preferences: toPlainObject(source.preferences),
    facts: toPlainObject(source.facts),
    memoryCount: Number(source.memoryCount ?? source.memory_count ?? 0),
    lastUpdatedAt: toDate(source.lastUpdatedAt ?? source.last_updated_at)
  };
}

export function normalizeSession(
  value: unknown,
  fallback: { agentId: string; role: string; scopes?: string[] }
): ClawDBSession {
  const source = toPlainObject(value);

  return {
    agentId: String(source.agentId ?? source.agent_id ?? fallback.agentId),
    role: String(source.role ?? fallback.role),
    scopes: Array.isArray(source.scopes)
      ? source.scopes.map(String)
      : Array.isArray(source.grantedScopes)
        ? source.grantedScopes.map(String)
        : Array.isArray(source.granted_scopes)
          ? source.granted_scopes.map(String)
          : fallback.scopes ?? [],
    token: String(source.token ?? source.sessionToken ?? source.session_token ?? ''),
    expiresAt: toDate(source.expiresAt ?? source.expires_at)
  };
}

export function normalizeEvent(value: unknown): ClawDBEvent {
  const source = toPlainObject(value);
  const eventType = String(source.type ?? source.eventType ?? source.event_type ?? 'session:expired');
  const payload =
    source.payload ??
    toPlainObject(source.payloadJson ?? source.payload_json ?? (typeof source.payload === 'string' ? source.payload : undefined));

  return {
    type: eventType as ClawDBEvent['type'],
    payload: payload as ClawDBEvent['payload']
  } as ClawDBEvent;
}

export function normalizeBatchError(error: unknown): ClawDBError {
  if (ClawDBError.isClawDBError(error)) {
    return error;
  }

  if (typeof error === 'object' && error !== null) {
    if ('status' in error && typeof (error as { status?: unknown }).status === 'number') {
      const { status, ...rest } = error as { status: number } & Record<string, unknown>;
      return fromHttpResponse(status, rest);
    }

    if ('code' in error && typeof (error as { code?: unknown }).code === 'number') {
      return fromGrpcStatus(error as { code: number; message?: string; details?: string });
    }
  }

  if (error instanceof ClawDBTimeoutError || error instanceof ClawDBUnavailableError || error instanceof ClawDBAuthError) {
    return error;
  }

  if (error instanceof Error) {
    if (/timeout/i.test(error.message)) {
      return new ClawDBTimeoutError(error.message);
    }

    if (/unavailable|network/i.test(error.message)) {
      return new ClawDBUnavailableError(error.message, error);
    }

    return new ClawDBInternalError(error.message, error);
  }

  return new ClawDBInternalError('Unknown ClawDB error', error);
}

export function assertBatchSize(operations: BatchOp[], maxSize: number): void {
  if (operations.length > maxSize) {
    throw new ClawDBInternalError(`Batch contains ${operations.length} operations, which exceeds the limit of ${maxSize}.`);
  }
}
