# axonio-types

Shared TypeScript domain types used across ClawDB SDKs and adapters.

## Install

```bash
npm install axonio-types
```

## Exports

Core models:
- `MemoryRecord`
- `MemoryType`
- `SearchResult`
- `BranchInfo`
- `BranchStatus`
- `SyncResult`
- `ReflectJob`
- `ClawDBSession`
- `ClawDBConfig`
- `ClawDBError`
- `ClawDBErrorCode`

## Example

```ts
import type { MemoryRecord, MemoryType } from 'axonio-types';

const kind: MemoryType = 'task';
const memory: Partial<MemoryRecord> = {
  content: 'Ship release notes',
  memoryType: kind,
};
```

## Notes

- `createdAt`, `updatedAt`, and related temporal fields are represented as `Date` objects in the TypeScript surface.
- Error codes here are the shared wire-level codes; `axonio-errors` extends them with client-only variants such as `SESSION_EXPIRED`.
