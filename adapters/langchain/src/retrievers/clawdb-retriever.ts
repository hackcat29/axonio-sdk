import type { ClawDB, SearchHit } from 'axonio';
import { Document } from '@langchain/core/documents';
import { BaseRetriever } from '@langchain/core/retrievers';
import type { CallbackManagerForRetrieverRun } from '@langchain/core/callbacks/manager';

export type { CallbackManagerForRetrieverRun };

/**
 * A LangChain BaseRetriever-compatible implementation backed by ClawDB.
 *
 * Compatible with @langchain/core ^0.2.
 *
 * @example
 * ```ts
 * const retriever = new ClawDBRetriever({ client: db, topK: 8 });
 * const docs = await retriever.getRelevantDocuments("What tasks are due today?");
 * ```
 */
export class ClawDBRetriever extends BaseRetriever {
  readonly lc_namespace = ['clawdb', 'retrievers'];

  private readonly client: ClawDB;
  private readonly topK: number;
  private readonly filter: Record<string, unknown> | undefined;
  private readonly semantic: boolean;

  constructor(fields: {
    client: ClawDB;
    topK?: number;
    filter?: Record<string, unknown>;
    semantic?: boolean;
  }) {
    super({});
    this.client = fields.client;
    this.topK = fields.topK ?? 5;
    this.filter = fields.filter;
    this.semantic = fields.semantic ?? true;
  }

  async _getRelevantDocuments(
    query: string,
    _runManager?: CallbackManagerForRetrieverRun
  ): Promise<Document[]> {
    const results: SearchHit[] = await this.client.search(query, {
      topK: this.topK,
      semantic: this.semantic,
      filter: this.filter,
    });

    return results.map((r) => new Document({
      pageContent: r.content,
      metadata: {
        id: r.id,
        score: r.score,
        memoryType: r.memoryType,
        tags: r.tags,
        createdAt: r.createdAt,
        ...r.metadata,
      },
    }));
  }
}
