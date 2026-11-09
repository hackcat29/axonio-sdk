# @clawdb/sdk

Official TypeScript client for ClawDB.

## Install

```bash
npm install @clawdb/sdk
```

## Quick Start

### Hosted (Axonio cloud)

Create an API key in the dashboard, then:

```ts
import { ClawDB } from '@clawdb/sdk';

// Talks HTTPS to https://api.axonio.xyz/api/v1/gateway, which routes to your
// workspace's own ClawDB instance. `ClawDB.fromEnv()` does the same when only
// CLAWDB_API_KEY is set.
const db = new ClawDB({
  endpoint: 'https://api.axonio.xyz/api/v1/gateway',
  apiKey: process.env.CLAWDB_API_KEY,
});
```

### Self-hosted

```ts
import { ClawDB } from '@clawdb/sdk';

// gRPC to your own clawdb-server. With no endpoint at all, the SDK downloads
// and starts a local server for you.
const db = new ClawDB({ endpoint: process.env.CLAWDB_URL ?? 'http://localhost:50050' });
```

### Then

```ts
const memoryId = await db.rememberTyped('Ship the changelog on Friday', {
  type: 'task',
  tags: ['release']
});

const hits = await db.search('release plan', { topK: 5, semantic: true });
const branch = await db.branch('release-experiment');
const tx = await db.beginTx();
await db.txRememberTyped(tx.id, 'Draft rollback instructions', { type: 'task' });
await db.commitTx(tx.id);

console.log(memoryId, hits.length, branch.id);
```

## API Surface

Health and sessions:
- `health()`
- `ping()`
- `createSession({ role, scopes, ttlSecs })`
- `validateSession()`
- `revokeSession(sessionId)`
- `activeSessionCount()`

Memory:
- `remember(content)`
- `rememberTyped(content, { type, tags, expiresAt })`
- `updateMemory(memoryId, content)`
- `search(query, { topK, semantic, type, tags })`
- `recall(memoryIds)`
- `listMemories({ type, limit })`
- `deleteMemory(memoryId)`

Branches:
- `branch(name, fromBranchId?)`
- `getBranch(branchId)`
- `getBranchByName(name)`
- `getTrunkBranch()`
- `listBranches()`
- `discardBranch(branchId)`
- `archiveBranch(branchId)`
- `merge(sourceBranchId, targetBranchId, strategy?)`
- `diff(branchId, targetBranchId?)`

Sync:
- `sync()`
- `pushSync()`
- `pullSync()`
- `reconcileSync()`
- `syncStatus()`

Reflection:
- `reflect()`
- `reflectGetFacts(agentId)`
- `reflectListJobs(agentId, { status, limit, offset })`
- `reflectGetJob(jobId)`
- `reflectGetPreferences(agentId)`
- `reflectGetContradictions(agentId)`
- `reflectResolveContradiction(agentId, contradictionId, { strategy, mergedValueJson })`

Transactions:
- `beginTx()`
- `txRemember(txId, content)`
- `txRememberTyped(txId, content, { type, tags, expiresAt })`
- `commitTx(txId)`
- `rollbackTx(txId)`

## Configuration

Constructor options:
- `endpoint`
- `apiKey`
- `agentId`
- `workspace`
- `role`
- `tls`
- `timeoutMs`

Transports: an `http(s)` URL with a path (such as the hosted gateway) uses the
HTTP API; a `host:port` server uses gRPC. Override with `transport: 'grpc' | 'http'`.
Sessions are opened for you, last an hour, and are renewed automatically.

Environment variables:
- `CLAWDB_URL` (optional with an API key: defaults to the hosted cloud)
- `CLAWDB_API_KEY`
- `CLAWDB_AGENT_ID`
- `CLAWDB_WORKSPACE`
- `CLAWDB_ROLE`
- `CLAWDB_TIMEOUT_MS`
