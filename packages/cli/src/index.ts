import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import prompts from 'prompts';
import clawdb, { ClawDB } from 'axonio';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProjectType = 'node' | 'python' | 'go' | 'rust' | 'unknown';
export type BackendType = 'sqlite' | 'postgres' | 'cloud';
export type EditorHost = 'claude' | 'cursor' | 'vscode' | 'zed' | 'openclaw' | 'google-antigravity';

type JsonRecord = Record<string, unknown>;

const activeClients = new Set<ClawDB>();

// ─── Output helpers ───────────────────────────────────────────────────────────

function isJsonMode(jsonFlag = false): boolean {
  return jsonFlag || !process.stdout.isTTY;
}

function writeOutput(payload: unknown, jsonFlag = false): void {
  if (isJsonMode(jsonFlag)) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (typeof payload === 'string') {
    process.stdout.write(`${payload}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeError(error: unknown, jsonFlag = false): never {
  const message = error instanceof Error ? error.message : String(error);
  if (isJsonMode(jsonFlag)) {
    process.stderr.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  } else {
    process.stderr.write(`${chalk.red('Error:')} ${message}\n`);
  }
  process.exit(1);
}

// ─── Project/backend detection ─────────────────────────────────────────────

function cwdFileNames(): string[] {
  return ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml'].filter((file) => existsSync(resolve(process.cwd(), file)));
}

export function detectProjectType(fileNames = cwdFileNames()): ProjectType {
  if (fileNames.includes('package.json')) return 'node';
  if (fileNames.includes('pyproject.toml')) return 'python';
  if (fileNames.includes('go.mod')) return 'go';
  if (fileNames.includes('Cargo.toml')) return 'rust';
  return 'unknown';
}

/** The hosted Axonio cloud (the old cloud.clawdb.dev host no longer exists). */
const CLOUD_URL = 'https://api.axonio.xyz/api/v1/gateway';

/** AXONIO_* wins over the older CLAWDB_* names, which still work. */
function envVar(name: string, source: NodeJS.ProcessEnv = process.env): string | undefined {
  return source[`AXONIO_${name}`] || source[`CLAWDB_${name}`] || undefined;
}

export function detectBackend(env: NodeJS.ProcessEnv = process.env): BackendType {
  if (envVar('API_KEY', env)) return 'cloud';
  if (env.DATABASE_URL) return 'postgres';
  return 'sqlite';
}

export function formatSnippet(projectType: ProjectType): string {
  switch (projectType) {
    case 'node':
      return "TypeScript:  import axonio from 'axonio'";
    case 'python':
      return 'Python:      from axonio import axonio';
    case 'go':
      return 'Go:          db, err := clawdb.New(clawdb.Options{})';
    case 'rust':
      return 'Rust:        let db = ClawDBClient::auto_provision().await?;';
    default:
      return "TypeScript:  import axonio from 'axonio'";
  }
}

// ─── Env / config helpers ─────────────────────────────────────────────────

function renderBanner(): string {
  return [
    '┌─────────────────────────────────────────┐',
    '│  ClawDB — zero-config agent database    │',
    '└─────────────────────────────────────────┘'
  ].join('\n');
}

function envFilePath(): string {
  return resolve(process.cwd(), '.clawdb.env');
}

function readDotEnvFile(): Record<string, string> {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return {};
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/u);
  const result: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function writeClawdbEnv(values: Record<string, string>): void {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  writeFileSync(envFilePath(), `${lines.join('\n')}\n`, 'utf8');
}

// ─── Server process helpers ───────────────────────────────────────────────

function pidPath(): string {
  return join(homedir(), '.clawdb', 'server.pid');
}

function commandExists(command: string): boolean {
  const probe = process.platform === 'win32'
    ? spawnSync('where', [command], { stdio: 'ignore' })
    : spawnSync('which', [command], { stdio: 'ignore' });
  return probe.status === 0;
}

function tryStopPid(): boolean {
  if (!existsSync(pidPath())) return false;
  const pid = Number(readFileSync(pidPath(), 'utf8').trim());
  if (!Number.isFinite(pid)) return false;
  try {
    process.kill(pid);
    return true;
  } catch {
    return false;
  }
}

function startLocalBinary(port = 50050, detach = false): void {
  const candidates = [
    join(homedir(), '.clawdb', 'bin', process.platform === 'win32' ? 'clawdb-server.exe' : 'clawdb-server')
  ];
  const binary = candidates.find((candidate) => existsSync(candidate))
    ?? (commandExists('clawdb-server') ? 'clawdb-server' : undefined);
  if (typeof binary !== 'string') {
    throw new Error('clawdb-server binary not found in PATH or ~/.clawdb/bin');
  }

  const child = spawn(binary, ['--grpc-port', String(port)], {
    detached: detach,
    stdio: detach ? 'ignore' : 'inherit',
    env: {
      ...process.env,
      CLAW_GUARD_JWT_SECRET: process.env.CLAW_GUARD_JWT_SECRET ?? 'clawdb-sdk-local-dev-secret',
      CLAW_VECTOR_ENABLED: process.env.CLAW_VECTOR_ENABLED ?? 'false'
    }
  });

  if (detach) {
    child.unref();
    mkdirSync(dirname(pidPath()), { recursive: true });
    writeFileSync(pidPath(), String(child.pid), 'utf8');
  }
}

// ─── Version / client helpers ──────────────────────────────────────────────

function cliVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function getDb(override?: { endpoint?: string }): Promise<ClawDB> {
  let db: ClawDB;
  if (override?.endpoint) {
    db = new ClawDB({ endpoint: override.endpoint, agentId: envVar('AGENT_ID') });
  } else {
    db = await clawdb();
  }
  db.on('error', () => {});
  activeClients.add(db);
  return db;
}

function closeActiveClients(): void {
  for (const db of activeClients) {
    db.close();
    activeClients.delete(db);
  }
}

// ─── Smoke test ───────────────────────────────────────────────────────────

async function smokeTest(db: ClawDB): Promise<void> {
  const id = await db.rememberTyped('clawdb init smoke test', { type: 'message', tags: ['smoke-test'] });
  const hits = await db.search('smoke test', { topK: 3 });
  if (!hits.some((hit) => hit.id === id)) {
    throw new Error('Smoke test search did not return the inserted memory');
  }
  await db.deleteMemory(id);
}

// ─── MCP config helpers ───────────────────────────────────────────────────

// Returns the legacy flat block used by `mcp print-config`
export function mcpConfigBlock(host: EditorHost): Record<string, JsonRecord> {
  return {
    mcpServers: {
      axonio: {
        command: 'npx',
        args: ['-y', 'axonio-mcp@latest'],
        env: {
          AXONIO_URL: 'http://localhost:50050',
          AXONIO_AGENT_ID: host,
        },
      },
    },
  };
}

function editorConfigPath(host: EditorHost): string {
  switch (host) {
    case 'claude':
      return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'cursor':
      return join(homedir(), '.cursor', 'mcp.json');
    case 'vscode':
      return resolve(process.cwd(), '.vscode', 'mcp.json');
    case 'zed':
      return join(homedir(), '.config', 'zed', 'settings.json');
    case 'openclaw':
      return join(homedir(), '.openclaw', 'mcp.json');
    case 'google-antigravity':
      return join(homedir(), '.config', 'google-antigravity', 'mcp.json');
  }
}

// Each host uses a different top-level key in its config file
function hostConfigKey(host: EditorHost): string {
  if (host === 'vscode') return 'servers';
  if (host === 'zed') return 'context_servers';
  return 'mcpServers';
}

// Build the server entry object shaped for each host's expected schema
function hostServerEntry(host: EditorHost): Record<string, unknown> {
  const env = { AXONIO_URL: 'http://localhost:50050', AXONIO_AGENT_ID: host };
  if (host === 'vscode') {
    // VS Code MCP (servers key) requires type: stdio
    return { type: 'stdio', command: 'npx', args: ['-y', 'axonio-mcp@latest'], env };
  }
  if (host === 'zed') {
    // Zed uses context_servers with a nested command object
    return {
      command: { path: 'npx', args: ['-y', 'axonio-mcp@latest'] },
      settings: { env },
    };
  }
  // Claude Desktop, Cursor, OpenClaw, Google Antigravity share the mcpServers format
  return { command: 'npx', args: ['-y', 'axonio-mcp@latest'], env };
}

function mergeJsonFile(filePath: string, host: EditorHost): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const current = existsSync(filePath)
    ? JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    : {};
  const key = hostConfigKey(host);
  const next = {
    ...current,
    [key]: {
      ...((current[key] as Record<string, unknown> | undefined) ?? {}),
      clawdb: hostServerEntry(host),
    },
  };
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

function installMcpForHost(host: EditorHost, jsonFlag = false): void {
  const path = editorConfigPath(host);
  mergeJsonFile(path, host);
  writeOutput(jsonFlag ? { ok: true, host, configPath: path } : `${chalk.green('✓')} ClawDB MCP config written to ${path}`, jsonFlag);
}

function printPostInitTips(host: EditorHost | 'skip'): void {
  process.stdout.write('\n');
  if (host === 'skip') {
    process.stdout.write(`${chalk.bold('Next steps:')}
`);
    process.stdout.write(`  Install MCP later:  ${chalk.cyan('clawdb mcp install-<host>')}
`);
    process.stdout.write(`  Hosts available:    claude · cursor · vscode · zed · openclaw · google-antigravity\n`);
  } else {
    const hostLabel: Record<EditorHost, string> = {
      claude: 'Claude Desktop',
      cursor: 'Cursor',
      vscode: 'VS Code',
      zed: 'Zed',
      openclaw: 'OpenClaw',
      'google-antigravity': 'Google Antigravity',
    };
    process.stdout.write(`${chalk.bold('Next steps:')}
`);
    process.stdout.write(`  1. ${chalk.yellow(`Restart ${hostLabel[host]}`)} to activate the MCP server\n`);
    process.stdout.write(`  2. Look for ${chalk.cyan('ClawDB')} in your host's tool/MCP panel\n`);
    process.stdout.write(`  3. Your agent can now call memory, branch, and sync tools automatically\n`);
  }
  process.stdout.write(`\n  Docs: ${chalk.underline('https://docs.axonio.xyz')}\n`);
  process.stdout.write(`  Status: ${chalk.cyan('clawdb status')}  ·  Help: ${chalk.cyan('clawdb --help')}\n\n`);
}

async function maybeInstallMcpHost(): Promise<void> {
  const response = await prompts({
    type: 'select',
    name: 'host',
    message: 'Install ClawDB MCP config for which host?',
    initial: 0,
    choices: [
      { title: 'Claude Desktop', value: 'claude' },
      { title: 'Cursor', value: 'cursor' },
      { title: 'VS Code', value: 'vscode' },
      { title: 'Zed', value: 'zed' },
      { title: 'OpenClaw', value: 'openclaw' },
      { title: 'Google Antigravity', value: 'google-antigravity' },
      { title: 'Skip for now', value: 'skip' }
    ]
  });
  const host = response.host as EditorHost | 'skip' | undefined;
  if (!host || host === 'skip') {
    printPostInitTips('skip');
    return;
  }
  installMcpForHost(host, false);
  printPostInitTips(host);
}

// ─── init command ────────────────────────────────────────────────────────

async function initCommand(options: { cloud?: boolean; dataDir?: string }, jsonFlag = false): Promise<void> {
  const projectType = detectProjectType();
  const dotEnv = readDotEnvFile();
  const backend = options.cloud ? 'cloud' : detectBackend({ ...process.env, ...dotEnv });

  const spinner = ora({ text: 'Initialising Axonio', isSilent: isJsonMode(jsonFlag) }).start();
  try {
    if (!isJsonMode(jsonFlag)) {
      process.stdout.write(`${renderBanner()}\n`);
    }

    let envValues: Record<string, string> = {};
    let db: ClawDB;

    if (options.cloud || backend === 'cloud') {
      let apiKey = envVar('API_KEY');
      if (!apiKey) {
        const response = await prompts({ type: 'password', name: 'value', message: 'Enter Axonio API key' });
        apiKey = response.value;
        if (!apiKey) {
          process.stdout.write('Open https://axonio.xyz/signup to create an API key.\n');
          throw new Error('Cloud API key required for --cloud init');
        }
      }
      process.env.AXONIO_API_KEY = apiKey;
      process.env.AXONIO_URL = CLOUD_URL;
      db = await ClawDB.autoProvision();
      envValues = { AXONIO_URL: CLOUD_URL, AXONIO_API_KEY: apiKey };
    } else {
      db = await ClawDB.autoProvision();
      envValues = { AXONIO_URL: db.endpoint };
    }

    await smokeTest(db);
    writeClawdbEnv(envValues);
    spinner.stop();

    // Detach the gRPC connectivity watcher now that we're done with the db.
    // This MUST happen synchronously before any `await` that yields to the
    // event loop — otherwise the pending watchConnectivityState deadline
    // callback fires before the error handler is registered, crashing the process.
    db.on('error', () => {});
    db.close();

    if (isJsonMode(jsonFlag)) {
      writeOutput({ projectType, backend, endpoint: db.endpoint, envFile: envFilePath(), snippet: formatSnippet(projectType) }, true);
      process.exit(0);
    }

    process.stdout.write(`${chalk.green('✓')} Server started on ${db.endpoint}\n`);
    process.stdout.write(`${chalk.green('✓')} Database initialised at ${options.dataDir ?? join(homedir(), '.clawdb')}/\n\n`);
    process.stdout.write('Add to your agent:\n\n');
    process.stdout.write(`  ${formatSnippet(projectType)}\n`);
    process.stdout.write('  MCP:         axonio mcp install-<claude|cursor|vscode|zed|openclaw|google-antigravity>\n\n');
    process.stdout.write("Your agent now has a database. That's it.\n\n");
    await maybeInstallMcpHost();
    process.exit(0);
  } catch (error) {
    spinner.stop();
    throw error;
  }
}

// ─── cloud login ─────────────────────────────────────────────────────────

async function cloudLogin(jsonFlag = false): Promise<void> {
  const response = await prompts({ type: 'password', name: 'apiKey', message: 'Axonio API key' });
  if (!response.apiKey) throw new Error('API key is required');
  writeClawdbEnv({ AXONIO_URL: CLOUD_URL, AXONIO_API_KEY: response.apiKey });
  writeOutput({ ok: true, cloud: true }, jsonFlag);
}

// ─── Command registrations ────────────────────────────────────────────────

function registerMcpCommands(program: Command): void {
  const mcp = program.command('mcp').description('MCP adapter management');
  const editors: EditorHost[] = ['claude', 'cursor', 'vscode', 'zed', 'openclaw', 'google-antigravity'];
  for (const host of editors) {
    mcp.command(`install-${host}`).option('--json', 'JSON output').action((options: { json?: boolean }) => {
      installMcpForHost(host, options.json);
    });
  }
  mcp.command('print-config').option('--host <host>', 'Target editor host', 'claude').action((options: { host: EditorHost }) => {
    writeOutput(mcpConfigBlock(options.host), true);
  });
}

function registerHealthCommands(program: Command): void {
  program.command('status').description('Show server health').option('--json', 'JSON output').action(async (options: { json?: boolean }) => {
    const db = await getDb();
    writeOutput(await db.health(), options.json);
  });
  program.command('ready').description('Check server readiness').option('--json', 'JSON output').action(async (options: { json?: boolean }) => {
    const db = await getDb();
    await db.ping();
    writeOutput({ ready: true }, options.json);
  });
}

function registerSessionCommands(program: Command): void {
  const session = program.command('session').description('Session management');

  session.command('create')
    .option('--role <role>', 'Role', '')
    .option('--scopes <scopes>', 'Comma-separated scopes')
    .option('--ttl <secs>', 'TTL in seconds', '3600')
    .option('--json', 'JSON output')
    .action(async (options: { role: string; scopes?: string; ttl: string; json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.createSession({
        role: options.role,
        scopes: options.scopes?.split(',').filter(Boolean) ?? [],
        ttlSecs: Number(options.ttl)
      }), options.json);
    });

  session.command('validate')
    .option('--json', 'JSON output')
    .action(async (options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.validateSession(), options.json);
    });

  session.command('revoke <sessionId>')
    .option('--json', 'JSON output')
    .action(async (sessionId: string, options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput({ revoked: await db.revokeSession(sessionId), sessionId }, options.json);
    });

  session.command('count')
    .option('--json', 'JSON output')
    .action(async (options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput({ count: await db.activeSessionCount() }, options.json);
    });
}

