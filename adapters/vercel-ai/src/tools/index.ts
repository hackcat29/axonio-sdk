import type { ClawDB } from 'axonio';
import { z } from 'zod';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CoreTool<TParams extends z.ZodTypeAny, TResult = any> = {
  description: string;
  parameters: TParams;
  execute: (params: z.infer<TParams>) => Promise<TResult>;
};

function tool<TParams extends z.ZodTypeAny, TResult>(spec: CoreTool<TParams, TResult>): CoreTool<TParams, TResult> {
  return spec;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clawdbTools(client: ClawDB): Record<string, CoreTool<any>> {
  return {
    // ── Memory ────────────────────────────────────────────────────────────
    remember: tool({
      description: 'Store important user facts, preferences, and decisions so they are available in future responses.',
      parameters: z.object({ content: z.string(), memoryType: z.string().optional(), tags: z.array(z.string()).optional() }),
      async execute({ content, memoryType, tags }) {
        return { id: await client.rememberTyped(content, { type: memoryType, tags }) };
      }
    }),
    update_memory: tool({
      description: 'Update an existing memory entry by ID.',
      parameters: z.object({ id: z.string(), content: z.string() }),
      async execute({ id, content }) { return { updated: await client.updateMemory(id, content) }; }
    }),
    delete_memory: tool({
      description: 'Delete a memory entry by ID.',
      parameters: z.object({ id: z.string() }),
      async execute({ id }) { return { deleted: await client.deleteMemory(id) }; }
    }),
    list_memories: tool({
      description: 'List recent memory entries, optionally filtered by type.',
      parameters: z.object({ limit: z.number().optional(), memoryType: z.string().optional() }),
      async execute({ limit, memoryType }) { return { memories: await client.listMemories({ limit, type: memoryType }) }; }
    }),
    search: tool({
      description: 'Search long-term memory for relevant context before you answer the user.',
      parameters: z.object({ query: z.string(), topK: z.number().min(1).max(50).optional(), semantic: z.boolean().optional() }),
      async execute({ query, topK, semantic }) {
        return { results: await client.search(query, { topK: topK ?? 5, semantic: semantic ?? true }) };
      }
    }),
    recall: tool({
      description: 'Fetch exact memory entries by ID.',
      parameters: z.object({ ids: z.array(z.string()).min(1) }),
      async execute({ ids }) { return { memories: await client.recall(ids) }; }
    }),
    // ── Branches ──────────────────────────────────────────────────────────
    branch_fork: tool({
      description: 'Fork the agent memory state into a new branch for experimentation.',
      parameters: z.object({ name: z.string(), fromBranchId: z.string().optional() }),
      async execute({ name, fromBranchId }) { return client.branch(name, fromBranchId ?? ''); }
    }),
    branch_list: tool({
      description: 'List all memory branches.',
      parameters: z.object({}),
      async execute() { return { branches: await client.listBranches() }; }
    }),
    branch_get: tool({
      description: 'Get branch details by ID.',
      parameters: z.object({ branchId: z.string() }),
      async execute({ branchId }) { return client.getBranch(branchId); }
    }),
    branch_trunk: tool({
      description: 'Get the trunk (main) branch.',
      parameters: z.object({}),
      async execute() { return client.getTrunkBranch(); }
    }),
    branch_diff: tool({
      description: 'Diff two memory branches.',
      parameters: z.object({ sourceBranchId: z.string(), targetBranchId: z.string() }),
      async execute({ sourceBranchId, targetBranchId }) { return client.diff(sourceBranchId, targetBranchId); }
    }),
    branch_merge: tool({
      description: 'Merge an experimental branch back into main memory.',
      parameters: z.object({ branchId: z.string(), targetBranchId: z.string().optional(), strategy: z.enum(['last-write', 'source-wins', 'target-wins']).optional() }),
      async execute({ branchId, targetBranchId, strategy }) { return client.merge(branchId, targetBranchId ?? '', strategy ?? 'last-write'); }
    }),
    branch_discard: tool({
      description: 'Discard a branch permanently.',
      parameters: z.object({ branchId: z.string() }),
      async execute({ branchId }) { return { discarded: await client.discardBranch(branchId) }; }
    }),
    branch_archive: tool({
      description: 'Archive a branch for future reference.',
      parameters: z.object({ branchId: z.string() }),
      async execute({ branchId }) { return { archived: await client.archiveBranch(branchId) }; }
    }),
    // ── Sync ──────────────────────────────────────────────────────────────
    sync: tool({ description: 'Full bidirectional sync.', parameters: z.object({}), async execute() { return client.sync(); } }),
    sync_push: tool({ description: 'Push local changes.', parameters: z.object({}), async execute() { return client.pushSync(); } }),
    sync_pull: tool({ description: 'Pull remote changes.', parameters: z.object({}), async execute() { return client.pullSync(); } }),
    sync_status: tool({ description: 'Get sync status.', parameters: z.object({}), async execute() { return client.syncStatus(); } }),
    // ── Reflect ───────────────────────────────────────────────────────────
    reflect: tool({ description: 'Trigger a reflection job.', parameters: z.object({}), async execute() { return client.reflect(); } }),
    reflect_facts: tool({ description: 'Get extracted facts.', parameters: z.object({ agentId: z.string() }), async execute({ agentId }) { return client.reflectGetFacts(agentId); } }),
    reflect_preferences: tool({ description: 'Get extracted preferences.', parameters: z.object({ agentId: z.string() }), async execute({ agentId }) { return client.reflectGetPreferences(agentId); } }),
    reflect_contradictions: tool({ description: 'Get contradictions.', parameters: z.object({ agentId: z.string() }), async execute({ agentId }) { return client.reflectGetContradictions(agentId); } }),
    reflect_resolve_contradiction: tool({ description: 'Resolve a contradiction.', parameters: z.object({ agentId: z.string(), contradictionId: z.string(), strategy: z.string() }), async execute({ agentId, contradictionId, strategy }) { return client.reflectResolveContradiction(agentId, contradictionId, { strategy }); } }),
    // ── Transactions ──────────────────────────────────────────────────────
    tx_begin: tool({ description: 'Begin a memory transaction.', parameters: z.object({}), async execute() { return client.beginTx(); } }),
    tx_remember: tool({ description: 'Add a memory to a transaction.', parameters: z.object({ txId: z.string(), content: z.string(), memoryType: z.string().optional() }), async execute({ txId, content, memoryType }) { return { id: memoryType ? await client.txRememberTyped(txId, content, { type: memoryType }) : await client.txRemember(txId, content) }; } }),
    tx_commit: tool({ description: 'Commit a transaction.', parameters: z.object({ txId: z.string() }), async execute({ txId }) { return { committed: await client.commitTx(txId) }; } }),
    tx_rollback: tool({ description: 'Roll back a transaction.', parameters: z.object({ txId: z.string() }), async execute({ txId }) { return { rolled_back: await client.rollbackTx(txId) }; } }),
  };
}
