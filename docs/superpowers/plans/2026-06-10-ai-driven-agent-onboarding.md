# AI-Driven Agent Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After creating/reconnecting an agent in atom's "API 키 관리" settings, surface an inline onboarding package — MCP connection snippets + a bootstrap session prompt — so a human can wire their AI onto atom as the team's shared knowledge hub.

**Architecture:** Pure builder functions generate client snippets and the session prompt from `{ agentId, secret, mcpUrl, headerName }`. The backend adds a `GET /api/config/connection-info` endpoint (MCP URL resolved from env/request) and idempotently seeds an "Agent Onboarding" card on startup that the prompt tells agents to read. A new `AgentOnboardingPanel` React component renders the package after create/reissue and via a per-agent "Connect" button.

**Tech Stack:** Fastify + TypeScript (backend, jest unit tests), React + Vite + i18next (dashboard, vitest unit tests), PostgreSQL. Dashboard package manager is pnpm.

**Repo & branch:** Work in `/Users/al02528308/Documents/Git/shelter/atom` on `main` (local-only commits; not pushed by this plan).

**Spec:** `docs/superpowers/specs/2026-06-10-ai-driven-agent-onboarding-design.md`

**Conventions discovered (follow these):**
- Backend unit tests live in `tests/unit/*.test.ts`, use **jest** globals (`describe/it/expect` — do NOT import them), and import source with a `.js` extension (e.g. `../../src/api/config/connection.js`). Run with `npm test -- <path>`.
- Dashboard unit tests sit next to source as `*.test.ts`, use **vitest** (`import { describe, expect, test } from 'vitest'`), and cover **pure logic only** (no component render tests). Run with `npx vitest run <path>` from `dashboard/`.
- No hardcoded UI strings — every label goes through `t(...)` with both `en` and `ko` keys.
- TypeScript: no `any`.

---

## Task 1: Backend — MCP URL resolver (pure)

**Files:**
- Create: `src/api/config/connection.ts`
- Test: `tests/unit/connection-info.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/connection-info.test.ts`:

```ts
import {
  resolveMcpUrl,
  buildConnectionInfo,
  MCP_HEADER_NAME,
} from "../../src/api/config/connection.js";

describe("connection info", () => {
  it("prefers PUBLIC_MCP_URL verbatim (trailing slash stripped)", () => {
    expect(
      resolveMcpUrl({
        publicMcpUrl: "https://x.example/mcp/",
        frontendUrl: "https://f.example",
        requestOrigin: "http://o",
      })
    ).toBe("https://x.example/mcp");
  });

  it("falls back to FRONTEND_URL + /mcp", () => {
    expect(
      resolveMcpUrl({ frontendUrl: "https://atom.nine-lives.dev/", requestOrigin: "http://o" })
    ).toBe("https://atom.nine-lives.dev/mcp");
  });

  it("falls back to request origin + /mcp", () => {
    expect(resolveMcpUrl({ requestOrigin: "http://localhost:4200" })).toBe(
      "http://localhost:4200/mcp"
    );
  });

  it("falls back to relative /mcp when nothing is known", () => {
    expect(resolveMcpUrl({})).toBe("/mcp");
  });

  it("buildConnectionInfo returns the resolved url and x-api-key header", () => {
    expect(buildConnectionInfo({ frontendUrl: "https://a" })).toEqual({
      mcpUrl: "https://a/mcp",
      headerName: "x-api-key",
    });
    expect(MCP_HEADER_NAME).toBe("x-api-key");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/unit/connection-info.test.ts`
Expected: FAIL — cannot find module `../../src/api/config/connection.js`.

- [ ] **Step 3: Write the implementation**

Create `src/api/config/connection.ts`:

```ts
export const MCP_HEADER_NAME = "x-api-key";

export interface ConnectionInfoInput {
  publicMcpUrl?: string;
  frontendUrl?: string;
  requestOrigin?: string;
}

export interface ConnectionInfo {
  mcpUrl: string;
  headerName: string;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function resolveMcpUrl(input: ConnectionInfoInput): string {
  const publicMcpUrl = input.publicMcpUrl?.trim();
  if (publicMcpUrl) return stripTrailingSlash(publicMcpUrl);

  const frontendUrl = input.frontendUrl?.trim();
  if (frontendUrl) return stripTrailingSlash(frontendUrl) + "/mcp";

  const requestOrigin = input.requestOrigin?.trim();
  if (requestOrigin) return stripTrailingSlash(requestOrigin) + "/mcp";

  return "/mcp";
}

export function buildConnectionInfo(input: ConnectionInfoInput): ConnectionInfo {
  return { mcpUrl: resolveMcpUrl(input), headerName: MCP_HEADER_NAME };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/unit/connection-info.test.ts`
