import { readEnv } from './env';
import type { ClawDBConfig } from '@clawdb/types';

export const DEFAULT_CONFIG: Required<ClawDBConfig> = {
  endpoint: 'http://localhost:50050',
  apiKey: '',
  agentId: '',
  role: 'assistant',
  workspace: '',
  region: '',
  timeout: 30000,
  tls: false
};

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && typeof process.versions?.node === 'string';
}

function getNodeRequire():
  | ((name: 'node:fs' | 'node:os' | 'node:path') => {
      [key: string]: unknown;
    })
  | undefined {
  if (!isNodeRuntime()) {
    return undefined;
  }

  try {
    return Function(
      'return typeof require !== "undefined" ? require : (process.mainModule && process.mainModule.require ? process.mainModule.require.bind(process.mainModule) : undefined);'
    )() as
      | ((name: 'node:fs' | 'node:os' | 'node:path') => { [key: string]: unknown })
      | undefined;
  } catch {
    return undefined;
  }
}

export class ClawDBConfigResolver {
  resolve(config: ClawDBConfig = {}): Required<ClawDBConfig> {
    const fileConfig = compactObject(this.readConfigFile());
    const envConfig = compactObject(ClawDBConfigResolver.fromEnv());
    const explicitConfig = compactObject(config);

    return {
      ...DEFAULT_CONFIG,
      ...fileConfig,
      ...envConfig,
      ...explicitConfig,
      timeout: firstDefined<number>(config.timeout, envConfig.timeout, fileConfig.timeout, DEFAULT_CONFIG.timeout),
      tls: firstDefined<boolean>(config.tls, envConfig.tls, fileConfig.tls, DEFAULT_CONFIG.tls)
    };
  }

  readConfigFile(): Partial<ClawDBConfig> {
    const req = getNodeRequire();
    if (!req) {
      return {};
    }

    try {
      const fs = req('node:fs') as { existsSync(path: string): boolean; readFileSync(path: string, encoding: string): string };
      const os = req('node:os') as { homedir(): string };
      const path = req('node:path') as { join(...parts: string[]): string };

      const filePath = path.join(os.homedir(), '.clawdb', 'config.toml');
      if (!fs.existsSync(filePath)) {
        return {};
      }

      return parseSimpleToml(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return {};
    }
  }

  static fromEnv(): ClawDBConfig {
    if (typeof process === 'undefined' || process.env == null) {
      return {};
    }

    const timeoutRaw = readEnvString(readEnv('TIMEOUT_MS'));
    const tlsRaw = readEnvString(readEnv('TLS'));
    const timeout = timeoutRaw == null ? undefined : Number(timeoutRaw);

    return {
      endpoint: readEnvString(readEnv('ENDPOINT')),
      apiKey: readEnvString(readEnv('API_KEY')),
      agentId: readEnvString(readEnv('AGENT_ID')),
      workspace: readEnvString(readEnv('WORKSPACE')),
      role: readEnvString(readEnv('ROLE')),
      region: readEnvString(readEnv('REGION')),
      timeout: Number.isFinite(timeout) ? timeout : undefined,
      tls: tlsRaw == null ? undefined : tlsRaw === '1' || tlsRaw.toLowerCase() === 'true'
    };
  }
}

function firstDefined<T>(...values: Array<T | undefined>): T {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }

  throw new Error('Expected at least one defined value.');
}

function parseSimpleToml(raw: string): Partial<ClawDBConfig> {
  const result: Partial<ClawDBConfig> = {};

  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/gu, '');

    switch (key) {
      case 'endpoint':
        result.endpoint = value;
        break;
      case 'api_key':
      case 'apiKey':
        result.apiKey = value;
        break;
      case 'agent_id':
      case 'agentId':
        result.agentId = value;
        break;
      case 'workspace':
        result.workspace = value;
        break;
      case 'region':
        result.region = value;
        break;
      case 'role':
        result.role = value;
        break;
      case 'timeout':
      case 'timeout_ms': {
        const timeout = Number(value);
        result.timeout = Number.isFinite(timeout) ? timeout : undefined;
        break;
      }
      case 'tls':
        result.tls = value === '1' || value.toLowerCase() === 'true';
        break;
      default:
        break;
    }
  }

  return result;
}

function readEnvString(value: string | undefined): string | undefined {
  return value == null || value.trim() === '' ? undefined : value;
}

function compactObject<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>;
}
