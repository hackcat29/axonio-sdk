# axonio-openai-agents

OpenAI Agents SDK integration for ClawDB.

## Install

```bash
npm install axonio-openai-agents axonio @openai/agents
```

## Exports

- `createClawDBAgentTools(client)`
- `ClawDBToolHandler`
- `withClawDBMemory(agent, client)`

## Quick Start

```ts
import { ClawDB } from 'axonio';
import { createClawDBAgentTools, ClawDBToolHandler } from 'axonio-openai-agents';

const db = new ClawDB({ endpoint: 'http://localhost:50050', agentId: 'openai-agent' });
const tools = createClawDBAgentTools(db);
const handler = new ClawDBToolHandler(db);

const result = await handler.handle('remember_memory', {
  content: 'The deployment window starts at 17:00 UTC',
  memory_type: 'context'
});

console.log(result, tools.length);
```

## Tool Coverage

- Memory: `remember_memory`, `update_memory`, `delete_memory`, `list_memories`, `search_memory`, `recall_memory`
- Branches: `fork_branch`, `list_branches`, `get_branch`, `get_trunk_branch`, `diff_branches`, `merge_branch`, `discard_branch`, `archive_branch`
- Sync: `sync`, `sync_push`, `sync_pull`, `sync_status`
- Reflection: `reflect`, `reflect_facts`, `reflect_preferences`, `reflect_contradictions`, `reflect_resolve`
- Transactions: `tx_begin`, `tx_remember`, `tx_commit`, `tx_rollback`
