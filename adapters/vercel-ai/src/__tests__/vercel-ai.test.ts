import { describe, expect, it, vi } from 'vitest';

import { clawdbTools } from '../tools/index.js';
import { clawdbMiddleware } from '../middleware/index.js';

const EXPECTED_TOOL_NAMES = [
  'remember',
  'update_memory',
  'delete_memory',
  'list_memories',
  'search',
  'recall',
  'branch_fork',
  'branch_list',
  'branch_get',
  'branch_trunk',
  'branch_diff',
  'branch_merge',
  'branch_discard',
  'branch_archive',
  'sync',
  'sync_push',
  'sync_pull',
  'sync_status',
  'reflect',
  'reflect_facts',
  'reflect_preferences',
  'reflect_contradictions',
  'reflect_resolve_contradiction',
  'tx_begin',
  'tx_remember',
  'tx_commit',
  'tx_rollback'
] as const;

function makeMockDb() {
  return {
    rememberTyped: vi.fn().mockResolvedValue('m-1'),
    search: vi.fn().mockResolvedValue([
      {
        id: 'm-1',
        content: 'stored info',
        score: 0.9,
        memoryType: 'message',
        tags: ['a'],
        metadata: {},
        createdAt: new Date()
      }
    ]),
    recall: vi.fn().mockResolvedValue([{ id: 'm-1' }])
  } as unknown as import('axonio').ClawDB;
}

describe('vercel ai adapter', () => {
  it('returns remember/search/recall tools', () => {
    const tools = clawdbTools(makeMockDb());
    expect(Object.keys(tools)).toEqual(EXPECTED_TOOL_NAMES);
  });

  it('middleware injects memory context into params', async () => {
    const db = makeMockDb();
    const middleware = clawdbMiddleware(db);

    const out = await middleware.transformParams?.({
      messages: [{ role: 'user', content: 'hello' }]
    });

    const messages = out?.messages as Array<Record<string, unknown>>;
    expect(messages[0]?.role).toBe('system');
  });

  it('middleware saves user and assistant text after generate', async () => {
    const db = makeMockDb();
    const middleware = clawdbMiddleware(db);

    const result = await middleware.wrapGenerate?.({
      doGenerate: async () => ({ text: 'assistant says hi' }),
      params: { messages: [{ role: 'user', content: 'hello' }] }
    });

    expect((result as { text: string }).text).toBe('assistant says hi');
    expect(db.rememberTyped).toHaveBeenCalledTimes(2);
  });
});
