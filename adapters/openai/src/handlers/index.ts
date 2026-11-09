import type { ClawDB } from 'axonio';

/**
 * Dispatches OpenAI Agents SDK tool calls to the ClawDB client.
 *
 * Never throws — returns a JSON-encoded `{ error, message }` object on failure.
 *
 * @example
 * ```ts
 * const handler = new ClawDBToolHandler(db);
 * const result = await handler.handle("clawdb_remember", { content: "Deploy at noon" });
 * ```
 */
export class ClawDBToolHandler {
  constructor(private readonly client: ClawDB) {}

  async handle(toolName: string, args: unknown): Promise<string> {
    try {
      return await this.dispatch(toolName, args as Record<string, unknown>);
    } catch (err) {
      const maybeCode = (err as { code?: unknown })?.code;
      const maybeMessage = (err as { message?: unknown })?.message;
      if (typeof maybeCode === 'string' || typeof maybeCode === 'number') {
        return JSON.stringify({ error: String(maybeCode), message: String(maybeMessage ?? 'Tool call failed') });
      }
      return JSON.stringify({ error: 'internal_error', message: String(err) });
    }
  }

  private async dispatch(toolName: string, args: Record<string, unknown>): Promise<string> {
    switch (toolName) {
      // ── Memory ──
      case 'remember_memory': {
        const id = await this.client.rememberTyped(args['content'] as string, {
          type: args['memory_type'] as string | undefined,
          tags: args['tags'] as string[] | undefined,
        });
        return JSON.stringify({ memory_id: id, status: 'stored' });
      }

      case 'update_memory': {
        const ok = await this.client.updateMemory(args['id'] as string, args['content'] as string);
        return JSON.stringify({ updated: ok });
      }

      case 'delete_memory': {
        const ok = await this.client.deleteMemory(args['id'] as string);
        return JSON.stringify({ deleted: ok });
      }

      case 'list_memories': {
        const memories = await this.client.listMemories({ limit: args['limit'] as number | undefined, type: args['memory_type'] as string | undefined });
        return JSON.stringify({ memories });
      }

      case 'search_memory': {
        const results = await this.client.search(args['query'] as string, {
          topK: (args['top_k'] as number | undefined) ?? 5,
          semantic: (args['semantic'] as boolean | undefined) ?? true,
        });
        return JSON.stringify({ results });
      }

      case 'recall_memory': {
        const memories = await this.client.recall(args['memory_ids'] as string[]);
        return JSON.stringify({ memories });
      }

      // ── Branches ──
      case 'fork_branch': {
        const branch = await this.client.branch(args['name'] as string, args['from_branch_id'] ? String(args['from_branch_id']) : '');
        return JSON.stringify({ branch_id: branch.branchId, name: branch.name, status: 'created' });
      }

      case 'list_branches': return JSON.stringify({ branches: await this.client.listBranches() });
      case 'get_branch': return JSON.stringify(await this.client.getBranch(args['branch_id'] as string));
      case 'get_trunk_branch': return JSON.stringify(await this.client.getTrunkBranch());

      case 'diff_branches': {
        const diff = await this.client.diff(args['source_branch_id'] as string, args['target_branch_id'] as string);
        return JSON.stringify(diff);
      }

      case 'merge_branch': {
        const result = await this.client.merge(
          args['branch_id'] as string,
          (args['target_branch_id'] as string | undefined) ?? '',
          (args['strategy'] as string | undefined) ?? 'last-write'
        );
        return JSON.stringify({ applied: result.applied, conflicts: result.conflicts, success: result.success });
      }

      case 'discard_branch': return JSON.stringify({ discarded: await this.client.discardBranch(args['branch_id'] as string) });
      case 'archive_branch': return JSON.stringify({ archived: await this.client.archiveBranch(args['branch_id'] as string) });

      // ── Sync ──
      case 'sync': return JSON.stringify(await this.client.sync());
      case 'sync_push': return JSON.stringify(await this.client.pushSync());
      case 'sync_pull': return JSON.stringify(await this.client.pullSync());
      case 'sync_status': return JSON.stringify(await this.client.syncStatus());

      // ── Reflect ──
      case 'reflect': return JSON.stringify(await this.client.reflect());
      case 'reflect_facts': return JSON.stringify(await this.client.reflectGetFacts(args['agent_id'] as string));
      case 'reflect_preferences': return JSON.stringify(await this.client.reflectGetPreferences(args['agent_id'] as string));
      case 'reflect_contradictions': return JSON.stringify(await this.client.reflectGetContradictions(args['agent_id'] as string));
      case 'reflect_resolve': return JSON.stringify(await this.client.reflectResolveContradiction(args['agent_id'] as string, args['contradiction_id'] as string, { strategy: args['strategy'] as string }));

      // ── Transactions ──
      case 'tx_begin': return JSON.stringify(await this.client.beginTx());
      case 'tx_remember': return JSON.stringify({ id: args['memory_type'] ? await this.client.txRememberTyped(args['tx_id'] as string, args['content'] as string, { type: args['memory_type'] as string }) : await this.client.txRemember(args['tx_id'] as string, args['content'] as string) });
      case 'tx_commit': return JSON.stringify({ committed: await this.client.commitTx(args['tx_id'] as string) });
      case 'tx_rollback': return JSON.stringify({ rolled_back: await this.client.rollbackTx(args['tx_id'] as string) });

      default:
        return JSON.stringify({ error: 'unknown_tool', message: `Unknown tool: ${toolName}` });
    }
  }
}