function registerMemoryCommands(program: Command): void {
  const memory = program.command('memory').description('Memory operations');

  memory.command('remember <content>')
    .option('--json', 'JSON output')
    .action(async (content: string, options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput({ id: await db.remember(content) }, options.json);
    });

  memory.command('remember-typed <content>')
    .option('--type <t>', 'Memory type', 'context')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--json', 'JSON output')
    .action(async (content: string, options: { type: string; tags?: string; json?: boolean }) => {
      const db = await getDb();
      writeOutput({ id: await db.rememberTyped(content, { type: options.type, tags: options.tags?.split(',').filter(Boolean) }) }, options.json);
    });

  memory.command('update <id> <content>')
    .option('--json', 'JSON output')
    .action(async (id: string, content: string, options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput({ updated: await db.updateMemory(id, content), id }, options.json);
    });

  memory.command('search <query>')
    .option('--top-k <n>', 'Top K results', '5')
    .option('--json', 'JSON output')
    .action(async (query: string, options: { topK: string; json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.search(query, { topK: Number(options.topK) }), options.json);
    });

  memory.command('recall <ids...>')
    .option('--json', 'JSON output')
    .action(async (ids: string[], options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.recall(ids), options.json);
    });

  memory.command('list')
    .option('--type <t>', 'Filter by type')
    .option('--limit <n>', 'Limit', '50')
    .option('--json', 'JSON output')
    .action(async (options: { type?: string; limit: string; json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.listMemories({ type: options.type, limit: Number(options.limit) }), options.json);
    });

  memory.command('delete <id>')
    .option('--json', 'JSON output')
    .action(async (id: string, options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput({ deleted: await db.deleteMemory(id), id }, options.json);
    });
}

