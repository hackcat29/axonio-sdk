import type { ClawDB, SearchHit } from 'axonio';
import { ClawDB as ClawDBClient } from 'axonio';

export interface OpenClawLogger {
  info(message: string): void;
}

export interface OpenClawAgent {
  id?: string;
  logger: OpenClawLogger;
  plugins?: OpenClawPlugin[];
}

export interface OpenClawContext {
  sessionId?: string;
  set(key: string, value: unknown): void;
  get<T = unknown>(key: string): T;
  injectContext(value: string): void;
}

export interface OpenClawMessage {
  content: string;
}

export interface OpenClawResponse {
  userMessage: string;
  assistantMessage: string;
}

export interface OpenClawTool {
  name: string;
  description: string;
  execute(input: Record<string, unknown>, ctx: OpenClawContext): Promise<unknown>;
}

export interface OpenClawPlugin {
  name: string;
  version: string;
  tools?: OpenClawTool[];
  onAgentInit?: (agent: OpenClawAgent, ctx: OpenClawContext) => Promise<void>;
  onMessage?: (message: OpenClawMessage, ctx: OpenClawContext) => Promise<void>;
  onResponse?: (response: OpenClawResponse, ctx: OpenClawContext) => Promise<void>;
  onAgentShutdown?: (ctx: OpenClawContext) => Promise<void>;
}

export interface ClawDBPluginOptions {
  autoStore?: boolean;
  autoSearch?: boolean;
  topK?: number;
  syncOnShutdown?: boolean;
  endpoint?: string;
}

const CLOUD_ENDPOINT = 'https://cloud.clawdb.dev';

function resolveClientConfig(endpoint?: string): { endpoint?: string; apiKey?: string } {
  const explicit = endpoint?.trim();
  if (explicit) {
    return { endpoint: explicit };
  }

  const envEndpoint = process.env.CLAWDB_URL?.trim();
  const envApiKey = process.env.CLAWDB_API_KEY?.trim();
  if (envEndpoint) {
    return { endpoint: envEndpoint, apiKey: envApiKey || undefined };
  }
  if (envApiKey) {
    return { endpoint: CLOUD_ENDPOINT, apiKey: envApiKey };
  }
  return {};
}

function getDb(ctx: OpenClawContext): ClawDB {
  return ctx.get<ClawDB>('clawdb');
}

function createRememberTool(): OpenClawTool {
  return {
    name: 'clawdb_remember',
    description: 'Store important facts so they remain available in future agent runs.',
    async execute(input, ctx) {
      const db = getDb(ctx);
      return { id: await db.rememberTyped(String(input.content), { type: input.memory_type as string | undefined }) };
    }
  };
}

function createSearchTool(): OpenClawTool {
  return {
    name: 'clawdb_search',
    description: 'Search long-term memory for context relevant to the current task.',
    async execute(input, ctx) {
      const db = getDb(ctx);
      return { results: await db.search(String(input.query), { topK: Number(input.top_k ?? 5) }) };
    }
  };
}

function createRecallTool(): OpenClawTool {
  return {
    name: 'clawdb_recall',
    description: 'Recall exact memory entries when you already know which IDs you need.',
    async execute(input, ctx) {
      const db = getDb(ctx);
      return { memories: await db.recall((input.ids as string[]) ?? []) };
    }
  };
}

function createBranchTool(): OpenClawTool {
  return {
    name: 'clawdb_branch_fork',
    description: 'Fork memory state into a new branch for experimentation.',
    async execute(input, ctx) {
      const db = getDb(ctx);
      return db.branch(String(input.name), input.from_branch_id ? String(input.from_branch_id) : '');
    }
  };
}

function createUpdateMemoryTool(): OpenClawTool {
  return { name: 'clawdb_update_memory', description: 'Update an existing memory entry by ID.', async execute(input, ctx) { return { updated: await getDb(ctx).updateMemory(String(input.id), String(input.content)) }; } };
}

