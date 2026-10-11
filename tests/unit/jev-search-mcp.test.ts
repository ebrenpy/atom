import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SearchResult } from "../../src/shared/types.js";
import type { JevSearchResponse } from "../../src/shared/jev-search.js";
import { registerSearchTools, type SearchToolDependencies } from "../../src/mcp/tools/search_tools.js";

const bm25Result: SearchResult = {
  card_id: "card-1",
  node_id: "node-1",
  title: "지식 카드",
  card_type: "knowledge",
  is_symlink: false,
  snippet: "발췌",
  node_path: [],
};

const jevResponse = {
  schema_version: 1,
  engine: "jev",
  run_id: "run-1",
  query: "질의",
  root_node_id: null,
  status: "complete",
  complete: true,
  started_at: "2026-10-11T00:00:00.000Z",
  completed_at: "2026-10-11T00:00:01.000Z",
  policy: {
    prompt_version: "v3", model: "jev-latest", summary_chars: 200, structure_threshold: 0.5,
    score_floor: 0.3, relative_score_delta: 0.1, max_results: 6, batch_candidates: 48,
    payload_max_chars: 60_000, run_timeout_ms: 45_000, max_candidates: 20_000, max_concurrent_runs: 2,
  },
  results: [],
  trace: { candidates: [], steps: [], calls: [] },
  error: null,
} as JevSearchResponse;

function captureTool(dependencies: SearchToolDependencies) {
  let handler: ((...args: unknown[]) => Promise<unknown>) | undefined;
  const server = {
    tool: (_name: string, _description: string, _schema: unknown, callback: (...args: unknown[]) => Promise<unknown>) => { handler = callback; },
  } as unknown as McpServer;
  registerSearchTools(server, dependencies);
  if (!handler) throw new Error("search_cards was not registered");
  return handler;
}

describe("search_cards Jev opt-in", () => {
  it("leaves the default BM25 result array intact", async () => {
    const handler = captureTool({ searchCards: async () => [bm25Result], runJev: async () => jevResponse });
    const response = await handler({ query: "질의" }, {});

    expect(response).toEqual({ content: [{ type: "text", text: JSON.stringify([bm25Result]) }] });
  });

  it("forwards context and MCP cancellation signal to the same Jev envelope", async () => {
    const controller = new AbortController();
    const calls: Array<{ input: unknown; signal: AbortSignal | undefined }> = [];
    const handler = captureTool({
      searchCards: async () => [bm25Result],
      runJev: async (input, signal) => { calls.push({ input, signal }); return jevResponse; },
    });
    const result = await handler({ query: "질의", engine: "jev", limit: 3, root_node_id: "10000000-0000-4000-8000-000000000001", context: { agent: "roselin", project: "atom" } }, { signal: controller.signal });

    expect(calls).toEqual([{
      input: {
        query: "질의",
        root_node_id: "10000000-0000-4000-8000-000000000001",
        limit: 3,
        context: { agent: "roselin", project: "atom", task: undefined },
      },
      signal: controller.signal,
    }]);
    expect(result).toEqual({ content: [{ type: "text", text: JSON.stringify(jevResponse) }] });
  });

  it("rejects meaningless context on a BM25 call", async () => {
    const handler = captureTool({ searchCards: async () => [bm25Result], runJev: async () => jevResponse });
    const result = await handler({ query: "질의", context: { agent: "roselin" } }, {});

    expect(result).toMatchObject({ isError: true, content: [{ type: "text" }] });
    expect(JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text).error.code).toBe("JEV_CONTEXT_REQUIRES_JEV");
  });
});
