# axonio-proto

Generated protobuf and gRPC bindings used by the TypeScript SDK and supporting packages.

## Install

```bash
npm install axonio-proto
```

## Exports

- Generated service and message types from `src/generated/clawdb`
- Shared helper types re-exported from `src/types`

## Example

```ts
import { ClawDBServiceDefinition } from 'axonio-proto';

console.log(Object.keys(ClawDBServiceDefinition.methods));
```

## Regenerating Bindings

```bash
pnpm --filter axonio-proto generate
pnpm --filter axonio-proto build
```

## Notes

- This package is primarily intended for SDK authors and transport-layer integrations.
- Application code should usually depend on `axonio` instead of using protobuf bindings directly.
