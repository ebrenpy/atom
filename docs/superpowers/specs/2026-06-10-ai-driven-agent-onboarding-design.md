# AI-Driven Agent Onboarding — Design Spec

- **Date:** 2026-06-10
- **Repo:** `atom` (eiaserinnys/atom · deployed from `~/shelter/atom`)
- **Status:** Approved design → ready for implementation plan
- **Area:** Dashboard settings → "API 키 관리" (Agent/API-key management)

## 1. Problem & Goal

Today, creating an agent (`agent_id` + display name) yields a one-time secret and nothing else. A human must already know how to wire the secret into an MCP client and how to make their AI actually *use* atom. atom's premise is that it's the team's **centralized knowledge hub that LLMs read from and write to** ("by the agents, for the agents") — but there is zero in-app guidance to onboard an AI onto it.

**Goal:** After creating (or reconnecting) an agent, produce a copy-paste **onboarding package** a human hands to their AI so it (1) connects to atom over MCP and (2) receives a session prompt that makes it use atom as the shared knowledge base.

## 2. Key Decisions (from brainstorming)

1. **Agent role = read+write contributor.** The session prompt instructs the AI to *read before acting* (search/compile atom for prior knowledge) and *write back* durable learnings as cards. Matches atom's "by the agents, for the agents" philosophy.
2. **Prompt source of truth = atom bootstrap.** The dashboard generates a *short* prompt that tells the AI to first load atom's "Agent Onboarding" card (via `search_cards` → `compile`). Real, evolving guidance lives in atom itself — change it without redeploying the dashboard.
3. **Layout = Approach A (inline).** Onboarding lives inside the existing "API 키 관리" tab. The one-time secret banner expands into an onboarding panel; each agent list row gets a "연결" (Connect) button opening the same panel inline.
4. **Onboarding card = auto-seeded** on startup if absent (idempotent, mirrors the legacy-agent migration), so the bootstrap prompt always resolves.

## 3. UX Design (Approach A)

All within `dashboard/src/components/Config/AgentManagementTab.tsx`.

**Onboarding panel** — a new component `AgentOnboardingPanel.tsx` with two sub-tabs:

- **연결 설정 (Connect):** a client picker (Claude Code / Claude Desktop·Cursor JSON / curl). Renders the chosen client's snippet with the agent's values filled in, plus a copy button. Shows the MCP URL and header name.
- **세션 프롬프트 (Session prompt):** the bootstrap prompt with `agent_id` interpolated, plus a copy button.

**Where the panel appears:**

- **After create / reissue:** the existing one-time secret banner becomes/contains the panel, with the **real secret** embedded in the Connect snippets.
- **Per-agent "연결" button:** each list row gets a "연결" toggle that opens the same panel inline beneath the row.

**One-time-secret constraint (honored):** the plaintext secret is only available right after create/reissue. So:

- Right after create/reissue → snippets contain the real secret.
- Existing agent via "연결" → snippets show a `<your-secret>` placeholder with a hint to reissue if the secret is lost. The **세션 프롬프트 sub-tab works fully** (it needs no secret).

## 4. Connection Config

Snippets are built client-side from `{ agentId, secret, mcpUrl, headerName }`.

- **Claude Code (CLI):**
  ```
  claude mcp add --transport http atom <mcpUrl> --header "x-api-key: <secret>"
  ```
- **Generic JSON (Claude Desktop / Cursor / others):**
  ```json
  { "mcpServers": { "atom": { "url": "<mcpUrl>", "headers": { "x-api-key": "<secret>" } } } }
  ```
- **curl (connectivity test):**
  ```
  curl -X POST <mcpUrl> -H "x-api-key: <secret>" -H "content-type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```

`headerName` is `x-api-key`. Transport is Streamable HTTP at `POST /mcp` (confirmed: served at both `atom.<domain>/mcp` and `api.atom.<domain>/mcp`).

## 5. Bootstrap Prompt + Onboarding Card

**Generated prompt (agent-facing, English; `{{agent_id}}` interpolated):**

> You are connected to **atom**, our team's shared knowledge hub, over MCP (agent id: `{{agent_id}}`). atom is the source of truth for how we work and what we know.
>
> Before any task:
> 1. **Load context** — call `search_cards` with "agent onboarding" and `compile` the matching node to read how we work, conventions, and where things live. If no onboarding card exists yet, `get_tree` from the root and infer conventions from the top-level structure.
> 2. **Read before acting** — search atom for relevant prior knowledge instead of assuming.
> 3. **Write back** — record durable learnings, decisions, and reusable facts as new atomic cards (`create_card` / `batch_op`), placed in the right tree location. Keep one idea per card.
>
> Tools: `search_cards`, `get_tree`, `get_node`, `list_children`, `compile`, `create_card`, `update_card`, `create_symlink`, `move_node`, `batch_op`.

