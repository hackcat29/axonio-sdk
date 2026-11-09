# axonio-langchain

LangChain.js integration for ClawDB retrieval, chat history, and tools.

## Install

```bash
npm install axonio-langchain axonio @langchain/core langchain
```

## Exports

- `ClawDBRetriever`
- `ClawDBChatMessageHistory`
- `createClawDBTools(client)`
- `ClawDBMemoryStore`

## Quick Start

```ts
import { ClawDB } from 'axonio';
import { ClawDBRetriever, ClawDBChatMessageHistory, createClawDBTools } from 'axonio-langchain';

const db = new ClawDB({ endpoint: 'http://localhost:50050', agentId: 'langchain-agent' });

const retriever = new ClawDBRetriever({ client: db, topK: 5 });
const history = new ClawDBChatMessageHistory({ client: db, sessionId: 'chat-1' });
const tools = createClawDBTools(db);

console.log(await retriever.getRelevantDocuments('deployment checklist'));
console.log(tools.length, history);
```

## Tool Coverage

- Memory: `clawdb_remember`, `clawdb_update_memory`, `clawdb_delete_memory`, `clawdb_list_memories`, `clawdb_search`, `clawdb_recall`
- Branches: `clawdb_branch_fork`, `clawdb_branch_list`, `clawdb_branch_get`, `clawdb_branch_trunk`, `clawdb_branch_diff`, `clawdb_branch_merge`, `clawdb_branch_discard`, `clawdb_branch_archive`
- Sync: `clawdb_sync`, `clawdb_sync_push`, `clawdb_sync_pull`, `clawdb_sync_status`
- Reflection: `clawdb_reflect`, `clawdb_reflect_facts`, `clawdb_reflect_preferences`, `clawdb_reflect_contradictions`, `clawdb_reflect_resolve`
- Transactions: `clawdb_tx_begin`, `clawdb_tx_remember`, `clawdb_tx_commit`, `clawdb_tx_rollback`
