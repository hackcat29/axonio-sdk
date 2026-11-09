# axonio-openclaw

OpenClaw plugin for ClawDB-backed memory retrieval, persistence, branching, sync, reflection, and transactions.

## Install

```bash
npm install axonio-openclaw axonio openclaw
```

## Exports

- `ClawDBPlugin(options)` creates an OpenClaw plugin instance.
- `withClawDB(agent, options)` appends the plugin to an agent.
- `formatMemoryContext(hits)` formats search hits for prompt injection.

## Quick Start

```ts
import { withClawDB } from 'axonio-openclaw';

const agent = withClawDB(myAgent, {
  autoStore: true,
  autoSearch: true,
  topK: 5,
  syncOnShutdown: false,
  endpoint: 'http://localhost:50050'
});
```

## Plugin Options

- `autoStore`: persist user and assistant turns automatically.
- `autoSearch`: search ClawDB before each turn and inject the results into context.
- `topK`: number of search hits injected when `autoSearch` is enabled.
- `syncOnShutdown`: push a sync before agent shutdown.
- `endpoint`: override the default ClawDB endpoint.

## Included Tools

- Memory: `clawdb_remember`, `clawdb_update_memory`, `clawdb_delete_memory`, `clawdb_list_memories`, `clawdb_search`, `clawdb_recall`
- Branches: `clawdb_branch_fork`, `clawdb_branch_list`, `clawdb_branch_get`, `clawdb_branch_trunk`, `clawdb_branch_diff`, `clawdb_branch_merge`, `clawdb_branch_discard`, `clawdb_branch_archive`
- Sync: `clawdb_sync`, `clawdb_sync_push`, `clawdb_sync_pull`, `clawdb_sync_status`
- Reflection: `clawdb_reflect`, `clawdb_reflect_facts`, `clawdb_reflect_preferences`, `clawdb_reflect_contradictions`, `clawdb_reflect_resolve`
- Transactions: `clawdb_tx_begin`, `clawdb_tx_remember`, `clawdb_tx_commit`, `clawdb_tx_rollback`

## Environment

The plugin reads `CLAWDB_URL`, `CLAWDB_API_KEY`, and `CLAWDB_AGENT_ID`. If only `CLAWDB_API_KEY` is present, it targets the default cloud endpoint.
