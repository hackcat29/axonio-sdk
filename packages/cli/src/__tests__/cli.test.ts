import { describe, expect, it } from 'vitest';
import { detectProjectType, detectBackend, formatSnippet, mcpConfigBlock } from '../index';

describe('cli helpers', () => {
  it('detects backend from env', () => {
    expect(detectBackend({ DATABASE_URL: 'postgres://x' })).toBe('postgres');
    expect(detectBackend({ AXONIO_API_KEY: 'k' })).toBe('cloud');
    // The older name keeps working.
    expect(detectBackend({ CLAWDB_API_KEY: 'k' })).toBe('cloud');
    expect(detectBackend({ AXONIO_API_KEY: '', CLAWDB_API_KEY: '' })).not.toBe('cloud');
    expect(detectBackend({})).toBe('sqlite');
  });

  it('formats snippets', () => {
    expect(formatSnippet('node')).toContain("import axonio from 'axonio'");
    expect(formatSnippet('python')).toContain('from axonio import axonio');
  });

  it('builds editor config block', () => {
    const claude = mcpConfigBlock('claude') as { mcpServers: { axonio: { command: string; env: { AXONIO_AGENT_ID: string } } } };
    expect(claude.mcpServers.axonio.command).toBe('npx');
    expect(claude.mcpServers.axonio.env.AXONIO_AGENT_ID).toBe('claude');

    const zed = mcpConfigBlock('zed') as { mcpServers: { axonio: { env: { AXONIO_AGENT_ID: string } } } };
    expect(zed.mcpServers.axonio.env.AXONIO_AGENT_ID).toBe('zed');
  });

  it('detects project type from filenames', () => {
    expect(detectProjectType(['package.json'])).toBe('node');
    expect(detectProjectType(['pyproject.toml'])).toBe('python');
  });
});
