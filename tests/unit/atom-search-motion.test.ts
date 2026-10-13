import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// The standalone page keeps its renderer inline. Exercise the actual event adapter
// with invented records; no private stream fixtures are copied into the repository.
const html = readFileSync(new URL("../../published/atom-search-motion/index.html", import.meta.url), "utf8");
function adapter(source = html) {
  const model = source.slice(source.indexOf("  function createModel()"), source.indexOf("  // 완성 응답"));
  const sent = source.slice(source.indexOf("  function sentText("), source.indexOf("  function verdictOf("));
  return runInNewContext(model + "\nconst model = createModel();\n" + sent + "\n({model,applyEvent,sentText});", { ROOT: "__root__" }, { timeout: 1000 });
}
const candidate = (ref: string, type = "knowledge", parent: string | null = null) => ({
  ref, node_id: ref, card_id: ref + "-card", card_type: type, title: "시험 후보", path: ["시험"],
  summary: "시험 내용", hop: 0, origin: "lexical_seed", physical_parent_node_id: parent,
  child_count: type === "structure" ? 97 : null,
});
const event = (stage: string, candidates: any[] = [], decisions: any[] = [], extra: any = {}) => ({ event: "step_completed", data: {
  step: { id: stage, hop: 1, candidate_refs: [], decisions, stage, ...extra }, candidates, call: null,
} });

describe("published Jev graph event contract", () => {
  it("marks the unopened structure itself and resumes it before children arrive", () => {
    const { model, applyEvent } = adapter();
    applyEvent(model, event("atom_outline", [candidate("parent", "structure")], [{ ref: "parent", action: "opened_root" }], { deferred_refs: ["parent"] }));
    expect(model.nodes.size).toBe(1);
    expect(model.nodes.get("parent")).toMatchObject({ deferred: true, childCount: 97, byRoot: true });
    applyEvent(model, event("deferred_scan", [], [], { parent_ref: "parent", candidate_refs: ["parent"] }));
    expect(model.nodes.get("parent").deferred).toBe(false);
    applyEvent(model, event("atom_outline", [{ ...candidate("child"), origin: "outline", traversal_parent_ref: "parent", hop: 2 }]));
    expect(model.nodes.get("child")).toMatchObject({ parent: "parent", hop: 2 });
  });
  it("links every matching physical sibling to an opened hit parent", () => {
    const { model, applyEvent } = adapter();
    applyEvent(model, { event: "run", data: { policy: { structure_threshold: 0.6 } } });
    applyEvent(model, event("lexical_seed", [candidate("a", "knowledge", "parent"), candidate("b", "knowledge", "parent"), candidate("low", "knowledge", "parent")]));
    applyEvent(model, event("content_noul", [], ["a", "b", "low"].map((ref, i) => ({ ref, action: "content_scored", score: i === 2 ? 0.5 : 0.7 }))));
    applyEvent(model, event("hit_parent", [{ ...candidate("parent", "structure"), origin: "hit_parent", hit_ref: "a" }], [{ ref: "parent", action: "opened_by_hit" }], { candidate_refs: ["a"] }));
    expect(Array.from(model.nodes.get("parent").climbFrom)).toEqual(["a", "b"]);
  });
  it("shows the full instructions from the scored candidate's audit question", () => {
    const { model, applyEvent, sentText } = adapter();
    applyEvent(model, event("lexical_seed", [candidate("a")]));
    const e = event("content_noul", [], [{ ref: "a", action: "content_scored", score: 0.8, question_key: "content_0" }]);
    e.data.call = { request: { questions: { content_0: { instructions: "판정 질문\n요청\n후보", criteria: {} } } } } as any;
    applyEvent(model, e);
    expect(sentText(model.nodes.get("a"), false).text).toBe("판정 질문\n요청\n후보");
  });
  it("uses done for terminal status and tolerates a failed sufficiency call", () => {
    const { model, applyEvent } = adapter();
    applyEvent(model, { event: "run", data: { policy: { sufficiency_threshold: 0.7 } } });
    applyEvent(model, event("sufficiency_noul"));
    expect(model.suff.size).toBe(0);
    applyEvent(model, event("run_terminal", [], [], { terminal_status: "complete", stop_reason: "sufficient" }));
    applyEvent(model, { event: "done", data: { status: "limited", stop_reason: null, error: { code: "CALL_BUDGET" }, results: [] } });
    expect(model.terminal).toMatchObject({ status: "limited", code: "CALL_BUDGET", stop: null });
  });
  it("does not add an empty hop for selection and terminal records after an entry-only search", () => {
    const { model, applyEvent } = adapter();
    applyEvent(model, event("lexical_seed", [candidate("a")], [], { hop: 0 }));
    applyEvent(model, event("selection", [], [], { hop: 1, selected_refs: ["a"] }));
    applyEvent(model, event("run_terminal", [], [], { hop: 1, terminal_status: "complete", stop_reason: "sufficient" }));
    expect(model.maxHop).toBe(0);
  });
  it("the contract assertions catch a dropped deferral and truncated audit text", () => {
    const mutant = html.replace('n.deferred = true;', 'n.deferred = false;').replace('lines.join("\\n"), criteria:', 'lines.slice(2).join("\\n"), criteria:');
    const { model, applyEvent, sentText } = adapter(mutant);
    applyEvent(model, event("atom_outline", [candidate("parent", "structure")], [], { deferred_refs: ["parent"] }));
    expect(model.nodes.get("parent").deferred).toBe(false);
    const n = model.nodes.get("parent"); n.asked = { step: "call", key: "q" };
    model.calls.set("call", { request: { questions: { q: { instructions: "質問\n요청\n후보" } } } });
    expect(sentText(n, false).text).not.toBe("質問\n요청\n후보");
  });
});
