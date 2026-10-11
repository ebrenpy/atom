import Fastify from "fastify";
import type { SearchResult } from "../../src/shared/types.js";
import type { JevSearchResponse } from "../../src/shared/jev-search.js";
import { createSearchHandler, type SearchHandlerDependencies } from "../../src/api/routes/search.js";

const result: SearchResult = {
  card_id: "card-1",
  node_id: "node-1",
  title: "게임 규칙",
  card_type: "knowledge",
  is_symlink: false,
  snippet: "규칙 발췌",
  node_path: ["게임"],
};

function response(): JevSearchResponse {
  return {
    schema_version: 1,
    engine: "jev",
    run_id: "run-1",
    query: "게임 규칙",
    root_node_id: null,
    status: "complete",
    complete: true,
    started_at: "2026-10-11T00:00:00.000Z",
    completed_at: "2026-10-11T00:00:01.000Z",
    policy: {
      prompt_version: "v3",
      model: "jev-latest",
      summary_chars: 200,
      structure_threshold: 0.5,
      score_floor: 0.3,
      relative_score_delta: 0.1,
      max_results: 6,
      batch_candidates: 48,
      payload_max_chars: 60_000,
      run_timeout_ms: 45_000,
      max_candidates: 20_000,
      max_concurrent_runs: 2,
    },
    results: [],
    trace: { candidates: [], steps: [], calls: [] },
    error: null,
  };
}

function makeApp(dependencies: SearchHandlerDependencies) {
  const app = Fastify({ logger: false });
  app.get("/search", createSearchHandler(dependencies));
  return app;
}

describe("Jev REST search boundary", () => {
  it("keeps the engine-free BM25 array response unchanged", async () => {
    const filters: unknown[] = [];
    const app = makeApp({
      searchCards: async (value) => { filters.push(value); return [result]; },
      runJev: async () => { throw new Error("Jev must not run"); },
    });

    const res = await app.inject({ method: "GET", url: "/search?q=게임%20규칙" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([result]);
    expect(filters).toEqual([{ query: "게임 규칙", limit: undefined, root_node_id: undefined, tags: undefined, card_type: undefined, updated_after: undefined, updated_before: undefined, source_type: undefined, strategy: undefined }]);
  });

  it("passes opt-in query, scope, limit, context, and response envelope to the Jev branch", async () => {
    const calls: Array<{ input: unknown; aborted: boolean }> = [];
    const envelope = response();
    const app = makeApp({
      searchCards: async () => [result],
      runJev: async (input, signal) => {
        calls.push({ input, aborted: signal.aborted });
        return envelope;
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/search?q=%20%EA%B2%8C%EC%9E%84%20%20%EA%B7%9C%EC%B9%99%20&engine=jev&limit=3&root_node_id=10000000-0000-4000-8000-000000000001&context_agent=roselin&context_project=atom",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(envelope);
    expect(calls).toEqual([{
      input: {
        query: " 게임  규칙 ",
        root_node_id: "10000000-0000-4000-8000-000000000001",
        limit: 3,
        context: { agent: "roselin", project: "atom", task: undefined },
      },
      aborted: false,
    }]);
  });

  it("rejects unsupported BM25 filters and conflicting root aliases for Jev", async () => {
    const calls: unknown[] = [];
    const app = makeApp({
      searchCards: async () => [result],
      runJev: async (input) => { calls.push(input); return response(); },
    });

    const unsupported = await app.inject({ method: "GET", url: "/search?q=test&engine=jev&tags=x" });
    const conflict = await app.inject({ method: "GET", url: "/search?q=test&engine=jev&rootNodeId=10000000-0000-4000-8000-000000000001&root_node_id=10000000-0000-4000-8000-000000000002" });
    const invalidEngine = await app.inject({ method: "GET", url: "/search?q=test&engine=unknown" });

    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json().error.code).toBe("JEV_UNSUPPORTED_FILTER");
    expect(conflict.statusCode).toBe(400);
    expect(conflict.json().error.code).toBe("JEV_ROOT_ALIAS_CONFLICT");
    expect(invalidEngine.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it("maps a trace-bearing upstream error to 502 without altering its envelope", async () => {
    const failed = response();
    failed.status = "error";
    failed.complete = false;
    failed.error = { code: "BAD_NOUL_RESPONSE", message: "Jev response was incomplete." };
    const app = makeApp({ searchCards: async () => [result], runJev: async () => failed });

    const res = await app.inject({ method: "GET", url: "/search?q=test&engine=jev" });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual(failed);
  });
});
