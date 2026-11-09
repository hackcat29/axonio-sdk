import type { GrpcMetadata, GrpcStatus } from 'axonio-proto';
import type { ClawDBErrorCode as SharedErrorCode } from 'axonio-types';

export type ClawDBErrorCode = SharedErrorCode | 'SESSION_EXPIRED' | 'INVALID_API_KEY';

type ErrorBody = Record<string, unknown> | undefined;

export class ClawDBError extends Error {
  constructor(
    public readonly code: ClawDBErrorCode,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = 'ClawDBError';
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      requestId: this.requestId
    };
  }

  static isClawDBError(error: unknown): error is ClawDBError {
    return error instanceof ClawDBError;
  }
}

export class ClawDBAuthError extends ClawDBError {
  constructor(
    code: 'AUTH_FAILED' | 'SESSION_EXPIRED' | 'INVALID_API_KEY' = 'AUTH_FAILED',
    message = 'Authentication failed',
    details?: unknown,
    requestId?: string
  ) {
    super(code, message, details, requestId);
    this.name = 'ClawDBAuthError';
  }
}

export class ClawDBAccessDeniedError extends ClawDBError {
  constructor(
    message = 'Access denied',
    public readonly resource = 'unknown',
    public readonly action = 'unknown',
    details?: unknown,
    requestId?: string
  ) {
    super('ACCESS_DENIED', message, details, requestId);
    this.name = 'ClawDBAccessDeniedError';
  }
}

export class ClawDBNotFoundError extends ClawDBError {
  constructor(
    message = 'Resource not found',
    public readonly entityType = 'entity',
    public readonly entityId = 'unknown',
    details?: unknown,
    requestId?: string
  ) {
    super('NOT_FOUND', message, details, requestId);
    this.name = 'ClawDBNotFoundError';
  }
}

export class ClawDBRateLimitError extends ClawDBError {
  constructor(
    message = 'Rate limit exceeded',
    public readonly retryAfterMs = 1000,
    details?: unknown,
    requestId?: string
  ) {
    super('RATE_LIMITED', message, details, requestId);
    this.name = 'ClawDBRateLimitError';
  }
}

export class ClawDBUnavailableError extends ClawDBError {
  constructor(message = 'Service unavailable', details?: unknown, requestId?: string) {
    super('UNAVAILABLE', message, details, requestId);
    this.name = 'ClawDBUnavailableError';
  }
}

export class ClawDBTimeoutError extends ClawDBError {
  constructor(message = 'Request timed out', public readonly timeoutMs = 30000, details?: unknown, requestId?: string) {
    super('TIMEOUT', message, details, requestId);
    this.name = 'ClawDBTimeoutError';
  }
}

export class ClawDBValidationError extends ClawDBError {
  constructor(
    message = 'Invalid input',
    public readonly field?: string,
    public readonly constraint?: string,
    details?: unknown,
    requestId?: string
  ) {
    super('INVALID_INPUT', message, details, requestId);
    this.name = 'ClawDBValidationError';
  }
}

export class ClawDBInternalError extends ClawDBError {
  constructor(message = 'Internal server error', details?: unknown, requestId?: string) {
    super('INTERNAL', message, details, requestId);
    this.name = 'ClawDBInternalError';
  }
}

function getMetadataValue(metadata: GrpcMetadata | undefined, key: string): unknown {
  if (metadata == null) {
    return undefined;
  }

  if (typeof (metadata as { get?: unknown }).get === 'function') {
    return (metadata as { get(name: string): unknown }).get(key);
  }

  return (metadata as Record<string, unknown>)[key];
}

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function parseMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) {
    return body;
  }

  if (typeof body === 'object' && body !== null) {
    const candidate =
      ('message' in body && typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : undefined) ??
      ('error' in body && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : undefined);

    if (candidate && candidate.trim()) {
      return candidate;
    }
  }

  return fallback;
}

function parseRequestId(metadata: GrpcMetadata | undefined, body?: ErrorBody): string | undefined {
  const metadataRequestId =
    firstValue(getMetadataValue(metadata, 'x-request-id')) ?? firstValue(getMetadataValue(metadata, 'request-id'));
  if (metadataRequestId != null) {
    return String(metadataRequestId);
  }

  if (body?.requestId != null) {
    return String(body.requestId);
  }

  if (body?.request_id != null) {
    return String(body.request_id);
  }

  return undefined;
}

