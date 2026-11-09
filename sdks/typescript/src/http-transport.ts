/**
 * HTTP transport for ClawDB endpoints that are URLs with a path, such as the
 * hosted Axonio gateway (https://api.axonio.xyz/api/v1/gateway).
 *
 * The client's public methods are written against gRPC method names and
 * gRPC-shaped responses. This module maps each method to the server's HTTP
 * API (/v1/...) and reshapes the JSON reply into the same fields, so every
 * method works unchanged over either transport. Failures are raised as
 * gRPC-style errors ({ code, message, metadata }) so the client's existing
 * error classes and retry rules apply.
 */
import * as grpc from '@grpc/grpc-js';

/** The hosted cloud. Requests carry the API key; the gateway routes them to
 * the workspace's own ClawDB instance. */
export const CLOUD_ENDPOINT = 'https://api.axonio.xyz/api/v1/gateway';

/** Hosts that used to be the default cloud endpoint but no longer resolve. */
const LEGACY_CLOUD_HOSTS = new Set(['cloud.clawdb.dev']);

/** Rewrites a retired cloud URL to the current one; anything else is kept. */
export function normalizeCloudEndpoint(endpoint: string): string {
  try {
    return LEGACY_CLOUD_HOSTS.has(new URL(endpoint).hostname) ? CLOUD_ENDPOINT : endpoint;
  } catch {
    return endpoint;
  }
}

/** gRPC endpoints are host:port; an http(s) URL with a path is the HTTP API. */
export function isHttpEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.pathname.replace(/\/+$/u, '') !== '';
  } catch {
    return false;
  }
}

export interface HttpCallContext {
  baseUrl: string;
  apiKey?: string;
  sessionToken?: string;
  agentId: string;
  workspaceId?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

type Json = Record<string, unknown>;
type Route = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Reshapes the HTTP reply (null for 204) into the gRPC response fields. */
  reply?: (json: unknown) => Json;
};

const enc = encodeURIComponent;
const str = (value: unknown): string => (value === undefined || value === null ? '' : String(value));
const asObject = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const parseJsonField = (value: unknown): unknown => {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};
const wrapJson = (json: unknown): Json => ({ json: JSON.stringify(json ?? {}) });
const branchReply = (json: unknown): Json => {
  const b = asObject(json);
  return { branch: { branch_id: str(b.id ?? b.branch_id), name: str(b.name), branch_json: JSON.stringify(b) } };
};

