import type { BranchInfo, BranchStatus, ClawDBSession } from 'axonio-types';

import { evaluateBranchDiff, normalizeBranchInfo, normalizeDiffResult, normalizeMergeResult, withSession } from './internal';
import type { BranchEvaluation, DiffResult, MergeResult, SessionExecutor, Transport } from './types';

export class BranchClient {
  constructor(
    private readonly transport: Transport,
    private readonly session: () => ClawDBSession,
    private readonly executeWithSession: SessionExecutor,
    private readonly dbFactory?: () => unknown
  ) {}

  async fork(name: string, options: { parent?: string; description?: string } = {}): Promise<BranchInfo> {
    return this.executeWithSession(async () => {
      const response = await this.transport.request<
        Record<string, unknown>,
        { branch?: unknown } | unknown
      >(
        'Branch.Fork',
        withSession(this.session(), {
          name,
          branchName: name,
          branch_name: name,
          parent: options.parent ?? 'trunk',
          parentBranchName: options.parent ?? 'trunk',
          parent_branch_name: options.parent ?? 'trunk',
          description: options.description
        })
      );

      return normalizeBranchInfo((response as { branch?: unknown }).branch ?? response);
    });
  }

  async list(options: { status?: BranchStatus } = {}): Promise<BranchInfo[]> {
    return this.executeWithSession(async () => {
      const response = await this.transport.request<
        Record<string, unknown>,
        { branches?: unknown[] }
      >('Branch.List', withSession(this.session(), { status: options.status }));

      return (response.branches ?? []).map(normalizeBranchInfo);
    });
  }

  async get(nameOrId: string): Promise<BranchInfo> {
    return this.executeWithSession(async () => {
      const response = await this.transport.request<
        Record<string, unknown>,
        { branch?: unknown } | unknown
      >('Branch.Get', withSession(this.session(), { nameOrId, name_or_id: nameOrId }));

      return normalizeBranchInfo((response as { branch?: unknown }).branch ?? response);
    });
  }

  async diff(branchA: string, branchB: string): Promise<DiffResult> {
    return this.executeWithSession(async () => {
      const response = await this.transport.request(
        'Branch.Diff',
        withSession(this.session(), { branchA, branchB, branch_a: branchA, branch_b: branchB })
      );

      return normalizeDiffResult(response);
    });
  }

  async merge(source: string, options: { into?: string; strategy?: 'ours' | 'theirs' | 'union' } = {}): Promise<MergeResult> {
    return this.executeWithSession(async () => {
      const response = await this.transport.request(
        'Branch.Merge',
        withSession(this.session(), {
          source,
          sourceBranch: source,
          source_branch: source,
          into: options.into ?? 'trunk',
          targetBranch: options.into ?? 'trunk',
          target_branch: options.into ?? 'trunk',
          strategy: options.strategy ?? 'union'
        })
      );

      return normalizeMergeResult(response);
    });
  }

  async discard(nameOrId: string): Promise<void> {
    await this.executeWithSession(async () => {
      await this.transport.request('Branch.Discard', withSession(this.session(), { nameOrId, name_or_id: nameOrId }));
    });
  }

  async archive(nameOrId: string): Promise<void> {
    await this.executeWithSession(async () => {
      await this.transport.request('Branch.Archive', withSession(this.session(), { nameOrId, name_or_id: nameOrId }));
    });
  }

  async simulate<T>(name: string, fn: (db: unknown) => Promise<T>): Promise<{ result: T; evaluation: BranchEvaluation }> {
    const sandbox = await this.fork(`sandbox-${name}-${Date.now()}`, { parent: name });

    try {
      const result = await fn(this.dbFactory?.());
      const diff = await this.diff(sandbox.id, sandbox.parentId ?? 'trunk');
      const evaluation = evaluateBranchDiff(diff);

      await this.discard(sandbox.id);

      return { result, evaluation };
    } catch (error) {
      await this.discard(sandbox.id);
      throw error;
    }
  }
}