Expected: PASS (5 passing).

- [ ] **Step 5: Commit**

```bash
git add src/api/config/connection.ts tests/unit/connection-info.test.ts
git commit -m "feat(api): add MCP connection-info resolver for agent onboarding"
```

---

## Task 2: Backend — `GET /api/config/connection-info` route

**Files:**
- Modify: `src/api/routes/config.ts` (add import near line 18; add route after the Agents block, before the Database Info block ~line 195)

- [ ] **Step 1: Add the import**

In `src/api/routes/config.ts`, add this import alongside the other `../config/*` imports (after the `policy.js` import on line 18):

```ts
import { buildConnectionInfo } from '../config/connection.js';
```

- [ ] **Step 2: Add the route**

In `src/api/routes/config.ts`, immediately before the `// ── Database Info ──` comment (currently ~line 196), insert:

```ts
  // ── Agent Onboarding ────────────────────────────────────────────────────────

  // GET /api/config/connection-info — MCP URL + header name for onboarding (editor+)
  app.get('/api/config/connection-info', async (req, reply) => {
    if (!requireRole(req, reply, 'editor')) return;
    const xfp = req.headers['x-forwarded-proto'];
    const proto = (Array.isArray(xfp) ? xfp[0] : xfp) ?? req.protocol;
    const host = req.headers.host;
    const requestOrigin = host ? `${proto}://${host}` : undefined;
    return reply.send(
      buildConnectionInfo({
        publicMcpUrl: process.env['PUBLIC_MCP_URL'],
        frontendUrl: process.env['FRONTEND_URL'],
        requestOrigin,
      })
    );
  });