/** One entry per gRPC method the client uses. */
function route(method: string, p: Json): Route {
  switch (method) {
    case 'Health':
      return { method: 'GET', path: '/v1/health' };
    case 'CreateSession':
      return {
        method: 'POST',
        path: '/v1/sessions',
        body: { agent_id: p.agent_id, role: p.role, scopes: p.scopes, ttl_secs: p.ttl_secs },
      };
    case 'ValidateSession':
      return { method: 'GET', path: '/v1/sessions/me' };
    case 'RevokeSession':
      return { method: 'DELETE', path: `/v1/sessions/${enc(str(p.session_id))}`, reply: () => ({ revoked: true }) };
    case 'ActiveSessionCount':
      return { method: 'GET', path: '/v1/sessions/active/count' };

    case 'Remember':
      return { method: 'POST', path: '/v1/memories', body: { content: p.content } };
    case 'RememberTyped':
      return {
        method: 'POST',
        path: '/v1/memories',
        body: { content: p.content, type: p.type, tags: p.tags, metadata: parseJsonField(p.metadata_json) ?? {} },
      };
    case 'RecallOne':
      return { method: 'GET', path: `/v1/memories/${enc(str(p.memory_id))}` };
    case 'UpdateMemory':
      return { method: 'PATCH', path: `/v1/memories/${enc(str(p.memory_id))}`, body: { content: p.content } };
    case 'Search':
      return {
        method: 'GET',
        path: '/v1/memories/search',
        query: { q: str(p.query), top_k: Number(p.top_k ?? 10), semantic: Boolean(p.semantic) },
        reply: (json) => ({ hits: asArray(json) }),
      };
    case 'ListMemories':
      return {
        method: 'GET',
        path: '/v1/memories',
        query: { type: str(p.type) || undefined, limit: Number(p.limit ?? 50) },
        reply: (json) => ({ memories: asArray(json) }),
      };
    case 'DeleteMemory':
      return { method: 'DELETE', path: `/v1/memories/${enc(str(p.memory_id))}`, reply: () => ({ deleted: true }) };

    case 'Branch':
      return {
        method: 'POST',
        path: '/v1/branches',
        body: { name: p.name, ...(str(p.from) ? { from: p.from } : {}) },
        reply: (json) => {
          const b = asObject(json);
          return { branch_id: str(b.branch_id ?? b.id), name: str(b.name) };
        },
      };
    case 'GetBranch':
      return { method: 'GET', path: `/v1/branches/${enc(str(p.branch_id))}`, reply: branchReply };
    case 'GetBranchByName':
      return { method: 'GET', path: `/v1/branches/by-name/${enc(str(p.name))}`, reply: branchReply };
    case 'GetTrunkBranch':
      return { method: 'GET', path: '/v1/branches/trunk', reply: branchReply };
    case 'ListBranches':
      return {
        method: 'GET',
        path: '/v1/branches',
        reply: (json) => ({ branches: asArray(json).map((b) => branchReply(b).branch) }),
      };
    case 'DiscardBranch':
      return { method: 'DELETE', path: `/v1/branches/${enc(str(p.branch_id))}`, reply: () => ({ discarded: true }) };
    case 'ArchiveBranch':
      return { method: 'POST', path: `/v1/branches/${enc(str(p.branch_id))}/archive`, reply: () => ({ archived: true }) };
    case 'Merge':
      return {
        method: 'POST',
        path: `/v1/branches/${enc(str(p.source))}/merge`,
        body: { target: str(p.target), ...(str(p.strategy) ? { strategy: p.strategy } : {}) },
        reply: (json) => {
          const r = asObject(json);
          const conflicts = asArray(r.conflicts);
          return {
            success: r.success ?? true,
            applied: r.applied ?? 0,
            skipped: r.skipped ?? 0,
            conflicts: Array.isArray(r.conflicts) ? conflicts.length : Number(r.conflicts ?? 0),
            duration_ms: r.duration_ms ?? 0,
            conflicts_json: JSON.stringify(conflicts),
          };
        },
      };
    case 'Diff':
      return {
        method: 'GET',
        path: `/v1/branches/${enc(str(p.branch_id))}/diff`,
        query: { target: str(p.target) },
        reply: (json) => {
          const d = asObject(json);
          const stats = asObject(d.stats);
          return {
            added: stats.added ?? d.added ?? 0,
            removed: stats.removed ?? d.removed ?? 0,
            modified: stats.modified ?? d.modified ?? 0,
            unchanged: stats.unchanged ?? d.unchanged ?? 0,
            divergence_score: d.divergence_score ?? 0,
            diff_json: JSON.stringify(d),
          };
        },
      };

    case 'Sync':
      return { method: 'POST', path: '/v1/sync' };
    case 'PushSync':
      return { method: 'POST', path: '/v1/sync/push', reply: (json) => ({ summary_json: JSON.stringify(json ?? {}) }) };
    case 'PullSync':
      return { method: 'POST', path: '/v1/sync/pull', reply: (json) => ({ summary_json: JSON.stringify(json ?? {}) }) };
    case 'ReconcileSync':
      return { method: 'POST', path: '/v1/sync/reconcile', reply: (json) => ({ summary_json: JSON.stringify(json ?? {}) }) };
    case 'SyncStatus':
      return { method: 'GET', path: '/v1/sync/status', reply: (json) => ({ status_json: JSON.stringify(json ?? {}) }) };

    case 'Reflect':
      return { method: 'POST', path: '/v1/reflect' };
    case 'ReflectGetFacts':
      return { method: 'GET', path: `/v1/reflect/facts/${enc(str(p.agent_id))}`, reply: wrapJson };
    case 'ReflectListJobs':
      return {
        method: 'GET',
        path: '/v1/reflect/jobs',
        query: {
          agent_id: str(p.agent_id) || undefined,
          status: str(p.status) || undefined,
          limit: p.limit === undefined ? undefined : Number(p.limit),
          offset: p.offset === undefined ? undefined : Number(p.offset),
        },
        reply: wrapJson,
      };
    case 'ReflectGetJob':
      return { method: 'GET', path: `/v1/reflect/jobs/${enc(str(p.job_id))}`, reply: wrapJson };
    case 'ReflectGetPreferences':
      return { method: 'GET', path: `/v1/reflect/preferences/${enc(str(p.agent_id))}`, reply: wrapJson };
    case 'ReflectGetContradictions':
      return { method: 'GET', path: `/v1/reflect/contradictions/${enc(str(p.agent_id))}`, reply: wrapJson };
    case 'ReflectResolveContradiction':
      return {
        method: 'POST',
        path: `/v1/reflect/contradictions/${enc(str(p.agent_id))}/${enc(str(p.contradiction_id))}/resolve`,
        body: { strategy: str(p.strategy), merged_value: parseJsonField(p.merged_value_json) },
        reply: wrapJson,
      };

    case 'BeginTx':
      return { method: 'POST', path: '/v1/tx' };
    case 'TxRemember':
      return { method: 'POST', path: `/v1/tx/${enc(str(p.tx_id))}/memories`, body: { content: p.content } };
    case 'TxRememberTyped':
      return {
        method: 'POST',
        path: `/v1/tx/${enc(str(p.tx_id))}/memories/typed`,
        body: { content: p.content, type: p.type, tags: p.tags, metadata: parseJsonField(p.metadata_json) ?? {} },
      };
    case 'CommitTx':
      return { method: 'POST', path: `/v1/tx/${enc(str(p.tx_id))}/commit` };
    case 'RollbackTx':
      return { method: 'POST', path: `/v1/tx/${enc(str(p.tx_id))}/rollback` };
    default:
      throw rpcError(grpc.status.UNIMPLEMENTED, `${method} is not available over the HTTP transport`);
  }
}

