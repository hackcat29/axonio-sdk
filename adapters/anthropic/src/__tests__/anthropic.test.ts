import { describe, expect, it, vi } from 'vitest';
import { clawdbTools, handleClawDBToolCall } from '../index.js';

const EXPECTED_TOOL_NAMES = [
  'clawdb_remember',
  'clawdb_update_memory',
  'clawdb_delete_memory',
  'clawdb_list_memories',
  'clawdb_search',
  'clawdb_recall',
  'clawdb_branch_fork',
  'clawdb_branch_list',
  'clawdb_branch_get',
  'clawdb_branch_trunk',
  'clawdb_branch_diff',
  'clawdb_branch_merge',
  'clawdb_branch_discard',
  'clawdb_branch_archive',
  'clawdb_sync',
  'clawdb_sync_push',
  'clawdb_sync_pull',
  'clawdb_sync_status',
  'clawdb_reflect',
  'clawdb_reflect_facts',
  'clawdb_reflect_preferences',
  'clawdb_reflect_contradictions',
  'clawdb_reflect_resolve_contradiction',
  'clawdb_tx_begin',
  'clawdb_tx_remember',
  'clawdb_tx_commit',
  'clawdb_tx_rollback'
] as const;

function makeMockDb() {
  return {
    rememberTyped: vi.fn().mockResolvedValue('m-1')
  } as unknown as import('axonio').ClawDB;
}

describe('anthropic adapter', () => {
  it('builds required tools', () => {
    const tools = clawdbTools(makeMockDb());
    expect(tools.map((t) => t.name)).toEqual(EXPECTED_TOOL_NAMES);
  });

  it('handles remember call', async () => {
    const db = makeMockDb();
    const result = await handleClawDBToolCall(db, {
      type: 'tool_use',
      id: 'tool-1',
      name: 'clawdb_remember',
      input: { content: 'abc' }
    } as never);
    expect(result.type).toBe('tool_result');
  });
});
