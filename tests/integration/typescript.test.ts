/**
 * Cross-SDK integration tests for ClawDB.
 *
 * If CLAWDB_TEST_ENDPOINT is set, the suite targets that server.
 * Otherwise it relies on the SDK's local auto-provisioning path.
 *
 * The suite is skipped in regular unit-test runs unless CLAWDB_INTEGRATION=1.
 *
 * Run:
 *   CLAWDB_INTEGRATION=1 pnpm vitest run
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ClawDB } from 'axonio';
import { ClawDBRetriever } from 'axonio-langchain';
import { ClawDBChatMessageHistory } from 'axonio-langchain';
import { createClawDBTools as createLCTools } from 'axonio-langchain';
import { createClawDBAgentTools } from 'axonio-openai-agents';
import { ClawDBToolHandler } from 'axonio-openai-agents';
import { clawdbTools } from 'axonio-vercel-ai';

const INTEGRATION = !!process.env['CLAWDB_INTEGRATION'];
const ENDPOINT = process.env['CLAWDB_TEST_ENDPOINT']?.trim();
const AGENT_ID = `test-agent-${Date.now()}`;
const EXPECTED_LANGCHAIN_TOOL_NAMES = [
  'clawdb_remember',
  'clawdb_search',
  'clawdb_recall',
  'clawdb_update_memory',
  'clawdb_delete_memory',
  'clawdb_list_memories',
  'clawdb_branch_fork',
  'clawdb_branch_list',
  'clawdb_branch_get',
  'clawdb_branch_trunk',
  'clawdb_branch_diff',
  'clawdb_branch_merge',
  'clawdb_branch_discard',
  'clawdb_branch_archive',
  'clawdb_sync',
  'clawdb_sync_push',
  'clawdb_sync_pull',
  'clawdb_sync_status',
  'clawdb_reflect',
  'clawdb_reflect_facts',
  'clawdb_reflect_preferences',
  'clawdb_reflect_contradictions',
  'clawdb_reflect_resolve',
  'clawdb_tx_begin',
  'clawdb_tx_remember',
  'clawdb_tx_commit',
  'clawdb_tx_rollback',
] as const;
const EXPECTED_OPENAI_TOOL_NAMES = [
  'remember_memory',
  'update_memory',
  'delete_memory',
  'list_memories',
  'search_memory',
  'recall_memory',
  'fork_branch',
  'list_branches',
  'get_branch',
  'get_trunk_branch',
  'diff_branches',
  'merge_branch',
  'discard_branch',
  'archive_branch',
  'sync',
  'sync_push',
  'sync_pull',
  'sync_status',
  'reflect',
  'reflect_facts',
  'reflect_preferences',
  'reflect_contradictions',
  'reflect_resolve',
  'tx_begin',
  'tx_remember',
  'tx_commit',
  'tx_rollback',
] as const;
const EXPECTED_VERCEL_TOOL_NAMES = [
  'remember',
  'update_memory',
  'delete_memory',
  'list_memories',
  'search',
  'recall',
  'branch_fork',
  'branch_list',
  'branch_get',
  'branch_trunk',
  'branch_diff',
  'branch_merge',
  'branch_discard',
  'branch_archive',
  'sync',
  'sync_push',
  'sync_pull',
  'sync_status',
  'reflect',
  'reflect_facts',
  'reflect_preferences',
  'reflect_contradictions',
  'reflect_resolve_contradiction',
  'tx_begin',
  'tx_remember',
  'tx_commit',
  'tx_rollback',
] as const;

describe.skipIf(!INTEGRATION)('ClawDB Integration Tests', () => {
  let db: ClawDB;
  const createdIds: string[] = [];

  beforeAll(async () => {
    db = ENDPOINT
      ? new ClawDB({ endpoint: ENDPOINT, agentId: AGENT_ID })
      : await ClawDB.autoProvision({ agentId: AGENT_ID });
  });

  afterAll(async () => {
    // Cleanup memories created during tests
    for (const id of createdIds) {
      await db.deleteMemory(id).catch(() => undefined);
    }
    db?.close();
  });

  // ──────────────────────────────────────────────────────────────
  // Core SDK: Memory CRUD
  // ──────────────────────────────────────────────────────────────

  it('SDK: remembers and recalls a memory', async () => {
    const id = await db.rememberTyped('Integration test memory', {
      type: 'context',
      tags: ['integration', 'test'],
    });
    createdIds.push(id);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('SDK: searches for a stored memory', async () => {
    const id = await db.rememberTyped('TypeScript integration test payload', {
      tags: ['search-test'],
    });
    createdIds.push(id);

    const results = await db.search('TypeScript integration test', { topK: 5 });
    const found = results.find(r => r.id === id);
    expect(found).toBeDefined();
    expect(found!.score).toBeGreaterThan(0);
  });

  it('SDK: recalls specific memories by ID', async () => {
    const id = await db.remember('Recall integration test');
    createdIds.push(id);

    const memories = await db.recall([id]);
    expect(memories).toHaveLength(1);
    expect(memories[0]!['content']).toBe('Recall integration test');
  });

  it('SDK: forgets (soft-deletes) a memory', async () => {
    const id = await db.remember('To be forgotten');
    await expect(db.deleteMemory(id)).resolves.toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // Core SDK: Branches
  // ──────────────────────────────────────────────────────────────

  it('SDK: forks a branch', async () => {
    const branchName = `test-branch-${Date.now()}`;
    const branch = await db.branch(branchName);
    expect(branch.name).toBe(branchName);
    expect(branch.branchId).toBeDefined();
  });

  it('SDK: lists branches including the new one', async () => {
    const branchName = `list-test-${Date.now()}`;
    await db.branch(branchName);
    const branches = await db.listBranches();
    expect(branches.some(b => b.name === branchName)).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // LangChain adapter
  // ──────────────────────────────────────────────────────────────

  it('LangChain: ClawDBRetriever retrieves documents', async () => {
    const id = await db.remember('LangChain retriever integration test');
    createdIds.push(id);

    const retriever = new ClawDBRetriever({ client: db, topK: 5 });
    const docs = await retriever.getRelevantDocuments('LangChain retriever');
    expect(docs.length).toBeGreaterThan(0);
    expect(typeof docs[0]!.pageContent).toBe('string');
  });

  it('LangChain: ClawDBChatMessageHistory stores and retrieves messages', async () => {
    const sessionId = `session-${Date.now()}`;
    const history = new ClawDBChatMessageHistory({ client: db, sessionId });

    await history.addUserMessage('Hello from LangChain');
    await history.addAIChatMessage('Hello back from ClawDB');

    const messages = await history.getMessages();
    expect(messages.length).toBeGreaterThanOrEqual(2);
    await history.clear();
  });

  it('LangChain: createClawDBTools returns the expanded tool surface', () => {
    const tools = createLCTools(db);
    expect(tools.map(t => t.name)).toEqual(EXPECTED_LANGCHAIN_TOOL_NAMES);
  });

  // ──────────────────────────────────────────────────────────────
  // OpenAI adapter
  // ──────────────────────────────────────────────────────────────

  it('OpenAI: createClawDBAgentTools returns Responses API tools', () => {
    const tools = createClawDBAgentTools(db);
    expect(tools.map(t => t.name)).toEqual(EXPECTED_OPENAI_TOOL_NAMES);
    expect(tools.every(t => t.type === 'function')).toBe(true);
    expect(tools.every(t => t.parameters.additionalProperties === false)).toBe(true);
  });

  it('OpenAI: ClawDBToolHandler.handle dispatches clawdb_remember', async () => {
    const handler = new ClawDBToolHandler(db);
    const result = JSON.parse(await handler.handle('remember_memory', { content: 'OAI integration test' }));
    expect(result.status).toBe('stored');
    if (result.memory_id) createdIds.push(result.memory_id as string);
  });

  it('OpenAI: ClawDBToolHandler.handle dispatches clawdb_search', async () => {
    const handler = new ClawDBToolHandler(db);
    const result = JSON.parse(await handler.handle('search_memory', { query: 'OAI integration test' }));
    expect(Array.isArray(result.results)).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // Vercel AI adapter
  // ──────────────────────────────────────────────────────────────

  it('Vercel AI: clawdbTools.remember.execute stores memory', async () => {
    const tools = clawdbTools(db);
    expect(Object.keys(tools)).toEqual(EXPECTED_VERCEL_TOOL_NAMES);
    const result = await tools.remember.execute({ content: 'Vercel AI integration test' });
    expect(typeof result.id).toBe('string');
    if (result.id) createdIds.push(result.id);
  });

  it('Vercel AI: clawdbTools.search.execute returns results', async () => {
    const tools = clawdbTools(db);
    const result = await tools.search.execute({ query: 'Vercel AI integration test' });
    expect(Array.isArray(result.results)).toBe(true);
  });

  it('Vercel AI: clawdbTools.recall.execute returns memories', async () => {
    const tools = clawdbTools(db);
    const id = await db.remember('vercel recall integration test');
    createdIds.push(id);
    const result = await tools.recall.execute({ ids: [id] });
    expect(Array.isArray(result.memories)).toBe(true);
  });
});
