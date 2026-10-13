import type {
  JevMeaningPayload,
  JevMeaningResponse,
  JevSearchContext,
} from "../../shared/jev-search.js";

export interface JevChildSummary {
  totalDescendants: number;
  children: Array<{ title: string; descendantCards: number | null }>;
}

export interface JevPromptCandidate {
  nodeId: string;
  cardId: string;
  title: string;
  path: string[];
  summary: string | null;
  childSummary?: JevChildSummary | null;
}

export type ChildSummaryMode = "read" | "disabled";

const PAYLOAD_QUERY_CHARS = 400;
const PAYLOAD_CONTEXT_CHARS = 80;
const PAYLOAD_ID_CHARS = 96;
const PAYLOAD_TITLE_CHARS = 120;
const PAYLOAD_SUMMARY_CHARS = 200;
const PAYLOAD_PATH_SEGMENTS = 2;
const PAYLOAD_PATH_SEGMENT_CHARS = 80;
const PAYLOAD_CHILD_LIMIT = 24;
const PAYLOAD_CHILD_TITLE_CHARS = 60;
const ROOT_TITLE = "Atom 루트";
const SESSION_CONTEXT_LINE = "session_context는 관련도 보정에만 쓰고 탐색 범위는 바꾸지 않는다.";
const CHILD_SUMMARY_DISABLED_LINE = "하위 구조 정보: 읽지 않음";

const STRUCTURE_NATURE_RULES = [
  "후보는 모두 Atom 구조 카드다. 짧은 설명은 그 구조가 무엇을 어떤 기준으로 모으는 곳인지, 곧 성격과 역할을 말할 뿐 목차가 아니다. 판단할 것은 설명에 요청의 주제어가 나오는지가 아니라, 이 구조의 성격상 요청에 답이 될 카드가 그 아래 있을 법한지다.",
  "설명이 소재를 한정하지 않는 모음(이력, 아카이브, 발행 기록, \"소재는 정해져 있지 않다\", \"무엇이든\")이라고 말하면 주제로 거르지 않는다. 대신 요청이 그 모음이 담는 종류의 결과물로 답해질 요청인지 본다. 예를 들어 어떤 소재를 조사해 정리한 글의 모음이라면, 요청이 한 주제를 조사해 정리한 글(개념·방법·분석·동향·인물·사건)로 답할 수 있을 때 주제와 무관하게 열 가치가 있다. 어떤 주제를 다룬 글이 있었는지 찾는 요청은 그런 모음의 전형적인 용도다.",
  "요청이 이 구조의 제목이나 경로를 직접 지목하면(예: \"○○에서\", \"○○ 중에\") 주제와 무관하게 연다.",
  "설명이 성격을 한정하면(특정 시스템의 운영 절차, 실수 복기, 자동 생성 리포트 로그, 할 일 목록 등) 요청이 그 성격에 들어맞을 때만 연다. 모음이라도 요청이 그 결과물로 답해지는 종류가 아니면(특정 시스템의 현재 장애 원인 진단, 개별 대상의 세부 사양·수치 조회, 개인 기록 조회 등) 열지 않는다.",
];

const STRUCTURE_NATURE_CRITERIA = {
  true: "이 구조의 성격, 곧 모으는 것의 종류가 요청이 찾는 것과 맞아 그 아래에 현재 요청에 답이 될 카드가 있을 법하다.",
  false: "이 구조의 성격, 곧 모으는 것의 종류가 요청이 찾는 것과 달라 그 아래에 현재 요청에 답이 될 카드가 있을 법하지 않다.",
};

const CONTENT_PROMPT = {
  instructions: [
    "후보는 Atom 지식 카드다. 사용자 요청에 그 카드의 본문을 동적 추가 문맥으로 넣는 것이 직접 도움이 되는지 판단한다.",
    SESSION_CONTEXT_LINE,
  ],
  question: "이 카드의 본문을 동적 추가 문맥으로 넣는 것이 요청에 직접 도움이 되는지 판단하세요.",
  criteria: {
    true: "이 카드의 본문이 현재 요청에 직접 도움이 된다.",
    false: "이 카드의 본문은 현재 요청에 직접 도움이 되지 않는다.",
  },
};

const STRUCTURE_PROMPT = {
  instructions: [
    ...STRUCTURE_NATURE_RULES,
    "하위 구조 정보(깊이·하위 카드 수·직계 자식)는 보조 근거다. 직계 자식 목록은 앞의 일부 제목일 뿐이므로 목록에 요청의 주제가 보이지 않는다는 이유만으로 낮게 판단하지 않는다. 소재를 한정하지 않는 모음은 하위 카드가 많을수록 요청에 답할 카드가 그 안에 있을 법하다.",
    "짧은 설명이 \"본문 없음\"이면 제목과 하위 구조 정보만으로 보수적으로 판단한다.",
    SESSION_CONTEXT_LINE,
  ],
  question: "짧은 설명이 말하는 이 구조의 성격, 곧 무엇을 모으는 곳인지(하위 구조는 보조 근거)로 볼 때 그 아래에 요청에 답이 될 카드가 있을 법한지 판단하세요.",
  criteria: STRUCTURE_NATURE_CRITERIA,
};

