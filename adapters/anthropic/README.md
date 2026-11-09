# axonio-anthropic

Anthropic Claude integration for ClawDB memory, branching, sync, reflection, and transactional tools.

## Install

```bash
npm install axonio-anthropic axonio @anthropic-ai/sdk
```

## Exports

- `clawdbTools(client)` returns the Anthropic tool definitions.
- `handleClawDBToolCall(client, toolUse)` executes a Claude tool call against ClawDB.
- `withClawDBMemory(anthropic, client)` injects recalled memory into `messages.create()` calls.

## Quick Start

```ts
import Anthropic from '@anthropic-ai/sdk';
import { ClawDB } from 'axonio';
import { clawdbTools, handleClawDBToolCall, withClawDBMemory } from 'axonio-anthropic';

const client = new ClawDB({ endpoint: 'http://localhost:50050', agentId: 'claude-agent' });
const anthropic = withClawDBMemory(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }), client);

const response = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-latest',
  max_tokens: 1024,
  tools: clawdbTools(client),
  messages: [{ role: 'user', content: 'Plan the release and remember the outcome.' }]
});

for (const block of response.content) {
  if (block.type === 'tool_use') {
    const result = await handleClawDBToolCall(client, block);
    console.log(result);
  }
}
```

## Tool Coverage

Memory tools:
- `clawdb_remember`
- `clawdb_update_memory`
- `clawdb_delete_memory`
- `clawdb_list_memories`
- `clawdb_search`
- `clawdb_recall`

Branch tools:
- `clawdb_branch_fork`
- `clawdb_branch_list`
- `clawdb_branch_get`
- `clawdb_branch_trunk`
- `clawdb_branch_diff`
- `clawdb_branch_merge`
- `clawdb_branch_discard`
- `clawdb_branch_archive`

Sync tools:
- `clawdb_sync`
- `clawdb_sync_push`
- `clawdb_sync_pull`
- `clawdb_sync_status`

Reflection tools:
- `clawdb_reflect`
- `clawdb_reflect_facts`
- `clawdb_reflect_preferences`
- `clawdb_reflect_contradictions`
- `clawdb_reflect_resolve_contradiction`

Transaction tools:
- `clawdb_tx_begin`
- `clawdb_tx_remember`
- `clawdb_tx_commit`
- `clawdb_tx_rollback`

## Notes

- `withClawDBMemory()` searches ClawDB using the latest user turn and appends the hits to the system prompt.
- Use `rememberTyped()` and `txRememberTyped()` in your own code when you need stable memory typing and tags.
- Set `CLAWDB_URL`, `CLAWDB_API_KEY`, and `CLAWDB_AGENT_ID` to target a managed deployment.
