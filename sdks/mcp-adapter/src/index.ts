import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ClawDB, type SearchHit } from 'axonio';

/** AXONIO_* wins over the older CLAWDB_* names. */
function env(name: string): string | undefined {
  return process.env[`AXONIO_${name}`] ?? process.env[`CLAWDB_${name}`];
}

const PACKAGE_VERSION = '0.2.2';
/** The hosted Axonio cloud (HTTP). The SDK picks its HTTP transport for it. */
const CLOUD_ENDPOINT = 'https://api.axonio.xyz/api/v1/gateway';

function resolveClientConfig(): { endpoint?: string; apiKey?: string; agentId?: string } {
  const explicitEndpoint = env('URL')?.trim();
  const apiKey = env('API_KEY')?.trim();
  const agentId = env('AGENT_ID')?.trim();

  if (explicitEndpoint) {
    return { endpoint: explicitEndpoint, apiKey: apiKey || undefined, agentId: agentId || undefined };
  }
  if (apiKey) {
    return { endpoint: CLOUD_ENDPOINT, apiKey, agentId: agentId || undefined };
  }
  return { agentId: agentId || undefined };
}

function getClaudeConfigPath(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Claude', 'claude_desktop_config.json');
  }
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

function clawdbClaudeConfigBlock(): Record<string, unknown> {
  // With an API key in the environment, configure the hosted cloud;
  // otherwise a local clawdb-server.
  const apiKey = env('API_KEY')?.trim();
  const serverEnv: Record<string, string> = apiKey
    ? { AXONIO_API_KEY: apiKey, AXONIO_AGENT_ID: 'claude-desktop' }
    : { AXONIO_URL: 'http://localhost:50050', AXONIO_AGENT_ID: 'claude-desktop' };
  return {
    mcpServers: {
      axonio: {
        command: 'npx',
        args: ['-y', 'axonio-mcp@latest'],
        env: serverEnv
      }
    }
  };
}

function printClaudeConfig(): void {
  process.stdout.write(`${JSON.stringify(clawdbClaudeConfigBlock(), null, 2)}\n`);
}

function installClaudeConfig(): void {
  const configPath = getClaudeConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });

  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  const block = clawdbClaudeConfigBlock();
  const mcpServers = (existing['mcpServers'] as Record<string, unknown> | undefined) ?? {};
  const next = {
    ...existing,
    mcpServers: {
      ...mcpServers,
      ...(block['mcpServers'] as Record<string, unknown>)
    }
  };

  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  process.stdout.write('✓ ClawDB added to Claude Desktop. Restart Claude Desktop to activate.\n');
}

function toMcpText(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) {
    return 'No results found.';
  }
  return hits.map((hit, index) => `${index + 1}. [${hit.score.toFixed(3)}] ${hit.content} (id=${hit.id})`).join('\n');
}

