/**
 * HTTP 线上契约（前端这一侧的唯一出口）。
 *
 * 这里**刻意重复声明**服务端已经有的类型，而不是 import @crossexam/shared：
 * 前端消费的是 JSON，不是 TS 对象；而 shared 经由 util.ts 依赖 node:crypto，
 * 一旦被 Vite 打进浏览器包就会直接崩。真正需要防漂移的中文标签另有一条漂移测试
 * （packages/web/test/labels.test.ts）看着。
 */

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
}

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
};

export type VerdictKind = 'solid' | 'overstated' | 'unsupported' | 'contradicts' | 'unanswerable';
export type ClaimCategory = 'skill' | 'experience' | 'achievement' | 'metric' | 'ownership' | 'timeline' | 'other';
export type InterviewerRole = 'tech' | 'hr' | 'hiring_manager' | 'stress' | 'domain_expert';
export type LlmMode = 'live' | 'record' | 'replay';

/** 简历原文里的一个左闭右开区间；quote 是原文逐字片段 */
export interface Anchor {
  start: number;
  end: number;
  quote: string;
  exact: boolean;
}

export interface Claim {
  id: string;
  text: string;
  anchor: Anchor;
  category: ClaimCategory;
  weight: number;
}

export interface RejectedClaim {
  text: string;
  quote: string;
  reason: string;
}

export interface Probe {
  id: string;
  claimId: string;
  interviewerId: string;
  round: number;
  question: string;
  anchor: Anchor;
  parentProbeId: string | null;
  rationale: string;
}

export interface Answer {
  probeId: string;
  text: string;
  mode: 'live' | 'simulated';
  citedAnchors: Anchor[];
}

export interface Verdict {
  claimId: string;
  kind: VerdictKind;
  confidence: number;
  rationale: string;
  evidence: Anchor[];
  probeIds: string[];
}

export interface Suggestion {
  claimId: string;
  anchor: Anchor;
  problem: string;
  before: string;
  after: string;
  why: string;
}

export interface AnswerOutcome {
  answer: Answer;
  answered: boolean;
  droppedCitations: string[];
}

export interface VerdictOutcome {
  verdict: Verdict;
  /** true 表示判定被代码改写过（代码级收敛），界面上必须显式提示 */
  adjusted: boolean;
  adjustmentReason: string | null;
  droppedEvidence: string[];
}

export type SuggestStatus = 'suggested' | 'not-needed' | 'rejected';

export interface SuggestOutcome {
  claimId: string;
  status: SuggestStatus;
  suggestion: Suggestion | null;
  reason: string | null;
}

export interface RejectedProbe {
  claimId: string;
  question: string;
  reason: string;
}

export interface AnswerError {
  probeId: string;
  message: string;
}
export interface VerdictError {
  claimId: string;
  message: string;
}
export interface SuggestError {
  claimId: string;
  message: string;
}

/** 服务端推给前端的事件联合体，event 名就是 type */
export type RunEvent =
  | { type: 'stage'; stage: string; round: number | null }
  | { type: 'claims'; claims: Claim[]; rejected: RejectedClaim[] }
  | { type: 'probes'; round: number; probes: Probe[]; rejected: RejectedProbe[] }
  | { type: 'answers'; answers: AnswerOutcome[]; errors: AnswerError[] }
  | { type: 'budget'; totalProbes: number; open: string[]; closed: string[] }
  | { type: 'verdicts'; verdicts: VerdictOutcome[]; errors: VerdictError[] }
  | { type: 'suggestions'; suggestions: SuggestOutcome[]; errors: SuggestError[] }
  | { type: 'error'; fatal: boolean; message: string };

export interface RunSummary {
  rounds: number;
  claims: number;
  probes: number;
  verdicts: Verdict[];
  suggestions: number;
  rejectedClaims: number;
  notices: string[];
  usage: Usage;
}

export interface HealthInfo {
  ok: boolean;
  mode: LlmMode;
  runMode: string;
  model: string;
  cassetteDir: string;
}

