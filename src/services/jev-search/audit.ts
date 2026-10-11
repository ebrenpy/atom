import type {
  JevAuditCall,
  JevAuditStage,
  JevMeaningPayload,
  JevMeaningResponse,
} from "../../shared/jev-search.js";
import { redactSensitiveText } from "./prompts.js";

export interface AuditCallInput {
  callId: string;
  runId: string;
  seq: number;
  stage: JevAuditStage;
  candidateCount: number;
  startedAt: string;
  startedClock: number;
  request: Record<string, unknown>;
}

export function outlineAuditRequest(nodeId: string | null, depth: number, excerptChars: number, purpose: string, parentRef: string | null): Record<string, unknown> {
  return { node_id: nodeId, depth, excerpt_chars: excerptChars, purpose, parent_ref: parentRef };
}

export function meaningAuditRequest(payload: JevMeaningPayload): Record<string, unknown> {
  return {
    model: sanitizeValue(payload.model),
    state: sanitizeValue(JSON.parse(payload.state)),
    questions: Object.fromEntries(Object.entries(payload.questions).map(([key, question]) => [
      redactSensitiveText(key),
      {
        type: sanitizeValue(question.type),
        instructions: sanitizeValue(question.instructions),
        criteria: sanitizeValue(question.criteria),
      },
    ])),
  };
}

export function makeAuditCall(
  input: AuditCallInput,
  options: {
    completedAt: string | null;
    response?: JevMeaningResponse | null;
    outlineResponse?: Record<string, unknown> | null;
    error?: { code: string; message: string } | null;
    disposition?: JevAuditCall["disposition"];
  },
): JevAuditCall {
  const elapsed = options.completedAt === null ? null : Math.max(0, Math.round(performance.now() - input.startedClock));
  const answer = options.response;
  return {
    call_id: input.callId,
    run_id: input.runId,
    seq: input.seq,
    stage: input.stage,
    candidate_count: input.candidateCount,
    disposition: options.disposition ?? (options.error ? "error" : "completed"),
    started_at: input.startedAt,
    completed_at: options.completedAt,
    latency_ms: elapsed,
    usage: answer ? {
      input_tokens: safeNumber(answer.usage?.input_tokens) ?? 0,
      output_tokens: safeNumber(answer.usage?.output_tokens),
    } : null,
    request: input.request,
    response: options.response
      ? meaningAuditResponse(options.response)
      : options.outlineResponse ? sanitizeValue(options.outlineResponse) as Record<string, unknown> : null,
    error: options.error ? {
      code: options.error.code,
      message: redactSensitiveText(options.error.message),
    } : null,
  };
}

function meaningAuditResponse(response: JevMeaningResponse): Record<string, unknown> {
  const answers = Object.fromEntries(Object.entries(response.answers ?? {}).flatMap(([key, value]) => {
    const noul = safeNumber(value?.noul);
    return value?.type === "noul" && noul !== null ? [[key, { type: "noul", noul }]] : [];
  }));
  return {
    model: redactSensitiveText(response.model),
    answers,
    usage: {
      input_tokens: safeNumber(response.usage?.input_tokens),
      output_tokens: safeNumber(response.usage?.output_tokens),
    },
  };
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
    key,
    /(?:api[_ -]?key|token|secret|password|credential|authorization)/i.test(key)
      ? "[REDACTED]"
      : sanitizeValue(nested),
  ]));
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
