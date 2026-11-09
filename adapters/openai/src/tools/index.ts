import type { ClawDB } from 'axonio';

/**
 * A tool definition compatible with the OpenAI Agents SDK (Responses API format).
 */
export interface Tool {
  type: 'function';
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

export interface ClawDBAgentToolsOptions {
  /** @deprecated All tools are now included by default. */
  enableBranching?: boolean;
}

export function createClawDBAgentTools(_client: ClawDB, _options: ClawDBAgentToolsOptions = {}): Tool[] {
  return [
    // ── Memory ────────────────────────────────────────────────────────────
    {
      type: 'function',
      name: 'remember_memory',
      description: 'Store information that should persist across future turns.',
      parameters: {
        type: 'object',
        properties: { content: { type: 'string' }, memory_type: { type: 'string', enum: ['context', 'task', 'tool_output', 'session', 'reasoning_trace', 'message', 'summary'] }, tags: { type: 'array', items: { type: 'string' } } },
        required: ['content'], additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'update_memory',
      description: 'Update the content of an existing memory entry.',
      parameters: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string' } }, required: ['id', 'content'], additionalProperties: false },
    },
    {
      type: 'function',
      name: 'delete_memory',
      description: 'Delete a memory entry by ID.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    },
    {
      type: 'function',
      name: 'list_memories',
      description: 'List recent memory entries.',
      parameters: { type: 'object', properties: { limit: { type: 'number' }, memory_type: { type: 'string' } }, required: [], additionalProperties: false },
    },
    {
      type: 'function',
      name: 'search_memory',
      description: 'Search long-term memory for details relevant to the current request.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, top_k: { type: 'number' }, semantic: { type: 'boolean' } }, required: ['query'], additionalProperties: false },
    },
    {
      type: 'function',
      name: 'recall_memory',
      description: 'Retrieve exact memory records by ID.',
      parameters: { type: 'object', properties: { memory_ids: { type: 'array', items: { type: 'string' } } }, required: ['memory_ids'], additionalProperties: false },
    },
    // ── Branches ──────────────────────────────────────────────────────────
    { type: 'function', name: 'fork_branch', description: 'Fork memory into a new branch.', parameters: { type: 'object', properties: { name: { type: 'string' }, from_branch_id: { type: 'string' } }, required: ['name'], additionalProperties: false } },
    { type: 'function', name: 'list_branches', description: 'List all branches.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
    { type: 'function', name: 'get_branch', description: 'Get a branch by ID.', parameters: { type: 'object', properties: { branch_id: { type: 'string' } }, required: ['branch_id'], additionalProperties: false } },
    { type: 'function', name: 'get_trunk_branch', description: 'Get the trunk branch.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
    { type: 'function', name: 'diff_branches', description: 'Diff two branches.', parameters: { type: 'object', properties: { source_branch_id: { type: 'string' }, target_branch_id: { type: 'string' } }, required: ['source_branch_id', 'target_branch_id'], additionalProperties: false } },
    { type: 'function', name: 'merge_branch', description: 'Merge a branch.', parameters: { type: 'object', properties: { branch_id: { type: 'string' }, target_branch_id: { type: 'string' }, strategy: { type: 'string', enum: ['last-write', 'source-wins', 'target-wins'] } }, required: ['branch_id'], additionalProperties: false } },
    { type: 'function', name: 'discard_branch', description: 'Discard a branch.', parameters: { type: 'object', properties: { branch_id: { type: 'string' } }, required: ['branch_id'], additionalProperties: false } },
    { type: 'function', name: 'archive_branch', description: 'Archive a branch.', parameters: { type: 'object', properties: { branch_id: { type: 'string' } }, required: ['branch_id'], additionalProperties: false } },
    // ── Sync ──────────────────────────────────────────────────────────────
    { type: 'function', name: 'sync', description: 'Bidirectional sync.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
    { type: 'function', name: 'sync_push', description: 'Push local changes.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
    { type: 'function', name: 'sync_pull', description: 'Pull remote changes.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
    { type: 'function', name: 'sync_status', description: 'Get sync status.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
    // ── Reflect ───────────────────────────────────────────────────────────
    { type: 'function', name: 'reflect', description: 'Trigger reflection.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
    { type: 'function', name: 'reflect_facts', description: 'Get facts.', parameters: { type: 'object', properties: { agent_id: { type: 'string' } }, required: ['agent_id'], additionalProperties: false } },
    { type: 'function', name: 'reflect_preferences', description: 'Get preferences.', parameters: { type: 'object', properties: { agent_id: { type: 'string' } }, required: ['agent_id'], additionalProperties: false } },
    { type: 'function', name: 'reflect_contradictions', description: 'Get contradictions.', parameters: { type: 'object', properties: { agent_id: { type: 'string' } }, required: ['agent_id'], additionalProperties: false } },
    { type: 'function', name: 'reflect_resolve', description: 'Resolve a contradiction.', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, contradiction_id: { type: 'string' }, strategy: { type: 'string' } }, required: ['agent_id', 'contradiction_id', 'strategy'], additionalProperties: false } },
    // ── Transactions ──────────────────────────────────────────────────────
    { type: 'function', name: 'tx_begin', description: 'Begin transaction.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
    { type: 'function', name: 'tx_remember', description: 'Add memory to transaction.', parameters: { type: 'object', properties: { tx_id: { type: 'string' }, content: { type: 'string' }, memory_type: { type: 'string' } }, required: ['tx_id', 'content'], additionalProperties: false } },
    { type: 'function', name: 'tx_commit', description: 'Commit transaction.', parameters: { type: 'object', properties: { tx_id: { type: 'string' } }, required: ['tx_id'], additionalProperties: false } },
    { type: 'function', name: 'tx_rollback', description: 'Roll back transaction.', parameters: { type: 'object', properties: { tx_id: { type: 'string' } }, required: ['tx_id'], additionalProperties: false } },
  ];
}
