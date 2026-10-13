import type { CandidateOccurrence, JevSearchStep } from "../../shared/jev-search.js";
import type { SearchResult, TreeOutlineNode, TreeNodeWithCard } from "../../shared/types.js";
import { EXCERPT_SOURCE_CHARS, toOutlineExcerpt } from "../outline-excerpt.js";
import { redactSensitiveText, selectFeedCards, selectionThreshold, type JevChildSummary, type JevPromptCandidate } from "./prompts.js";
import type { JevSearchPolicy } from "./config.js";

export interface JevTraversalCandidate extends JevPromptCandidate {
  cardType: "structure" | "knowledge";
  isSymlink: boolean;
  physicalParentNodeId: string | null;
  pathNodeIds: string[];
  traversalDepth: number;
  traversalParentRef: string | null;
  childSummary?: JevChildSummary | null;
}

export function candidateFromOutline(
  node: TreeOutlineNode,
  parentPath: string[],
  parentPathNodeIds: string[],
  traversalParentRef: string | null,
  traversalDepth: number,
): JevTraversalCandidate {
  const path = [...parentPath, safeTitle(node.title)];
  return {
    nodeId: node.id,
    cardId: node.card_id,
    title: safeTitle(node.title),
    cardType: node.card_type,
    isSymlink: node.is_symlink,
    summary: safeSummary(node.excerpt),
    path,
    pathNodeIds: [...parentPathNodeIds, node.id],
    traversalDepth,
    physicalParentNodeId: node.parent_node_id,
    traversalParentRef,
    ...(node.card_type === "structure" ? { childSummary: childSummaryFromOutline(node) } : {}),
  };
}

export function childSummaryFromOutline(node: TreeOutlineNode): JevChildSummary | null {
  if (node.is_symlink) return null;
  return {
    totalDescendants: node.descendant_count,
    children: node.children.map((child) => ({
      title: safeTitle(child.title),
      descendantCards: child.is_symlink ? null : child.descendant_count,
    })),
  };
}

export function childSummaryFromSymlinkOutline(children: TreeOutlineNode[]): JevChildSummary {
  return {
    totalDescendants: children.reduce((total, child) => total + 1 + (child.is_symlink ? 0 : child.descendant_count), 0),
    children: children.map((child) => ({
      title: safeTitle(child.title),
      descendantCards: child.is_symlink ? null : child.descendant_count,
    })),
  };
}

export function toOccurrence(
  candidate: JevTraversalCandidate,
  ref: string,
  discoveredInStepId: string,
): CandidateOccurrence {
  return {
    ref,
    node_id: candidate.nodeId,
    card_id: candidate.cardId,
    card_type: candidate.cardType,
    is_symlink: candidate.isSymlink,
    title: candidate.title,
    summary: candidate.summary,
    path: candidate.path,
    path_node_ids: candidate.pathNodeIds,
    traversal_depth: candidate.traversalDepth,
    physical_parent_node_id: candidate.physicalParentNodeId,
    traversal_parent_ref: candidate.traversalParentRef,
    canonical_node_id: candidate.isSymlink ? null : candidate.nodeId,
    discovered_in_step_id: discoveredInStepId,
    hop: 0,
    origin: "outline",
    hit_ref: null,
  };
}

export function lexicalSeedQuery(query: string, maxTerms: number): string {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of query.split(/[\s\p{P}\p{S}]+/u)) {
    const key = term.toLowerCase();
    if (Array.from(term).length < 2 || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length === maxTerms) break;
  }
  return terms.join(" OR ");
}

export function candidateFromNode(node: TreeNodeWithCard, ancestors: TreeNodeWithCard[], titles?: string[]): JevTraversalCandidate {
  const path = titles ?? ancestors.map(n => n.card.title);
  return {
    nodeId: node.id, cardId: node.card.id, title: safeTitle(node.card.title), cardType: node.card.card_type,
    isSymlink: node.is_symlink, summary: safeSummary(toOutlineExcerpt(node.card.content === null ? null : Array.from(node.card.content).slice(0, EXCERPT_SOURCE_CHARS).join(""), 200)),
    path: [...path.map(safeTitle), safeTitle(node.card.title)], pathNodeIds: [...ancestors.map(n => n.id), node.id],
    traversalDepth: ancestors.length, physicalParentNodeId: node.parent_node_id, traversalParentRef: null,
  };
}

export function seedMatchSnippet(snippet: string): string {
  return safeSummary(snippet.replace(/<[^>]*>/g, "")) ?? "";
}

export function recordSelection<T extends {
  ref: string;
  occurrence: CandidateOccurrence;
  discoveryOrder: number;
}>(
  step: JevSearchStep,
  scored: Array<{ candidate: T; score: number }>,
  limit: number,
  policy: JevSearchPolicy,
): Array<SearchResult & { score: number; selected_from_step_id: string }> {
  const threshold = selectionThreshold(scored.map((item) => item.score), policy);
  const selected = selectFeedCards(
    scored.map((item) => ({ ...item, order: item.candidate.discoveryOrder })),
    { scoreFloor: policy.scoreFloor, structureThreshold: policy.structureThreshold, relativeScoreDelta: policy.relativeScoreDelta, maxResults: limit },
  );
  const selectedRefs = new Set(selected.map((item) => item.candidate.ref));
  step.selection_threshold = threshold;
  step.selected_refs = selected.map((item) => item.candidate.ref);
  step.decisions = scored.map(({ candidate, score }) => ({
    ref: candidate.ref,
    question_key: null,
    score,
    action: selectedRefs.has(candidate.ref) ? "selected" : "not_selected",
    reused_from_ref: null,
  }));
  step.completed_at = new Date().toISOString();
  return selected.map(({ candidate, score }) => ({
    card_id: candidate.occurrence.card_id,
    node_id: candidate.occurrence.node_id,
    title: candidate.occurrence.title,
    card_type: candidate.occurrence.card_type,
    is_symlink: candidate.occurrence.is_symlink,
    snippet: candidate.occurrence.summary ?? "",
    node_path: candidate.occurrence.path.slice(0, -1),
    score,
    selected_from_step_id: step.id,
  }));
}

function safeSummary(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = redactSensitiveText(value.normalize("NFC").replace(/\s+/g, " ").trim());
  return normalized.length <= 200 ? normalized : normalized.slice(0, 199) + "…";
}

function safeTitle(value: string): string {
  const normalized = redactSensitiveText(value.normalize("NFC").replace(/\s+/g, " ").trim());
  return normalized.length <= 320 ? normalized : normalized.slice(0, 319) + "…";
}
