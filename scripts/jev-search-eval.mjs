import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function evaluateCase(item, response, elapsedMs) {
  const results = response.results ?? [];
  const trace = response.trace ?? { candidates: [], steps: [], calls: [] };
  const scores = new Map();
  const cardByRef = new Map(trace.candidates.map(c => [c.ref, c.card_id]));
  for (const step of trace.steps) if (step.stage === "content_noul") {
    for (const decision of step.decisions) if (decision.score !== null) scores.set(cardByRef.get(decision.ref), decision.score);
  }
  for (const result of results) scores.set(result.card_id, result.score);
  const targets = (item.targets ?? []).map(cardId => ({ card_id: cardId,
    selected: results.some(r => r.card_id === cardId), score: scores.get(cardId) ?? null }));
  const expected = item.expect ?? "hit";
  const matched = response.status !== "error" && response.status !== "cancelled" &&
    (expected === "some" ? results.length > 0 : expected === "none" ? results.length === 0 : targets.some(t => t.selected));
  const jevCalls = trace.calls.filter(c => ["structure_noul", "content_noul", "sufficiency_noul"].includes(c.stage));
  const steps = trace.steps.filter(s => !["selection", "run_terminal"].includes(s.stage));
  return { id: item.id, category: item.category ?? "uncategorized", matched, targets,
    result_count: results.length, highest_score: results.length ? Math.max(...results.map(r => r.score)) : null,
    jev_calls: jevCalls.length, input_tokens: jevCalls.reduce((sum, c) => sum + (c.usage?.input_tokens ?? 0), 0),
    elapsed_ms: Math.round(elapsedMs), status: response.status, stop_reason: response.stop_reason ?? null,
    error_code: response.error?.code ?? null, hops: Math.max(0, ...steps.map(s => s.hop)) };
}

function stats(values) {
  if (!values.length) return { median: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, max: sorted.at(-1) };
}

export function summarize(rows) {
  const categories = {}, stopReasons = {};
  for (const row of rows) {
    const entry = categories[row.category] ??= { total: 0, matched: 0 };
    entry.total += 1;
    if (row.matched) entry.matched += 1;
    const reason = String(row.stop_reason);
    stopReasons[reason] = (stopReasons[reason] ?? 0) + 1;
  }
  return { total: rows.length, matched: rows.filter(r => r.matched).length, categories,
    jev_calls: stats(rows.map(r => r.jev_calls)), elapsed_ms: stats(rows.map(r => r.elapsed_ms)), stop_reasons: stopReasons };
}

export async function requestSearch({ url, apiKey, query, id }, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "x-api-key": apiKey },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "search_cards", arguments: { query, engine: "jev" } } }),
  });
  if (!response.ok) throw new Error("MCP_HTTP_FAILED");
  const body = await response.text();
  let rpc;
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (!data) continue;
      const candidate = JSON.parse(data);
      if (candidate.id === id) rpc = candidate;
    }
  } else rpc = JSON.parse(body);
  if (!rpc?.result || rpc.error) throw new Error("MCP_RPC_FAILED");
  const content = rpc.result.content?.find(c => c.type === "text");
  if (!content) throw new Error("MCP_RESULT_INVALID");
  const result = JSON.parse(content.text);
  if (result.schema_version !== 2) {
    // Pre-run configuration/input failures contain no run trace.
    if (rpc.result.isError && result.error?.code) return { status: "error", stop_reason: null, results: [], trace: { candidates: [], steps: [], calls: [] }, error: { code: result.error.code } };
    throw new Error("MCP_RESULT_INVALID");
  }
  return result;
}

async function main() {
  const file = process.argv[2];
  const url = process.env.ATOM_MCP_URL, apiKey = process.env.ATOM_API_KEY;
  if (!file || !url || !apiKey) throw new Error("EVAL_INPUT_REQUIRED");
  const items = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(items)) throw new Error("EVAL_SET_INVALID");
  const rows = [];
  for (const [index, item] of items.entries()) {
    const started = performance.now();
    let result;
    try { result = await requestSearch({ url, apiKey, query: item.query, id: index + 1 }); }
    catch { result = { status: "error", error: { code: "EVAL_REQUEST_FAILED" }, results: [], trace: { candidates: [], steps: [], calls: [] } }; }
    const row = evaluateCase(item, result, performance.now() - started);
    rows.push(row);
    process.stdout.write(JSON.stringify(row) + "\n");
  }
  process.stdout.write(JSON.stringify({ summary: summarize(rows) }) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write("Jev evaluation failed: check the input file and required environment variables.\n"); process.exitCode = 1; });
}