function createDeleteMemoryTool(): OpenClawTool {
  return { name: 'clawdb_delete_memory', description: 'Delete a memory entry by ID.', async execute(input, ctx) { return { deleted: await getDb(ctx).deleteMemory(String(input.id)) }; } };
}

function createListMemoriesTool(): OpenClawTool {
  return { name: 'clawdb_list_memories', description: 'List recent memory entries.', async execute(input, ctx) { return { memories: await getDb(ctx).listMemories({ limit: input.limit as number | undefined, type: input.memory_type as string | undefined }) }; } };
}

function createBranchListTool(): OpenClawTool {
  return { name: 'clawdb_branch_list', description: 'List all memory branches.', async execute(_input, ctx) { return { branches: await getDb(ctx).listBranches() }; } };
}

function createBranchGetTool(): OpenClawTool {
  return { name: 'clawdb_branch_get', description: 'Get a branch by ID.', async execute(input, ctx) { return getDb(ctx).getBranch(String(input.branch_id)); } };
}

function createBranchTrunkTool(): OpenClawTool {
  return { name: 'clawdb_branch_trunk', description: 'Get the trunk branch.', async execute(_input, ctx) { return getDb(ctx).getTrunkBranch(); } };
}

function createBranchDiffTool(): OpenClawTool {
  return { name: 'clawdb_branch_diff', description: 'Diff two branches.', async execute(input, ctx) { return getDb(ctx).diff(String(input.source_branch_id), String(input.target_branch_id)); } };
}

function createBranchMergeTool(): OpenClawTool {
  return { name: 'clawdb_branch_merge', description: 'Merge a branch into main.', async execute(input, ctx) { return getDb(ctx).merge(String(input.branch_id), String(input.target_branch_id ?? ''), String(input.strategy ?? 'last-write')); } };
}

function createBranchDiscardTool(): OpenClawTool {
  return { name: 'clawdb_branch_discard', description: 'Discard a branch.', async execute(input, ctx) { return { discarded: await getDb(ctx).discardBranch(String(input.branch_id)) }; } };
}

function createBranchArchiveTool(): OpenClawTool {
  return { name: 'clawdb_branch_archive', description: 'Archive a branch.', async execute(input, ctx) { return { archived: await getDb(ctx).archiveBranch(String(input.branch_id)) }; } };
}

function createSyncTool(): OpenClawTool {
  return { name: 'clawdb_sync', description: 'Full bidirectional sync.', async execute(_input, ctx) { return getDb(ctx).sync(); } };
}

function createSyncPushTool(): OpenClawTool {
  return { name: 'clawdb_sync_push', description: 'Push local changes.', async execute(_input, ctx) { return getDb(ctx).pushSync(); } };
}

function createSyncPullTool(): OpenClawTool {
  return { name: 'clawdb_sync_pull', description: 'Pull remote changes.', async execute(_input, ctx) { return getDb(ctx).pullSync(); } };
}

function createSyncStatusTool(): OpenClawTool {
  return { name: 'clawdb_sync_status', description: 'Get sync status.', async execute(_input, ctx) { return getDb(ctx).syncStatus(); } };
}

function createReflectTool(): OpenClawTool {
  return { name: 'clawdb_reflect', description: 'Trigger a reflection job.', async execute(_input, ctx) { return getDb(ctx).reflect(); } };
}

function createReflectFactsTool(): OpenClawTool {
  return { name: 'clawdb_reflect_facts', description: 'Get extracted facts.', async execute(input, ctx) { return getDb(ctx).reflectGetFacts(String(input.agent_id)); } };
}

function createReflectPreferencesTool(): OpenClawTool {
  return { name: 'clawdb_reflect_preferences', description: 'Get extracted preferences.', async execute(input, ctx) { return getDb(ctx).reflectGetPreferences(String(input.agent_id)); } };
}

function createReflectContradictionsTool(): OpenClawTool {
  return { name: 'clawdb_reflect_contradictions', description: 'Get contradictions.', async execute(input, ctx) { return getDb(ctx).reflectGetContradictions(String(input.agent_id)); } };
}