function parseRetryAfterMs(metadata: GrpcMetadata | undefined, body?: ErrorBody): number {
  const retryAfterMsRaw = firstValue(getMetadataValue(metadata, 'retry-after-ms')) ?? body?.retryAfterMs ?? body?.retry_after_ms;
  if (retryAfterMsRaw != null) {
    const parsed = Number(String(retryAfterMsRaw).replace(/ms$/iu, '').trim());
    return Number.isFinite(parsed) ? Math.max(parsed, 0) : 1000;
  }

  const raw = firstValue(getMetadataValue(metadata, 'retry-after')) ?? body?.retryAfter ?? body?.retry_after;

  if (raw == null) {
    return 1000;
  }

  if (typeof raw === 'string' && /ms$/i.test(raw.trim())) {
    const parsed = Number(raw.replace(/ms$/i, '').trim());
    return Number.isFinite(parsed) ? Math.max(parsed, 0) : 1000;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 1000;
  }

  if (typeof raw === 'string' && /^\d+$/.test(raw.trim()) && raw.trim().length <= 3) {
    return Math.max(parsed * 1000, 0);
  }

  return Math.max(parsed, 0);
}

function parseTimeoutMs(body?: ErrorBody): number {
  const raw = body?.timeoutMs ?? body?.timeout_ms;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 30000;
}

function parseField(body?: ErrorBody): string | undefined {
  const raw = body?.field ?? body?.fieldName ?? body?.field_name;
  return raw == null ? undefined : String(raw);
}

function parseConstraint(body?: ErrorBody): string | undefined {
  const raw = body?.constraint ?? body?.rule;
  return raw == null ? undefined : String(raw);
}

function parseResource(body?: ErrorBody): string {
  const raw = body?.resource ?? body?.entityType ?? body?.entity_type;
  return raw == null ? 'unknown' : String(raw);
}

function parseAction(body?: ErrorBody): string {
  const raw = body?.action ?? body?.operation;
  return raw == null ? 'unknown' : String(raw);
}

function parseEntityType(body?: ErrorBody): string {
  const raw = body?.entityType ?? body?.entity_type ?? body?.resource;
  return raw == null ? 'entity' : String(raw);
}

function parseEntityId(body?: ErrorBody): string {
  const raw = body?.entityId ?? body?.entity_id ?? body?.id;
  return raw == null ? 'unknown' : String(raw);
}

function parseAuthCode(body?: ErrorBody): 'AUTH_FAILED' | 'SESSION_EXPIRED' | 'INVALID_API_KEY' {
  const raw = body?.code ?? body?.errorCode ?? body?.error_code;
  if (raw === 'SESSION_EXPIRED') {
    return 'SESSION_EXPIRED';
  }
  if (raw === 'INVALID_API_KEY') {
    return 'INVALID_API_KEY';
  }
  return 'AUTH_FAILED';
}

export function fromGrpcStatus(status: GrpcStatus): ClawDBError {
  const requestId = parseRequestId(status.metadata);
  const message = parseMessage(status.message ?? status.details, 'gRPC request failed');

  switch (status.code) {
    case 16:
      return new ClawDBAuthError('AUTH_FAILED', message, status, requestId);
    case 7:
      return new ClawDBAccessDeniedError(message, 'unknown', 'unknown', status, requestId);
    case 5:
      return new ClawDBNotFoundError(message, 'entity', 'unknown', status, requestId);
    case 8:
      return new ClawDBRateLimitError(message, parseRetryAfterMs(status.metadata), status, requestId);
    case 14:
      return new ClawDBUnavailableError(message, status, requestId);
    case 4:
      return new ClawDBTimeoutError(message, 30000, status, requestId);
    case 3:
      return new ClawDBValidationError(message, undefined, undefined, status, requestId);
    default:
      return new ClawDBInternalError(message, status, requestId);
  }
}

export function fromHttpResponse(status: number, body: unknown): ClawDBError {
  const objectBody = typeof body === 'object' && body !== null ? (body as ErrorBody) : undefined;
  const requestId = parseRequestId(undefined, objectBody);
  const message = parseMessage(body, `HTTP ${status}`);

  switch (status) {
    case 401:
      return new ClawDBAuthError(parseAuthCode(objectBody), message, body, requestId);
    case 403:
      return new ClawDBAccessDeniedError(message, parseResource(objectBody), parseAction(objectBody), body, requestId);
    case 404:
      return new ClawDBNotFoundError(message, parseEntityType(objectBody), parseEntityId(objectBody), body, requestId);
    case 408:
      return new ClawDBTimeoutError(message, parseTimeoutMs(objectBody), body, requestId);
    case 429:
      return new ClawDBRateLimitError(message, parseRetryAfterMs(undefined, objectBody), body, requestId);
    default:
      if (status >= 500) {
        return new ClawDBUnavailableError(message, body, requestId);
      }

      if (status >= 400) {
        return new ClawDBValidationError(message, parseField(objectBody), parseConstraint(objectBody), body, requestId);
      }

      return new ClawDBInternalError(message, body, requestId);
  }
}
