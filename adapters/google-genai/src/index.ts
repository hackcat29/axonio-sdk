import type { ClawDB } from 'axonio';
import type { FunctionDeclaration, FunctionCall, FunctionResponse, GenerativeModel } from '@google/generative-ai';

export function clawdbTools(_client: ClawDB): FunctionDeclaration[] {
  return [
    // ── Memory ────────────────────────────────────────────────────────────
    { name: 'clawdb_remember', description: 'Store important facts for future conversations.',
      parameters: { type: 'object', properties: { content: { type: 'string' }, memory_type: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['content'] }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_update_memory', description: 'Update an existing memory entry.',
      parameters: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string' } }, required: ['id', 'content'] }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_delete_memory', description: 'Delete a memory entry by ID.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_list_memories', description: 'List recent memory entries.',
      parameters: { type: 'object', properties: { limit: { type: 'number' }, memory_type: { type: 'string' } } }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_search', description: 'Search memory for context relevant to the request.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, top_k: { type: 'number' }, semantic: { type: 'boolean' } }, required: ['query'] }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_recall', description: 'Recall specific memory items by ID.',
      parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] }
    } as unknown as FunctionDeclaration,
    // ── Branches ──────────────────────────────────────────────────────────
    { name: 'clawdb_branch_fork', description: 'Fork memory state into a new branch.',
      parameters: { type: 'object', properties: { name: { type: 'string' }, from_branch_id: { type: 'string' } }, required: ['name'] }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_branch_list', description: 'List all memory branches.',
      parameters: { type: 'object', properties: {} }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_branch_get', description: 'Get a branch by ID.',
      parameters: { type: 'object', properties: { branch_id: { type: 'string' } }, required: ['branch_id'] }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_branch_trunk', description: 'Get the trunk branch.',
      parameters: { type: 'object', properties: {} }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_branch_diff', description: 'Diff two branches.',
      parameters: { type: 'object', properties: { source_branch_id: { type: 'string' }, target_branch_id: { type: 'string' } }, required: ['source_branch_id', 'target_branch_id'] }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_branch_merge', description: 'Merge a branch into main.',
      parameters: { type: 'object', properties: { branch_id: { type: 'string' }, target_branch_id: { type: 'string' }, strategy: { type: 'string' } }, required: ['branch_id'] }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_branch_discard', description: 'Discard a branch.',
      parameters: { type: 'object', properties: { branch_id: { type: 'string' } }, required: ['branch_id'] }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_branch_archive', description: 'Archive a branch.',
      parameters: { type: 'object', properties: { branch_id: { type: 'string' } }, required: ['branch_id'] }
    } as unknown as FunctionDeclaration,
    // ── Sync ──────────────────────────────────────────────────────────────
    { name: 'clawdb_sync', description: 'Full bidirectional sync.', parameters: { type: 'object', properties: {} } } as unknown as FunctionDeclaration,
    { name: 'clawdb_sync_push', description: 'Push local changes.', parameters: { type: 'object', properties: {} } } as unknown as FunctionDeclaration,
    { name: 'clawdb_sync_pull', description: 'Pull remote changes.', parameters: { type: 'object', properties: {} } } as unknown as FunctionDeclaration,
    { name: 'clawdb_sync_status', description: 'Get sync status.', parameters: { type: 'object', properties: {} } } as unknown as FunctionDeclaration,
    // ── Reflect ───────────────────────────────────────────────────────────
    { name: 'clawdb_reflect', description: 'Trigger a reflection job.', parameters: { type: 'object', properties: {} } } as unknown as FunctionDeclaration,
    { name: 'clawdb_reflect_facts', description: 'Get extracted facts for an agent.',
      parameters: { type: 'object', properties: { agent_id: { type: 'string' } }, required: ['agent_id'] }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_reflect_preferences', description: 'Get extracted preferences.',
      parameters: { type: 'object', properties: { agent_id: { type: 'string' } }, required: ['agent_id'] }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_reflect_contradictions', description: 'Get contradictions in memory.',
      parameters: { type: 'object', properties: { agent_id: { type: 'string' } }, required: ['agent_id'] }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_reflect_resolve_contradiction', description: 'Resolve a memory contradiction.',
      parameters: { type: 'object', properties: { agent_id: { type: 'string' }, contradiction_id: { type: 'string' }, strategy: { type: 'string' } }, required: ['agent_id', 'contradiction_id', 'strategy'] }
    } as unknown as FunctionDeclaration,
    // ── Transactions ──────────────────────────────────────────────────────
    { name: 'clawdb_tx_begin', description: 'Begin a memory transaction.', parameters: { type: 'object', properties: {} } } as unknown as FunctionDeclaration,
    { name: 'clawdb_tx_remember', description: 'Add a memory to a transaction.',
      parameters: { type: 'object', properties: { tx_id: { type: 'string' }, content: { type: 'string' }, memory_type: { type: 'string' } }, required: ['tx_id', 'content'] }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_tx_commit', description: 'Commit a transaction.',
      parameters: { type: 'object', properties: { tx_id: { type: 'string' } }, required: ['tx_id'] }
    } as unknown as FunctionDeclaration,
    { name: 'clawdb_tx_rollback', description: 'Roll back a transaction.',
      parameters: { type: 'object', properties: { tx_id: { type: 'string' } }, required: ['tx_id'] }
    } as unknown as FunctionDeclaration,
  ];
}

