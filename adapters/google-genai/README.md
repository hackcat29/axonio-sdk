# axonio-google-genai

Google Generative AI integration for ClawDB tools and automatic memory context injection.

## Install

```bash
npm install axonio-google-genai axonio @google/generative-ai
```

## Exports

- `clawdbTools(client)` returns `FunctionDeclaration[]` for Gemini tool use.
- `handleClawDBFunctionCall(client, call)` executes a function call against ClawDB.
- `withClawDBMemory(model, client)` patches `generateContent()` to prepend recalled memory.

## Quick Start

```ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ClawDB } from 'axonio';
import { clawdbTools, handleClawDBFunctionCall, withClawDBMemory } from 'axonio-google-genai';

const db = new ClawDB({ endpoint: 'http://localhost:50050', agentId: 'gemini-agent' });
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
const model = withClawDBMemory(genAI.getGenerativeModel({ model: 'gemini-1.5-pro' }), db);

const result = await model.generateContent({
  contents: [{ role: 'user', parts: [{ text: 'Remember that the customer wants weekly reports.' }] }],
  tools: [{ functionDeclarations: clawdbTools(db) }]
});

const call = result.response.functionCalls?.()[0];
if (call) {
  console.log(await handleClawDBFunctionCall(db, call));
}
```

## Function Coverage

Supported functions are grouped into memory, branch, sync, reflection, and transaction operations:
- Memory: `clawdb_remember`, `clawdb_update_memory`, `clawdb_delete_memory`, `clawdb_list_memories`, `clawdb_search`, `clawdb_recall`
- Branches: `clawdb_branch_fork`, `clawdb_branch_list`, `clawdb_branch_get`, `clawdb_branch_trunk`, `clawdb_branch_diff`, `clawdb_branch_merge`, `clawdb_branch_discard`, `clawdb_branch_archive`
- Sync: `clawdb_sync`, `clawdb_sync_push`, `clawdb_sync_pull`, `clawdb_sync_status`
- Reflection: `clawdb_reflect`, `clawdb_reflect_facts`, `clawdb_reflect_preferences`, `clawdb_reflect_contradictions`, `clawdb_reflect_resolve_contradiction`, `clawdb_reflect_list_jobs`, `clawdb_reflect_get_job`
- Transactions: `clawdb_tx_begin`, `clawdb_tx_remember`, `clawdb_tx_commit`, `clawdb_tx_rollback`

## Notes

- Branch creation maps to `client.branch(name, fromBranchId)`.
- Contradiction resolution maps to `client.reflectResolveContradiction(agentId, contradictionId, { strategy })`.
- Transaction writes use `txRememberTyped()` automatically when `memory_type` is supplied.
