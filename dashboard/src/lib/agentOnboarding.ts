export const SECRET_PLACEHOLDER = '<your-secret>';
export const MCP_URL_PLACEHOLDER = '<mcp-url>';
export const DEFAULT_HEADER_NAME = 'x-api-key';

export type OnboardingClient = 'claude-code' | 'json' | 'curl';

export interface OnboardingInputs {
  agentId: string;
  secret?: string;
  mcpUrl?: string;
  headerName?: string;
}

function secretOf(i: OnboardingInputs): string {
  return i.secret ?? SECRET_PLACEHOLDER;
}
function urlOf(i: OnboardingInputs): string {
  return i.mcpUrl ?? MCP_URL_PLACEHOLDER;
}
function headerOf(i: OnboardingInputs): string {
  return i.headerName ?? DEFAULT_HEADER_NAME;
}

export function buildClaudeCodeSnippet(i: OnboardingInputs): string {
  return `claude mcp add --transport http atom ${urlOf(i)} --header "${headerOf(i)}: ${secretOf(i)}"`;
}

export function buildJsonSnippet(i: OnboardingInputs): string {
  return JSON.stringify(
    { mcpServers: { atom: { url: urlOf(i), headers: { [headerOf(i)]: secretOf(i) } } } },
    null,
    2
  );
}

export function buildCurlSnippet(i: OnboardingInputs): string {
  return [
    `curl -X POST ${urlOf(i)} \\`,
    `  -H "${headerOf(i)}: ${secretOf(i)}" \\`,
    `  -H "content-type: application/json" \\`,
    `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
  ].join('\n');
}

export function buildSessionPrompt(i: OnboardingInputs): string {
  return `You are connected to atom, our team's shared knowledge hub, over MCP (agent id: ${i.agentId}). atom is the source of truth for how we work and what we know.

Before any task:
1. Load context — call search_cards with "agent onboarding" and compile_subtree on the matching node to learn how we work, conventions, and where things live. If no onboarding card exists yet, get_tree from the root and infer conventions from the top-level structure.
2. Read before acting — search atom for relevant prior knowledge instead of assuming.
3. Write back — record durable learnings, decisions, and reusable facts as new atomic cards (create_card / batch_op), placed in the right tree location. Keep one idea per card.

Tools: search_cards, get_tree, get_node, list_children, compile_subtree, create_card, update_card, create_symlink, move_node, batch_op.`;
}

export function buildClientSnippet(client: OnboardingClient, i: OnboardingInputs): string {
  switch (client) {
    case 'claude-code':
      return buildClaudeCodeSnippet(i);
    case 'json':
      return buildJsonSnippet(i);
    case 'curl':
      return buildCurlSnippet(i);
  }
}
