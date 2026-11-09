import { describe, expect, it, vi } from 'vitest';

import { createClawDBAgentTools } from '../tools/index.js';
import { ClawDBToolHandler } from '../handlers/index.js';
import { withClawDBMemory } from '../middleware/index.js';

const EXPECTED_TOOL_NAMES = [
  'remember_memory',
  'update_memory',
  'delete_memory',
  'list_memories',
  'search_memory',
  'recall_memory',
  'fork_branch',
  'list_branches',
  'get_branch',
  'get_trunk_branch',
  'diff_branches',
  'merge_branch',
  'discard_branch',
  'archive_branch',
  'sync',
  'sync_push',
  'sync_pull',
  'sync_status',
  'reflect',
  'reflect_facts',
  'reflect_preferences',
  'reflect_contradictions',
  'reflect_resolve',
  'tx_begin',
  'tx_remember',
  'tx_commit',
  'tx_rollback'
] as const;

function makeMockDb() {
  return {
    rememberTyped: vi.fn().mockResolvedValue('mem-id-1'),
    search: vi.fn().mockResolvedValue([
      {
        id: 'mem-id-1',
        content: 'project preference',
        score: 0.9,
        memoryType: 'message',
        tags: [],
        metadata: {},
        createdAt: new Date()
      }
    ]),
    recall: vi.fn().mockResolvedValue([]),
    branch: vi.fn().mockResolvedValue({ branchId: 'br-1', name: 'branch' }),
    merge: vi.fn().mockResolvedValue({ success: true, applied: 1, conflicts: 0 })
  } as unknown as import('axonio').ClawDB;
}

describe('openai adapter', () => {
  it('creates required OpenAI tools', () => {
    const tools = createClawDBAgentTools(makeMockDb(), { enableBranching: true });
    expect(tools.map((t) => t.name)).toEqual(EXPECTED_TOOL_NAMES);
  });

  it('handler dispatches remember tool', async () => {
    const handler = new ClawDBToolHandler(makeMockDb());
    const out = JSON.parse(await handler.handle('remember_memory', { content: 'hello' }));
    expect(out.memory_id).toBe('mem-id-1');
  });

  it('wrapper injects memory and stores turn pair', async () => {
    const db = makeMockDb();
    const agent = {
      instructions: 'base system prompt',
      tools: [],
      run: vi.fn().mockResolvedValue('assistant answer')
    };

    const wrapped = withClawDBMemory(agent, db);
    const result = await wrapped.run?.('user message');

    expect(result).toBe('assistant answer');
    expect(db.search).toHaveBeenCalled();
    expect(db.rememberTyped).toHaveBeenCalledTimes(2);
  });
});
