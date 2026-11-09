import { ClawDBValidationError } from 'axonio-errors';
import type { ClawDBSession } from 'axonio-types';

import { normalizeBatchError, withSession } from './internal';
import type { BatchOp, BatchResult, RememberOptions, SessionExecutor, Transport } from './types';

const MAX_BATCH_SIZE = 100;

export class BatchClient {
  private readonly queue: BatchOp[] = [];

  constructor(
    private readonly transport: Transport,
    private readonly session: () => ClawDBSession,
    private readonly executeWithSession: SessionExecutor
  ) {}

  remember(items: RememberOptions[]): BatchBuilder {
    for (const item of items) {
      if (typeof item.content !== 'string' || item.content.trim().length === 0) {
        throw new ClawDBValidationError('Batch remember requires a non-empty content field', 'content', 'non-empty');
      }

      this.queue.push({
        type: 'remember',
        content: item.content,
        options: item
      });
    }

    return new BatchBuilder(this.transport, this.session, this.executeWithSession, [...this.queue]);
  }

  async execute(): Promise<BatchResult[]> {
    return new BatchBuilder(this.transport, this.session, this.executeWithSession, [...this.queue]).execute();
  }

  get maxBatchSize(): number {
    return MAX_BATCH_SIZE;
  }
}

export class BatchBuilder {
  constructor(
    private readonly transport: Transport,
    private readonly session: () => ClawDBSession,
    private readonly executeWithSession: SessionExecutor,
    private readonly queue: BatchOp[] = []
  ) {}

  add(op: BatchOp): BatchBuilder {
    this.queue.push(op);
    return this;
  }

  async execute(): Promise<BatchResult[]> {
    if (this.queue.length > MAX_BATCH_SIZE) {
      throw new ClawDBValidationError('Batch size exceeds maxBatchSize', 'batch', '<=100');
    }

    return this.executeWithSession(async () => {
      const results: BatchResult[] = [];

      for (const op of this.queue) {
        try {
          if (op.type === 'remember') {
            const result = await this.transport.request('Memory.Remember', withSession(this.session(), {
              content: op.content,
              memoryType: op.options?.memoryType,
              memory_type: op.options?.memoryType,
              tags: op.options?.tags ?? [],
              metadata: op.options?.metadata ?? {},
              ttlDays: op.options?.ttlDays,
              ttl_days: op.options?.ttlDays
            }));

            results.push({ ok: true, result });
          } else {
            const result = await this.transport.request('Memory.Forget', withSession(this.session(), {
              memoryId: op.memoryId,
              memory_id: op.memoryId,
              softDelete: true,
              soft_delete: true
            }));

            results.push({ ok: true, result });
          }
        } catch (error) {
          results.push({ ok: false, error: normalizeBatchError(error) });
        }
      }

      return results;
    });
  }
}
