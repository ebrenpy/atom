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