function registerBranchCommands(program: Command): void {
  const branch = program.command('branch').description('Branch management');

  branch.command('fork <name>')
    .option('--from <branchId>', 'Source branch ID')
    .option('--json', 'JSON output')
    .action(async (name: string, options: { from?: string; json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.branch(name, options.from), options.json);
    });

  branch.command('list')
    .option('--json', 'JSON output')
    .action(async (options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.listBranches(), options.json);
    });

  branch.command('get <id>')
    .option('--json', 'JSON output')
    .action(async (id: string, options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.getBranch(id), options.json);
    });

  branch.command('get-by-name <name>')
    .option('--json', 'JSON output')
    .action(async (name: string, options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.getBranchByName(name), options.json);
    });

  branch.command('trunk')
    .option('--json', 'JSON output')
    .action(async (options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.getTrunkBranch(), options.json);
    });

  branch.command('diff <id>')
    .option('--target <t>', 'Target branch ID (default: trunk)', '')
    .option('--json', 'JSON output')
    .action(async (id: string, options: { target: string; json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.diff(id, options.target), options.json);
    });

  branch.command('merge <source>')
    .option('--target <t>', 'Target branch (default: trunk)', '')
    .option('--strategy <s>', 'Merge strategy', '')
    .option('--json', 'JSON output')
    .action(async (source: string, options: { target: string; strategy: string; json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.merge(source, options.target, options.strategy), options.json);
    });

  branch.command('discard <id>')
    .option('--json', 'JSON output')
    .action(async (id: string, options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput({ discarded: await db.discardBranch(id), id }, options.json);
    });

  branch.command('archive <id>')
    .option('--json', 'JSON output')
    .action(async (id: string, options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput({ archived: await db.archiveBranch(id), id }, options.json);
    });
}

