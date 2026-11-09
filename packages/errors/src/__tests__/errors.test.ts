import { describe, expect, it } from 'vitest';

import {
  ClawDBAccessDeniedError,
  ClawDBAuthError,
  ClawDBError,
  ClawDBInternalError,
  ClawDBNotFoundError,
  ClawDBRateLimitError,
  ClawDBTimeoutError,
  ClawDBUnavailableError,
  ClawDBValidationError,
  fromGrpcStatus,
  fromHttpResponse
} from '../index';

describe('axonio-errors', () => {
  it('serializes base errors with toJSON', () => {
    const error = new ClawDBError('INTERNAL', 'boom', { trace: true }, 'req-1');

    expect(error.toJSON()).toEqual({
      name: 'ClawDBError',
      code: 'INTERNAL',
      message: 'boom',
      details: { trace: true },
      requestId: 'req-1'
    });
  });

  it('marks auth errors as ClawDB errors', () => {
    const error = new ClawDBAuthError('INVALID_API_KEY', 'bad key');

    expect(error).toBeInstanceOf(ClawDBError);
    expect(ClawDBError.isClawDBError(error)).toBe(true);
  });

  it('rejects non-ClawDB errors in the type guard', () => {
    expect(ClawDBError.isClawDBError(new Error('plain'))).toBe(false);
  });

  it('stores access denied resource context', () => {
    const error = new ClawDBAccessDeniedError('denied', 'memory', 'write');

    expect(error.resource).toBe('memory');
    expect(error.action).toBe('write');
  });

  it('stores not found entity context', () => {
    const error = new ClawDBNotFoundError('missing', 'branch', 'branch-1');

    expect(error.entityType).toBe('branch');
    expect(error.entityId).toBe('branch-1');
  });

  it('stores retryAfterMs on rate limit errors', () => {
    const error = new ClawDBRateLimitError('slow down', 2500);

    expect(error.retryAfterMs).toBe(2500);
  });

  it('uses the default unavailable message', () => {
    const error = new ClawDBUnavailableError();

    expect(error.message).toBe('Service unavailable');
  });

  it('stores timeoutMs on timeout errors', () => {
    const error = new ClawDBTimeoutError('timed out', 4500);

    expect(error.timeoutMs).toBe(4500);
  });

  it('stores field metadata on validation errors', () => {
    const error = new ClawDBValidationError('bad field', 'alpha', 'between-0-and-1');

    expect(error.field).toBe('alpha');
    expect(error.constraint).toBe('between-0-and-1');
  });

  it('uses the default internal error message', () => {
    const error = new ClawDBInternalError();

    expect(error.message).toBe('Internal server error');
  });

  it('maps unauthenticated gRPC status to auth errors', () => {
    const error = fromGrpcStatus({ code: 16, message: 'expired' });

    expect(error).toBeInstanceOf(ClawDBAuthError);
    expect(error.code).toBe('AUTH_FAILED');
  });

  it('maps resource exhausted gRPC status and parses retry-after metadata', () => {
    const error = fromGrpcStatus({
      code: 8,
      message: 'too many requests',
      metadata: { 'retry-after-ms': '275', 'x-request-id': 'req-grpc-1' }
    });

    expect(error).toBeInstanceOf(ClawDBRateLimitError);
    expect((error as ClawDBRateLimitError).retryAfterMs).toBe(275);
    expect(error.requestId).toBe('req-grpc-1');
  });

  it('maps deadline exceeded gRPC status to timeout errors', () => {
    const error = fromGrpcStatus({ code: 4, message: 'deadline exceeded' });

    expect(error).toBeInstanceOf(ClawDBTimeoutError);
  });

  it('maps HTTP responses to typed errors', () => {
    expect(fromHttpResponse(403, { message: 'forbidden', resource: 'memory', action: 'write' })).toBeInstanceOf(
      ClawDBAccessDeniedError
    );
    expect(fromHttpResponse(404, { message: 'missing', entityType: 'memory', entityId: 'm-1' })).toBeInstanceOf(
      ClawDBNotFoundError
    );
    expect(fromHttpResponse(429, { message: 'slow down', retryAfterMs: 123 })).toBeInstanceOf(ClawDBRateLimitError);
    expect(fromHttpResponse(408, { message: 'timeout', timeoutMs: 9000 })).toBeInstanceOf(ClawDBTimeoutError);
    expect(fromHttpResponse(503, { message: 'offline' })).toBeInstanceOf(ClawDBUnavailableError);
  });

  it('preserves instanceof across mapped subclasses', () => {
    const error = fromHttpResponse(401, { code: 'SESSION_EXPIRED', message: 'session expired' });

    expect(error).toBeInstanceOf(ClawDBError);
    expect(error).toBeInstanceOf(ClawDBAuthError);
    expect(error.code).toBe('SESSION_EXPIRED');
  });
});
