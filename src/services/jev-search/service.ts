import { randomUUID } from "node:crypto";
import type {
  CandidateOccurrence,
  JevAuditCall,
  JevAuditStage,
  JevMeaningPayload,
  JevMeaningResponse,
  JevSearchInput,
  JevSearchResponse,
  JevSearchStage,
  JevSearchStatus,
  JevSearchStep,
  JevStepDecision,
} from "../../shared/jev-search.js";
import type { TreeOutline, TreeNodeWithCard } from "../../shared/types.js";
import { getNode, getTreeOutline } from "../tree.service.js";
import { JevClient, JevError } from "./client.js";
import { JevSearchConfigError, JevSearchRequestError, JEV_SEARCH_POLICY, normalizeJevSearchInput, policyView, readJevServerConfig, type JevSearchPolicy } from "./config.js";
import { candidateFromOutline, childSummaryFromSymlinkOutline, recordSelection, toOccurrence, type JevTraversalCandidate } from "./catalog.js";
import { makeAuditCall, meaningAuditRequest, outlineAuditRequest, type AuditCallInput } from "./audit.js";
import { buildContentPayload, buildStructurePayload, JevAnswerError, noul, takePayloadBatch } from "./prompts.js";

export interface JevSearchDependencies {
  getNode(nodeId: string): Promise<TreeNodeWithCard | null>;
  getTreeOutline(nodeId: string | null, depth: number, excerptChars: number): Promise<TreeOutline | null>;
  judge(payload: JevMeaningPayload, signal?: AbortSignal): Promise<JevMeaningResponse>;
  policy?: JevSearchPolicy;
}

interface SearchCandidate extends JevTraversalCandidate {
  ref: string;
  discoveredInStepId: string;
  occurrence: CandidateOccurrence;
  discoveryOrder: number;
}

interface ScoredContent {
  candidate: SearchCandidate;
  score: number;
}

interface RunFailure {
  code: string;
  message: string;
}

let activeRuns = 0;