export function buildStructurePayload(
  query: string,
  context: JevSearchContext,
  candidates: JevPromptCandidate[],
  childSummaries: ChildSummaryMode,
): JevMeaningPayload {
  return buildPayload("structure_noul", query, context, candidates, childSummaries);
}

export function buildContentPayload(
  query: string,
  context: JevSearchContext,
  candidates: JevPromptCandidate[],
): JevMeaningPayload {
  return buildPayload("content_noul", query, context, candidates, null);
}

export function buildSufficiencyPayload(query: string, context: JevSearchContext, candidates: JevPromptCandidate[]): JevMeaningPayload {
  const nodes = candidates.map(compactPayloadNode);
  return {
    state: JSON.stringify({
      stage: "sufficiency_noul",
      instructions: ["후보는 지금까지 찾은 Atom 지식 카드 묶음이다. 요청에 답하는 데 이 카드들이면 되는지 판단한다.", SESSION_CONTEXT_LINE],
      user_prompt: compactText(query, PAYLOAD_QUERY_CHARS), session_context: compactSessionContext(context),
      candidates: nodes.map(stateCandidate),
    }),
    model: "jev-latest",
    questions: { sufficiency_0: {
      type: "noul",
      instructions: ["이 카드들만 읽으면 요청에 답할 수 있는지 판단하세요.", "요청: " + compactText(query, PAYLOAD_QUERY_CHARS), "찾은 카드:",
        ...nodes.map((n, index) => `${index + 1}. ${n.path.join(" › ")}: ${n.summary ?? "본문 없음"}`)].join("\n"),
      criteria: { true: "이 카드들만 읽으면 요청에 답할 수 있다.", false: "이 카드들만으로는 요청에 답할 수 없다." },
    } },
  };
}

export function takePayloadBatch<T extends JevPromptCandidate>(
  pool: T[],
  maxChars: number,
  build: (batch: T[]) => JevMeaningPayload,
): T[] {
  if (pool.length === 0) return [];
  let fits = 1;
  let high = pool.length;
  while (fits < high) {
    const count = Math.ceil((fits + high) / 2);
    if (JSON.stringify(build(pool.slice(0, count))).length <= maxChars) fits = count;
    else high = count - 1;
  }
  return pool.slice(0, fits);
}

export function noul(response: JevMeaningResponse, key: string): number {
  const answer = response.answers[key];
  if (!answer || answer.type !== "noul" || !Number.isFinite(answer.noul) || (answer.noul as number) < 0 || (answer.noul as number) > 1) {
    throw new JevAnswerError(key);
  }
  return answer.noul as number;
}

export class JevAnswerError extends Error {
  readonly code = "BAD_NOUL_RESPONSE";

  constructor(key: string) {
    super(`Jev omitted a valid Noul answer for ${key}.`);
    this.name = "JevAnswerError";
  }
}

export function selectionThreshold(
  scores: number[],
  policy: Pick<{ scoreFloor: number; relativeScoreDelta: number }, "scoreFloor" | "relativeScoreDelta">,
): number {
  return scores.length === 0 ? policy.scoreFloor : Math.max(policy.scoreFloor, Math.max(...scores) - policy.relativeScoreDelta);
}

export function selectFeedCards<T extends { score: number; order: number }>(
  feed: T[],
  policy: Pick<{ scoreFloor: number; relativeScoreDelta: number; maxResults: number }, "scoreFloor" | "relativeScoreDelta" | "maxResults">,
): T[] {
  const threshold = selectionThreshold(feed.map((card) => card.score), policy);
  return feed
    .filter((card) => card.score + Number.EPSILON >= threshold)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, policy.maxResults);
}

export function normalizeQuery(value: string): string {
  return normalizeText(value);
}

