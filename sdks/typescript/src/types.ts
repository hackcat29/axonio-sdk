import type { ClawDBError } from 'axonio-errors';
import type {
  BranchInfo,
  BranchStatus,
  ClawDBConfig,
  ClawDBSession,
  MemoryRecord,
  MemoryType,
  ReflectJob,
  SearchResult,
  SyncResult
} from 'axonio-types';

export type MetadataFilter =
  | { [key: string]: unknown }
  | { $and: MetadataFilter[] }
  | { $or: MetadataFilter[] }
  | { $not: MetadataFilter };

export interface RememberOptions {
  memoryType?: MemoryType;
  tags?: string[];
  metadata?: Record<string, unknown>;
  ttlDays?: number;
  content?: string;
}

export interface SearchOptions {
  topK?: number;
  semantic?: boolean;
  filter?: MetadataFilter;
  alpha?: number;
}

export interface ListOptions {
  memoryType?: MemoryType;
  limit?: number;
  offset?: number;
  sortBy?: 'created_at' | 'importance_score';
}

export interface MemoryUpdateInput {
  content?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface EntityDiff {
  id: string;
  changeType: 'added' | 'removed' | 'modified';
  before?: unknown;
  after?: unknown;
}

export interface DiffResult {
  added: number;
  removed: number;
  modified: number;
  divergenceScore: number;
  entityDiffs: EntityDiff[];
}

export interface MergeConflict {
  id: string;
  reason: string;
}

export interface MergeResult {
  applied: number;
  conflicts: MergeConflict[];
  success: boolean;
}

export interface BranchEvaluation {
  divergenceScore: number;
  entitiesAdded: number;
  recommendation: 'commit' | 'discard' | 'review';
}

export interface SyncStatus {
  connected: boolean;
  pendingPush: number;
  lastSyncAt: Date | null;
}

export interface SyncOptions {
  apiKey?: string;
  intervalMs?: number;
}

export interface AgentProfile {
  preferences: Record<string, unknown>;
  facts: Record<string, unknown>;
  memoryCount: number;
  lastUpdatedAt: Date;
}

export type BatchOp =
  | { type: 'remember'; content: string; options?: RememberOptions }
  | { type: 'forget'; memoryId: string };

export type BatchResult = { ok: true; result: unknown } | { ok: false; error: ClawDBError };

export type ClawDBEventType =
  | 'memory:added'
  | 'memory:archived'
  | 'branch:created'
  | 'branch:merged'
  | 'sync:completed'
  | 'reflect:completed'
  | 'guard:denied'
  | 'session:expired';

export type ClawDBEventMap = {
  'memory:added': { memoryId: string; agentId: string; memoryType: MemoryType };
  'memory:archived': { memoryId: string; reason: string };
  'branch:created': { branchId: string; name: string };
  'branch:merged': { source: string; target: string; applied: number };
  'sync:completed': { pushed: number; pulled: number };
  'reflect:completed': { jobId: string; archived: number; promoted: number };
  'guard:denied': { action: string; resource: string; reason: string };
  'session:expired': {};
};

export type ClawDBEvent = {
  [K in ClawDBEventType]: { type: K; payload: ClawDBEventMap[K] };
}[ClawDBEventType];

export interface SessionCreateOptions {
  role?: string;
  scopes?: string[];
  taskType?: string;
}

export type SessionExecutor = <T>(fn: () => Promise<T>) => Promise<T>;

export interface Transport {
  readonly mode?: 'grpc' | 'grpc-web' | 'http';
  request<TReq, TRes>(method: RpcMethod | string, payload: TReq): Promise<TRes>;
  stream<TReq, TRes>(method: RpcMethod | string, payload: TReq): AsyncIterable<TRes>;
  close?(): Promise<void> | void;
}

export type RpcMethod =
  | 'System.Health'
  | 'Session.Create'
  | 'Session.Validate'
  | 'Session.Refresh'
  | 'Session.Revoke'
  | 'Memory.Remember'
  | 'Memory.Search'
  | 'Memory.Recall'
  | 'Memory.Forget'
  | 'Memory.Update'
  | 'Memory.List'
  | 'Memory.Score'
  | 'Branch.Fork'
  | 'Branch.List'
  | 'Branch.Get'
  | 'Branch.Diff'
  | 'Branch.Merge'
  | 'Branch.Discard'
  | 'Branch.Archive'
  | 'Sync.Push'
  | 'Sync.Pull'
  | 'Sync.Status'
  | 'Sync.Configure'
  | 'Reflect.Trigger'
  | 'Reflect.Status'
  | 'Reflect.Profile'
  | 'ClawDB.StreamEvents';

export type {
  BranchInfo,
  BranchStatus,
  ClawDBConfig,
  ClawDBSession,
  MemoryRecord,
  MemoryType,
  ReflectJob,
  SearchResult,
  SyncResult
};
