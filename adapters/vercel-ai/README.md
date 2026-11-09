# axonio-vercel-ai

Vercel AI SDK integration for ClawDB.

## Install

```bash
npm install axonio-vercel-ai axonio ai
```

## Exports

- `clawdbTools(client)`
- `clawdbMiddleware(client)`
- `useClawDB(options)`

## Quick Start

```ts
import { generateText } from 'ai';
import { ClawDB } from 'axonio';
import { clawdbTools, clawdbMiddleware } from 'axonio-vercel-ai';

const db = new ClawDB({ endpoint: 'http://localhost:50050', agentId: 'vercel-ai-agent' });

const result = await generateText({
  model,
  prompt: 'Remember that the customer wants weekly reports.',
  tools: clawdbTools(db),
  experimental_transform: clawdbMiddleware(db)
});

console.log(result.text);
```

## Tool Coverage

- Memory: `remember`, `update_memory`, `delete_memory`, `list_memories`, `search`, `recall`
- Branches: `branch_fork`, `branch_list`, `branch_get`, `branch_trunk`, `branch_diff`, `branch_merge`, `branch_discard`, `branch_archive`
- Sync: `sync`, `sync_push`, `sync_pull`, `sync_status`
- Reflection: `reflect`, `reflect_facts`, `reflect_preferences`, `reflect_contradictions`, `reflect_resolve_contradiction`
- Transactions: `tx_begin`, `tx_remember`, `tx_commit`, `tx_rollback`
