import type { SearchResult, TreeNodeWithCard, TreeOutlineNode } from "../../src/shared/types.js";
import { searchWithJev, type JevSearchDependencies } from "../../src/services/jev-search/service.js";

function node(id: string, type: "structure" | "knowledge", parent: string | null = null): TreeNodeWithCard {
  return { id, card_id: id, parent_node_id: parent, position: 0, is_symlink: false, created_at: "", journal_limit: null,
    card: { id, card_type: type, title: id, content: "가짜 본문", references: [], tags: [], card_timestamp: null, content_timestamp: null,
      source_type: null, source_ref: null, source_snapshot: null, source_checksum: null, source_checked_at: null, staleness: "fresh", version: 1, updated_at: "", created_by: null, updated_by: null } };
}
function seed(n: TreeNodeWithCard): SearchResult {
  return { card_id: n.card_id, node_id: n.id, card_type: n.card.card_type, title: n.card.title, is_symlink: false, snippet: "일치", node_path: [] };
}
function fixture(seeds: TreeNodeWithCard[], children: Record<string, TreeNodeWithCard[]>, score: (stage: string, cardId: string, ids: string[]) => number) {
  const nodes = new Map([...seeds, ...Object.values(children).flat()].map(n => [n.id, n]));
  const judged: Array<{ stage: string; ids: string[] }> = [];
  const deps: JevSearchDependencies = {
    searchCards: async () => seeds.map(seed),
    getNode: async id => nodes.get(id) ?? null,
    getTreeOutline: async (id, depth) => ({ node_id: id, canonical_node_id: id, depth,
      nodes: (children[id ?? "ROOT"] ?? []).map(n => ({ id: n.id, card_id: n.card_id, parent_node_id: n.parent_node_id, position: 0, is_symlink: false,
        title: n.card.title, card_type: n.card.card_type, excerpt: n.card.content, child_count: 0, descendant_count: 0, children: [] } as TreeOutlineNode)) }),
    judge: async payload => {
      const state = JSON.parse(payload.state), ids = state.candidates.map((c: { card_id: string }) => c.card_id);
      judged.push({ stage: state.stage, ids });
      return { model: "fixture", usage: { input_tokens: 1 }, answers: Object.fromEntries(Object.keys(payload.questions).map((key, index) =>
        [key, { type: "noul", noul: score(state.stage, ids[index] ?? "", ids) }])) };
    },
  };
  return { deps, judged };
}
const group = (parent: string, type: "structure" | "knowledge", count: number) => Array.from({ length: count }, (_, i) => node(`${parent}-${i}`, type, parent));

