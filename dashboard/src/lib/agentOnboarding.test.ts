import { describe, expect, test } from 'vitest';
import {
  buildClaudeCodeSnippet,
  buildJsonSnippet,
  buildCurlSnippet,
  buildSessionPrompt,
  buildClientSnippet,
  SECRET_PLACEHOLDER,
  MCP_URL_PLACEHOLDER,
} from './agentOnboarding';

const full = {
  agentId: 'seosoyoung',
  secret: 'abc123',
  mcpUrl: 'https://atom.nine-lives.dev/mcp',
  headerName: 'x-api-key',
};

describe('agent onboarding builders', () => {
  test('claude code snippet embeds url, header, and secret', () => {
    expect(buildClaudeCodeSnippet(full)).toBe(
      'claude mcp add --transport http atom https://atom.nine-lives.dev/mcp --header "x-api-key: abc123"'
    );
  });

  test('json snippet parses to a valid MCP config', () => {
    expect(JSON.parse(buildJsonSnippet(full))).toEqual({
      mcpServers: {
        atom: { url: 'https://atom.nine-lives.dev/mcp', headers: { 'x-api-key': 'abc123' } },
      },
    });
  });

  test('curl snippet posts tools/list with the header', () => {
    const s = buildCurlSnippet(full);
    expect(s).toContain('curl -X POST https://atom.nine-lives.dev/mcp');
    expect(s).toContain('"x-api-key: abc123"');
    expect(s).toContain('tools/list');
  });

  test('missing secret and url fall back to placeholders', () => {
    const s = buildClaudeCodeSnippet({ agentId: 'a' });
    expect(s).toContain(SECRET_PLACEHOLDER);
    expect(s).toContain(MCP_URL_PLACEHOLDER);
  });

  test('session prompt interpolates the agent id and names the tools', () => {
    const p = buildSessionPrompt(full);
    expect(p).toContain('agent id: seosoyoung');
    expect(p).toContain('search_cards');
    expect(p).toContain('Write back');
  });

  test('buildClientSnippet dispatches by client id', () => {
    expect(buildClientSnippet('json', full)).toBe(buildJsonSnippet(full));
    expect(buildClientSnippet('curl', full)).toBe(buildCurlSnippet(full));
    expect(buildClientSnippet('claude-code', full)).toBe(buildClaudeCodeSnippet(full));
  });
});