export interface DemoInfo {
  title: string;
  resume: string;
  jd: string;
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  llmMode: LlmMode;
  jobTitle: string;
  status: string;
  meta: Record<string, unknown>;
}

export interface LlmStats {
  calls: number;
  replayedCalls: number;
  liveCalls: number;
  distinctDigests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
}

export interface EventRow {
  seq: number;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface SessionView {
  session: SessionSummary & { resumeText: string; jdText: string; resumeHash: string };
  events: EventRow[];
  notices: string[];
  rounds: number;
  rejectedClaims: RejectedClaim[];
  llm: LlmStats;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error.length > 0) return body.error;
  } catch {
    // 不是 JSON 就退回状态码文案
  }
  return '请求失败（HTTP ' + String(res.status) + '）';
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as T;
}

export function fetchHealth(): Promise<HealthInfo> {
  return getJson<HealthInfo>('/api/health');
}

export function fetchDemo(): Promise<DemoInfo> {
  return getJson<DemoInfo>('/api/demo');
}

export async function listSessions(limit = 20): Promise<SessionSummary[]> {
  const data = await getJson<{ sessions: SessionSummary[] }>('/api/sessions?limit=' + String(limit));
  return data.sessions;
}

export function getSession(id: string): Promise<SessionView> {
  return getJson<SessionView>('/api/sessions/' + encodeURIComponent(id));
}

export function fetchStats(sessionId?: string): Promise<LlmStats> {
  const suffix = sessionId === undefined ? '' : '?session=' + encodeURIComponent(sessionId);
  return getJson<LlmStats>('/api/stats' + suffix);
}

export interface CreateSessionInput {
  useDemo?: boolean;
  resumeText?: string;
  jdText?: string;
  jobTitle?: string;
}

export async function createSession(input: CreateSessionInput): Promise<{ id: string; mode: LlmMode; jobTitle: string }> {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as { id: string; mode: LlmMode; jobTitle: string };
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch('/api/sessions/' + encodeURIComponent(id), { method: 'DELETE' });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
}

export function reportUrl(id: string): string {
  return '/api/sessions/' + encodeURIComponent(id) + '/report.md';
}

export interface SseEvent {
  id: string | null;
  event: string;
  data: unknown;
}

/** 解析一个 SSE 块；没有 data 字段的块（心跳、注释）返回 null */
export function parseSseBlock(raw: string): SseEvent | null {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let event = 'message';
  let id: string | null = null;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.length === 0 || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
    else if (field === 'id') id = value;
  }

  if (dataLines.length === 0) return null;
  const joined = dataLines.join('\n');
  let data: unknown = joined;
  try {
    data = JSON.parse(joined);
  } catch {
    data = joined;
  }
  return { id, event, data };
}

/**
 * 浏览器里读 SSE：跑沙盘是 POST，EventSource 只能发 GET，
 * 所以只能用 fetch + ReadableStream 自己切块。
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let cut = buffer.indexOf('\n\n');
    while (cut >= 0) {
      const parsed = parseSseBlock(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
      if (parsed !== null) onEvent(parsed);
      cut = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode();
  const tail = parseSseBlock(buffer);
  if (tail !== null) onEvent(tail);
}

export interface RunOptions {
  panel?: InterviewerRole[];
  maxClaims?: number;
  signal?: AbortSignal;
}

export async function streamRun(
  sessionId: string,
  options: RunOptions,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  const params = new URLSearchParams();
  if (options.panel !== undefined && options.panel.length > 0) params.set('panel', options.panel.join(','));
  if (options.maxClaims !== undefined) params.set('maxClaims', String(options.maxClaims));
  const query = params.toString();
  const url = '/api/sessions/' + encodeURIComponent(sessionId) + '/run' + (query.length > 0 ? '?' + query : '');

  const init: RequestInit = { method: 'POST' };
  if (options.signal !== undefined) init.signal = options.signal;
  const res = await fetch(url, init);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  if (res.body === null) throw new ApiError('服务端没有返回事件流', res.status);
  await readSseStream(res.body, onEvent);
}