describe("Jev document revision 3", () => {
  it("10 discovers large content collections but scores the cheap path first", async () => {
    const large = node("large", "structure"), cheap = node("cheap", "structure");
    const f = fixture([large, cheap], { large: group("large", "knowledge", 97), cheap: [node("target", "knowledge", "cheap")] },
      stage => stage === "sufficiency_noul" ? 0.7 : 0.9);
    const r = await searchWithJev({ query: "가짜 질의" }, f.deps);
    expect(r.results.map(c => c.card_id)).toEqual(["target"]);
    expect(r.trace.candidates.filter(c => c.card_type === "knowledge")).toHaveLength(98);
    const read = r.trace.steps.find(s => s.purpose === "candidate_discovery" && s.parent_ref === r.trace.candidates.find(c => c.card_id === "large")?.ref);
    expect(read).toMatchObject({ deferred_kinds: ["content"] });
    expect(f.judged.filter(j => j.stage === "content_noul").flatMap(j => j.ids)).toEqual(["target"]);
    expect(r.trace.steps.some(s => String(s.stage) === "deferred_scan")).toBe(false);
  });

  it("10 defers the oversized side alone and judges the other side in the same hop", async () => {
    const large = node("large", "structure");
    const f = fixture([large], { large: [...group("large", "structure", 97), node("target", "knowledge", "large")] },
      stage => stage === "sufficiency_noul" ? 0.7 : 0.9);
    const r = await searchWithJev({ query: "가짜 질의" }, f.deps);
    expect(r.results.map(c => c.card_id)).toEqual(["target"]);
    expect(r.trace.steps.find(s => s.purpose === "candidate_discovery")).toMatchObject({ deferred_kinds: ["structure"] });
    expect(f.judged.filter(j => j.stage === "structure_noul").flatMap(j => j.ids)).toEqual(["large"]);
  });

  it("10 resumes deferred structures whole and keeps exactly 96 candidates in the immediate pool", async () => {
    for (const count of [96, 97]) {
      const large = node("large", "structure");
      const f = fixture([large], { large: group("large", "structure", count) }, (_stage, id) => id === "large" ? 0.9 : 0.1);
      const r = await searchWithJev({ query: "가짜 질의" }, f.deps);
      const scans = r.trace.steps.filter(s => String(s.stage) === "deferred_scan");
      expect(scans).toHaveLength(count === 97 ? 1 : 0);
      if (scans.length) expect(scans[0].candidate_refs).toHaveLength(97);
      expect(f.judged.filter(j => j.stage === "structure_noul").flatMap(j => j.ids)).toHaveLength(count + 1);
    }
  });

  it("10 resumes whole deferred groups before widening, by hit, gate score and discovery order", async () => {
    const h = node("hit-parent", "structure"), b = node("high-first", "structure"), c = node("low", "structure"), d = node("high-second", "structure");
    const hit = node("hit", "knowledge", h.id);
    const f = fixture([b, c, d, hit], { ROOT: [h], [h.id]: [hit, ...group(h.id, "knowledge", 97)],
      [b.id]: group(b.id, "knowledge", 97), [c.id]: group(c.id, "knowledge", 97), [d.id]: group(d.id, "knowledge", 97) },
      (stage, id) => stage === "sufficiency_noul" ? 0.1 : stage === "structure_noul" ? id === c.id ? 0.6 : 0.9 : id === hit.id ? 0.8 : 0.1);
    const r = await searchWithJev({ query: "가짜 질의" }, f.deps);
    const scans = r.trace.steps.filter(s => String(s.stage) === "deferred_scan");
    const byRef = new Map(r.trace.candidates.map(c => [c.ref, c.card_id]));
    expect(scans.map(s => byRef.get(s.parent_ref ?? ""))).toEqual([h.id, b.id, d.id, c.id]);
    expect(scans.every(s => s.candidate_refs.length === 97)).toBe(true);
    const widen = r.trace.steps.find(s => s.stage === "widen");
    expect(widen?.seq).toBeGreaterThan(scans.at(-1)?.seq ?? Infinity);
    expect(f.judged.filter(j => j.stage === "content_noul").flatMap(j => j.ids)).toHaveLength(389);
    expect(r).toMatchObject({ status: "complete", stop_reason: "exhausted", policy: { max_jev_calls: 32, defer_candidates: 96 } });
  });

  it("12 reasks sufficiency for a changed selected bundle, and skips an unchanged bundle", async () => {
    for (const addedScore of [0.6, 0.2]) {
      const h = node("parent", "structure"), hit = node("hit", "knowledge", h.id), added = node("added", "knowledge", h.id);
      const f = fixture([hit], { ROOT: [h], [h.id]: [hit, added] }, (stage, id) => stage === "sufficiency_noul" ? 0.1 : id === hit.id ? 0.93 : addedScore);
      const r = await searchWithJev({ query: "가짜 질의" }, f.deps);
      expect(f.judged.filter(j => j.stage === "sufficiency_noul").map(j => j.ids)).toEqual(addedScore === 0.6 ? [[hit.id], [hit.id, added.id]] : [[hit.id]]);
      expect(r.results.map(c => c.card_id)).toEqual(addedScore === 0.6 ? [hit.id, added.id] : [hit.id]);
    }
  });
});
