import { readEnv } from './env';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { CLOUD_ENDPOINT, httpUnary, isHttpEndpoint, normalizeCloudEndpoint, type RpcError } from './http-transport';

// ─── Public types ────────────────────────────────────────────────────────────

export interface MemoryOptions {
  memoryType?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  topK?: number;
  semantic?: boolean;
  filter?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface SearchHit {
  id: string;
  content: string;
  score: number;
  memoryType: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface MemoryRecord {
  id: string;
  content: string;
  memoryType: string;
  tags: string[];
}

export interface BranchInfo {
  branchId: string;
  name: string;
  branchJson?: string;
}

export interface BranchResponse {
  branchId: string;
  name: string;
  requestId?: string;
}

export interface MergeResult {
  success: boolean;
  applied: number;
  skipped: number;
  conflicts: number;
  durationMs: number;
  requestId?: string;
  /** JSON-encoded array of per-conflict detail (entity_id, entity_type,
   * base/ours/theirs values, conflicting_fields) from claw-branch. Opaque —
   * `conflicts` above stays the plain count for existing callers. */
  conflictsJson?: string;
}

export interface DiffResult {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  divergenceScore: number;
  diffJson?: string;
  requestId?: string;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  durationMs: number;
  requestId?: string;
}

export interface SyncActionResult {
  summaryJson?: string;
  requestId?: string;
}

export interface SyncStatusResult {
  statusJson?: string;
  requestId?: string;
}

export interface ReflectResult {
  jobId: string;
  status: string;
  message: string;
  skipped: boolean;
  requestId?: string;
}

export interface HealthStatus {
  ok: boolean;
  components?: Record<string, boolean>;
  uptimeSecs?: number;
  requestId?: string;
}

export interface SessionInfo {
  id: string;
  token: string;
  expiresAt: string;
  scopes: string[];
  requestId?: string;
}

export interface ValidateSessionResult {
  sessionId: string;
  agentId: string;
  workspaceId: string;
  role: string;
  scopes: string[];
  expiresAt: string;
  requestId?: string;
}

export interface TxInfo {
  txId: string;
  requestId?: string;
}

export interface ClawDBConfig {
  endpoint?: string;
  apiKey?: string;
  agentId?: string;
  workspaceId?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * 'grpc' for host:port servers, 'http' for the HTTP API (including the
   * hosted cloud). Defaults to 'http' for an http(s) URL with a path, such
   * as https://api.axonio.xyz/api/v1/gateway, and 'grpc' otherwise.
   */
  transport?: 'grpc' | 'http';
  /** Internal flag used by SDK health probes to avoid recursive local bootstrap. */
  __skipLocalBootstrap?: boolean;
}

type UnaryOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

type RawClient = grpc.Client;
type LoadedServiceClientConstructor = new (address: string, credentials: grpc.ChannelCredentials) => RawClient;

const RETRYABLE = new Set<number>([
  grpc.status.UNAVAILABLE,
  grpc.status.DEADLINE_EXCEEDED,
  grpc.status.RESOURCE_EXHAUSTED,
  grpc.status.INTERNAL
]);

const NON_RETRYABLE = new Set<number>([
  grpc.status.UNAUTHENTICATED,
  grpc.status.PERMISSION_DENIED,
  grpc.status.NOT_FOUND
]);

const LOCAL_ENDPOINT = 'http://127.0.0.1:50050';
const SERVICE = 'clawdb.v1.ClawDBService';
const DEFAULT_SERVER_RELEASE_VERSION = '0.1.9';
const DEFAULT_LOCAL_JWT_SECRET = 'clawdb-sdk-local-dev-secret';
const DEFAULT_SESSION_SCOPES = ['*'];
/** Sessions the client opens for itself. Sent explicitly: some server
 * versions read ttl_secs 0 over HTTP as "expire immediately". */
const DEFAULT_SESSION_TTL_SECS = 3600;
/** Renew this long before expiry, so calls in flight don't hit a dead token. */
const SESSION_RENEW_MARGIN_MS = 60_000;
const MODULE_DIR = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = resolve(MODULE_DIR, '../proto/clawdb.proto');

const channelPool = new Map<string, RawClient>();
let serviceClientConstructor: LoadedServiceClientConstructor | undefined;

function debugEnabled(): boolean {
  return readEnv('DEBUG') === '1';
}

function debugLog(payload: Record<string, unknown>): void {
  if (debugEnabled()) {
    process.stderr.write(`${JSON.stringify({ scope: 'clawdb-sdk', ...payload })}\n`);
  }
}

function normalizeEndpoint(endpoint: string): string {
  if (endpoint.startsWith('http://')) {
    return endpoint.replace(/^http:\/\//u, '');
  }
  if (endpoint.startsWith('https://')) {
    return endpoint.replace(/^https:\/\//u, '');
  }
  return endpoint;
}

function deriveLocalHttpEndpoint(endpoint: string): string | undefined {
  try {
    const url = new URL(endpoint);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
      return undefined;
    }
    if (url.port && url.port !== '50050') {
      return undefined;
    }
    url.port = '8080';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/u, '');
  } catch {
    return undefined;
  }
}

function credentialsForEndpoint(endpoint: string): grpc.ChannelCredentials {
  return endpoint.startsWith('https://')
    ? grpc.credentials.createSsl()
    : grpc.credentials.createInsecure();
}

function getOrCreateClient(endpoint: string): RawClient {
  const key = endpoint;
  const found = channelPool.get(key);
  if (found) {
    return found;
  }
  const client = new (getServiceClientConstructor())(normalizeEndpoint(endpoint), credentialsForEndpoint(endpoint));
  channelPool.set(key, client);
  return client;
}

function getServiceClientConstructor(): LoadedServiceClientConstructor {
  if (serviceClientConstructor) {
    return serviceClientConstructor;
  }

  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    bytes: Buffer,
  });
  const grpcPackage = grpc.loadPackageDefinition(packageDefinition) as {
    clawdb?: {
      v1?: {
        ClawDBService?: LoadedServiceClientConstructor;
      };
    };
  };
  const constructor = grpcPackage.clawdb?.v1?.ClawDBService;
  if (!constructor) {
    throw new Error(`Unable to load ClawDB gRPC service from ${PROTO_PATH}`);
  }

