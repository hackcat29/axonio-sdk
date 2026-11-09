# axonio-errors

Shared ClawDB error classes for TypeScript clients and adapters.

## Install

```bash
npm install axonio-errors
```

## Exports

Base classes:
- `ClawDBError`
- `ClawDBAuthError`
- `ClawDBAccessDeniedError`
- `ClawDBNotFoundError`
- `ClawDBRateLimitError`
- `ClawDBUnavailableError`
- `ClawDBTimeoutError`
- `ClawDBValidationError`
- `ClawDBInternalError`

Types:
- `ClawDBErrorCode`

## Example

```ts
import { ClawDBError, ClawDBNotFoundError } from 'axonio-errors';

try {
  throw new ClawDBNotFoundError('Memory not found', 'memory', 'mem_123');
} catch (error) {
  if (ClawDBError.isClawDBError(error)) {
    console.error(error.code, error.message);
  }
}
```

## Notes

- Each error optionally carries `details` and `requestId`.
- `ClawDBRateLimitError` parses retry headers into `retryAfterMs`.
- `ClawDBValidationError` exposes `field` and `constraint` when the server provides them.
