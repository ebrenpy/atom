import {
  buildContentPayload,
  buildStructurePayload,
  noul,
  selectFeedCards,
  selectionThreshold,
  takePayloadBatch,
} from "../../src/services/jev-search/prompts.js";

const context = { agent: null, project: null, task: null };

const candidate = {
  nodeId: "node-1",
  cardId: "card-1",
  title: "게임 규칙",
  path: ["Atom 루트", "게임", "게임 규칙"],
  summary: "게임 규칙과 적용 사례를 모은다.",
  childSummary: {
    totalDescendants: 4,
    children: [
      { title: "전투 규칙", descendantCards: 2 },
      { title: "챔피언 기록", descendantCards: null },
    ],
  },
};

describe("Jev prompt and selection contracts", () => {
  it("builds the v3 structure meaning payload with actual child summaries", () => {
    const payload = buildStructurePayload("이렐리아 특성", context, [candidate], "read");
    const state = JSON.parse(payload.state) as { stage: string; candidates: Array<Record<string, unknown>> };

    expect(payload.model).toBe("jev-latest");
    expect(state.stage).toBe("structure_noul");
    expect(state.candidates[0]).toMatchObject({ node_id: "node-1", card_id: "card-1" });
    expect(payload.questions["structure_0"]?.instructions).toContain("구조의 성격");
    expect(payload.questions["structure_0"]?.instructions).toContain("요청: 이렐리아 특성");
    expect(payload.questions["structure_0"]?.instructions).toContain("하위 카드 수: 4");
    expect(payload.questions["structure_0"]?.instructions).toContain("전투 규칙(2)");
    expect(payload.questions["structure_0"]?.instructions).not.toContain("본문 없음");
  });

  it("builds content questions from the card summary and direct usefulness policy", () => {
    const payload = buildContentPayload("이렐리아 특성", context, [candidate]);
    const state = JSON.parse(payload.state) as { stage: string };

    expect(state.stage).toBe("content_noul");
    expect(payload.questions["content_0"]?.instructions).toContain("본문을 동적 추가 문맥으로 넣는 것이 요청에 직접 도움이 되는지");
    expect(payload.questions["content_0"]?.instructions).toContain("게임 규칙과 적용 사례를 모은다.");
  });

  it("keeps the 0.30 floor and 0.10 relative selection threshold", () => {
    const feed = [
      { cardId: "a", score: 0.8, order: 0 },
      { cardId: "b", score: 0.7, order: 1 },
      { cardId: "c", score: 0.69, order: 2 },
      { cardId: "d", score: 0.3, order: 3 },
    ];

    expect(selectionThreshold(feed.map((item) => item.score), { scoreFloor: 0.3, relativeScoreDelta: 0.1 })).toBeCloseTo(0.7);
    expect(selectFeedCards(feed, { scoreFloor: 0.3, relativeScoreDelta: 0.1, maxResults: 6 }).map((item) => item.cardId)).toEqual(["a", "b"]);
  });

  it("reads only the longest ordered batch within the serialized payload budget", () => {
    const items = [candidate, { ...candidate, nodeId: "node-2", cardId: "card-2" }];
    const batch = takePayloadBatch(items, 1_000, (values) => buildContentPayload("query", context, values));

    expect(batch[0]?.cardId).toBe("card-1");
    expect(JSON.stringify(buildContentPayload("query", context, batch)).length).toBeLessThanOrEqual(1_000);
  });

  it("accepts only finite Noul values in range", () => {
    expect(noul({ model: "jev-latest", answers: { content_0: { type: "noul", noul: 0.5 } }, usage: { input_tokens: 1 } }, "content_0")).toBe(0.5);
    expect(() => noul({ model: "jev-latest", answers: {}, usage: { input_tokens: 1 } }, "content_0")).toThrow(/content_0/);
    expect(() => noul({ model: "jev-latest", answers: { content_0: { type: "noul", noul: 1.1 } }, usage: { input_tokens: 1 } }, "content_0")).toThrow(/content_0/);
  });
});
