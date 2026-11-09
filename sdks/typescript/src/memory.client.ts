import { ClawDBValidationError } from 'axonio-errors';
import type { ClawDBSession, MemoryRecord, SearchResult } from 'axonio-types';

import { isUuid, normalizeMemoryRecord, normalizeSearchResults, withSession } from './internal';
import type { ListOptions, MemoryUpdateInput, RememberOptions, SearchOptions, SessionExecutor, Transport } from './types';

export class MemoryClient {
  constructor(
    private readonly transport: Transport,
    private readonly session: () => ClawDBSession,
    private readonly executeWithSession: SessionExecutor
  ) {}

  async remember(content: string, options: RememberOptions = {}): Promise<string> {
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new ClawDBValidationError('content must be a non-empty string', 'content', 'non-empty');
    }

    return this.executeWithSession(async () => {
      const response = await this.transport.request<
        Record<string, unknown>,
        { memoryId?: string; memory_id?: string }
      >(
        'Memory.Remember',
        withSession(this.session(), {
          content,
          memoryType: options.memoryType,
          memory_type: options.memoryType,
          tags: options.tags ?? [],
          metadata: options.metadata ?? {},
          metadataJson: options.metadata == null ? undefined : JSON.stringify(options.metadata),
          metadata_json: options.metadata == null ? undefined : JSON.stringify(options.metadata),
          ttlDays: options.ttlDays,
          ttl_days: options.ttlDays
        })
      );

      return response.memoryId ?? response.memory_id ?? '';
    });
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new ClawDBValidationError('query must be a non-empty string', 'query', 'non-empty');
    }

    const topK = options.topK ?? 5;
    if (topK > 100) {
      throw new ClawDBValidationError('topK cannot exceed 100', 'topK', '<=100');
    }

    if (options.alpha != null && (options.alpha < 0 || options.alpha > 1)) {
      throw new ClawDBValidationError('alpha must be between 0 and 1', 'alpha', '0..1');
    }

    return this.executeWithSession(async () => {
      const response = await this.transport.request(
        'Memory.Search',
        withSession(this.session(), {
          query,
          topK,
          top_k: topK,
          semantic: options.semantic ?? true,
          filter: options.filter,
          filterJson: options.filter == null ? undefined : JSON.stringify(options.filter),
          filter_json: options.filter == null ? undefined : JSON.stringify(options.filter),
          alpha: options.alpha
        })
      );

      return normalizeSearchResults(response);
    });
  }

  async recall(memoryIds: string[]): Promise<MemoryRecord[]> {
    if (!Array.isArray(memoryIds) || memoryIds.length === 0) {
      throw new ClawDBValidationError('memoryIds must be a non-empty array', 'memoryIds', 'non-empty-array');
    }

    for (const id of memoryIds) {
      if (!isUuid(id)) {
        throw new ClawDBValidationError(`memoryIds must contain only UUIDs: ${id}`, 'memoryIds', 'uuid');
      }
    }

    return this.executeWithSession(async () => {
      const response = await this.transport.request<
        Record<string, unknown>,
        { memories?: unknown[] }
      >('Memory.Recall', withSession(this.session(), { memoryIds, memory_ids: memoryIds }));

      return (response.memories ?? []).map(normalizeMemoryRecord);
    });
  }

  async forget(memoryId: string): Promise<void> {
    if (!isUuid(memoryId)) {
      throw new ClawDBValidationError('memoryId must be a UUID', 'memoryId', 'uuid');
    }

    await this.executeWithSession(async () => {
      await this.transport.request('Memory.Forget', withSession(this.session(), {
        memoryId,
        memory_id: memoryId,
        softDelete: true,
        soft_delete: true
      }));
    });
  }

  async update(memoryId: string, updates: MemoryUpdateInput): Promise<MemoryRecord> {
    if (!isUuid(memoryId)) {
      throw new ClawDBValidationError('memoryId must be a UUID', 'memoryId', 'uuid');
    }

    return this.executeWithSession(async () => {
      const response = await this.transport.request<
        Record<string, unknown>,
        { memory?: unknown } | unknown
      >(
        'Memory.Update',
        withSession(this.session(), {
          memoryId,
          memory_id: memoryId,
          updates: {
            ...(updates.content !== undefined ? { content: updates.content } : {}),
            ...(updates.tags !== undefined ? { tags: updates.tags } : {}),
            ...(updates.metadata !== undefined ? { metadata: updates.metadata } : {})
          }
        })
      );

      return normalizeMemoryRecord((response as { memory?: unknown }).memory ?? response);
    });
  }

  async list(options: ListOptions = {}): Promise<MemoryRecord[]> {
    return this.executeWithSession(async () => {
      const response = await this.transport.request<
        Record<string, unknown>,
        { memories?: unknown[] }
      >(
        'Memory.List',
        withSession(this.session(), {
          memoryType: options.memoryType,
          memory_type: options.memoryType,
          limit: options.limit,
          offset: options.offset,
          sortBy: options.sortBy,
          sort_by: options.sortBy
        })
      );

      return (response.memories ?? []).map(normalizeMemoryRecord);
    });
  }

  async score(memoryId: string): Promise<{ importance: number; recency: number; confidence: number; composite: number }> {
    if (!isUuid(memoryId)) {
      throw new ClawDBValidationError('memoryId must be a UUID', 'memoryId', 'uuid');
    }

    return this.executeWithSession(async () => {
      const response = await this.transport.request<
        Record<string, unknown>,
        Record<string, unknown>
      >('Memory.Score', withSession(this.session(), { memoryId, memory_id: memoryId }));

      return {
        importance: Number(response.importance ?? 0),
        recency: Number(response.recency ?? 0),
        confidence: Number(response.confidence ?? 0),
        composite: Number(response.composite ?? 0)
      };
    });
  }
}