  serviceClientConstructor = constructor;
  return constructor;
}

function parseDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'number') {
    return new Date(value > 2_000_000_000 ? value : value * 1000);
  }
  if (typeof value === 'string') {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && asNum > 0) {
      return new Date(asNum > 2_000_000_000 ? asNum : asNum * 1000);
    }
    return new Date(value);
  }
  return new Date();
}

function parseBranchPayload(payload: Record<string, unknown>): { branchId: string; name: string; branchJson: string } {
  const branchJson = String(payload.branch_json ?? payload.branchJson ?? '');
  let parsed: Record<string, unknown> = {};

  if (branchJson) {
    try {
      parsed = JSON.parse(branchJson) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }

  return {
    branchId: String(payload.branch_id ?? payload.branchId ?? parsed.branch_id ?? parsed.branchId ?? ''),
    name: String(payload.name ?? parsed.name ?? ''),
    branchJson,
  };
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function toStableSessionAgentId(agentId: string): string {
  if (isUuidLike(agentId)) {
    return agentId;
  }

  const hex = createHash('sha256').update(agentId).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const normalized = hex.join('');
  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20, 32),
  ].join('-');
}

function toClawError(error: unknown): ClawDBError {
  if (error instanceof ClawDBError) {
    return error;
  }
  const grpcErr = error as grpc.ServiceError;
  const code = typeof grpcErr?.code === 'number' ? grpcErr.code : grpc.status.UNKNOWN;
  const message = grpcErr?.message ?? 'Unknown gRPC error';
  const md = grpcErr?.metadata;
  const requestId = md?.get('x-request-id')?.[0]?.toString();

  if (code === grpc.status.UNAUTHENTICATED || code === grpc.status.PERMISSION_DENIED) {
    return new ClawDBAuthError(message, code, requestId);
  }
  if (code === grpc.status.NOT_FOUND) {
    return new ClawDBNotFoundError(message, code, requestId);
  }
  if (code === grpc.status.RESOURCE_EXHAUSTED) {
    const retryAfter = md?.get('retry-after-ms')?.[0];
    const retryAfterMs = retryAfter ? Number(String(retryAfter)) : undefined;
    return new ClawDBRateLimitError(message, code, requestId, Number.isFinite(retryAfterMs) ? retryAfterMs : undefined);
  }
  if (code === grpc.status.DEADLINE_EXCEEDED || code === grpc.status.CANCELLED) {
    return new ClawDBTimeoutError(message, code, requestId);
  }
  if (code === grpc.status.UNAVAILABLE || code === grpc.status.INTERNAL) {
    return new ClawDBUnavailableError(message, code, requestId);
  }
  return new ClawDBError(message, code, requestId);
}

export class ClawDBError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly requestId?: string,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'ClawDBError';
  }
}

export class ClawDBAuthError extends ClawDBError {
  constructor(message: string, code: number, requestId?: string) {
    super(message, code, requestId);
    this.name = 'ClawDBAuthError';
  }
}

export class ClawDBNotFoundError extends ClawDBError {
  constructor(message: string, code: number, requestId?: string) {
    super(message, code, requestId);
    this.name = 'ClawDBNotFoundError';
  }
}

export class ClawDBRateLimitError extends ClawDBError {
  constructor(message: string, code: number, requestId?: string, retryAfterMs?: number) {
    super(message, code, requestId, retryAfterMs);
    this.name = 'ClawDBRateLimitError';
  }
}

export class ClawDBUnavailableError extends ClawDBError {
  constructor(message: string, code: number, requestId?: string) {
    super(message, code, requestId);
    this.name = 'ClawDBUnavailableError';
  }
}

export class ClawDBTimeoutError extends ClawDBError {
  constructor(message: string, code: number, requestId?: string) {
    super(message, code, requestId);
    this.name = 'ClawDBTimeoutError';
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function computeRetryDelay(attempt: number): number {
  const base = Math.min(30_000, 200 * 2 ** (attempt - 1));
  return base * (0.5 + Math.random() * 0.5);
}

function platformId(): string {
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64';
  if (process.platform === 'darwin' && process.arch === 'x64') return 'darwin-x64';
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64';
  if (process.platform === 'win32' && process.arch === 'x64') return 'win32-x64';
  throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`);
}

function releaseAssetCandidates(version: string): string[] {
  const legacy = `clawdb-server-${platformId()}.tar.gz`;

  if (process.platform === 'darwin' && process.arch === 'arm64') {
    // New format (no version prefix, contains both clawdb-server and clawdb)
    // ships from the updated release workflow on the main branch.
    return [
      'clawdb-aarch64-apple-darwin.tar.gz',
      `clawdb-v${version}-aarch64-apple-darwin.tar.gz`,
      legacy,
    ];
  }
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return [
      'clawdb-x86_64-apple-darwin.tar.gz',
      `clawdb-v${version}-x86_64-apple-darwin.tar.gz`,
      legacy,
    ];
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return [
      'clawdb-x86_64-unknown-linux-gnu.tar.gz',
      `clawdb-v${version}-x86_64-unknown-linux-gnu.tar.gz`,
      legacy,
    ];
  }
  if (process.platform === 'linux' && process.arch === 'arm64') {
    return [
      'clawdb-aarch64-unknown-linux-gnu.tar.gz',
      `clawdb-v${version}-aarch64-unknown-linux-gnu.tar.gz`,
      legacy,
    ];
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return [
      'clawdb-x86_64-pc-windows-msvc.zip',
      `clawdb-v${version}-x86_64-pc-windows-msvc.zip`,
      legacy,
    ];
  }

  throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`);
}

function serverReleaseVersion(): string {
  const configured = readEnv('SERVER_RELEASE_VERSION')?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }
  return DEFAULT_SERVER_RELEASE_VERSION;
}

