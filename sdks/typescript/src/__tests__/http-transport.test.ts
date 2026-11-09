import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClawDB, ClawDBAuthError, ClawDBNotFoundError } from '../index';
import { CLOUD_ENDPOINT, isHttpEndpoint, normalizeCloudEndpoint } from '../http-transport';

type Call = { url: URL; method: string; headers: Record<string, string>; body?: unknown };

/** A fetch stand-in for the gateway + instance: records calls, answers by route. */
function fakeServer(handler: (call: Call) => { status?: number; json?: unknown } | undefined) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const call: Call = {
      url: new URL(String(input)),
      method: String(init.method ?? 'GET'),
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    if (call.url.pathname.endsWith('/v1/sessions') && call.method === 'POST') {
      return new Response(
        JSON.stringify({ token: `tok-${calls.length}`, id: 's1', expires_at: new Date(Date.now() + 3_600_000).toISOString() }),
        { status: 200 }
      );
    }
    const reply = handler(call) ?? { status: 404, json: { error: 'not_found' } };
    return new Response(reply.json === undefined ? null : JSON.stringify(reply.json), { status: reply.status ?? 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

describe('HTTP transport', () => {
  beforeEach(() => {
    delete process.env.CLAWDB_URL;
    delete process.env.CLAWDB_API_KEY;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('picks the transport from the endpoint shape', () => {
    expect(isHttpEndpoint(CLOUD_ENDPOINT)).toBe(true);
    expect(isHttpEndpoint('http://127.0.0.1:50050')).toBe(false);
    expect(isHttpEndpoint('https://db.example.com/')).toBe(false);
    expect(new ClawDB({ endpoint: CLOUD_ENDPOINT, apiKey: 'k' }).transport).toBe('http');
    expect(new ClawDB({ endpoint: 'http://db.example:50050', __skipLocalBootstrap: true }).transport).toBe('grpc');
  });

  it('maps the retired cloud host to the current gateway', () => {
    expect(normalizeCloudEndpoint('https://cloud.clawdb.dev')).toBe(CLOUD_ENDPOINT);
    expect(new ClawDB({ endpoint: 'https://cloud.clawdb.dev', apiKey: 'k' }).endpoint).toBe(CLOUD_ENDPOINT);
    expect(normalizeCloudEndpoint('https://db.example.com/api')).toBe('https://db.example.com/api');
  });

  it('fromEnv with only an API key targets the cloud', () => {
    process.env.CLAWDB_API_KEY = 'ck_live_x';
    const db = ClawDB.fromEnv();
    expect(db.endpoint).toBe(CLOUD_ENDPOINT);
    expect(db.transport).toBe('http');
    expect(db.apiKey).toBe('ck_live_x');
  });

  it('opens a one-hour session, then sends the API key and the session header', async () => {
    const calls = fakeServer((c) => (c.url.pathname.endsWith('/v1/memories') ? { json: { memory_id: 'm1' } } : undefined));
    const db = new ClawDB({ endpoint: CLOUD_ENDPOINT, apiKey: 'ck_live_x', agentId: 'my-agent' });

    await expect(db.rememberTyped('hello', { type: 'context', tags: ['t'], metadata: { a: 1 } })).resolves.toBe('m1');

    const [session, remember] = calls;
    expect(session.url.toString()).toBe(`${CLOUD_ENDPOINT}/v1/sessions`);
    expect(session.body).toMatchObject({ ttl_secs: 3600, scopes: ['*'] });
    expect((session.body as { agent_id: string }).agent_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(remember.headers.authorization).toBe('Bearer ck_live_x');
    expect(remember.headers['x-claw-session']).toBe('tok-1');
    expect(remember.body).toEqual({ content: 'hello', type: 'context', tags: ['t'], metadata: { a: 1 } });
  });

  it('reshapes search, branches, diff and merge replies', async () => {
    fakeServer((c) => {
      const p = c.url.pathname;
      if (p.endsWith('/v1/memories/search')) {
        expect(c.url.searchParams.get('q')).toBe('north-dock');
        return { json: [{ id: 'm1', score: 1, content: 'north dock', memory_type: 'context', tags: [], metadata: {} }] };
      }
      if (p.endsWith('/v1/branches')) return { json: [{ id: 'b1', name: 'trunk' }] };
      if (p.endsWith('/diff')) return { json: { stats: { added: 2, removed: 0, modified: 1, unchanged: 3 }, divergence_score: 0.5 } };
      if (p.endsWith('/merge')) return { json: { success: true, applied: 2, skipped: 0, conflicts: [{ entity_id: 'x' }], duration_ms: 4 } };
      return undefined;
    });
    const db = new ClawDB({ endpoint: CLOUD_ENDPOINT, apiKey: 'k' });

    const hits = await db.search('north-dock', { topK: 3 });
    expect(hits[0]).toMatchObject({ id: 'm1', score: 1, memoryType: 'context' });
    expect(await db.listBranches()).toEqual([expect.objectContaining({ branchId: 'b1', name: 'trunk' })]);
    expect(await db.diff('b2', 'trunk')).toMatchObject({ added: 2, modified: 1, unchanged: 3, divergenceScore: 0.5 });
    const merged = await db.merge('b2', 'trunk');
    expect(merged).toMatchObject({ success: true, applied: 2, conflicts: 1 });
    expect(JSON.parse(merged.conflictsJson ?? '[]')).toEqual([{ entity_id: 'x' }]);
  });

  it('renews a rejected session once and retries', async () => {
    let first = true;
    const calls = fakeServer((c) => {
      if (!c.url.pathname.endsWith('/v1/memories')) return undefined;
      if (first) {
        first = false;
        return { status: 401, json: { error: 'unauthorized' } };
      }
      return { json: [] };
    });
    const db = new ClawDB({ endpoint: CLOUD_ENDPOINT, apiKey: 'k', maxRetries: 1 });

    await expect(db.listMemories()).resolves.toEqual([]);
    const sessions = calls.filter((c) => c.url.pathname.endsWith('/v1/sessions'));
    expect(sessions).toHaveLength(2);
    expect(calls.at(-1)?.headers['x-claw-session']).toBe('tok-3');
  });

  it('does not loop on a bad API key', async () => {
    // The gateway rejects the key before any session exists.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_api_key' }), { status: 401 }))
    );
    const db = new ClawDB({ endpoint: CLOUD_ENDPOINT, apiKey: 'wrong' });
    await expect(db.listMemories()).rejects.toBeInstanceOf(ClawDBAuthError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('maps 404 to ClawDBNotFoundError and loops Recall over single GETs', async () => {
    const calls = fakeServer((c) => {
      if (c.url.pathname.endsWith('/v1/memories/a')) return { json: { id: 'a', content: 'A', memory_type: 'context', tags: [] } };
      return undefined;
    });
    const db = new ClawDB({ endpoint: CLOUD_ENDPOINT, apiKey: 'k' });

    await expect(db.recall(['a'])).resolves.toEqual([{ id: 'a', content: 'A', memoryType: 'context', tags: [] }]);
    await expect(db.deleteMemory('missing')).rejects.toBeInstanceOf(ClawDBNotFoundError);
    expect(calls.filter((c) => c.url.pathname.includes('/v1/memories/')).map((c) => c.method)).toEqual(['GET', 'DELETE']);
  });
});