function registerSyncCommands(program: Command): void {
  const sync = program.command('sync').description('Sync operations');

  sync.command('run')
    .option('--json', 'JSON output')
    .action(async (options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.sync(), options.json);
    });

  sync.command('push')
    .option('--json', 'JSON output')
    .action(async (options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.pushSync(), options.json);
    });

  sync.command('pull')
    .option('--json', 'JSON output')
    .action(async (options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.pullSync(), options.json);
    });

  sync.command('reconcile')
    .option('--json', 'JSON output')
    .action(async (options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.reconcileSync(), options.json);
    });

  sync.command('status')
    .option('--json', 'JSON output')
    .action(async (options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.syncStatus(), options.json);
    });
}

function registerReflectCommands(program: Command): void {
  const reflect = program.command('reflect').description('Reflection operations');

  reflect.command('run')
    .option('--watch', 'Poll until job completes')
    .option('--json', 'JSON output')
    .action(async (options: { watch?: boolean; json?: boolean }) => {
      const db = await getDb();
      const job = await db.reflect() as { jobId?: string; status?: string };
      if (options.watch && job.jobId) {
        let current: unknown = job;
        const spinner = ora({ text: `Job ${job.jobId}: ${job.status ?? ''}`, isSilent: isJsonMode(options.json) }).start();
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const polled = await db.reflectGetJob(job.jobId) as { status?: string };
          current = polled;
          spinner.text = `Job ${job.jobId}: ${polled.status ?? ''}`;
          if (polled.status === 'completed' || polled.status === 'failed') break;
          await new Promise((r) => setTimeout(r, 2000));
        }
        spinner.stop();
        writeOutput(current, options.json);
      } else {
        writeOutput(job, options.json);
      }
    });

  reflect.command('jobs')
    .option('--agent-id <id>', 'Agent ID', '')
    .option('--status <s>', 'Filter by status')
    .option('--limit <n>', 'Limit', '20')
    .option('--offset <n>', 'Offset', '0')
    .option('--json', 'JSON output')
    .action(async (options: { agentId: string; status?: string; limit: string; offset: string; json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.reflectListJobs(options.agentId, {
        status: options.status,
        limit: Number(options.limit),
        offset: Number(options.offset)
      }), options.json);
    });

  reflect.command('job <jobId>')
    .option('--json', 'JSON output')
    .action(async (jobId: string, options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.reflectGetJob(jobId), options.json);
    });

  reflect.command('facts <agentId>')
    .option('--json', 'JSON output')
    .action(async (agentId: string, options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.reflectGetFacts(agentId), options.json);
    });

  reflect.command('preferences <agentId>')
    .option('--json', 'JSON output')
    .action(async (agentId: string, options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.reflectGetPreferences(agentId), options.json);
    });

  reflect.command('contradictions <agentId>')
    .option('--json', 'JSON output')
    .action(async (agentId: string, options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.reflectGetContradictions(agentId), options.json);
    });

  reflect.command('resolve <agentId> <contradictionId>')
    .option('--strategy <s>', 'Resolution strategy', '')
    .option('--merged-value <json>', 'Merged value JSON', '')
    .option('--json', 'JSON output')
    .action(async (agentId: string, contradictionId: string, options: { strategy: string; mergedValue: string; json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.reflectResolveContradiction(agentId, contradictionId, {
        strategy: options.strategy,
        mergedValueJson: options.mergedValue
      }), options.json);
    });
}