async function downloadFile(url: string, targetFile: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${url} (${response.status})`);
  }

  mkdirSync(dirname(targetFile), { recursive: true });
  const bytes = await response.arrayBuffer();
  writeFileSync(targetFile, Buffer.from(bytes));
}

function releaseBaseCandidates(version: string): string[] {
  const configured = readEnv('SERVER_RELEASE_BASE_URL')?.trim();
  const candidates = [
    configured,
    // Prefer latest/download — picks up the new archive format (both binaries) from any future release
    'https://github.com/Claw-DB/ClawDB/releases/latest/download',
    'https://github.com/clawdb/clawdb/releases/latest/download',
    'https://github.com/claw-db/clawdb/releases/latest/download',
    // Specific versioned tag URLs as fallback — may only ship the old CLI-only archive
    `https://github.com/Claw-DB/ClawDB/releases/download/v${version}`,
    `https://github.com/clawdb/clawdb/releases/download/v${version}`,
    `https://github.com/claw-db/clawdb/releases/download/v${version}`,
  ].filter((value): value is string => Boolean(value && value.length > 0));

  return Array.from(new Set(candidates));
}

function sha256(filePath: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function parseChecksums(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([a-fA-F0-9]{64})\s+\*?(\S+)$/u);
    if (match) {
      map.set(match[2], match[1].toLowerCase());
    }
  }
  return map;
}

async function resolveReleaseBase(archiveNames: string[], version: string): Promise<{ base: string; archiveName: string; checksums?: Map<string, string> }> {
  for (const base of releaseBaseCandidates(version)) {
    try {
      const checksumsResponse = await fetch(`${base}/checksums.txt`);
      if (checksumsResponse.ok) {
        const checksums = parseChecksums(await checksumsResponse.text());
        const withChecksum = archiveNames.find((name) => checksums.has(name));
        if (withChecksum) {
          return { base, archiveName: withChecksum, checksums };
        }
      }

      for (const archiveName of archiveNames) {
        const probe = await fetch(`${base}/${archiveName}`, { method: 'HEAD' });
        if (probe.ok) {
          return { base, archiveName };
        }
      }
    } catch {
      // try next base candidate
    }
  }

  throw new Error(
    'Unable to auto-provision clawdb-server: no downloadable release assets were found. ' +
    'Install clawdb-server manually on PATH, or set CLAWDB_SERVER_RELEASE_BASE_URL to a valid releases download URL.'
  );
}

function startDetachedServer(binaryPath: string): Promise<number> {
  return new Promise<number>((resolveStart, rejectStart) => {
    const child = spawn(binaryPath, ['--grpc-port', '50050'], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        CLAW_GUARD_JWT_SECRET: process.env.CLAW_GUARD_JWT_SECRET ?? DEFAULT_LOCAL_JWT_SECRET,
        CLAW_VECTOR_ENABLED: process.env.CLAW_VECTOR_ENABLED ?? 'false'
      }
    });

    child.once('error', (error) => {
      rejectStart(error);
    });

    child.once('spawn', () => {
      child.unref();
      if (typeof child.pid !== 'number') {
        rejectStart(new Error('Failed to start clawdb-server process'));
        return;
      }
      resolveStart(child.pid);
    });
  });
}

async function waitForHealth(endpoint: string, timeoutMs: number): Promise<boolean> {
  const db = new ClawDB({ endpoint, timeoutMs: 500, maxRetries: 1, __skipLocalBootstrap: true });
  db.on('error', () => {});
  const start = Date.now();
  try {
    while (Date.now() - start < timeoutMs) {
      try {
        await db.ping();
        return true;
      } catch {
        await sleep(100);
      }
    }
    return false;
  } finally {
    db.close();
  }
}

