import type { ClawDBFileConfig } from './schema.js';
import { ClawDBConfigSchema } from './schema.js';
import type { ZodError } from 'zod';

/**
 * Reads CLAWDB_* environment variables and maps them to ClawDBFileConfig keys.
 *
 * Supported variables:
 *   CLAWDB_ENDPOINT   → endpoint
 *   CLAWDB_API_KEY    → api_key
 *   CLAWDB_AGENT_ID   → agent_id
 *   CLAWDB_WORKSPACE  → workspace
 *   CLAWDB_ROLE       → role
 *   CLAWDB_LOG_LEVEL  → log_level
 *   CLAWDB_LOG_FORMAT → log_format
 *   CLAWDB_TIMEOUT_MS → timeout_ms
 *   CLAWDB_TLS        → tls  (truthy: "1","true","yes")
 *   CLAWDB_SYNC_HUB_URL          → sync.hub_url
 *   CLAWDB_SYNC_INTERVAL_SECS    → sync.interval_secs
 *   CLAWDB_REFLECT_SERVICE_URL   → reflect.service_url
 */
export function readFromEnv(): Partial<ClawDBFileConfig> {
  const env = (key: string): string | undefined => {
    // AXONIO_* wins over the older CLAWDB_* names.
    if (typeof process !== 'undefined') return process.env[key.replace(/^CLAWDB_/, 'AXONIO_')] ?? process.env[key];
    return undefined;
  };

  const result: Partial<ClawDBFileConfig> = {};

  const endpoint = env('CLAWDB_ENDPOINT');
  if (endpoint) result.endpoint = endpoint;

  const apiKey = env('CLAWDB_API_KEY');
  if (apiKey) result.api_key = apiKey;

  const agentId = env('CLAWDB_AGENT_ID');
  if (agentId) result.agent_id = agentId;

  const workspace = env('CLAWDB_WORKSPACE');
  if (workspace) result.workspace = workspace;

  const role = env('CLAWDB_ROLE');
  if (role) result.role = role;

  const logLevel = env('CLAWDB_LOG_LEVEL');
  if (logLevel) result.log_level = logLevel as ClawDBFileConfig['log_level'];

  const logFormat = env('CLAWDB_LOG_FORMAT');
  if (logFormat) result.log_format = logFormat as ClawDBFileConfig['log_format'];

  const timeoutMs = env('CLAWDB_TIMEOUT_MS');
  if (timeoutMs) {
    const n = parseInt(timeoutMs, 10);
    if (!isNaN(n)) result.timeout_ms = n;
  }

  const tls = env('CLAWDB_TLS');
  if (tls !== undefined) result.tls = ['1', 'true', 'yes'].includes(tls.toLowerCase());

  const syncHubUrl = env('CLAWDB_SYNC_HUB_URL');
  const syncIntervalRaw = env('CLAWDB_SYNC_INTERVAL_SECS');
  if (syncHubUrl || syncIntervalRaw) {
    result.sync = { interval_secs: 30 };
    if (syncHubUrl) result.sync.hub_url = syncHubUrl;
    if (syncIntervalRaw) {
      const n = parseFloat(syncIntervalRaw);
      if (!isNaN(n)) result.sync.interval_secs = n;
    }
  }

  const reflectServiceUrl = env('CLAWDB_REFLECT_SERVICE_URL');
  if (reflectServiceUrl) result.reflect = { service_url: reflectServiceUrl };

  return result;
}

export interface EnvValidationResult {
  ok: boolean;
  missing: string[];
  invalid: string[];
}

/**
 * Validates that the environment contains a usable ClawDB configuration.
 * Reports missing required fields and fields with invalid values.
 */
export function validateEnv(): EnvValidationResult {
  const raw = readFromEnv();
  const parsed = ClawDBConfigSchema.safeParse(raw);

  const missing: string[] = [];
  const invalid: string[] = [];

  // endpoint is highly recommended — not strictly required (defaults to localhost)
  if (!raw.endpoint && typeof process !== 'undefined' && !process.env['CLAWDB_ENDPOINT']) {
    missing.push('CLAWDB_ENDPOINT');
  }

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      invalid.push(`${issue.path.join('.')}: ${issue.message}`);
    }
  }

  return {
    ok: parsed.success && missing.length === 0,
    missing,
    invalid,
  };
}
