import type Anthropic from '@anthropic-ai/sdk';
import type { ClawDB } from 'axonio';

export function clawdbTools(_client: ClawDB): Anthropic.Tool[] {
  return [
    // ── Memory ────────────────────────────────────────────────────────────
    {
      name: 'clawdb_remember',
      description: 'Store important information that should persist across future conversations.',
      input_schema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The content to remember.' },
          memory_type: { type: 'string', description: 'Optional type tag (context, task, message, summary, etc.).' },
          tags: { type: 'array', items: { type: 'string' } }
        },
        required: ['content']
      }
    },
    {
      name: 'clawdb_update_memory',
      description: 'Update the content of an existing memory entry by ID.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The memory ID to update.' },
          content: { type: 'string', description: 'New content for the memory.' }
        },
        required: ['id', 'content']
      }
    },
    {
      name: 'clawdb_delete_memory',
      description: 'Delete a memory entry by ID.',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      }
    },
    {
      name: 'clawdb_list_memories',
      description: 'List recent memory entries, optionally filtered by type.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of results (default 20).' },
          memory_type: { type: 'string', description: 'Filter by memory type.' }
        }
      }
    },
    {
      name: 'clawdb_search',
      description: 'Search memory for context that is relevant to the current user request.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          top_k: { type: 'number' },
          semantic: { type: 'boolean' }
        },
        required: ['query']
      }
    },
    {
      name: 'clawdb_recall',
      description: 'Recall specific memory entries when you already know their IDs.',
      input_schema: {
        type: 'object',
        properties: { ids: { type: 'array', items: { type: 'string' } } },
        required: ['ids']
      }
    },
    // ── Branches ──────────────────────────────────────────────────────────
    {
      name: 'clawdb_branch_fork',
      description: 'Fork the agent memory state into a new branch for experimentation.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Human-readable branch name.' },
          from_branch_id: { type: 'string', description: 'Optional source branch ID (defaults to trunk).' }
        },
        required: ['name']
      }
    },
    {
      name: 'clawdb_branch_list',
      description: 'List all memory branches.',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'clawdb_branch_get',
      description: 'Get details about a specific branch by ID.',
      input_schema: {
        type: 'object',
        properties: { branch_id: { type: 'string' } },
        required: ['branch_id']
      }
    },
    {
      name: 'clawdb_branch_trunk',
      description: 'Get the trunk (main) branch information.',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'clawdb_branch_diff',
      description: 'Compute the diff between two branches.',
      input_schema: {
        type: 'object',
        properties: {
          source_branch_id: { type: 'string' },
          target_branch_id: { type: 'string' }
        },
        required: ['source_branch_id', 'target_branch_id']
      }
    },
    {
      name: 'clawdb_branch_merge',
      description: 'Merge an experimental branch back into main memory.',
      input_schema: {
        type: 'object',
        properties: {
          branch_id: { type: 'string' },
          target_branch_id: { type: 'string', description: 'Target branch ID (defaults to trunk).' },
          strategy: { type: 'string', enum: ['last-write', 'source-wins', 'target-wins'] }
        },
        required: ['branch_id']
      }
    },
    {
      name: 'clawdb_branch_discard',
      description: 'Discard (delete) a branch permanently.',
      input_schema: {
        type: 'object',
        properties: { branch_id: { type: 'string' } },
        required: ['branch_id']
      }
    },
    {
      name: 'clawdb_branch_archive',
      description: 'Archive a branch for future reference.',
      input_schema: {
        type: 'object',
        properties: { branch_id: { type: 'string' } },
        required: ['branch_id']
      }
    },
    // ── Sync ──────────────────────────────────────────────────────────────
    {
      name: 'clawdb_sync',
      description: 'Run a full bidirectional sync with the remote ClawDB cluster.',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'clawdb_sync_push',
      description: 'Push local memory changes to the remote cluster.',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'clawdb_sync_pull',
      description: 'Pull remote memory changes to the local store.',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'clawdb_sync_status',
      description: 'Get the current sync status and last sync timestamp.',
      input_schema: { type: 'object', properties: {} }
    },
    // ── Reflect ───────────────────────────────────────────────────────────
    {
      name: 'clawdb_reflect',
      description: 'Trigger a reflection job to extract facts and preferences from stored memories.',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'clawdb_reflect_facts',
      description: 'Get extracted facts for a specific agent.',
      input_schema: {
        type: 'object',
        properties: { agent_id: { type: 'string' } },
        required: ['agent_id']
      }
    },
    {
      name: 'clawdb_reflect_preferences',
      description: 'Get extracted preferences for a specific agent.',
      input_schema: {
        type: 'object',
        properties: { agent_id: { type: 'string' } },
        required: ['agent_id']
      }
    },
    {
      name: 'clawdb_reflect_contradictions',
      description: 'Get contradictions detected in stored memories for an agent.',
      input_schema: {
        type: 'object',
        properties: { agent_id: { type: 'string' } },
        required: ['agent_id']
      }
    },
    {
      name: 'clawdb_reflect_resolve_contradiction',
      description: 'Resolve a specific contradiction detected in memories.',
      input_schema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          contradiction_id: { type: 'string' },
          strategy: { type: 'string', enum: ['keep-old', 'keep-new', 'merge'] }
        },
        required: ['agent_id', 'contradiction_id', 'strategy']
      }
    },
    // ── Transactions ──────────────────────────────────────────────────────
    {
      name: 'clawdb_tx_begin',
      description: 'Begin a memory transaction to batch multiple writes atomically.',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'clawdb_tx_remember',
      description: 'Add a memory to an open transaction.',
      input_schema: {
        type: 'object',
        properties: {
          tx_id: { type: 'string' },
          content: { type: 'string' },
          memory_type: { type: 'string' }
        },
        required: ['tx_id', 'content']
      }
    },
    {
      name: 'clawdb_tx_commit',
      description: 'Commit a transaction, persisting all buffered writes.',
      input_schema: {
        type: 'object',
        properties: { tx_id: { type: 'string' } },
        required: ['tx_id']
      }
    },
    {
      name: 'clawdb_tx_rollback',
      description: 'Roll back a transaction, discarding all buffered writes.',
      input_schema: {
        type: 'object',
        properties: { tx_id: { type: 'string' } },
        required: ['tx_id']
      }
    }
  ];
}