export async function searchWithJev(
  rawInput: JevSearchInput,
  deps: JevSearchDependencies,
  callerSignal?: AbortSignal,
): Promise<JevSearchResponse> {
  const policy = deps.policy ?? JEV_SEARCH_POLICY;
  const input = normalizeJevSearchInput(rawInput, policy);
  if (activeRuns >= policy.maxConcurrentRuns) {
    throw new JevSearchRequestError("Jev search is at its concurrent run limit.", "JEV_SEARCH_BUSY", 429);
  }

  activeRuns += 1;
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const controller = new AbortController();
  let cancelled = callerSignal?.aborted ?? false;
  let timedOut = false;
  const onCallerAbort = () => {
    cancelled = true;
    controller.abort();
  };
  if (callerSignal && !callerSignal.aborted) callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  if (cancelled) controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, policy.runTimeoutMs);
  timeout.unref?.();

  const occurrences: CandidateOccurrence[] = [];
  const steps: JevSearchStep[] = [];
  const auditCalls: JevAuditCall[] = [];
  const structurePool: SearchCandidate[] = [];
  const structureParents: SearchCandidate[] = [];
  const descendantContentPool: SearchCandidate[] = [];
  const rootContentPool: SearchCandidate[] = [];
  const scoredContent: ScoredContent[] = [];
  const firstByCardId = new Map<string, SearchCandidate>();
  let stepSequence = 0;
  let callSequence = 0;
  let candidateSequence = 0;
  let limitCode: string | null = null;
  let finalStatus: JevSearchStatus = "complete";
  let finalError: { code: string; message: string } | null = null;
  let rootPath: string[] = [];
  let rootPathNodeIds: string[] = [];

  const stopped = (): boolean => cancelled || timedOut || callerSignal?.aborted === true;
  const now = (): string => new Date().toISOString();
  const pushStep = (stage: JevSearchStage, refs: string[] = []): JevSearchStep => {
    stepSequence += 1;
    const step: JevSearchStep = {
      id: `step-${String(stepSequence).padStart(6, "0")}`,
      seq: stepSequence,
      stage,
      started_at: now(),
      completed_at: null,
      call_id: null,
      candidate_refs: refs,
      decisions: [],
    };
    steps.push(step);
    return step;
  };
  const beginCall = (stage: JevAuditStage, candidateCount: number, request: Record<string, unknown>): AuditCallInput => {
    callSequence += 1;
    return {
      callId: `${runId}:call:${String(callSequence).padStart(6, "0")}`,
      runId,
      seq: callSequence,
      stage,
      candidateCount,
      startedAt: now(),
      startedClock: performance.now(),
      request,
    };
  };
  const finishCall = (call: AuditCallInput, options: Parameters<typeof makeAuditCall>[1]) => {
    auditCalls.push(makeAuditCall(call, options));
  };

  const addOutlineRead = async (
    nodeId: string | null,
    depth: number,
    excerptChars: number,
    purpose: "candidate_discovery" | "symlink_summary",
    parent: SearchCandidate | null,
  ): Promise<void> => {
    const step = pushStep("atom_outline", parent ? [parent.ref] : []);
    step.purpose = purpose;
    step.parent_ref = parent?.ref ?? null;
    const call = beginCall("atom_outline", purpose === "symlink_summary" ? 1 : 0, outlineAuditRequest(nodeId, depth, excerptChars, purpose, parent?.ref ?? null));
    step.call_id = call.callId;

    let outline: TreeOutline | null;
    try {
      if (stopped()) {
        finishCall(call, { completedAt: null, disposition: "skipped" });
        return;
      }
      outline = await deps.getTreeOutline(nodeId, depth, excerptChars);
      if (stopped()) {
        const completedAt = now();
        step.completed_at = completedAt;
        finishCall(call, {
          completedAt,
          outlineResponse: outline ? { canonical_node_id: outline.canonical_node_id, node_count: outline.nodes.length } : null,
          disposition: "skipped",
        });
        return;
      }
      if (!outline) throw new Error("outline missing");
    } catch (error) {
      if (stopped()) {
        finishCall(call, { completedAt: null, disposition: "skipped" });
        return;
      }
      const safeError = { code: "ATOM_OUTLINE_FAILED", message: "Atom tree outline read failed." };
      step.completed_at = now();
      finishCall(call, { completedAt: step.completed_at, error: safeError, disposition: "error" });
      if (purpose === "symlink_summary" && parent) {
        parent.childSummary = null;
        return;
      }
      throw new JevRunError(safeError.code, safeError.message);
    }

    step.canonical_node_id = outline.canonical_node_id;
    if (purpose === "symlink_summary") {
      if (parent) {
        parent.childSummary = childSummaryFromSymlinkOutline(outline.nodes);
      }
      const completedAt = now();
      step.completed_at = completedAt;
      finishCall(call, {
        completedAt,
        outlineResponse: { canonical_node_id: outline.canonical_node_id, node_count: outline.nodes.length },
      });
      return;
    }

    const decisions: JevStepDecision[] = [];
    const summarize: SearchCandidate[] = [];
    let outlineOrdinal = 0;
    for (const node of outline.nodes) {
      if (occurrences.length >= policy.maxCandidates) {
        limitCode = "CANDIDATE_LIMIT";
        break;
      }
      outlineOrdinal += 1;
      const traversalDepth = parent ? parent.traversalDepth + 1 : 0;
      const candidate = candidateFromOutline(
        node,
        parent ? parent.path : rootPath,
        parent ? parent.pathNodeIds : rootPathNodeIds,
        parent?.ref ?? null,
        traversalDepth,
      );
      candidateSequence += 1;
      const ref = `${step.id}:${String(outlineOrdinal).padStart(4, "0")}`;
      const occurrence = toOccurrence(candidate, ref, step.id);
      const found: SearchCandidate = {
        ...candidate,
        ref,
        discoveredInStepId: step.id,
        occurrence,
        discoveryOrder: candidateSequence,
      };
      occurrences.push(occurrence);
      step.candidate_refs.push(ref);

      const first = firstByCardId.get(candidate.cardId);
      if (first) {
        occurrence.canonical_node_id = first.occurrence.canonical_node_id;
        decisions.push({ ref, question_key: null, score: null, action: "alias", reused_from_ref: first.ref });
        continue;
      }
      firstByCardId.set(candidate.cardId, found);
      if (candidate.cardType === "structure") {
        structurePool.push(found);
        if (candidate.isSymlink) summarize.push(found);
      } else if (candidate.summary === null) {
        decisions.push({ ref, question_key: null, score: null, action: "no_body", reused_from_ref: null });
      } else if (parent) {
        descendantContentPool.push(found);
      } else {
        rootContentPool.push(found);
      }
    }
    step.decisions = decisions;
    const completedAt = now();
    step.completed_at = completedAt;
    finishCall(call, {
      completedAt,
      outlineResponse: {
        canonical_node_id: outline.canonical_node_id,
        node_count: outline.nodes.length,
        candidate_refs: step.candidate_refs,
      },
    });

    if (!limitCode) {
      for (const symlink of summarize) {
        if (stopped()) return;
        await addOutlineRead(symlink.nodeId, 1, 0, "symlink_summary", symlink);
      }
    }
  };

  const judgeBatch = async (stage: "structure_noul" | "content_noul", batch: SearchCandidate[]): Promise<number[] | null> => {
    if (batch.length === 0 || stopped()) return null;
    const promptCandidates = batch.map(({ nodeId, cardId, title, path, summary, childSummary }) => ({ nodeId, cardId, title, path, summary, childSummary }));
    const payload = stage === "structure_noul"
      ? buildStructurePayload(input.query, input.context, promptCandidates, "read")
      : buildContentPayload(input.query, input.context, promptCandidates);
    const step = pushStep(stage, batch.map((candidate) => candidate.ref));
    const call = beginCall(stage, batch.length, meaningAuditRequest(payload));
    step.call_id = call.callId;
    let response: JevMeaningResponse;
    try {
      response = await deps.judge(payload, controller.signal);
    } catch (error) {
      if (stopped()) {
        finishCall(call, { completedAt: null, disposition: "skipped" });
        return null;
      }
      const safeError = safeJevFailure(error);
      step.completed_at = now();
      finishCall(call, { completedAt: step.completed_at, error: safeError, disposition: "error" });
      throw new JevRunError(safeError.code, safeError.message);
    }
    if (stopped()) {
      const completedAt = now();
      step.completed_at = completedAt;
      finishCall(call, { completedAt, response, disposition: "skipped" });
      return null;
    }

    let scores: number[];
    try {
      scores = batch.map((_candidate, index) => noul(response, `${stage === "structure_noul" ? "structure" : "content"}_${index}`));
    } catch (error) {
      const safeError = safeJevFailure(error);
      step.completed_at = now();
      finishCall(call, { completedAt: step.completed_at, response, error: safeError, disposition: "error" });
      throw new JevRunError(safeError.code, safeError.message);
    }

    const completedAt = now();
    step.completed_at = completedAt;
    finishCall(call, { completedAt, response });
    step.decisions = batch.map((candidate, index) => {
      const score = scores[index] as number;
      const structure = stage === "structure_noul";
      const action = structure
        ? score >= policy.structureThreshold ? "queued" : "pruned"
        : "content_scored";
      return {
        ref: candidate.ref,
        question_key: `${structure ? "structure" : "content"}_${index}`,
        score,
        action,
        reused_from_ref: null,
      };
    });
    return scores;
  };

  try {
    if (input.root_node_id) {
      let root: TreeNodeWithCard | null;
      try {
        root = await deps.getNode(input.root_node_id);
      } catch {
        throw new JevSearchRequestError("The search scope could not be read.", "JEV_ROOT_READ_FAILED", 502);
      }
      if (stopped()) {
        finalStatus = timedOut ? "limited" : "cancelled";
        limitCode = timedOut ? "RUN_TIME_LIMIT" : null;
      } else if (!root) {
        throw new JevSearchRequestError("The search scope node was not found.", "JEV_ROOT_NOT_FOUND", 404);
      } else if (root.card.card_type !== "structure") {
        throw new JevSearchRequestError("The search scope must be a structure node.", "JEV_ROOT_NOT_STRUCTURE", 400);
      } else {
        rootPath = [root.card.title];
        rootPathNodeIds = [root.id];
      }
    }

    if (finalStatus === "complete" && !stopped()) {
      await addOutlineRead(input.root_node_id ?? null, 2, policy.summaryChars, "candidate_discovery", null);
    }

    while (finalStatus === "complete" && !stopped() && !limitCode && (structurePool.length > 0 || structureParents.length > 0)) {
      const nextCandidate = structurePool[0];
      const nextParent = structureParents[0];
      if (nextParent && (!nextCandidate || nextParent.traversalDepth < nextCandidate.traversalDepth)) {
        if (occurrences.length >= policy.maxCandidates) {
          limitCode = "CANDIDATE_LIMIT";
          break;
        }
        structureParents.shift();
        await addOutlineRead(nextParent.nodeId, 2, policy.summaryChars, "candidate_discovery", nextParent);
        continue;
      }
      if (!nextCandidate) continue;

      const maxBatch = structurePool.slice(0, policy.batchCandidates);
      const batch = takePayloadBatch(maxBatch, policy.payloadMaxChars, (items) => buildStructurePayload(input.query, input.context, items, "read"));
      const scores = await judgeBatch("structure_noul", batch);
      if (!scores || stopped() || limitCode) break;
      structurePool.splice(0, batch.length);
      for (let index = 0; index < batch.length; index += 1) {
        if (scores[index] !== undefined && scores[index] >= policy.structureThreshold) structureParents.push(batch[index] as SearchCandidate);
      }
    }

    if (stopped()) {
      finalStatus = timedOut ? "limited" : "cancelled";
      if (timedOut) limitCode = "RUN_TIME_LIMIT";
    } else if (limitCode) {
      finalStatus = "limited";
    }

    if (finalStatus === "complete" && !limitCode) {
      descendantContentPool.push(...rootContentPool);
      while (!stopped() && descendantContentPool.length > 0) {
        const maxBatch = descendantContentPool.slice(0, policy.batchCandidates);
        const batch = takePayloadBatch(maxBatch, policy.payloadMaxChars, (items) => buildContentPayload(input.query, input.context, items));
        const scores = await judgeBatch("content_noul", batch);
        if (!scores || stopped()) break;
        descendantContentPool.splice(0, batch.length);
        batch.forEach((candidate, index) => scoredContent.push({ candidate, score: scores[index] as number }));
      }
    }

    if (stopped()) {
      finalStatus = timedOut ? "limited" : "cancelled";
      if (timedOut) limitCode = "RUN_TIME_LIMIT";
    } else if (limitCode) {
      finalStatus = "limited";
    }
  } catch (error) {
    if (stopped()) {
      finalStatus = timedOut ? "limited" : "cancelled";
      if (timedOut) limitCode = "RUN_TIME_LIMIT";
    } else if (error instanceof JevSearchRequestError) {
      throw error;
    } else {
      finalStatus = "error";
      finalError = error instanceof JevRunError
        ? { code: error.code, message: error.message }
        : { code: "JEV_SEARCH_FAILED", message: "Jev search failed." };
    }
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", onCallerAbort);
    activeRuns -= 1;
  }

  let results: JevSearchResponse["results"] = [];
  if (finalStatus === "complete" || finalStatus === "limited") {
    const selectionStep = pushStep("selection", scoredContent.map((item) => item.candidate.ref));
    results = recordSelection(selectionStep, scoredContent, input.limit, policy);
  }
  if (finalStatus === "limited") {
    finalError = {
      code: limitCode ?? "RUN_TIME_LIMIT",
      message: limitCode === "CANDIDATE_LIMIT"
        ? "Jev search reached its candidate limit."
        : "Jev search reached its time limit.",
    };
  }
  if (finalStatus === "cancelled") {
    results = [];
    finalError = { code: "CANCELLED", message: "Jev search was cancelled." };
  }
  if (finalStatus === "error") results = [];

  const completedAt = now();
  const terminal = pushStep("run_terminal");
  terminal.started_at = completedAt;
  terminal.completed_at = completedAt;
  terminal.terminal_status = finalStatus;
  terminal.terminal_code = finalError?.code ?? null;

  return {
    schema_version: 1,
    engine: "jev",
    run_id: runId,
    query: input.query,
    root_node_id: input.root_node_id ?? null,
    status: finalStatus,
    complete: finalStatus === "complete",
    started_at: startedAt,
    completed_at: completedAt,
    policy: policyView(policy),
    results,
    trace: { candidates: occurrences, steps, calls: auditCalls },
    error: finalError,
  };
}

export async function runConfiguredJevSearch(input: JevSearchInput, signal?: AbortSignal): Promise<JevSearchResponse> {
  let config;
  try {
    config = readJevServerConfig();
  } catch (error) {
    if (error instanceof JevSearchConfigError) {
      throw new JevSearchRequestError(error.message, error.code, 503);
    }
    throw error;
  }
  const client = new JevClient(config.baseUrl, config.apiKey);
  return searchWithJev(input, { getNode, getTreeOutline, judge: client.judge.bind(client) }, signal);
}

function safeJevFailure(error: unknown): RunFailure {
  if (error instanceof JevAnswerError) return { code: error.code, message: "Jev response did not include a valid score for every candidate." };
  if (error instanceof JevError) return { code: error.code, message: error.message };
  return { code: "JEV_JUDGMENT_FAILED", message: "Jev judgment failed." };
}

class JevRunError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "JevRunError";
  }
}
