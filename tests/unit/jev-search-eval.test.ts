const modulePath = "../../scripts/jev-search-eval.mjs";

describe("Jev evaluation metrics", () => {
  it("marks target misses and the some/none expectations from actual selections", async () => {
    const { evaluateCase } = await import(modulePath);
    const r = { status: "complete", stop_reason: "sufficient", results: [{ card_id: "found", score: 0.8 }],
      trace: { candidates: [{ card_id: "miss", ref: "m" }], steps: [{ stage: "content_noul", hop: 0, decisions: [{ ref: "m", score: 0.6 }] }],
        calls: [{ stage: "content_noul", usage: { input_tokens: 12 } }, { stage: "sufficiency_noul", usage: { input_tokens: 4 } }, { stage: "lexical_seed", usage: null }] } };
    const miss = evaluateCase({ id: "a", category: "direct", targets: ["miss"], expect: "hit" }, r, 20);
    expect(miss).toMatchObject({ matched: false, result_count: 1, highest_score: 0.8, jev_calls: 2, input_tokens: 16, elapsed_ms: 20,
      targets: [{ card_id: "miss", selected: false, score: 0.6 }] });
    expect(evaluateCase({ id: "b", targets: ["miss", "found"] }, r, 20).matched).toBe(true);
    expect(evaluateCase({ id: "c", targets: [], expect: "some" }, r, 20).matched).toBe(true);
    expect(evaluateCase({ id: "d", targets: [], expect: "none" }, r, 20).matched).toBe(false);
    expect(evaluateCase({ id: "e", targets: [], expect: "none" }, { ...r, results: [] }, 20).matched).toBe(true);
    expect(JSON.stringify(miss)).not.toMatch(/content|snippet|questions/);
  });
  it("summarizes category hits, median/max costs and stop reasons", async () => {
    const { summarize } = await import(modulePath);
    expect(summarize([
      { category: "a", matched: true, jev_calls: 2, elapsed_ms: 20, stop_reason: "sufficient" },
      { category: "a", matched: false, jev_calls: 4, elapsed_ms: 40, stop_reason: "exhausted" },
      { category: "b", matched: true, jev_calls: 3, elapsed_ms: 30, stop_reason: null },
    ])).toMatchObject({ total: 3, matched: 2, categories: { a: { total: 2, matched: 1 }, b: { total: 1, matched: 1 } },
      jev_calls: { median: 3, max: 4 }, elapsed_ms: { median: 30, max: 40 }, stop_reasons: { sufficient: 1, exhausted: 1, null: 1 } });
  });
  it("calls search_cards once using Jev and parses the HTTP MCP SSE response", async () => {
    const { requestSearch } = await import(modulePath);
    const calls: any[] = [];
    const result = { schema_version: 2, status: "complete", results: [] };
    const fakeFetch = async (_url: string, options: any) => {
      calls.push(options);
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(result) }] } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
    };
    expect(await requestSearch({ url: "https://example.invalid/mcp", apiKey: "test-key", query: "게임", id: 1 }, fakeFetch)).toEqual(result);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body)).toMatchObject({ method: "tools/call", params: { name: "search_cards", arguments: { engine: "jev", query: "게임", include_trace: true } } });
    expect(calls[0].headers["x-api-key"]).toBe("test-key");
  });
});