export async function handleClawDBToolCall(
  client: ClawDB,
  toolUse: Anthropic.ToolUseBlock
): Promise<Anthropic.ToolResultBlockParam> {
  const reply = (data: unknown) => ({
    type: 'tool_result' as const,
    tool_use_id: toolUse.id,
    content: JSON.stringify(data)
  });

  const i = toolUse.input as Record<string, unknown>;

  switch (toolUse.name) {
    // ── Memory ──
    case 'clawdb_remember': {
      const id = await client.rememberTyped(String(i.content), {
        type: i.memory_type as string | undefined,
        tags: i.tags as string[] | undefined
      });
      return reply({ id });
    }
    case 'clawdb_update_memory': {
      const ok = await client.updateMemory(String(i.id), String(i.content));
      return reply({ updated: ok });
    }
    case 'clawdb_delete_memory': {
      const ok = await client.deleteMemory(String(i.id));
      return reply({ deleted: ok });
    }
    case 'clawdb_list_memories': {
      const memories = await client.listMemories({
        limit: i.limit as number | undefined,
        type: i.memory_type as string | undefined
      });
      return reply({ memories });
    }
    case 'clawdb_search': {
      const results = await client.search(String(i.query), {
        topK: (i.top_k as number) ?? 5,
        semantic: (i.semantic as boolean) ?? true
      });
      return reply({ results });
    }
    case 'clawdb_recall': {
      const memories = await client.recall(i.ids as string[]);
      return reply({ memories });
    }
    // ── Branches ──
    case 'clawdb_branch_fork': {
      const branch = await client.branch(String(i.name), i.from_branch_id ? String(i.from_branch_id) : '');
      return reply(branch);
    }
    case 'clawdb_branch_list': {
      const branches = await client.listBranches();
      return reply({ branches });
    }
    case 'clawdb_branch_get': {
      const branch = await client.getBranch(String(i.branch_id));
      return reply(branch);
    }
    case 'clawdb_branch_trunk': {
      const trunk = await client.getTrunkBranch();
      return reply(trunk);
    }
    case 'clawdb_branch_diff': {
      const diff = await client.diff(String(i.source_branch_id), String(i.target_branch_id));
      return reply(diff);
    }
    case 'clawdb_branch_merge': {
      const result = await client.merge(
        String(i.branch_id),
        String(i.target_branch_id ?? ''),
        (i.strategy as string) ?? 'last-write'
      );
      return reply(result);
    }
    case 'clawdb_branch_discard': {
      const ok = await client.discardBranch(String(i.branch_id));
      return reply({ discarded: ok });
    }
    case 'clawdb_branch_archive': {
      const ok = await client.archiveBranch(String(i.branch_id));
      return reply({ archived: ok });
    }
    // ── Sync ──
    case 'clawdb_sync': {
      const result = await client.sync();
      return reply(result);
    }
    case 'clawdb_sync_push': {
      const result = await client.pushSync();
      return reply(result);
    }
    case 'clawdb_sync_pull': {
      const result = await client.pullSync();
      return reply(result);
    }
    case 'clawdb_sync_status': {
      const status = await client.syncStatus();
      return reply(status);
    }
    // ── Reflect ──
    case 'clawdb_reflect': {
      const job = await client.reflect();
      return reply(job);
    }
    case 'clawdb_reflect_facts': {
      const facts = await client.reflectGetFacts(String(i.agent_id));
      return reply(facts);
    }
    case 'clawdb_reflect_preferences': {
      const prefs = await client.reflectGetPreferences(String(i.agent_id));
      return reply(prefs);
    }
    case 'clawdb_reflect_contradictions': {
      const contradictions = await client.reflectGetContradictions(String(i.agent_id));
      return reply(contradictions);
    }
    case 'clawdb_reflect_resolve_contradiction': {
      const result = await client.reflectResolveContradiction(
        String(i.agent_id),
        String(i.contradiction_id),
        { strategy: String(i.strategy) }
      );
      return reply(result);
    }
    // ── Transactions ──
    case 'clawdb_tx_begin': {
      const tx = await client.beginTx();
      return reply(tx);
    }
    case 'clawdb_tx_remember': {
      const id = i.memory_type ? await client.txRememberTyped(String(i.tx_id), String(i.content), { type: String(i.memory_type) }) : await client.txRemember(String(i.tx_id), String(i.content));
      return reply({ id });
    }
    case 'clawdb_tx_commit': {
      const ok = await client.commitTx(String(i.tx_id));
      return reply({ committed: ok });
    }
    case 'clawdb_tx_rollback': {
      const ok = await client.rollbackTx(String(i.tx_id));
      return reply({ rolled_back: ok });
    }
    default:
      return reply({ error: `Unknown tool: ${toolUse.name}` });
  }
}

export function withClawDBMemory(anthropic: Anthropic, client: ClawDB): Anthropic {
  const messagesApi = anthropic.messages;
  const originalCreate = messagesApi.create.bind(messagesApi);

  // @ts-expect-error — patching the Anthropic instance
  messagesApi.create = async (params: Anthropic.MessageCreateParams) => {
    const userTurns = params.messages.filter((m) => m.role === 'user');
    const lastUser = userTurns.at(-1);
    const userText = typeof lastUser?.content === 'string' ? lastUser.content : '';

    if (userText) {
      const hits = await client.search(userText, { topK: 5, semantic: true });
      if (hits.length > 0) {
        const context = hits.map((h) => h.content).join('\n');
        const sys = `Relevant prior context:\n${context}`;
        params = {
          ...params,
          system: params.system ? `${params.system}\n\n${sys}` : sys
        };
      }
    }
    return originalCreate(params as Anthropic.MessageCreateParamsNonStreaming);
  };

  return anthropic;
}