```

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify the route is registered and guarded**

Run (in one terminal): `npm run dev`
Then: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4200/api/config/connection-info`
Expected: `401` (route exists but requires auth — `/api/config/*` is not in the auth-bypass list). A `404` would mean the route is not registered.
Stop the dev server afterward.

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/config.ts
git commit -m "feat(api): expose GET /api/config/connection-info"
```

---

## Task 3: Backend — onboarding card seed

**Files:**
- Modify: `src/db/queries/cards.ts` (add `findCardByTitle`)
- Create: `src/api/onboarding-seed.ts`
- Test: `tests/unit/onboarding-seed.test.ts`
- Modify: `src/api/index.ts` (call seed inside `seedMigration`)

- [ ] **Step 1: Add `findCardByTitle` query**

In `src/db/queries/cards.ts`, after `selectCardById` (ends ~line 61), add:

```ts
export async function findCardByTitle(
  db: Queryable,
  title: string
): Promise<Card | null> {
  const result = await db.query(`SELECT * FROM cards WHERE title = $1 LIMIT 1`, [title]);
  if (result.rows.length === 0) return null;
  return rowToCard(result.rows[0]);
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/onboarding-seed.test.ts`:

```ts
import {
  ensureOnboardingCard,
  buildOnboardingCardInput,
  ONBOARDING_CARD_TITLE,
} from "../../src/api/onboarding-seed.js";

describe("onboarding card seed", () => {
  it("creates the card when none exists", async () => {
    const created: unknown[] = [];
    const result = await ensureOnboardingCard({
      exists: async () => false,
      create: async (input) => {
        created.push(input);
      },
    });
    expect(result).toBe(true);
    expect(created).toHaveLength(1);
  });

  it("is idempotent — does nothing when the card already exists", async () => {
    let createCalls = 0;
    const result = await ensureOnboardingCard({
      exists: async () => true,
      create: async () => {
        createCalls++;
      },
    });
    expect(result).toBe(false);
    expect(createCalls).toBe(0);
  });

  it("builds a knowledge card with the canonical title under 50 chars", () => {
    const input = buildOnboardingCardInput();
    expect(input.card_type).toBe("knowledge");
    expect(input.title).toBe(ONBOARDING_CARD_TITLE);
    expect(input.title.length).toBeLessThanOrEqual(50);
    expect(input.content).toContain("atom");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- tests/unit/onboarding-seed.test.ts`
Expected: FAIL — cannot find module `../../src/api/onboarding-seed.js`.

- [ ] **Step 4: Write the implementation**

Create `src/api/onboarding-seed.ts`:

```ts
import type { CreateCardInput } from "../shared/types.js";

export const ONBOARDING_CARD_TITLE = "Agent Onboarding";

export const ONBOARDING_CARD_CONTENT = `# Agent Onboarding

This is atom — our team's shared knowledge hub. You (an AI agent) read from it
before working and write durable learnings back to it.

## How we work
- **Read before acting.** Search atom for prior knowledge before assuming.
- **Write back.** Record reusable facts, decisions, and learnings as atomic
  knowledge cards. Keep one idea per card.
- **Place cards thoughtfully.** Put each card under the structure node it
  belongs to; use \`get_tree\` to find the right home.

## Conventions
- Card titles are short (<= 50 chars).
- "structure" cards organize hierarchy; "knowledge" cards hold content.
- Link related cards via references instead of duplicating content.

Edit this card in atom to keep onboarding guidance current — every agent reads it.`;

export function buildOnboardingCardInput(): CreateCardInput {
  return {
    card_type: "knowledge",
    title: ONBOARDING_CARD_TITLE,
    content: ONBOARDING_CARD_CONTENT,
    parent_node_id: null,
    tags: ["onboarding", "agents"],
    references: [],
  };
}

export interface OnboardingSeedDeps {
  exists(title: string): Promise<boolean>;
  create(input: CreateCardInput): Promise<void>;
}

export async function ensureOnboardingCard(deps: OnboardingSeedDeps): Promise<boolean> {
  if (await deps.exists(ONBOARDING_CARD_TITLE)) return false;
  await deps.create(buildOnboardingCardInput());
  return true;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/unit/onboarding-seed.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 6: Wire the seed into startup**

In `src/api/index.ts`, add imports near the other db/service imports (after line 23 `import { findAgentByAgentId, insertAgent } from "../db/queries/agents.js";`):

```ts
import { findCardByTitle } from "../db/queries/cards.js";
import { createCard } from "../services/card.service.js";
import { ensureOnboardingCard, ONBOARDING_CARD_TITLE } from "./onboarding-seed.js";
```

Then inside `seedMigration()`, just before its closing brace (after the MCP_SECRET block, ~line 87), add:

```ts
  // Agent Onboarding card — bootstrap target referenced by agent session prompts
  const seededOnboarding = await ensureOnboardingCard({
    exists: async (title) => (await findCardByTitle(db, title)) !== null,
    create: async (input) => {
      await createCard(null, input);
    },
  });
  if (seededOnboarding) {
    console.log(`[seed] Created "${ONBOARDING_CARD_TITLE}" card`);
  }
```

- [ ] **Step 7: Verify build + the seed unit test still pass**

Run: `npx tsc --noEmit && npm test -- tests/unit/onboarding-seed.test.ts`
Expected: no tsc errors; tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/db/queries/cards.ts src/api/onboarding-seed.ts tests/unit/onboarding-seed.test.ts src/api/index.ts
git commit -m "feat(api): idempotently seed Agent Onboarding card on startup"
```

---

## Task 4: Frontend — onboarding builders (pure)

**Files:**
- Create: `dashboard/src/lib/agentOnboarding.ts`
- Test: `dashboard/src/lib/agentOnboarding.test.ts`

All commands in this task run from the `dashboard/` directory.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/lib/agentOnboarding.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/agentOnboarding.test.ts`
Expected: FAIL — cannot resolve `./agentOnboarding`.

- [ ] **Step 3: Write the implementation**

Create `dashboard/src/lib/agentOnboarding.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/agentOnboarding.test.ts`
Expected: PASS (6 passing).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/agentOnboarding.ts dashboard/src/lib/agentOnboarding.test.ts
git commit -m "feat(dashboard): add agent onboarding snippet/prompt builders"
```

---

## Task 5: Frontend — types, API client, and hook wiring

**Files:**
- Modify: `dashboard/src/api/types.ts` (add `ConnectionInfo`)
- Modify: `dashboard/src/api/configApi.ts` (add `getConnectionInfo`, fix `reissueSecret` return type)
- Modify: `dashboard/src/hooks/useConfig.ts` (track `lastCreated` + `connectionInfo`)

- [ ] **Step 1: Add the `ConnectionInfo` type**

In `dashboard/src/api/types.ts`, after the `Agent` interface (ends line 18), add:

```ts
export interface ConnectionInfo {
  mcpUrl: string;
  headerName: string;
}
```

- [ ] **Step 2: Update the API client**

In `dashboard/src/api/configApi.ts`:

Change the import on line 2 to include `ConnectionInfo`:

```ts
import type { Agent, User, UserRole, ConnectionInfo } from './types';
```

Replace the `reissueSecret` method (lines 25-27) with a corrected return type (the route returns the public agent plus the secret):

```ts
  reissueSecret(id: string): Promise<Agent & { secret: string }> {
    return request(`/api/config/agents/${id}/reissue`, { method: 'POST' });
  },
```

Add a `getConnectionInfo` method (e.g. right after `getDbInfo`):

```ts
  getConnectionInfo(): Promise<ConnectionInfo> {
    return request('/api/config/connection-info');
  },
```

- [ ] **Step 3: Update `useConfig`**

In `dashboard/src/hooks/useConfig.ts`:

Change the import on line 2 to add `ConnectionInfo`:

```ts
import { configApi, type User, type Agent, type UserRole, type ConnectionInfo } from '../api/client';
```

Replace the `lastCreatedSecret` state (line 8) with `lastCreated` + `connectionInfo`:

```ts
  const [lastCreated, setLastCreated] = useState<{ agentId: string; secret: string } | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
```

Replace `loadAgents` (lines 20-28) to also fetch connection info:

```ts
  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const [data, conn] = await Promise.all([
        configApi.listAgents(),
        configApi.getConnectionInfo().catch(() => null),
      ]);
      setAgents(data);
      setConnectionInfo(conn);
    } finally {
      setLoading(false);
    }
  }, []);
```

Replace `createAgent` (lines 48-55), `reissueSecret` (lines 57-60), and `clearSecret` (line 70):

```ts
  const createAgent = useCallback(
    async (input: { agent_id: string; display_name?: string }) => {
      const result = await configApi.createAgent(input);
      setLastCreated(result.secret ? { agentId: result.agent_id, secret: result.secret } : null);
      await loadAgents();
    },
    [loadAgents]
  );

  const reissueSecret = useCallback(async (id: string) => {
    const result = await configApi.reissueSecret(id);
    setLastCreated({ agentId: result.agent_id, secret: result.secret });
  }, []);
```

```ts
  const clearSecret = useCallback(() => setLastCreated(null), []);
```

Update the returned object (lines 72-85): replace `lastCreatedSecret,` with `lastCreated,` and add `connectionInfo,`:

```ts
  return {
    users,
    agents,
    loading,
    lastCreated,
    connectionInfo,
    clearSecret,
    loadUsers,
    loadAgents,
    addUser,
    updateUser,
    createAgent,
    reissueSecret,
    updateAgent,
  };
```

- [ ] **Step 4: Verify the existing builder tests still pass and types compile**

Run from `dashboard/`: `npx tsc -b`
Expected: AgentManagementTab.tsx will report a type error about `lastCreatedSecret` no longer existing — that is expected and fixed in Task 7. To confirm only that error remains, you may instead run `npx vitest run src/lib/agentOnboarding.test.ts` (PASS). Proceed to commit; the tab is updated next.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/api/types.ts dashboard/src/api/configApi.ts dashboard/src/hooks/useConfig.ts
git commit -m "feat(dashboard): track lastCreated agent + connectionInfo in useConfig"
```

---

## Task 6: Frontend — `AgentOnboardingPanel` component

**Files:**
- Create: `dashboard/src/components/Config/AgentOnboardingPanel.tsx`

- [ ] **Step 1: Write the component**

Create `dashboard/src/components/Config/AgentOnboardingPanel.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConnectionInfo } from '../../api/types';
import {
  buildClientSnippet,
  buildSessionPrompt,
  type OnboardingClient,
} from '../../lib/agentOnboarding';

interface AgentOnboardingPanelProps {
  agentId: string;
  secret?: string;
  connectionInfo: ConnectionInfo | null;
  onDismiss?: () => void;
}

const CLIENTS: { id: OnboardingClient; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'json', label: 'Claude Desktop / Cursor' },
  { id: 'curl', label: 'curl' },
];

export function AgentOnboardingPanel({
  agentId,
  secret,
  connectionInfo,
  onDismiss,
}: AgentOnboardingPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'connect' | 'prompt'>('connect');
  const [client, setClient] = useState<OnboardingClient>('claude-code');
  const [copied, setCopied] = useState<string | null>(null);

  const inputs = {
    agentId,
    secret,
    mcpUrl: connectionInfo?.mcpUrl,
    headerName: connectionInfo?.headerName,
  };
  const connectSnippet = buildClientSnippet(client, inputs);
  const promptText = buildSessionPrompt(inputs);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    } catch {
      // ignore clipboard failures
    }
  };

  const pill = (active: boolean) =>
    `text-xs rounded px-2 py-0.5 font-sans cursor-pointer border ${
      active
        ? 'border-brand/40 bg-brand/10 text-brand'
        : 'border-border bg-transparent text-muted-foreground hover:bg-muted'
    }`;

  const copyBtn = (key: string, text: string) => (
    <button
      className="text-xs rounded px-2.5 py-1 border border-brand/40 bg-transparent text-brand cursor-pointer hover:bg-brand/10 font-sans whitespace-nowrap"
      onClick={() => copy(key, text)}
    >
      {copied === key ? t('common.copied') : t('common.copy')}
    </button>
  );

  return (
    <div className="flex flex-col gap-3 bg-brand/8 border border-brand/25 rounded-md px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-brand">
          {t('onboarding.panel_title', { agent: agentId })}
        </div>
        {onDismiss && (
          <button
            className="text-xs rounded px-2 py-0.5 border border-border bg-transparent text-muted-foreground cursor-pointer hover:bg-muted font-sans"
            onClick={onDismiss}
          >
            {t('agents.acknowledged')}
          </button>
        )}
      </div>

      {secret && (
        <div className="flex flex-col gap-1">
          <div className="text-xs text-brand">{t('agents.new_key_warning')}</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-card border border-border rounded px-2 py-1.5 font-mono text-foreground break-all">
              {secret}
            </code>
            {copyBtn('secret', secret)}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button className={pill(tab === 'connect')} onClick={() => setTab('connect')}>
          {t('onboarding.tab_connect')}
        </button>
        <button className={pill(tab === 'prompt')} onClick={() => setTab('prompt')}>
          {t('onboarding.tab_prompt')}
        </button>
      </div>

      {tab === 'connect' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground">{t('onboarding.client_label')}</span>
            {CLIENTS.map((c) => (
              <button key={c.id} className={pill(client === c.id)} onClick={() => setClient(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex items-start gap-2">
            <pre className="flex-1 text-xs bg-card border border-border rounded px-2 py-1.5 font-mono text-foreground whitespace-pre-wrap break-all overflow-x-auto">
              {connectSnippet}
            </pre>
            {copyBtn('connect', connectSnippet)}
          </div>
          {!connectionInfo && (
            <div className="text-node-error text-xs">{t('onboarding.connect_hint')}</div>
          )}
          {!secret && (
            <div className="text-muted-foreground text-xs">{t('onboarding.secret_missing_hint')}</div>
          )}
        </div>
      )}

      {tab === 'prompt' && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground">{t('onboarding.prompt_intro_hint')}</div>
          <div className="flex items-start gap-2">
            <pre className="flex-1 text-xs bg-card border border-border rounded px-2 py-1.5 font-mono text-foreground whitespace-pre-wrap overflow-x-auto">
              {promptText}
            </pre>
            {copyBtn('prompt', promptText)}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run from `dashboard/`: `npx tsc -b`
Expected: no new errors from `AgentOnboardingPanel.tsx` (the only remaining error is the `lastCreatedSecret` reference in `AgentManagementTab.tsx`, fixed in Task 7).

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/Config/AgentOnboardingPanel.tsx
git commit -m "feat(dashboard): add AgentOnboardingPanel (connect + session prompt)"
```

---

## Task 7: Frontend — wire the panel into `AgentManagementTab`

**Files:**
- Modify: `dashboard/src/components/Config/AgentManagementTab.tsx` (full replacement)

- [ ] **Step 1: Replace the component**

Replace the entire contents of `dashboard/src/components/Config/AgentManagementTab.tsx` with:

```tsx
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfig } from '../../hooks/useConfig';
import { AgentOnboardingPanel } from './AgentOnboardingPanel';

export function AgentManagementTab() {
  const { t } = useTranslation();
  const {
    agents,
    loading,
    lastCreated,
    connectionInfo,
    clearSecret,
    loadAgents,
    createAgent,
    reissueSecret,
    updateAgent,
  } = useConfig();

  const [newAgentId, setNewAgentId] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reissueErrors, setReissueErrors] = useState<Record<string, string>>({});
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({});
  const [connectAgentId, setConnectAgentId] = useState<string | null>(null);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const handleCreate = async () => {
    if (!newAgentId.trim()) {
      setCreateError('agent_id를 입력하세요.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await createAgent({
        agent_id: newAgentId.trim(),
        display_name: newDisplayName.trim() || undefined,
      });
      setNewAgentId('');
      setNewDisplayName('');
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleReissue = async (id: string) => {
    setReissueErrors((prev) => ({ ...prev, [id]: '' }));
    try {
      await reissueSecret(id);
    } catch (e: unknown) {
      setReissueErrors((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : String(e),
      }));
    }
  };

  const handleToggleActive = async (id: string, is_active: boolean) => {
    setUpdateErrors((prev) => ({ ...prev, [id]: '' }));
    try {
      await updateAgent(id, { is_active });
    } catch (e: unknown) {
      setUpdateErrors((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : String(e),
      }));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 생성/재발급 직후: 시크릿 + 온보딩 패키지 */}
      {lastCreated && (
        <AgentOnboardingPanel
          agentId={lastCreated.agentId}
          secret={lastCreated.secret}
          connectionInfo={connectionInfo}
          onDismiss={clearSecret}
        />
      )}

      {/* 새 에이전트 생성 */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t('agents.create_section')}
        </div>
        <div className="flex flex-col gap-2">
          <input
            className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-foreground text-sm outline-none focus:border-brand font-sans"
            placeholder={t('agents.name_placeholder')}
            value={newAgentId}
            onChange={(e) => setNewAgentId(e.target.value)}
          />
          <input
            className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-foreground text-sm outline-none focus:border-brand font-sans"
            placeholder={t('agents.display_name_placeholder')}
            value={newDisplayName}
            onChange={(e) => setNewDisplayName(e.target.value)}
          />
          <button
            className="self-start bg-brand text-white border-none rounded px-3 py-1.5 text-sm cursor-pointer font-sans disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? t('agents.creating') : t('agents.generate_btn')}
          </button>
          {createError && <div className="text-node-error text-xs">{createError}</div>}
        </div>
      </div>

      {/* 에이전트 목록 */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t('agents.list_section')}
        </div>
        {loading && <div className="text-muted-foreground text-sm">{t('common.loading')}</div>}
        {!loading && agents.length === 0 && (
          <div className="text-muted-foreground text-sm">{t('agents.no_agents')}</div>
        )}
        <div className="flex flex-col gap-2">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="flex flex-col gap-1 bg-card border border-border rounded px-3 py-2"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-sm text-foreground font-mono flex-1 min-w-0 truncate">
                  {agent.agent_id}
                </code>
                {agent.display_name && (
                  <span className="text-xs text-muted-foreground">{agent.display_name}</span>
                )}
                <span
                  className={`text-xs rounded px-1.5 py-px border ${
                    agent.is_active
                      ? 'text-node-response border-node-response/40 bg-node-response/10'
                      : 'text-muted-foreground border-border bg-muted'
                  }`}
                >
                  {agent.is_active ? t('agents.active') : t('agents.inactive')}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  className="text-xs rounded px-2 py-0.5 border border-border bg-transparent text-muted-foreground cursor-pointer hover:bg-muted font-sans"
                  onClick={() =>
                    setConnectAgentId((cur) => (cur === agent.agent_id ? null : agent.agent_id))
                  }
                >
                  {t('onboarding.connect_btn')}
                </button>
                <button
                  className="text-xs rounded px-2 py-0.5 border border-border bg-transparent text-muted-foreground cursor-pointer hover:bg-muted font-sans"
                  onClick={() => handleReissue(agent.id)}
                >
                  {t('agents.reissue')}
                </button>
                <button
                  className="text-xs rounded px-2 py-0.5 border border-border bg-transparent text-muted-foreground cursor-pointer hover:bg-muted font-sans"
                  onClick={() => handleToggleActive(agent.id, !agent.is_active)}
                >
                  {agent.is_active ? t('agents.deactivate') : t('agents.activate')}
                </button>
              </div>
              {connectAgentId === agent.agent_id && (
                <AgentOnboardingPanel
                  agentId={agent.agent_id}
                  connectionInfo={connectionInfo}
                  onDismiss={() => setConnectAgentId(null)}
                />
              )}
              {reissueErrors[agent.id] && (
                <div className="text-node-error text-xs">{reissueErrors[agent.id]}</div>
              )}
              {updateErrors[agent.id] && (
                <div className="text-node-error text-xs">{updateErrors[agent.id]}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the dashboard type-checks**

Run from `dashboard/`: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/Config/AgentManagementTab.tsx
git commit -m "feat(dashboard): surface onboarding panel after create + per-agent Connect"
```

---

## Task 8: i18n — add the `onboarding` namespace

**Files:**
- Modify: `dashboard/src/locales/en/translation.json`
- Modify: `dashboard/src/locales/ko/translation.json`

- [ ] **Step 1: Add the English keys**

In `dashboard/src/locales/en/translation.json`, after the `"agents": { ... }` block's closing `},` (the block ends at line 66 with `},`), insert:

```json
  "onboarding": {
    "panel_title": "Onboarding package — {{agent}}",
    "tab_connect": "Connect",
    "tab_prompt": "Session prompt",
    "client_label": "Client:",
    "connect_btn": "Connect",
    "prompt_intro_hint": "Paste this into your AI's session/system prompt. It loads the real instructions from atom's onboarding card.",
    "connect_hint": "Could not load the MCP URL — fill in <mcp-url> manually.",
    "secret_missing_hint": "Secret is shown only once. Reissue to embed a fresh secret in these snippets."
  },
```

- [ ] **Step 2: Add the Korean keys**

In `dashboard/src/locales/ko/translation.json`, after the `"agents": { ... }` block's closing `},` (line 66), insert:

```json
  "onboarding": {
    "panel_title": "온보딩 패키지 — {{agent}}",
    "tab_connect": "연결 설정",
    "tab_prompt": "세션 프롬프트",
    "client_label": "클라이언트:",
    "connect_btn": "연결",
    "prompt_intro_hint": "AI의 세션/시스템 프롬프트에 붙여넣으세요. 실제 지침은 atom의 온보딩 카드에서 로드됩니다.",
    "connect_hint": "MCP URL을 불러오지 못했습니다 — <mcp-url>을 직접 입력하세요.",
    "secret_missing_hint": "시크릿은 1회만 표시됩니다. 스니펫에 새 시크릿을 넣으려면 재발급하세요."
  },
```

- [ ] **Step 3: Verify both files are valid JSON**

Run from repo root:

```bash
node -e "JSON.parse(require('fs').readFileSync('dashboard/src/locales/en/translation.json','utf8')); JSON.parse(require('fs').readFileSync('dashboard/src/locales/ko/translation.json','utf8')); console.log('valid')"
```

Expected: `valid`.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/locales/en/translation.json dashboard/src/locales/ko/translation.json
git commit -m "i18n: add onboarding namespace (en, ko)"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Backend — type-check, build, unit tests**

Run from repo root:

```bash
npx tsc --noEmit
npm run test:unit
```

Expected: no tsc errors; jest reports all unit tests passing (including `connection-info` and `onboarding-seed`).

- [ ] **Step 2: Frontend — type-check, unit tests, build**

Run from `dashboard/`:

```bash
npx tsc -b
npx vitest run
npx vite build
```

Expected: no type errors; vitest all passing (including `agentOnboarding`); build succeeds.

- [ ] **Step 3: Manual smoke test**

Start the stack locally (`docker compose ... up` per project docs, or `npm run dev` + dashboard dev server). Then in the dashboard:
1. Open 설정 → API 키 관리.
2. Create an agent → confirm the onboarding panel appears with the real secret in the Connect snippet; switch clients (Claude Code / JSON / curl); switch to 세션 프롬프트 and confirm the agent id is interpolated; test copy buttons.
3. Click "연결" on an existing agent → confirm the panel opens inline with `<your-secret>` placeholder and the secret-missing hint; the prompt tab works.
4. Confirm a card titled "Agent Onboarding" exists (e.g. via search in the tree).

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore: verification fixes for agent onboarding"
```

(Skip if nothing changed.)

---

## Notes for the implementer

- Do **not** push to `origin`/`fork`; this plan commits locally only. The user decides when to push (atom's `origin` = eiaserinnys/atom, `fork` = ebrenpy/atom).
- The agent-facing **session prompt text stays English** by design (instructions to an LLM); only UI chrome is localized.
- Out of scope (do not add): `agents.last_used_at`, per-agent custom prompts, prompt localization, in-browser MCP playground.
