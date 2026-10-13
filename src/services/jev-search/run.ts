import type { CandidateOccurrence, JevAuditCall, JevAuditStage, JevSearchObserver, JevSearchStage, JevSearchStep } from "../../shared/jev-search.js";
import { makeAuditCall, type AuditCallInput } from "./audit.js";

/** Request-local recording. seq records starts; completion events record arrivals. */
export class JevRunTrace {
  readonly candidates: CandidateOccurrence[] = [];
  readonly steps: JevSearchStep[] = [];
  readonly calls: JevAuditCall[] = [];
  hop = 0;
  limitCode: string | null = null;
  jevCalls = 0;

  constructor(readonly runId: string, readonly stopped: () => boolean, readonly observer?: JevSearchObserver) {}

  start(stage: JevSearchStage, refs: string[] = [], startedAt = new Date().toISOString()): JevSearchStep {
    const seq = this.steps.length + 1;
    const step: JevSearchStep = {
      id: `step-${String(seq).padStart(6, "0")}`, seq, hop: this.hop, stage,
      started_at: startedAt, completed_at: null, call_id: null,
      candidate_refs: [...refs], decisions: [],
    };
    this.steps.push(step);
    this.observer?.({ event: "step_started", data: { id: step.id, seq, hop: step.hop, stage, started_at: step.started_at, candidate_refs: [...refs] } });
    return step;
  }

  beginCall(step: JevSearchStep, stage: JevAuditStage, count: number, request: Record<string, unknown>): AuditCallInput {
    // Calls start before any awaits, so their sequence cannot depend on arrival order.
    const seq = this.steps.filter(s => s.call_id !== null).length + 1;
    const callId = `${this.runId}:call:${String(seq).padStart(6, "0")}`;
    step.call_id = callId;
    return { callId, runId: this.runId, seq, stage, candidateCount: count,
      startedAt: step.started_at, startedClock: performance.now(), request };
  }

  finish(step: JevSearchStep, call?: AuditCallInput, options?: Parameters<typeof makeAuditCall>[1]): void {
    let audit: JevAuditCall | null = null;
    if (call && options) {
      step.completed_at = options.completedAt;
      audit = makeAuditCall(call, options);
      this.calls.push(audit);
    } else {
      step.completed_at ??= new Date().toISOString();
    }
    // Incomplete work still has a final delta (completed_at stays null).
    this.observer?.({ event: "step_completed", data: structuredClone({
      step, candidates: this.candidates.filter(c => c.discovered_in_step_id === step.id), call: audit,
    }) });
  }
}

export class JevRunError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "JevRunError";
  }
}