async function main(): Promise<void> {
  const legacyEndpoint = env('ENDPOINT');
  if (legacyEndpoint && !env('URL')) {
    process.env.AXONIO_URL = legacyEndpoint;
  }

  if (process.argv.includes('--print-config')) {
    printClaudeConfig();
    return;
  }

  if (process.argv.includes('--install-claude')) {
    installClaudeConfig();
    return;
  }

  const server = new McpServer({ name: 'axonio', version: PACKAGE_VERSION });

  const db = new ClawDB(resolveClientConfig());

  const requireDb = (): ClawDB => {
    return db;
  };

  server.tool(
    'clawdb_remember',
    'Store information in the agent\'s persistent memory database.',
    {
      content: z.string().describe('What to remember'),
      memory_type: z.string().default('message'),
      tags: z.array(z.string()).optional()
    },
    async ({ content, memory_type, tags }) => {
      const id = await requireDb().rememberTyped(content, { type: memory_type, tags });
      return toMcpText({ id });
    }
  );

  server.tool(
    'clawdb_remember_bulk',
    'Store many memories in one call for fast context ingestion.',
    {
      memories: z.array(z.object({
        content: z.string(),
        memory_type: z.string().optional(),
        tags: z.array(z.string()).optional()
      })).min(1).max(100)
    },
    async ({ memories }) => {
      const ids = await Promise.all(
        memories.map((item) => requireDb().rememberTyped(item.content, {
          type: item.memory_type ?? 'message',
          tags: item.tags
        }))
      );
      return toMcpText({ ids });
    }
  );

  server.tool(
    'clawdb_search',
    'Search the agent\'s memory database by meaning or keywords.',
    {
      query: z.string(),
      top_k: z.number().min(1).max(50).default(5),
      semantic: z.boolean().default(true)
    },
    async ({ query, top_k, semantic }) => {
      const results = await requireDb().search(query, { topK: top_k, semantic });
      return { content: [{ type: 'text', text: formatHits(results) }] };
    }
  );

  // ── Memory CRUD ───────────────────────────────────────────────────────
  server.tool('clawdb_update_memory', 'Update an existing memory entry by ID.',
    { id: z.string(), content: z.string() },
    async ({ id, content }) => toMcpText({ updated: await requireDb().updateMemory(id, content) })
  );
  server.tool('clawdb_delete_memory', 'Delete a memory entry by ID.',
    { id: z.string() },
    async ({ id }) => toMcpText({ deleted: await requireDb().deleteMemory(id) })
  );
  server.tool('clawdb_list_memories', 'List recent memory entries.',
    { limit: z.number().optional(), memory_type: z.string().optional() },
    async ({ limit, memory_type }) => toMcpText({ memories: await requireDb().listMemories({ limit, type: memory_type }) })
  );
  // ── Branches ──────────────────────────────────────────────────────────
  server.tool('clawdb_branch_list', 'List all memory branches.', {},
    async () => toMcpText({ branches: await requireDb().listBranches() })
  );
  server.tool('clawdb_branch_get', 'Get a branch by ID.',
    { branch_id: z.string() },
    async ({ branch_id }) => toMcpText(await requireDb().getBranch(branch_id))
  );
  server.tool('clawdb_branch_trunk', 'Get the trunk (main) branch.', {},
    async () => toMcpText(await requireDb().getTrunkBranch())
  );
  server.tool('clawdb_branch_diff', 'Diff two branches.',
    { source_branch_id: z.string(), target_branch_id: z.string() },
    async ({ source_branch_id, target_branch_id }) => toMcpText(await requireDb().diff(source_branch_id, target_branch_id))
  );
  server.tool('clawdb_branch_discard', 'Discard a branch permanently.',
    { branch_id: z.string() },
    async ({ branch_id }) => toMcpText({ discarded: await requireDb().discardBranch(branch_id) })
  );
  server.tool('clawdb_branch_archive', 'Archive a branch.',
    { branch_id: z.string() },
    async ({ branch_id }) => toMcpText({ archived: await requireDb().archiveBranch(branch_id) })
  );
  // ── Sync ──────────────────────────────────────────────────────────────
  server.tool('clawdb_sync', 'Full bidirectional sync.', {}, async () => toMcpText(await requireDb().sync()));
  server.tool('clawdb_sync_push', 'Push local changes.', {}, async () => toMcpText(await requireDb().pushSync()));
  server.tool('clawdb_sync_pull', 'Pull remote changes.', {}, async () => toMcpText(await requireDb().pullSync()));
  server.tool('clawdb_sync_reconcile', 'Reconcile divergent sync state.', {}, async () => toMcpText(await requireDb().reconcileSync()));
  server.tool('clawdb_sync_status', 'Get sync status.', {}, async () => toMcpText(await requireDb().syncStatus()));
  // ── Reflect ───────────────────────────────────────────────────────────
  server.tool('clawdb_reflect', 'Trigger a reflection job.', {}, async () => toMcpText(await requireDb().reflect()));
  server.tool('clawdb_reflect_list_jobs', 'List reflection jobs.',
    { agent_id: z.string() },
    async ({ agent_id }) => toMcpText(await requireDb().reflectListJobs(agent_id))
  );
  server.tool('clawdb_reflect_get_job', 'Get a reflection job by ID.',
    { job_id: z.string() },
    async ({ job_id }) => toMcpText(await requireDb().reflectGetJob(job_id))
  );
  server.tool('clawdb_reflect_facts', 'Get extracted facts.',
    { agent_id: z.string() },
    async ({ agent_id }) => toMcpText(await requireDb().reflectGetFacts(agent_id))
  );
  server.tool('clawdb_reflect_preferences', 'Get extracted preferences.',
    { agent_id: z.string() },
    async ({ agent_id }) => toMcpText(await requireDb().reflectGetPreferences(agent_id))
  );
  server.tool('clawdb_reflect_contradictions', 'Get contradictions.',
    { agent_id: z.string() },
    async ({ agent_id }) => toMcpText(await requireDb().reflectGetContradictions(agent_id))
  );
  server.tool('clawdb_reflect_resolve_contradiction', 'Resolve a contradiction.',
    { agent_id: z.string(), contradiction_id: z.string(), strategy: z.enum(['keep-old', 'keep-new', 'merge']) },
    async ({ agent_id, contradiction_id, strategy }) => toMcpText(await requireDb().reflectResolveContradiction(agent_id, contradiction_id, { strategy }))
  );
  // ── Transactions ──────────────────────────────────────────────────────
  server.tool('clawdb_tx_begin', 'Begin a memory transaction.', {}, async () => toMcpText(await requireDb().beginTx()));
  server.tool('clawdb_tx_remember', 'Add a memory to a transaction.',
    { tx_id: z.string(), content: z.string(), memory_type: z.string().optional() },
    async ({ tx_id, content, memory_type }) => toMcpText({ id: memory_type ? await requireDb().txRememberTyped(tx_id, content, { type: memory_type }) : await requireDb().txRemember(tx_id, content) })
  );
  server.tool('clawdb_tx_remember_typed', 'Add a typed memory to a transaction.',
    { tx_id: z.string(), content: z.string(), memory_type: z.string(), tags: z.array(z.string()).optional() },
    async ({ tx_id, content, memory_type, tags }) => toMcpText({ id: await requireDb().txRememberTyped(tx_id, content, { type: memory_type, tags }) })
  );
  server.tool('clawdb_tx_commit', 'Commit a transaction.',
    { tx_id: z.string() },
    async ({ tx_id }) => toMcpText({ committed: await requireDb().commitTx(tx_id) })
  );
  server.tool('clawdb_tx_rollback', 'Roll back a transaction.',
    { tx_id: z.string() },
    async ({ tx_id }) => toMcpText({ rolled_back: await requireDb().rollbackTx(tx_id) })
  );

  server.tool(
    'clawdb_recall',
    'Retrieve specific memories by ID.',
    {
      ids: z.array(z.string()).min(1)
    },
    async ({ ids }) => {
      const memories = await requireDb().recall(ids);
      return toMcpText({ memories });
    }
  );

  server.tool(
    'clawdb_branch_fork',
    'Fork the agent\'s memory state for experimentation.',
    { name: z.string() },
    async ({ name }) => {
      const branch = await requireDb().branch(name);
      return toMcpText({ branch_id: branch.branchId });
    }
  );

  server.tool(
    'clawdb_branch_merge',
    'Merge an experimental branch back into main memory.',
    {
      branch_id: z.string(),
      strategy: z.enum(['last-write', 'source-wins']).default('last-write')
    },
    async ({ branch_id, strategy }) => {
      const result = await requireDb().merge(branch_id, '', strategy);
      return toMcpText(result);
    }
  );

  server.tool(
    'clawdb_status',
    'Check ClawDB connection and component health.',
    {},
    async () => {
      const health = await requireDb().health();
      return toMcpText(health);
    }
  );

  server.resource('recent', 'clawdb://recent', async (uri) => {
    const list = await requireDb().listMemories({ limit: 20 });
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(list, null, 2)
        }
      ]
    };
  });

  server.resource('memory-by-id', 'clawdb://memory/{id}', async (uri) => {
    const id = uri.pathname.split('/').pop();
    if (!id) {
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: 'missing id' }) }]
      };
    }
    const [memory] = await requireDb().recall([id]);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(memory ?? null, null, 2)
        }
      ]
    };
  });

  const maybePromptRegistrar = (server as unknown as {
    prompt?: (
      name: string,
      description: string,
      schema: Record<string, z.ZodTypeAny>,
      handler: (args: Record<string, unknown>) => Promise<{ messages: Array<{ role: string; content: { type: string; text: string } }> }>
    ) => void;
  }).prompt;

  if (typeof maybePromptRegistrar === 'function') {
    // Called on the server: a detached call has no `this` and crashed at startup.
    maybePromptRegistrar.call(
      server,
      'clawdb_load_context',
      'Search memory for the current topic and format the result for system prompt injection.',
      { topic: z.string() },
      async ({ topic }) => {
        const hits = await requireDb().search(String(topic), { topK: 5, semantic: true });
        return {
          messages: [
            {
              // MCP prompt messages are 'user' or 'assistant' only.
              role: 'user',
              content: {
                type: 'text',
                text: `Relevant prior context:\n${formatHits(hits)}`
              }
            }
          ]
        };
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main();
