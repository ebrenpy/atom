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