export function normalizeContext(value: Partial<JevSearchContext> | undefined): JevSearchContext {
  return {
    agent: normalizeContextValue(value?.agent, "agent"),
    project: normalizeContextValue(value?.project, "project"),
    task: normalizeContextValue(value?.task, "task"),
  };
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/\b((?:api[_ -]?key|token|secret|password|passwd|credential|private[_ -]?key|access[_ -]?key|auth[_ -]?key|authorization)\b\s*[:=]\s*)(?:["']?)[^\s"'`]+/gi, "$1[REDACTED]")
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [REDACTED]");
}

function buildPayload(
  stage: "structure_noul" | "content_noul",
  query: string,
  context: JevSearchContext,
  nodes: JevPromptCandidate[],
  childSummaries: ChildSummaryMode | null,
): JevMeaningPayload {
  const kind = childSummaries === null ? "content" : "structure";
  const prompt = childSummaries === null ? CONTENT_PROMPT : STRUCTURE_PROMPT;
  const compactNodes = nodes.map((node) => childSummaries === null ? compactPayloadNode(node) : compactStructureNode(node, childSummaries));
  const questions = Object.fromEntries(compactNodes.map((node, index) => [kind + "_" + String(index), {
    type: "noul" as const,
    instructions: [
      prompt.question,
      "요청: " + compactText(query, PAYLOAD_QUERY_CHARS),
      "현재 구조: " + node.parent_path.join(" › "),
      "후보 경로: " + node.path.join(" › "),
      "제목: " + node.title,
      "짧은 설명: " + (node.summary ?? "본문 없음"),
      ...(childSummaries === null ? [] : structureLines(node as ReturnType<typeof compactStructureNode>, childSummaries === "disabled")),
    ].join("\n"),
    criteria: prompt.criteria,
  }]));
  const compactQuery = compactText(query, PAYLOAD_QUERY_CHARS);
  return {
    state: JSON.stringify({
      stage,
      instructions: prompt.instructions,
      user_prompt: compactQuery,
      session_context: compactSessionContext(context),
      candidates: compactNodes.map(stateCandidate),
    }),
    model: "jev-latest",
    questions,
  };
}

function compactStructureNode(node: JevPromptCandidate, childSummaries: ChildSummaryMode) {
  const summary = childSummaries === "disabled" ? null : node.childSummary ?? null;
  const children = summary === null ? null : summary.children.slice(0, PAYLOAD_CHILD_LIMIT).map((child) => ({
    title: compactText(child.title, PAYLOAD_CHILD_TITLE_CHARS),
    cards: child.descendantCards,
  }));
  return {
    ...compactPayloadNode(node),
    depth: node.path.length,
    total_descendants: summary?.totalDescendants ?? null,
    children,
    omitted_children: summary === null || children === null ? null : summary.children.length - children.length,
  };
}

function structureLines(node: ReturnType<typeof compactStructureNode>, disabled: boolean): string[] {
  if (disabled) return ["깊이: " + String(node.depth), CHILD_SUMMARY_DISABLED_LINE];
  if (node.children === null) return ["깊이: " + String(node.depth), "하위 카드 수: 하위 정보 없음", "직계 자식: 하위 정보 없음"];
  const listed = [
    ...node.children.map((child) => `${child.title}(${child.cards === null ? "?" : String(child.cards)})`),
    ...(node.omitted_children ? [`… 외 ${String(node.omitted_children)}개`] : []),
  ];
  return [
    "깊이: " + String(node.depth),
    "하위 카드 수: " + String(node.total_descendants),
    listed.length > 0 ? "직계 자식 (각 자식 이하 카드 수): " + listed.join(", ") : "직계 자식: 없음",
  ];
}

function stateCandidate(node: ReturnType<typeof compactPayloadNode> | ReturnType<typeof compactStructureNode>) {
  const placed = { node_id: node.node_id, card_id: node.card_id, title: node.title, path: node.path, parent_path: node.parent_path };
  return "depth" in node ? { ...placed, depth: node.depth, total_descendants: node.total_descendants } : placed;
}

function compactSessionContext(context: JevSearchContext): JevSearchContext {
  return {
    agent: context.agent === null ? null : compactText(context.agent, PAYLOAD_CONTEXT_CHARS),
    project: context.project === null ? null : compactText(context.project, PAYLOAD_CONTEXT_CHARS),
    task: context.task === null ? null : compactText(context.task, PAYLOAD_CONTEXT_CHARS),
  };
}

function compactPayloadNode(node: JevPromptCandidate) {
  return {
    node_id: compactText(node.nodeId, PAYLOAD_ID_CHARS),
    card_id: compactText(node.cardId, PAYLOAD_ID_CHARS),
    title: compactText(node.title, PAYLOAD_TITLE_CHARS),
    path: compactPath(node.path),
    parent_path: compactPath(node.path.length > 1 ? node.path.slice(0, -1) : [ROOT_TITLE]),
    summary: node.summary === null ? null : compactText(node.summary, PAYLOAD_SUMMARY_CHARS),
  };
}

function compactPath(path: string[]): string[] {
  const tail = path.slice(-PAYLOAD_PATH_SEGMENTS).map((segment) => compactText(segment, PAYLOAD_PATH_SEGMENT_CHARS));
  return path.length > tail.length ? ["…", ...tail] : tail;
}

function compactText(value: string, maxChars: number): string {
  const normalized = redactSensitiveText(normalizeText(value));
  let used = 0;
  let cut = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    used += wireCost(normalized.charCodeAt(index));
    if (used > maxChars) return normalized.slice(0, endsInsidePair(normalized, cut) ? cut - 1 : cut) + "…";
    if (used < maxChars) cut = index + 1;
  }
  return normalized;
}

function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function normalizeContextValue(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error(`${field} context must be text.`);
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (normalized.length > 160) throw new Error(`${field} context is too long.`);
  return normalized;
}

function endsInsidePair(value: string, cut: number): boolean {
  if (cut === 0) return false;
  const code = value.charCodeAt(cut - 1);
  return code >= 0xd800 && code <= 0xdbff;
}

function wireCost(code: number): number {
  if (code === 0x22 || code === 0x5c) return 4;
  return code < 0x20 ? 7 : 1;
}