export async function handleClawDBFunctionCall(client: ClawDB, call: FunctionCall): Promise<FunctionResponse> {
  const args = (call.args ?? {}) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const respond = (response: unknown): FunctionResponse => ({ name: call.name, response: response as any });

  switch (call.name) {
    case 'clawdb_remember': {
      const id = await client.rememberTyped(String(args.content), { type: args.memory_type as string | undefined, tags: args.tags as string[] | undefined });
      return respond({ id });
    }
    case 'clawdb_update_memory': return respond({ updated: await client.updateMemory(String(args.id), String(args.content)) });
    case 'clawdb_delete_memory': return respond({ deleted: await client.deleteMemory(String(args.id)) });
    case 'clawdb_list_memories': return respond({ memories: await client.listMemories({ limit: args.limit as number | undefined, type: args.memory_type as string | undefined }) });
    case 'clawdb_search': return respond({ results: await client.search(String(args.query), { topK: (args.top_k as number) ?? 5, semantic: (args.semantic as boolean) ?? true }) });
    case 'clawdb_recall': return respond({ memories: await client.recall(args.ids as string[]) });
    case 'clawdb_branch_fork': return respond(await client.branch(String(args.name), args.from_branch_id ? String(args.from_branch_id) : ''));
    case 'clawdb_branch_list': return respond({ branches: await client.listBranches() });
    case 'clawdb_branch_get': return respond(await client.getBranch(String(args.branch_id)));
    case 'clawdb_branch_trunk': return respond(await client.getTrunkBranch());
    case 'clawdb_branch_diff': return respond(await client.diff(String(args.source_branch_id), String(args.target_branch_id)));
    case 'clawdb_branch_merge': return respond(await client.merge(String(args.branch_id), String(args.target_branch_id ?? ''), String(args.strategy ?? 'last-write')));
    case 'clawdb_branch_discard': return respond({ discarded: await client.discardBranch(String(args.branch_id)) });
    case 'clawdb_branch_archive': return respond({ archived: await client.archiveBranch(String(args.branch_id)) });
    case 'clawdb_sync': return respond(await client.sync());
    case 'clawdb_sync_push': return respond(await client.pushSync());
    case 'clawdb_sync_pull': return respond(await client.pullSync());
    case 'clawdb_sync_status': return respond(await client.syncStatus());
    case 'clawdb_reflect': return respond(await client.reflect());
    case 'clawdb_reflect_facts': return respond(await client.reflectGetFacts(String(args.agent_id)));
    case 'clawdb_reflect_preferences': return respond(await client.reflectGetPreferences(String(args.agent_id)));
    case 'clawdb_reflect_contradictions': return respond(await client.reflectGetContradictions(String(args.agent_id)));
    case 'clawdb_reflect_resolve_contradiction': return respond(await client.reflectResolveContradiction(String(args.agent_id), String(args.contradiction_id), { strategy: String(args.strategy) }));
    case 'clawdb_reflect_list_jobs': return respond(await client.reflectListJobs(String(args.agent_id)));
    case 'clawdb_reflect_get_job': return respond(await client.reflectGetJob(String(args.job_id)));
    case 'clawdb_tx_begin': return respond(await client.beginTx());
    case 'clawdb_tx_remember': return respond({ id: args.memory_type ? await client.txRememberTyped(String(args.tx_id), String(args.content), { type: String(args.memory_type) }) : await client.txRemember(String(args.tx_id), String(args.content)) });
    case 'clawdb_tx_commit': return respond({ committed: await client.commitTx(String(args.tx_id)) });
    case 'clawdb_tx_rollback': return respond({ rolled_back: await client.rollbackTx(String(args.tx_id)) });
    default: return respond({ error: `Unknown tool: ${call.name}` });
  }
}

export function withClawDBMemory(model: GenerativeModel, client: ClawDB): GenerativeModel {
  const originalGenerateContent = model.generateContent.bind(model);

  model.generateContent = (async (request: Parameters<typeof model.generateContent>[0]) => {
    const prompt = typeof request === 'string'
      ? request
      : Array.isArray(request)
        ? request.filter((part): part is string => typeof part === 'string').join(' ')
        : '';

    let enrichedRequest = request;
    if (prompt) {
      const hits = await client.search(prompt, { topK: 5, semantic: true });
      const memoryHeader = hits.length > 0
        ? `Relevant memory:\n${hits.map((hit, i) => `${i + 1}. ${hit.content}`).join('\n')}\n\n`
        : '';
      if (typeof request === 'string') {
        enrichedRequest = `${memoryHeader}${request}`;
      }
    }

    const response = await originalGenerateContent(enrichedRequest);

    if (prompt) {
      await client.rememberTyped(prompt, { type: 'message', tags: ['role:user'] });
      const text = response.response.text();
      if (text) {
        await client.rememberTyped(text, { type: 'message', tags: ['role:assistant'] });
      }
    }

    return response;
  }) as typeof model.generateContent;

  return model;
}
