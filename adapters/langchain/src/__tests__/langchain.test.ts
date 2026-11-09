import { describe, expect, it, vi } from 'vitest';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

import { ClawDBRetriever } from '../retrievers/clawdb-retriever.js';
import { ClawDBChatMessageHistory } from '../memory/clawdb-chat-memory.js';
import { createClawDBTools } from '../tools/clawdb-tools.js';

const EXPECTED_TOOL_NAMES = [
  'clawdb_remember',
  'clawdb_search',
  'clawdb_recall',
  'clawdb_update_memory',
  'clawdb_delete_memory',
  'clawdb_list_memories',
  'clawdb_branch_fork',
  'clawdb_branch_list',
  'clawdb_branch_get',
  'clawdb_branch_trunk',
  'clawdb_branch_diff',
  'clawdb_branch_merge',
  'clawdb_branch_discard',
  'clawdb_branch_archive',
  'clawdb_sync',
  'clawdb_sync_push',
  'clawdb_sync_pull',
  'clawdb_sync_status',
  'clawdb_reflect',
  'clawdb_reflect_facts',
  'clawdb_reflect_preferences',
  'clawdb_reflect_contradictions',
  'clawdb_reflect_resolve',
  'clawdb_tx_begin',
  'clawdb_tx_remember',
  'clawdb_tx_commit',
  'clawdb_tx_rollback'
] as const;

function makeMockDb() {
  return {
    search: vi.fn().mockResolvedValue([
      {
        id: 'm-1',
        content: 'remember this',
        score: 0.9,
        memoryType: 'message',
        tags: ['session:s1'],
        metadata: { role: 'human' },
        createdAt: new Date('2025-01-01T00:00:00Z')
      }
    ]),
    rememberTyped: vi.fn().mockResolvedValue('m-1'),
    listMemories: vi.fn().mockResolvedValue([
      {
        id: 'm-1',
        content: 'first',
        memoryType: 'message',
        tags: ['session:s1', 'human']
      },
      {
        id: 'm-2',
        content: 'second',
        memoryType: 'message',
        tags: ['session:s1', 'ai']
      }
    ]),
    deleteMemory: vi.fn().mockResolvedValue(true)
  } as unknown as import('axonio').ClawDB;
}

describe('langchain adapter', () => {
  it('retriever maps SearchHit to Document', async () => {
    const db = makeMockDb();
    const retriever = new ClawDBRetriever({ client: db, topK: 3 });

    const docs = await retriever.getRelevantDocuments('q');

    expect(docs).toHaveLength(1);
    expect(docs[0]?.pageContent).toBe('remember this');
  });

  it('chat history stores and reads session messages', async () => {
    const db = makeMockDb();
    const history = new ClawDBChatMessageHistory({ client: db, sessionId: 's1' });

    await history.addMessage(new HumanMessage('hello'));
    const messages = await history.getMessages();

    expect(messages).toHaveLength(2);
    expect(messages[0]).toBeInstanceOf(HumanMessage);
    expect(messages[1]).toBeInstanceOf(AIMessage);
  });

  it('tools include remember/search/recall', () => {
    const db = makeMockDb();
    const tools = createClawDBTools(db);

    expect(tools.map((t) => t.name)).toEqual(EXPECTED_TOOL_NAMES);
  });
});
