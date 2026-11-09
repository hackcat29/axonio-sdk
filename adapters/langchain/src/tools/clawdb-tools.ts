import { z } from 'zod';
import type { ClawDB } from 'axonio';
import { DynamicStructuredTool } from '@langchain/core/tools';

/**
 * Creates an array of LangChain StructuredTool-compatible objects backed by ClawDB.
 *
 * Compatible with LangChain ^0.2 / @langchain/core ^0.2.
 * Uses duck-typing so @langchain/core is a peer dep only.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createClawDBTools(client: ClawDB): DynamicStructuredTool<any>[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: DynamicStructuredTool<any>[] = [
    new DynamicStructuredTool({
      name: 'clawdb_remember',
      description: 'Store important information that should persist across conversations. Use this for user preferences, decisions, facts, or constraints you may need later.',
      schema: z.object({
        content: z.string().describe('The content to remember'),
        memory_type: z
          .enum(['message', 'context', 'task', 'tool_output', 'session', 'summary'])
          .optional()
          .describe('Memory type'),
        tags: z.array(z.string()).optional().describe('Tags to attach'),
      }),
      func: async ({ content, memory_type, tags }: { content: string; memory_type?: string; tags?: string[] }) => {
        const id = await client.rememberTyped(content, {
          type: memory_type,
          tags,
        });
        return JSON.stringify({ memory_id: id, status: 'stored' });
      },
    }),
    new DynamicStructuredTool({
      name: 'clawdb_search',
      description: 'Search long-term memory for facts relevant to the current user request. Prefer this before asking clarifying questions when past context can help.',
      schema: z.object({
        query: z.string().describe('Search query'),
        top_k: z.number().min(1).max(50).optional().describe('Max results to return'),
      }),
      func: async ({ query, top_k }: { query: string; top_k?: number }) => {
        const results = await client.search(query, { topK: top_k ?? 5, semantic: true });
        return results
          .map((r, index) => `${index + 1}. [${r.score.toFixed(3)}] ${r.content} (id=${r.id})`)
          .join('\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'clawdb_recall',
      description: 'Load one or more exact memory entries by ID when you already know which saved items you need to reference.',
      schema: z.object({
        ids: z.array(z.string()).min(1).max(50).describe('Memory IDs to retrieve'),
      }),
      func: async ({ ids }: { ids: string[] }) => {
        const results = await client.recall(ids);
        return JSON.stringify({
          memories: results.map((r) => ({
            id: r.id,
            content: r.content,
            memory_type: r.memoryType,
            tags: r.tags,
          })),
        });
      },
    }),
    new DynamicStructuredTool({
      name: 'clawdb_update_memory',
      description: 'Update the content of an existing memory entry.',
      schema: z.object({ id: z.string(), content: z.string() }),
      func: async ({ id, content }: { id: string; content: string }) =>
        JSON.stringify({ updated: await client.updateMemory(id, content) }),
    }),
    new DynamicStructuredTool({
      name: 'clawdb_delete_memory',
      description: 'Delete a memory entry by ID.',
      schema: z.object({ id: z.string() }),
      func: async ({ id }: { id: string }) =>
        JSON.stringify({ deleted: await client.deleteMemory(id) }),
    }),
    new DynamicStructuredTool({
      name: 'clawdb_list_memories',
      description: 'List recent memory entries, optionally filtered by type.',
      schema: z.object({ limit: z.number().optional(), memory_type: z.string().optional() }),
      func: async ({ limit, memory_type }: { limit?: number; memory_type?: string }) =>
        JSON.stringify({ memories: await client.listMemories({ limit, type: memory_type }) }),
    }),
    // ── Branches ──────────────────────────────────────────────────────────
    new DynamicStructuredTool({
      name: 'clawdb_branch_fork',
      description: 'Fork the agent memory into a new branch for experimentation.',
      schema: z.object({ name: z.string(), from_branch_id: z.string().optional() }),
      func: async ({ name, from_branch_id }: { name: string; from_branch_id?: string }) =>
        JSON.stringify(await client.branch(name, from_branch_id ?? '')),
    }),
    new DynamicStructuredTool({
      name: 'clawdb_branch_list',
      description: 'List all memory branches.',
      schema: z.object({}),
      func: async () => JSON.stringify({ branches: await client.listBranches() }),
    }),
    new DynamicStructuredTool({
      name: 'clawdb_branch_get',
      description: 'Get a branch by ID.',
      schema: z.object({ branch_id: z.string() }),
      func: async ({ branch_id }: { branch_id: string }) => JSON.stringify(await client.getBranch(branch_id)),
    }),
    new DynamicStructuredTool({
      name: 'clawdb_branch_trunk',
      description: 'Get the trunk (main) branch.',
      schema: z.object({}),
      func: async () => JSON.stringify(await client.getTrunkBranch()),
    }),
    new DynamicStructuredTool({
      name: 'clawdb_branch_diff',
      description: 'Diff two branches.',
      schema: z.object({ source_branch_id: z.string(), target_branch_id: z.string() }),
      func: async ({ source_branch_id, target_branch_id }: { source_branch_id: string; target_branch_id: string }) =>
        JSON.stringify(await client.diff(source_branch_id, target_branch_id)),
    }),
    new DynamicStructuredTool({
      name: 'clawdb_branch_merge',
      description: 'Merge a branch back into main memory.',
      schema: z.object({ branch_id: z.string(), target_branch_id: z.string().optional(), strategy: z.string().optional() }),
      func: async ({ branch_id, target_branch_id, strategy }: { branch_id: string; target_branch_id?: string; strategy?: string }) =>
        JSON.stringify(await client.merge(branch_id, target_branch_id ?? '', strategy ?? 'last-write')),
    }),
    new DynamicStructuredTool({
      name: 'clawdb_branch_discard',
      description: 'Discard a branch permanently.',
      schema: z.object({ branch_id: z.string() }),
      func: async ({ branch_id }: { branch_id: string }) => JSON.stringify({ discarded: await client.discardBranch(branch_id) }),
    }),
    new DynamicStructuredTool({
      name: 'clawdb_branch_archive',
      description: 'Archive a branch.',
      schema: z.object({ branch_id: z.string() }),
      func: async ({ branch_id }: { branch_id: string }) => JSON.stringify({ archived: await client.archiveBranch(branch_id) }),
    }),
    // ── Sync ──────────────────────────────────────────────────────────────
    new DynamicStructuredTool({ name: 'clawdb_sync', description: 'Full bidirectional sync.', schema: z.object({}), func: async () => JSON.stringify(await client.sync()) }),
    new DynamicStructuredTool({ name: 'clawdb_sync_push', description: 'Push local changes.', schema: z.object({}), func: async () => JSON.stringify(await client.pushSync()) }),
    new DynamicStructuredTool({ name: 'clawdb_sync_pull', description: 'Pull remote changes.', schema: z.object({}), func: async () => JSON.stringify(await client.pullSync()) }),
    new DynamicStructuredTool({ name: 'clawdb_sync_status', description: 'Get sync status.', schema: z.object({}), func: async () => JSON.stringify(await client.syncStatus()) }),
    // ── Reflect ───────────────────────────────────────────────────────────
    new DynamicStructuredTool({ name: 'clawdb_reflect', description: 'Trigger a reflection job.', schema: z.object({}), func: async () => JSON.stringify(await client.reflect()) }),
    new DynamicStructuredTool({ name: 'clawdb_reflect_facts', description: 'Get extracted facts.', schema: z.object({ agent_id: z.string() }), func: async ({ agent_id }: { agent_id: string }) => JSON.stringify(await client.reflectGetFacts(agent_id)) }),
    new DynamicStructuredTool({ name: 'clawdb_reflect_preferences', description: 'Get extracted preferences.', schema: z.object({ agent_id: z.string() }), func: async ({ agent_id }: { agent_id: string }) => JSON.stringify(await client.reflectGetPreferences(agent_id)) }),
    new DynamicStructuredTool({ name: 'clawdb_reflect_contradictions', description: 'Get contradictions.', schema: z.object({ agent_id: z.string() }), func: async ({ agent_id }: { agent_id: string }) => JSON.stringify(await client.reflectGetContradictions(agent_id)) }),
    new DynamicStructuredTool({ name: 'clawdb_reflect_resolve', description: 'Resolve a contradiction.', schema: z.object({ agent_id: z.string(), contradiction_id: z.string(), strategy: z.string() }), func: async ({ agent_id, contradiction_id, strategy }: { agent_id: string; contradiction_id: string; strategy: string }) => JSON.stringify(await client.reflectResolveContradiction(agent_id, contradiction_id, { strategy })) }),
    // ── Transactions ──────────────────────────────────────────────────────
    new DynamicStructuredTool({ name: 'clawdb_tx_begin', description: 'Begin a transaction.', schema: z.object({}), func: async () => JSON.stringify(await client.beginTx()) }),
    new DynamicStructuredTool({ name: 'clawdb_tx_remember', description: 'Add a memory to a transaction.', schema: z.object({ tx_id: z.string(), content: z.string(), memory_type: z.string().optional() }), func: async ({ tx_id, content, memory_type }: { tx_id: string; content: string; memory_type?: string }) => JSON.stringify({ id: memory_type ? await client.txRememberTyped(tx_id, content, { type: memory_type }) : await client.txRemember(tx_id, content) }) }),
    new DynamicStructuredTool({ name: 'clawdb_tx_commit', description: 'Commit a transaction.', schema: z.object({ tx_id: z.string() }), func: async ({ tx_id }: { tx_id: string }) => JSON.stringify({ committed: await client.commitTx(tx_id) }) }),
    new DynamicStructuredTool({ name: 'clawdb_tx_rollback', description: 'Roll back a transaction.', schema: z.object({ tx_id: z.string() }), func: async ({ tx_id }: { tx_id: string }) => JSON.stringify({ rolled_back: await client.rollbackTx(tx_id) }) }),
  ];

  return tools;
}

/**
 * A VectorStore-like interface for embedding pipeline integration.
 * Bridges ClawDB memory search with LangChain's VectorStore interface.
 */
export class ClawDBMemoryStore {
  constructor(private readonly client: ClawDB) {}

  async similaritySearch(
    query: string,
    k = 5,
    _filter?: Record<string, unknown>
  ): Promise<Array<{ pageContent: string; metadata: Record<string, unknown> }>> {
    const results = await this.client.search(query, { topK: k, semantic: true });
    return results.map(r => ({
      pageContent: r.content,
      metadata: {
        id: r.id,
        score: r.score,
        memoryType: r.memoryType,
        tags: r.tags,
        ...r.metadata,
      },
    }));
  }

  async addDocuments(
    documents: Array<{ pageContent: string; metadata?: Record<string, unknown> }>
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const doc of documents) {
      const id = await this.client.rememberTyped(doc.pageContent, {
        metadata: doc.metadata,
      });
      ids.push(id);
    }
    return ids;
  }
}