async function ensureLocalServerAvailable(): Promise<string> {
  if (await waitForHealth(LOCAL_ENDPOINT, 500)) {
    return LOCAL_ENDPOINT;
  }

  try {
    const pid = await startDetachedServer('clawdb-server');
    mkdirSync(join(homedir(), '.clawdb'), { recursive: true });
    writeFileSync(join(homedir(), '.clawdb', 'server.pid'), String(pid), 'utf8');
    if (await waitForHealth(LOCAL_ENDPOINT, 20_000)) {
      return LOCAL_ENDPOINT;
    }
  } catch {
    // fallback to download path
  }

  const version = serverReleaseVersion();
  const archiveCandidates = releaseAssetCandidates(version);
  const { base, archiveName, checksums } = await resolveReleaseBase(archiveCandidates, version);

  const binDir = join(homedir(), '.clawdb', 'bin');
  const tempArchive = join(binDir, `${archiveName}.tmp`);
  const finalBinary = process.platform === 'win32'
    ? join(binDir, 'clawdb-server.exe')
    : join(binDir, 'clawdb-server');

  await downloadFile(`${base}/${archiveName}`, tempArchive);
  const expected = checksums?.get(archiveName);
  if (expected) {
    const actual = sha256(tempArchive);
    if (actual !== expected) {
      unlinkSync(tempArchive);
      throw new Error('Downloaded clawdb-server checksum verification failed');
    }
  }

  mkdirSync(binDir, { recursive: true });
  const isZipArchive = archiveName.endsWith('.zip');
  const extract = isZipArchive
    ? spawn('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${tempArchive}' -DestinationPath '${binDir}' -Force`])
    : spawn('tar', ['-xzf', tempArchive, '-C', binDir]);
  await new Promise<void>((resolveExtract, rejectExtract) => {
    extract.on('exit', (code) => {
      if (code === 0) {
        resolveExtract();
      } else {
        rejectExtract(new Error(`tar extraction failed with code ${code ?? -1}`));
      }
    });
    extract.on('error', rejectExtract);
  });

  const candidates = [
    // Prefer the actual server daemon binary (new release format ships both)
    join(binDir, 'clawdb-server'),
    join(binDir, 'clawdb-server.exe'),
    // Fall back to CLI binary (old release format — only ships clawdb)
    join(binDir, 'clawdb'),
    join(binDir, 'clawdb.exe'),
  ];

  const extracted = candidates.find((candidate) => existsSync(candidate));
  if (!extracted) {
    throw new Error('Downloaded archive did not contain clawdb-server binary');
  }

  // If we only got the CLI binary (old release format, no separate daemon), warn clearly.
  const isCliOnly = extracted.endsWith('clawdb') || extracted.endsWith('clawdb.exe');
  if (isCliOnly) {
    unlinkSync(tempArchive);
    throw new Error(
      'Auto-provisioning unavailable: the downloaded release only contains the clawdb CLI, not the clawdb-server daemon. ' +
      'Run `cargo install clawdb-server` to install the server, or set CLAWDB_SERVER_RELEASE_BASE_URL to a release that ships the clawdb-server binary.'
    );
  }

  renameSync(extracted, finalBinary);
  if (process.platform !== 'win32') {
    chmodSync(finalBinary, 0o755);
  }

  const pid = await startDetachedServer(finalBinary);
  mkdirSync(resolve(homedir(), '.clawdb'), { recursive: true });
  writeFileSync(join(homedir(), '.clawdb', 'server.pid'), String(pid), 'utf8');

  if (!(await waitForHealth(LOCAL_ENDPOINT, 20_000))) {
    throw new Error('clawdb-server did not become healthy within 20 seconds');
  }

  return LOCAL_ENDPOINT;
}

function deriveAgentId(): string {
  const envAgentId = readEnv('AGENT_ID');
  if (envAgentId && envAgentId.trim().length > 0) {
    return envAgentId;
  }
  const host = process.env.HOSTNAME ?? 'localhost';
  return `${host}-${process.pid}`;
}

export class ClawDB extends EventEmitter {
  public static readonly version: string = '0.2.1';

  readonly endpoint: string;
  readonly apiKey?: string;
  readonly agentId: string;
  readonly workspaceId?: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;

  readonly transport: 'grpc' | 'http';
  /** Created on first gRPC use; never created for the HTTP transport. */
  private grpcClient?: RawClient;
  private readonly skipLocalBootstrap: boolean;
  private shouldWatchConnectivity = true;
  private localBootstrapPromise?: Promise<void>;
  private sessionToken?: string;
  private sessionExpiresAt?: number;
  private sessionBootstrapPromise?: Promise<void>;

  constructor(config: ClawDBConfig = {}) {
    super();

    this.endpoint = normalizeCloudEndpoint(config.endpoint ?? LOCAL_ENDPOINT);
    this.transport = config.transport ?? (isHttpEndpoint(this.endpoint) ? 'http' : 'grpc');
    this.apiKey = config.apiKey;
    this.agentId = config.agentId ?? deriveAgentId();
    this.workspaceId = config.workspaceId;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.skipLocalBootstrap = config.__skipLocalBootstrap ?? false;

    if (this.transport === 'grpc') {
      this.watchConnectivity();
    }
  }

  // ─── Health ──────────────────────────────────────────────────────────────

  async health(): Promise<HealthStatus> {
    const r = await this.unaryCall<Record<string, unknown>>('Health', {});
    return {
      ok: Boolean(r.ok),
      components: (r.components as Record<string, boolean>) ?? {},
      uptimeSecs: Number(r.uptime_secs ?? r.uptimeSecs ?? 0),
      requestId: String(r.request_id ?? r.requestId ?? ''),
    };
  }

  async ping(): Promise<void> {
    // 500ms suits a local server; a first HTTPS round trip to the cloud
    // (TLS, gateway, instance) can legitimately take longer.
    await this.unaryCall('Health', {}, { timeoutMs: this.transport === 'http' ? this.timeoutMs : 500 });
  }

  // ─── Sessions ─────────────────────────────────────────────────────────────

  async createSession(opts: {
    agentId?: string;
    role?: string;
    scopes?: string[];
    ttlSecs?: number;
  } = {}): Promise<SessionInfo> {
    const r = await this.bootstrapSession({
      agentId: opts.agentId ?? this.agentId,
      role: opts.role ?? 'assistant',
      scopes: opts.scopes ?? DEFAULT_SESSION_SCOPES,
      ttlSecs: opts.ttlSecs ?? DEFAULT_SESSION_TTL_SECS,
    });
    this.rememberSession(r);
    return {
      id: String(r.id ?? ''),
      token: String(r.token ?? ''),
      expiresAt: String(r.expires_at ?? r.expiresAt ?? ''),
      scopes: Array.isArray(r.scopes) ? r.scopes.map(String) : [],
      requestId: String(r.request_id ?? r.requestId ?? ''),
    };
  }

  async validateSession(): Promise<ValidateSessionResult> {
    const r = await this.unaryCall<Record<string, unknown>>('ValidateSession', {});
    return {
      sessionId: String(r.session_id ?? r.sessionId ?? ''),
      agentId: String(r.agent_id ?? r.agentId ?? ''),
      workspaceId: String(r.workspace_id ?? r.workspaceId ?? ''),
      role: String(r.role ?? ''),
      scopes: Array.isArray(r.scopes) ? r.scopes.map(String) : [],
      expiresAt: String(r.expires_at ?? r.expiresAt ?? ''),
      requestId: String(r.request_id ?? r.requestId ?? ''),
    };
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    const r = await this.unaryCall<Record<string, unknown>>('RevokeSession', { session_id: sessionId });
    this.forgetSession();
    return Boolean(r.revoked);
  }

  async activeSessionCount(): Promise<number> {
    const r = await this.unaryCall<Record<string, unknown>>('ActiveSessionCount', {});
    return Number(r.count ?? 0);
  }

  // ─── Memory ───────────────────────────────────────────────────────────────

  async remember(content: string): Promise<string> {
    const r = await this.unaryCall<Record<string, unknown>>('Remember', { content });
    return String(r.memory_id ?? r.memoryId ?? '');
  }

  async rememberTyped(content: string, opts: {
    type?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  } = {}): Promise<string> {
    const r = await this.unaryCall<Record<string, unknown>>('RememberTyped', {
      content,
      type: opts.type ?? 'context',
      tags: opts.tags ?? [],
      metadata_json: JSON.stringify(opts.metadata ?? {}),
    });
    return String(r.memory_id ?? r.memoryId ?? '');
  }

  async updateMemory(memoryId: string, content: string): Promise<boolean> {
    const r = await this.unaryCall<Record<string, unknown>>('UpdateMemory', { memory_id: memoryId, content });
    return Boolean(r.updated);
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const r = await this.unaryCall<Record<string, unknown>>(
      'Search',
      {
        query,
        top_k: opts.topK ?? 10,
        semantic: opts.semantic ?? true,
        filter_json: JSON.stringify(opts.filter ?? {}),
      },
      { signal: opts.signal }
    );
    const hits = (Array.isArray(r.hits) ? r.hits : []) as Array<Record<string, unknown>>;
    return hits.map((h): SearchHit => ({
      id: String(h.id ?? ''),
      content: String(h.content ?? ''),
      score: Number(h.score ?? 0),
      memoryType: String(h.memory_type ?? h.memoryType ?? ''),
      tags: Array.isArray(h.tags) ? h.tags.map(String) : [],
      metadata: typeof h.metadata_json === 'string'
        ? (JSON.parse(h.metadata_json || '{}') as Record<string, unknown>)
        : ((h.metadata as Record<string, unknown>) ?? {}),
      createdAt: parseDate(h.created_at ?? h.createdAt),
    }));
  }

  async recall(memoryIds: string[]): Promise<MemoryRecord[]> {
    const r = await this.unaryCall<Record<string, unknown>>('Recall', { memory_ids: memoryIds });
    const memories = (Array.isArray(r.memories) ? r.memories : []) as Array<Record<string, unknown>>;
    return memories.map((m): MemoryRecord => ({
      id: String(m.id ?? ''),
      content: String(m.content ?? ''),
      memoryType: String(m.memory_type ?? m.memoryType ?? ''),
      tags: Array.isArray(m.tags) ? m.tags.map(String) : [],
    }));
  }

  async listMemories(opts: { type?: string; limit?: number } = {}): Promise<MemoryRecord[]> {
    const r = await this.unaryCall<Record<string, unknown>>('ListMemories', {
      type: opts.type ?? '',
      limit: opts.limit ?? 50,
    });
    const memories = (Array.isArray(r.memories) ? r.memories : []) as Array<Record<string, unknown>>;
    return memories.map((m): MemoryRecord => ({
      id: String(m.id ?? ''),
      content: String(m.content ?? ''),
      memoryType: String(m.memory_type ?? m.memoryType ?? ''),
      tags: Array.isArray(m.tags) ? m.tags.map(String) : [],
    }));
  }

  async deleteMemory(memoryId: string): Promise<boolean> {
    const r = await this.unaryCall<Record<string, unknown>>('DeleteMemory', { memory_id: memoryId });
    return Boolean(r.deleted);
  }

  // ─── Branches ─────────────────────────────────────────────────────────────

  async branch(name: string, from = ''): Promise<BranchResponse> {
    const r = await this.unaryCall<Record<string, unknown>>('Branch', { name, from });
    return {
      branchId: String(r.branch_id ?? r.branchId ?? ''),
      name: String(r.name ?? ''),
      requestId: String(r.request_id ?? r.requestId ?? ''),
    };
  }

  async getBranch(branchId: string): Promise<BranchInfo> {
    const r = await this.unaryCall<Record<string, unknown>>('GetBranch', { branch_id: branchId });
    const b = (r.branch as Record<string, unknown>) ?? {};
    return parseBranchPayload(b);
  }

  async getBranchByName(name: string): Promise<BranchInfo> {
    const r = await this.unaryCall<Record<string, unknown>>('GetBranchByName', { name });
    const b = (r.branch as Record<string, unknown>) ?? {};
    return parseBranchPayload(b);
  }

  async getTrunkBranch(): Promise<BranchInfo> {
    const r = await this.unaryCall<Record<string, unknown>>('GetTrunkBranch', {});
    const b = (r.branch as Record<string, unknown>) ?? {};
    return parseBranchPayload(b);
  }

  async listBranches(): Promise<BranchInfo[]> {
    const r = await this.unaryCall<Record<string, unknown>>('ListBranches', {});
    const branches = (Array.isArray(r.branches) ? r.branches : []) as Array<Record<string, unknown>>;
    return branches.map(parseBranchPayload);
  }

  async discardBranch(branchId: string): Promise<boolean> {
    const r = await this.unaryCall<Record<string, unknown>>('DiscardBranch', { branch_id: branchId });
    return Boolean(r.discarded);
  }

  async archiveBranch(branchId: string): Promise<boolean> {
    const r = await this.unaryCall<Record<string, unknown>>('ArchiveBranch', { branch_id: branchId });
    return Boolean(r.archived);
  }

  async merge(source: string, target: string, strategy = ''): Promise<MergeResult> {
    const r = await this.unaryCall<Record<string, unknown>>('Merge', { source, target, strategy });
    return {
      success: Boolean(r.success),
      applied: Number(r.applied ?? 0),
      skipped: Number(r.skipped ?? 0),
      conflicts: Number(r.conflicts ?? 0),
      durationMs: Number(r.duration_ms ?? r.durationMs ?? 0),
      requestId: String(r.request_id ?? r.requestId ?? ''),
      conflictsJson: String(r.conflicts_json ?? r.conflictsJson ?? ''),
    };
  }

  async diff(branchId: string, target = ''): Promise<DiffResult> {
    const r = await this.unaryCall<Record<string, unknown>>('Diff', { branch_id: branchId, target });
    return {
      added: Number(r.added ?? 0),
      removed: Number(r.removed ?? 0),
      modified: Number(r.modified ?? 0),
      unchanged: Number(r.unchanged ?? 0),
      divergenceScore: Number(r.divergence_score ?? r.divergenceScore ?? 0),
      diffJson: String(r.diff_json ?? r.diffJson ?? ''),
      requestId: String(r.request_id ?? r.requestId ?? ''),
    };
  }

  // ─── Sync ─────────────────────────────────────────────────────────────────

  async sync(): Promise<SyncResult> {
    const r = await this.unaryCall<Record<string, unknown>>('Sync', {});
    return {
      pushed: Number(r.pushed ?? 0),
      pulled: Number(r.pulled ?? 0),
      conflicts: Number(r.conflicts ?? 0),
      durationMs: Number(r.duration_ms ?? r.durationMs ?? 0),
      requestId: String(r.request_id ?? r.requestId ?? ''),
    };
  }

  async pushSync(): Promise<SyncActionResult> {
    const r = await this.unaryCall<Record<string, unknown>>('PushSync', {});
    return { summaryJson: String(r.summary_json ?? r.summaryJson ?? ''), requestId: String(r.request_id ?? r.requestId ?? '') };
  }

  async pullSync(): Promise<SyncActionResult> {
    const r = await this.unaryCall<Record<string, unknown>>('PullSync', {});
    return { summaryJson: String(r.summary_json ?? r.summaryJson ?? ''), requestId: String(r.request_id ?? r.requestId ?? '') };
  }

  async reconcileSync(): Promise<SyncActionResult> {
    const r = await this.unaryCall<Record<string, unknown>>('ReconcileSync', {});
    return { summaryJson: String(r.summary_json ?? r.summaryJson ?? ''), requestId: String(r.request_id ?? r.requestId ?? '') };
  }

  async syncStatus(): Promise<SyncStatusResult> {
    const r = await this.unaryCall<Record<string, unknown>>('SyncStatus', {});
    return { statusJson: String(r.status_json ?? r.statusJson ?? ''), requestId: String(r.request_id ?? r.requestId ?? '') };
  }

  // ─── Reflect ──────────────────────────────────────────────────────────────

  async reflect(): Promise<ReflectResult> {
    const r = await this.unaryCall<Record<string, unknown>>('Reflect', {});
    return {
      jobId: String(r.job_id ?? r.jobId ?? ''),
      status: String(r.status ?? ''),
      message: String(r.message ?? ''),
      skipped: Boolean(r.skipped),
      requestId: String(r.request_id ?? r.requestId ?? ''),
    };
  }

  async reflectGetFacts(agentId: string): Promise<unknown> {
    const r = await this.unaryCall<Record<string, unknown>>('ReflectGetFacts', { agent_id: agentId });
    return typeof r.json === 'string' ? JSON.parse(r.json || '{}') : r;
  }

  async reflectListJobs(agentId: string, opts: { status?: string; limit?: number; offset?: number } = {}): Promise<unknown> {
    const r = await this.unaryCall<Record<string, unknown>>('ReflectListJobs', {
      agent_id: agentId,
      status: opts.status ?? '',
      limit: opts.limit ?? 20,
      offset: opts.offset ?? 0,
    });
    return typeof r.json === 'string' ? JSON.parse(r.json || '{}') : r;
  }

  async reflectGetJob(jobId: string): Promise<unknown> {
    const r = await this.unaryCall<Record<string, unknown>>('ReflectGetJob', { job_id: jobId });
    return typeof r.json === 'string' ? JSON.parse(r.json || '{}') : r;
  }

  async reflectGetPreferences(agentId: string): Promise<unknown> {
    const r = await this.unaryCall<Record<string, unknown>>('ReflectGetPreferences', { agent_id: agentId });
    return typeof r.json === 'string' ? JSON.parse(r.json || '{}') : r;
  }

  async reflectGetContradictions(agentId: string): Promise<unknown> {
    const r = await this.unaryCall<Record<string, unknown>>('ReflectGetContradictions', { agent_id: agentId });
    return typeof r.json === 'string' ? JSON.parse(r.json || '{}') : r;
  }

  async reflectResolveContradiction(agentId: string, contradictionId: string, opts: {
    strategy?: string;
    mergedValueJson?: string;
  } = {}): Promise<unknown> {
    const r = await this.unaryCall<Record<string, unknown>>('ReflectResolveContradiction', {
      agent_id: agentId,
      contradiction_id: contradictionId,
      strategy: opts.strategy ?? '',
      merged_value_json: opts.mergedValueJson ?? '',
    });
    return typeof r.json === 'string' ? JSON.parse(r.json || '{}') : r;
  }

  // ─── Transactions ─────────────────────────────────────────────────────────

  async beginTx(): Promise<TxInfo> {
    const r = await this.unaryCall<Record<string, unknown>>('BeginTx', {});
    return { txId: String(r.tx_id ?? r.txId ?? ''), requestId: String(r.request_id ?? r.requestId ?? '') };
  }

  async txRemember(txId: string, content: string): Promise<string> {
    const r = await this.unaryCall<Record<string, unknown>>('TxRemember', { tx_id: txId, content });
    return String(r.memory_id ?? r.memoryId ?? '');
  }

  async txRememberTyped(txId: string, content: string, opts: {
    type?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  } = {}): Promise<string> {
    const r = await this.unaryCall<Record<string, unknown>>('TxRememberTyped', {
      tx_id: txId,
      content,
      type: opts.type ?? 'context',
      tags: opts.tags ?? [],
      metadata_json: JSON.stringify(opts.metadata ?? {}),
    });
    return String(r.memory_id ?? r.memoryId ?? '');
  }

  async commitTx(txId: string): Promise<boolean> {
    const r = await this.unaryCall<Record<string, unknown>>('CommitTx', { tx_id: txId });
    return Boolean(r.committed);
  }

  async rollbackTx(txId: string): Promise<boolean> {
    const r = await this.unaryCall<Record<string, unknown>>('RollbackTx', { tx_id: txId });
    return Boolean(r.rolled_back ?? r.rolledBack);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  static fromEnv(): ClawDB {
    const timeoutRaw = Number(readEnv('TIMEOUT_MS') ?? '10000');
    const retriesRaw = Number(readEnv('MAX_RETRIES') ?? '3');
    const url = readEnv('URL')?.trim();
    const apiKey = readEnv('API_KEY')?.trim() || undefined;
    return new ClawDB({
      // An API key with no URL means the hosted cloud.
      endpoint: url || (apiKey ? CLOUD_ENDPOINT : undefined),
      apiKey,
      agentId: readEnv('AGENT_ID'),
      workspaceId: readEnv('WORKSPACE_ID'),
      timeoutMs: Number.isFinite(timeoutRaw) ? timeoutRaw : 10_000,
      maxRetries: Number.isFinite(retriesRaw) ? retriesRaw : 3
    });
  }

  static async autoProvision(config: Omit<ClawDBConfig, 'endpoint' | 'apiKey'> = {}): Promise<ClawDB> {
    const explicitUrl = readEnv('URL')?.trim();
    const apiKey = readEnv('API_KEY')?.trim();
    if (explicitUrl) {
      // Keep the key: a self-hosted or cloud URL may need it.
      const db = new ClawDB({ ...config, endpoint: explicitUrl, apiKey: apiKey || undefined });
      await db.ping();
      return db;
    }

    if (apiKey) {
      const db = new ClawDB({ ...config, endpoint: CLOUD_ENDPOINT, apiKey });
      await db.ping();
      return db;
    }

    if (await waitForHealth(LOCAL_ENDPOINT, 500)) {
      return new ClawDB({ ...config, endpoint: LOCAL_ENDPOINT });
    }

    const endpoint = await ensureLocalServerAvailable();
    return new ClawDB({ ...config, endpoint });
  }

  close(): void {
    this.shouldWatchConnectivity = false;
    this.forgetSession();
  }

  /** The gRPC client, created on first use. */
  private get client(): RawClient {
    if (!this.grpcClient) {
      this.grpcClient = getOrCreateClient(this.endpoint);
    }
    return this.grpcClient;
  }

  private rememberSession(session: Record<string, unknown>): void {
    this.sessionToken = String(session.token ?? '') || undefined;
    const expires = Date.parse(String(session.expires_at ?? session.expiresAt ?? ''));
    this.sessionExpiresAt = Number.isFinite(expires) ? expires : undefined;
  }

  private forgetSession(): void {
    this.sessionToken = undefined;
    this.sessionExpiresAt = undefined;
  }

  private sessionIsFresh(): boolean {
    if (!this.sessionToken) return false;
    return this.sessionExpiresAt === undefined || Date.now() < this.sessionExpiresAt - SESSION_RENEW_MARGIN_MS;
  }

  /** True when the server rejected the session token itself (expired or
   * revoked), which a new session fixes, as opposed to a bad API key or a
   * missing permission, which it doesn't. */
  private isSessionRejection(error: unknown): boolean {
    const e = error as Partial<RpcError> & { code?: number; message?: string };
    if (e?.code !== grpc.status.UNAUTHENTICATED) return false;
    if (e.sessionRejected) return true;
    return /session/iu.test(String(e.message ?? ''));
  }

  private usesDefaultLocalEndpoint(): boolean {
    return !this.skipLocalBootstrap && !this.apiKey && this.endpoint === LOCAL_ENDPOINT;
  }

  private async ensureEndpointReady(): Promise<void> {
    if (!this.usesDefaultLocalEndpoint()) {
      return;
    }

    if (!this.localBootstrapPromise) {
      this.localBootstrapPromise = (async () => {
        if (await waitForHealth(this.endpoint, 500)) {
          return;
        }
        await ensureLocalServerAvailable();
      })().finally(() => {
        this.localBootstrapPromise = undefined;
      });
    }

    await this.localBootstrapPromise;
  }

  private metadata(): grpc.Metadata {
    const metadata = new grpc.Metadata();
    metadata.set('x-agent-id', this.agentId);
    if (this.workspaceId) {
      metadata.set('x-workspace-id', this.workspaceId);
    }
    if (this.sessionToken) {
      metadata.set('x-claw-session', this.sessionToken);
    }
    if (this.apiKey) {
      metadata.set('authorization', `Bearer ${this.apiKey}`);
    }
    return metadata;
  }

  private requiresSession(method: string): boolean {
    return method !== 'Health' && method !== 'CreateSession';
  }

  private async bootstrapSession(opts: {
    agentId: string;
    role: string;
    scopes: string[];
    ttlSecs: number;
  }): Promise<Record<string, unknown>> {
    if (this.transport === 'http') {
      return this.unaryCallOnce<Record<string, unknown>>(
        'CreateSession',
        {
          agent_id: toStableSessionAgentId(opts.agentId),
          role: opts.role,
          scopes: opts.scopes,
          ttl_secs: opts.ttlSecs,
        },
        { timeoutMs: this.timeoutMs }
      );
    }
    const localHttpEndpoint = deriveLocalHttpEndpoint(this.endpoint);
    if (localHttpEndpoint) {
      const response = await fetch(`${localHttpEndpoint}/v1/sessions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: toStableSessionAgentId(opts.agentId),
          role: opts.role,
          scopes: opts.scopes,
          ttl_secs: opts.ttlSecs,
        }),
      });

      const rawBody = await response.text();
      const body = (() => {
        if (!rawBody) {
          return {} as Record<string, unknown>;
        }
        try {
          return JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          return { message: rawBody } as Record<string, unknown>;
        }
      })();
      if (!response.ok) {
        throw new ClawDBAuthError(String(body.message ?? body.error ?? 'Session bootstrap failed'), grpc.status.UNAUTHENTICATED);
      }
      return body;
    }

    return this.unaryCallOnce<Record<string, unknown>>(
      'CreateSession',
      {
        // The server requires a UUID; derive a stable one from any other id,
        // as the HTTP paths already did.
        agent_id: toStableSessionAgentId(opts.agentId),
        role: opts.role,
        scopes: opts.scopes,
        ttl_secs: opts.ttlSecs,
      },
      { timeoutMs: this.timeoutMs }
    );
  }

  private async ensureSession(method: string): Promise<void> {
    if (!this.requiresSession(method) || this.sessionIsFresh()) {
      return;
    }

    if (!this.sessionBootstrapPromise) {
      this.sessionBootstrapPromise = (async () => {
        const session = await this.bootstrapSession({
          agentId: this.agentId,
          role: 'assistant',
          scopes: DEFAULT_SESSION_SCOPES,
          ttlSecs: DEFAULT_SESSION_TTL_SECS,
        });
        this.rememberSession(session);
        if (!this.sessionToken) {
          throw new ClawDBAuthError('Server returned a session without a token', grpc.status.UNAUTHENTICATED);
        }
      })().finally(() => {
        this.sessionBootstrapPromise = undefined;
      });
    }

    await this.sessionBootstrapPromise;
  }

  private async unaryCall<TRes = unknown>(
    method: string,
    payload: Record<string, unknown>,
    options: UnaryOptions = {}
  ): Promise<TRes> {
    await this.ensureEndpointReady();
    try {
      await this.ensureSession(method);
    } catch (error) {
      throw toClawError(error);
    }

    const maxAttempts = Math.max(1, this.maxRetries);
    let attempt = 0;
    let renewedSession = false;

    while (attempt < maxAttempts) {
      attempt += 1;
      const start = Date.now();
      try {
        const response = await this.unaryCallOnce<TRes>(method, payload, options);
        debugLog({ method, durationMs: Date.now() - start, status: 'ok' });
        return response;
      } catch (error) {
        // An expired or revoked session: open a new one and retry once.
        if (!renewedSession && this.requiresSession(method) && this.isSessionRejection(error)) {
          renewedSession = true;
          attempt -= 1;
          this.forgetSession();
          try {
            await this.ensureSession(method);
          } catch (renewError) {
            throw toClawError(renewError);
          }
          continue;
        }
        const mapped = toClawError(error);
        debugLog({ method, durationMs: Date.now() - start, status: mapped.code, retryAttempt: attempt });

        if (NON_RETRYABLE.has(mapped.code) || attempt >= maxAttempts || !RETRYABLE.has(mapped.code)) {
          throw mapped;
        }
        await sleep(computeRetryDelay(attempt));
      }
    }

    throw new ClawDBUnavailableError('Retry attempts exhausted', grpc.status.UNAVAILABLE);
  }

  private unaryCallOnce<TRes>(
    method: string,
    payload: Record<string, unknown>,
    options: UnaryOptions
  ): Promise<TRes> {
    if (this.transport === 'http') {
      return httpUnary(method, payload, {
        baseUrl: this.endpoint,
        apiKey: this.apiKey,
        sessionToken: this.sessionToken,
        agentId: this.agentId,
        workspaceId: this.workspaceId,
        timeoutMs: options.timeoutMs ?? this.timeoutMs,
        signal: options.signal,
      }) as Promise<TRes>;
    }
    return new Promise<TRes>((resolveCall, rejectCall) => {
      const deadline = new Date(Date.now() + (options.timeoutMs ?? this.timeoutMs));
      const clientMethod = (this.client as unknown as Record<string, unknown>)[method];
      if (typeof clientMethod !== 'function') {
        rejectCall(new ClawDBError(`Unknown gRPC method: ${method}`, grpc.status.INTERNAL));
        return;
      }

      const call = (clientMethod as (
        request: Record<string, unknown>,
        metadata: grpc.Metadata,
        options: { deadline: Date },
        callback: (error: grpc.ServiceError | null, response: unknown) => void
      ) => grpc.ClientUnaryCall).call(
        this.client,
        payload,
        this.metadata(),
        { deadline },
        (error: grpc.ServiceError | null, response: unknown) => {
          if (abortHandler) {
            options.signal?.removeEventListener('abort', abortHandler);
          }
          if (error) {
            rejectCall(error);
            return;
          }
          resolveCall(response as TRes);
        }
      );

      const abortHandler = options.signal
        ? () => {
            call.cancel();
            rejectCall(new ClawDBTimeoutError('Request cancelled', grpc.status.CANCELLED));
          }
        : undefined;

      if (abortHandler) {
        if (options.signal?.aborted) {
          abortHandler();
          return;
        }
        options.signal?.addEventListener('abort', abortHandler, { once: true });
      }
    });
  }

  private watchConnectivity(): void {
    const channel = this.client.getChannel();
    let previous = channel.getConnectivityState(true);

    const watchOnce = (): void => {
      if (!this.shouldWatchConnectivity) {
        return;
      }

      channel.watchConnectivityState(previous, Date.now() + 60_000, (error?: Error | undefined) => {
        if (!this.shouldWatchConnectivity) {
          return;
        }
        if (error) {
          this.emit('error', error);
          watchOnce();
          return;
        }

        const next = channel.getConnectivityState(false);
        if (next === grpc.connectivityState.READY && previous !== grpc.connectivityState.READY) {
          this.emit('connected');
        }
        if (next === grpc.connectivityState.TRANSIENT_FAILURE) {
          this.emit('disconnected');
          this.emit('reconnecting');
          channel.getConnectivityState(true);
        }
        if (next === grpc.connectivityState.CONNECTING && previous !== grpc.connectivityState.CONNECTING) {
          this.emit('reconnecting');
        }

        previous = next;
        watchOnce();
      });
    };

    watchOnce();
  }
}

export default async function clawdb(config?: Omit<ClawDBConfig, 'endpoint' | 'apiKey'>): Promise<ClawDB> {
  return ClawDB.autoProvision(config);
}