function registerTxCommands(program: Command): void {
  const tx = program.command('tx').description('Transactional memory operations');

  tx.command('begin')
    .option('--json', 'JSON output')
    .action(async (options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput(await db.beginTx(), options.json);
    });

  tx.command('remember <txId> <content>')
    .option('--json', 'JSON output')
    .action(async (txId: string, content: string, options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput({ txId, memoryId: await db.txRemember(txId, content) }, options.json);
    });

  tx.command('remember-typed <txId> <content>')
    .option('--type <t>', 'Memory type', 'context')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--json', 'JSON output')
    .action(async (txId: string, content: string, options: { type: string; tags?: string; json?: boolean }) => {
      const db = await getDb();
      writeOutput({ txId, memoryId: await db.txRememberTyped(txId, content, { type: options.type, tags: options.tags?.split(',').filter(Boolean) }) }, options.json);
    });

  tx.command('commit <txId>')
    .option('--json', 'JSON output')
    .action(async (txId: string, options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput({ committed: await db.commitTx(txId), txId }, options.json);
    });

  tx.command('rollback <txId>')
    .option('--json', 'JSON output')
    .action(async (txId: string, options: { json?: boolean }) => {
      const db = await getDb();
      writeOutput({ rolledBack: await db.rollbackTx(txId), txId }, options.json);
    });
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const program = new Command();
  const version = cliVersion();
  program.name('axonio').description('Axonio command line interface').version(version);

  // Ensure each command tears down the SDK channel watcher to avoid
  // late unhandled gRPC timeout events and hanging CLI processes.
  program.hook('postAction', async () => {
    closeActiveClients();
  });

  program.command('init')
    .description('Initialise ClawDB for this project')
    .option('--cloud', 'Use cloud mode')
    .option('--data-dir <path>', 'Data directory')
    .option('--json', 'JSON output')
    .action(async (options: { cloud?: boolean; dataDir?: string; json?: boolean }) => {
      await initCommand(options, options.json);
    });

  program.command('start')
    .description('Start the local clawdb-server')
    .option('--port <n>', 'gRPC port', '50050')
    .option('--detach', 'Detach process')
    .option('--json', 'JSON output')
    .action((options: { port: string; detach?: boolean; json?: boolean }) => {
      startLocalBinary(Number(options.port), Boolean(options.detach));
      writeOutput({ started: true, port: Number(options.port), detach: Boolean(options.detach) }, options.json);
    });

  program.command('stop')
    .description('Stop a detached local server')
    .option('--json', 'JSON output')
    .action((options: { json?: boolean }) => {
      writeOutput({ stopped: tryStopPid() }, options.json);
    });

  registerHealthCommands(program);
  registerSessionCommands(program);
  registerMemoryCommands(program);
  registerBranchCommands(program);
  registerSyncCommands(program);
  registerReflectCommands(program);
  registerTxCommands(program);

  const cloud = program.command('cloud').description('Cloud account management');
  cloud.command('login').option('--json', 'JSON output').action(async (options: { json?: boolean }) => cloudLogin(options.json));
  cloud.command('logout').option('--json', 'JSON output').action((options: { json?: boolean }) => {
    writeClawdbEnv({ AXONIO_URL: '', AXONIO_API_KEY: '' });
    writeOutput({ loggedOut: true }, options.json);
  });
  cloud.command('status').option('--json', 'JSON output').action((options: { json?: boolean }) => {
    const env = existsSync(envFilePath()) ? readFileSync(envFilePath(), 'utf8') : '';
    // Configured means a non-empty key: logout leaves the line in place, empty.
    const configured = env.split('\n').some((line) => /^(AXONIO|CLAWDB)_API_KEY=.+/.test(line.trim()));
    writeOutput({ configured }, options.json);
  });

  registerMcpCommands(program);

  program.command('version').option('--json', 'JSON output').action((options: { json?: boolean }) => writeOutput({ version }, options.json));

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    writeError(error);
  }
}

if (require.main === module) {
  void main();
}