function createReflectResolveTool(): OpenClawTool {
  return { name: 'clawdb_reflect_resolve', description: 'Resolve a contradiction.', async execute(input, ctx) { return getDb(ctx).reflectResolveContradiction(String(input.agent_id), String(input.contradiction_id), { strategy: String(input.strategy) }); } };
}

function createTxBeginTool(): OpenClawTool {
  return { name: 'clawdb_tx_begin', description: 'Begin a transaction.', async execute(_input, ctx) { return getDb(ctx).beginTx(); } };
}

function createTxRememberTool(): OpenClawTool {
  return { name: 'clawdb_tx_remember', description: 'Add a memory to a transaction.', async execute(input, ctx) { const db = getDb(ctx); return { id: input.memory_type ? await db.txRememberTyped(String(input.tx_id), String(input.content), { type: String(input.memory_type) }) : await db.txRemember(String(input.tx_id), String(input.content)) }; } };
}

function createTxCommitTool(): OpenClawTool {
  return { name: 'clawdb_tx_commit', description: 'Commit a transaction.', async execute(input, ctx) { return { committed: await getDb(ctx).commitTx(String(input.tx_id)) }; } };
}

function createTxRollbackTool(): OpenClawTool {
  return { name: 'clawdb_tx_rollback', description: 'Roll back a transaction.', async execute(input, ctx) { return { rolled_back: await getDb(ctx).rollbackTx(String(input.tx_id)) }; } };
}

export function formatMemoryContext(hits: SearchHit[]): string {
  const lines = hits.map((hit) => `[score: ${hit.score.toFixed(2)}] ${hit.content}`);
  return ['--- Relevant memories ---', ...lines, '-------------------------'].join('\n');
}

export function ClawDBPlugin(options: ClawDBPluginOptions = {}): OpenClawPlugin {
  const {
    autoStore = true,
    autoSearch = true,
    topK = 3,
    syncOnShutdown = true,
    endpoint
  } = options;

  return {
    name: 'clawdb',
    version: '0.1.1',
    async onAgentInit(agent, ctx) {
      const db = new ClawDBClient({
        ...resolveClientConfig(endpoint),
        agentId: agent.id ?? ctx.sessionId
      });
      ctx.set('clawdb', db);
      agent.logger.info('ClawDB: database ready');
    },
    tools: [
          createRememberTool(), createUpdateMemoryTool(), createDeleteMemoryTool(), createListMemoriesTool(),
          createSearchTool(), createRecallTool(),
          createBranchTool(), createBranchListTool(), createBranchGetTool(), createBranchTrunkTool(),
          createBranchDiffTool(), createBranchMergeTool(), createBranchDiscardTool(), createBranchArchiveTool(),
          createSyncTool(), createSyncPushTool(), createSyncPullTool(), createSyncStatusTool(),
          createReflectTool(), createReflectFactsTool(), createReflectPreferencesTool(), createReflectContradictionsTool(), createReflectResolveTool(),
          createTxBeginTool(), createTxRememberTool(), createTxCommitTool(), createTxRollbackTool(),
        ],
    async onMessage(message, ctx) {
      if (!autoSearch) return;
      const db = getDb(ctx);
      const hits = await db.search(message.content, { topK });
      if (hits.length > 0) {
        ctx.injectContext(formatMemoryContext(hits));
      }
    },
    async onResponse(response, ctx) {
      if (!autoStore) return;
      const db = getDb(ctx);
      await db.rememberTyped(response.userMessage, { type: 'user_message', tags: ['auto-stored'] });
      await db.rememberTyped(response.assistantMessage, { type: 'assistant_message', tags: ['auto-stored'] });
    },
    async onAgentShutdown(ctx) {
      const db = getDb(ctx);
      if (syncOnShutdown) {
        await db.sync();
      }
      db.close();
    }
  };
}

export function withClawDB<T extends OpenClawAgent>(agent: T, options?: ClawDBPluginOptions): T {
  const plugins = Array.isArray(agent.plugins) ? agent.plugins : [];
  agent.plugins = [...plugins, ClawDBPlugin(options)];
  return agent;
}
