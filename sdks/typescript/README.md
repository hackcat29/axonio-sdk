# @axonio/sdk

Official TypeScript client for [Axonio](https://axonio.xyz): persistent memory for AI agents.

> Formerly `@clawdb/sdk`. The `ClawDB` class is still exported (and `Axonio` is the same class), and the `CLAWDB_*` environment variables still work; `AXONIO_*` takes precedence.

## Install

```bash
npm install @axonio/sdk
```

## Quick Start

### Hosted (Axonio cloud)

Create an API key in the dashboard, then:

```ts
import { Axonio } from '@axonio/sdk';

// Talks HTTPS to https://api.axonio.xyz/api/v1/gateway, which routes to your
// workspace's own ClawDB instance. `Axonio.fromEnv()` does the same when only
// AXONIO_API_KEY is set.
const db = new Axonio({
  endpoint: 'https://api.axonio.xyz/api/v1/gateway',
  apiKey: process.env.AXONIO_API_KEY,
});
```

### Self-hosted

```ts
import { Axonio } from '@axonio/sdk';

// gRPC to your own clawdb-server. With no endpoint at all, the SDK downloads
// and starts a local server for you.
const db = new Axonio({ endpoint: process.env.AXONIO_URL ?? 'http://localhost:50050' });
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
- `AXONIO_URL` (optional with an API key: defaults to the hosted cloud)
- `AXONIO_API_KEY`
- `AXONIO_AGENT_ID`
- `AXONIO_WORKSPACE`
- `AXONIO_ROLE`
- `AXONIO_TIMEOUT_MS`