/** HTTP status → gRPC status, so the client's retry rules keep working. */
function grpcStatusFor(status: number): grpc.status {
  if (status === 400 || status === 422) return grpc.status.INVALID_ARGUMENT;
  if (status === 401) return grpc.status.UNAUTHENTICATED;
  if (status === 402 || status === 403) return grpc.status.PERMISSION_DENIED;
  if (status === 404) return grpc.status.NOT_FOUND;
  if (status === 408 || status === 504) return grpc.status.DEADLINE_EXCEEDED;
  if (status === 409) return grpc.status.ALREADY_EXISTS;
  if (status === 429) return grpc.status.RESOURCE_EXHAUSTED;
  if (status === 501) return grpc.status.UNIMPLEMENTED;
  if (status === 502 || status === 503) return grpc.status.UNAVAILABLE;
  if (status >= 500) return grpc.status.INTERNAL;
  return grpc.status.UNKNOWN;
}

export type RpcError = Error & {
  code: grpc.status;
  metadata: grpc.Metadata;
  /** Set when the server rejected the session token itself (expired,
   * revoked, missing), as opposed to the API key or the permissions. */
  sessionRejected?: boolean;
};

function rpcError(code: grpc.status, message: string, extra: { requestId?: string; retryAfterMs?: number; sessionRejected?: boolean } = {}): RpcError {
  const metadata = new grpc.Metadata();
  if (extra.requestId) metadata.set('x-request-id', extra.requestId);
  if (extra.retryAfterMs !== undefined) metadata.set('retry-after-ms', String(extra.retryAfterMs));
  return Object.assign(new Error(message), { code, metadata, sessionRejected: extra.sessionRejected });
}

/** Aborts when either the caller's signal or the timeout fires (Node 18 has
 * no AbortSignal.any). */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = (): void => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

export async function httpUnary(method: string, payload: Json, ctx: HttpCallContext): Promise<Json> {
  // The HTTP API fetches one memory per request.
  if (method === 'Recall') {
    const memories = [];
    for (const id of asArray(payload.memory_ids)) {
      memories.push(await httpUnary('RecallOne', { memory_id: id }, ctx));
    }
    return { memories };
  }
  const r = route(method, payload);
  const url = new URL(`${ctx.baseUrl.replace(/\/+$/u, '')}${r.path}`);
  for (const [key, value] of Object.entries(r.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { accept: 'application/json', 'x-agent-id': ctx.agentId };
  if (ctx.apiKey) headers.authorization = `Bearer ${ctx.apiKey}`;
  // x-claw-session, not Authorization: the gateway replaces Authorization
  // (the API key) before forwarding to the instance.
  if (ctx.sessionToken && method !== 'CreateSession') headers['x-claw-session'] = ctx.sessionToken;
  if (ctx.workspaceId) headers['x-workspace-id'] = ctx.workspaceId;
  if (r.body !== undefined) headers['content-type'] = 'application/json';

  const abort = withTimeout(ctx.signal, ctx.timeoutMs);
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, {
      method: r.method,
      headers,
      body: r.body === undefined ? undefined : JSON.stringify(r.body),
      signal: abort.signal,
    });
    text = await response.text();
  } catch (error) {
    if (abort.timedOut()) throw rpcError(grpc.status.DEADLINE_EXCEEDED, `Request timed out after ${ctx.timeoutMs}ms`);
    if (ctx.signal?.aborted) throw rpcError(grpc.status.CANCELLED, 'Request cancelled');
    throw rpcError(grpc.status.UNAVAILABLE, `Could not reach ${url.origin}: ${(error as Error).message}`);
  } finally {
    abort.done();
  }

  const requestId = response.headers.get('x-request-id') ?? undefined;
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text };
    }
  }

  if (!response.ok) {
    const body = asObject(json);
    const reason = str(body.error ?? body.message) || response.statusText || `HTTP ${response.status}`;
    const detail = str(body.detail ?? (body.required ? `requires ${str(body.required)}` : ''));
    const retryAfter = Number(response.headers.get('retry-after'));
    throw rpcError(grpcStatusFor(response.status), detail ? `${reason}: ${detail}` : reason, {
      requestId,
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
      // The instance answers a bad session with {"error":"unauthorized"};
      // the gateway answers a bad API key with "invalid_api_key".
      sessionRejected: response.status === 401 && body.error === 'unauthorized',
    });
  }

  const reshaped = r.reply ? r.reply(json) : asObject(json);
  return requestId ? { request_id: requestId, ...reshaped } : reshaped;
}