The prompt references the onboarding card **by title search** (no hard-coded node id), so re-seeding or moving the card doesn't break it.

**Onboarding card seed:** on startup, if no card titled "Agent Onboarding" exists, create one as a root node with starter content (purpose of atom, conventions, how to contribute). Idempotent — runs in the same place as the legacy-agent seed (`src/api/index.ts`). The card is then editable in atom itself; the dashboard never owns its content.

## 6. Backend Changes

- **New endpoint** `GET /api/config/connection-info` (same auth tier as `/api/config/agents`, editor+): returns
  ```json
  { "mcpUrl": "https://atom.<domain>/mcp", "headerName": "x-api-key" }
  ```
  `mcpUrl` resolution order: `process.env.PUBLIC_MCP_URL` → `FRONTEND_URL + "/mcp"` → derive from request origin (`x-forwarded-proto`/host) + `/mcp`.
- **Startup seed** (idempotent): ensure an "Agent Onboarding" card exists. Lives next to the legacy-agent migration in `src/api/index.ts`, using a card query helper.
- **No DB schema change.** (`agents.last_used_at` and similar are explicitly out of scope.)
- **Secret-once unchanged:** secret is still only returned by create/reissue; the package with a real secret is only rendered in that session.

## 7. Frontend Changes

| File | Change |
|------|--------|
| `dashboard/src/components/Config/AgentManagementTab.tsx` | Wire in the panel after create/reissue; add per-row "연결" toggle. Keep the tab lean by delegating to the new panel. |
| `dashboard/src/components/Config/AgentOnboardingPanel.tsx` | **New.** Two sub-tabs (Connect / Session prompt), client picker, copy buttons. Props: `{ agentId, secret? }`. |
| `dashboard/src/lib/agentOnboarding.ts` | **New.** Pure functions: `buildClaudeCodeSnippet`, `buildJsonSnippet`, `buildCurlSnippet`, `buildSessionPrompt`, given `{ agentId, secret, mcpUrl, headerName }`. Secret defaults to `<your-secret>` placeholder when absent. Unit-testable. |
| `dashboard/src/api/configApi.ts` | Add `getConnectionInfo()` → `GET /api/config/connection-info`. |
| `dashboard/src/hooks/useConfig.ts` | Fetch + expose `connectionInfo`. |
| `dashboard/src/api/types.ts` | Add `ConnectionInfo { mcpUrl: string; headerName: string }`. |

## 8. i18n

Add an `onboarding.*` namespace to **both** `dashboard/src/locales/en/translation.json` and `ko/translation.json` (repo convention: keep en + ko in sync). Keys (initial): `panel_title`, `tab_connect`, `tab_prompt`, `client_picker_label`, `copy`, `copied`, `connect_btn`, `secret_placeholder_hint` (reissue note), `prompt_hint`, `connect_hint`. **The agent-facing bootstrap prompt text itself stays English** (instructions to an LLM); only UI chrome is localized.

## 9. Data Flow

1. Dashboard mounts settings → `useConfig` fetches `connectionInfo` (cached).
2. User creates agent → API returns agent + one-time `secret`.
3. `AgentOnboardingPanel` renders snippets/prompt from `agentOnboarding.ts` using `{ agentId, secret, ...connectionInfo }`.
4. User copies the Connect snippet into their MCP client and the prompt into their AI session.
5. AI connects (`x-api-key`), runs the prompt → calls `search_cards("agent onboarding")` → `compile` → starts reading/writing atom.

## 10. Edge Cases & Error Handling

- **Lost secret (existing agent):** placeholder `<your-secret>` + reissue hint. No way to recover plaintext (by design).
- **Missing onboarding card:** the seed makes this rare; if a team deletes it, the prompt's step 1 search returns nothing — the prompt should degrade gracefully ("if no onboarding card exists, infer conventions from the tree root"). Include that fallback clause.
- **`connection-info` fetch fails:** panel shows the snippet with a `<mcp-url>` placeholder and a small error note; copy still works so the user can fill it manually.
- **Local dev:** `FRONTEND_URL` may be unset → fall back to request-origin derivation; document that `PUBLIC_MCP_URL` can override.

## 11. Testing

- **`agentOnboarding.ts`** — pure-logic vitest (node env, `*.test.ts`): snippet/prompt generation, secret-present vs placeholder, agent_id interpolation, URL substitution. (Matches repo test convention.)
- **Backend** — `connection-info` returns expected shape and honors env precedence; onboarding-card seed is idempotent (second startup creates no duplicate).
- No component-render tests (repo convention).

## 12. Out of Scope (YAGNI)

- `agents.last_used_at` / activity tracking.
- Per-agent custom prompts (bootstrap chosen instead).
- Prompt localization beyond English.
- In-browser MCP playground / live tool listing.
- Additional client integrations beyond the three snippets above.
