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
  /** 这一版能选的运行模式，顺序即展示顺序。旧服务端可能不返回，界面有兜底。 */
  modes?: LlmMode[];
  modeLabels?: Record<string, string>;
  /** 联网就绪状态：缺哪个环境变量由 missing 点名。 */
  live?: { ready: boolean; missing: string[] };
}

/** 真实端点上的模型清单；没配好联网时 ready=false 且 models 为空。 */
export interface ModelList {
  ready: boolean;
  models: string[];
  defaultModel: string;
  error: string | null;
  missing: string[];
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
  /** 这场沙盘当时用的意图契约，含指纹对账结果 */
  contracts: ContractView[];
}

export interface ContractPersona {
  name: string;
  role: string;
  seniority: string;
  tone: string;
  blurb: string;
}

export interface ContractBudget {
  maxRoundsPerClaim: number;
  maxProbesPerInterviewerPerClaim: number;
  maxTotalProbes: number;
}

/** 一位面试官的意图契约：人设、目标、手法、禁区、预算，全是结构化字段 */
export interface IntentContract {
  id: string;
  version: number;
  persona: ContractPersona;
  goal: string;
  tactics: string[];
  constraints: string[];
  forbidden: string[];
  budget: ContractBudget;
}

export interface ContractView {
  /** 预设面试官是角色名（tech / hr…），自定义是 custom-xxx：这里必须是宽松的字符串 */
  id: string;
  version: number;
  /** 服务端此刻按代码里的契约算出的指纹 */
  digest: string;
  /** 跑这场沙盘时落库的指纹；没跑过就是 null */
  storedDigest: string | null;
  verified: boolean;
  contract: IntentContract;
  /** 这位面试官实际拿到的 system prompt 原文 */
  systemPrompt: string;
}

export interface ContractsResponse {
  panel: string[];
  budget: ContractBudget;
  contracts: ContractView[];
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

export function fetchModels(): Promise<ModelList> {
  return getJson<ModelList>('/api/models');
}

export function fetchDemo(): Promise<DemoInfo> {
  return getJson<DemoInfo>('/api/demo');
}

/** 契约是声明式的：给定面试官 id 就能算出全文与指纹，不需要跑沙盘、不调模型 */
export function fetchContracts(panel?: string[]): Promise<ContractsResponse> {
  const query = panel !== undefined && panel.length > 0 ? '?panel=' + panel.join(',') : '';
  return getJson<ContractsResponse>('/api/contracts' + query);
}

/**
 * 自定义面试官的一份草稿：**窄字段**是故意的。
 * 契约要能被评审，就不该容忍一段两百字的「人设散文」。
 */
export interface InterviewerDraft {
  name: string;
  domain: string;
  seniority: string;
  tone: string;
  blurb: string;
  goal: string;
  tactics: string[];
}

/** 字段级 diff：让「AI 改了什么」看得见，而不是让人对着两段 JSON 找不同 */
export interface DraftDiff {
  field: string;
  before: string;
  after: string;
}

/** 库里的一位自定义面试官：契约视图与预设同形，界面不用写两套渲染 */
export interface InterviewerEntry extends ContractView {
  domain: string;
  /** llm = 模型生成的；local = 本地规则兜底 */
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewerLibrary {
  presets: ContractView[];
  custom: InterviewerEntry[];
  limit: number;
  budget: ContractBudget;
}

/** 「用 AI 优化」的结果：草稿 + 谁生成的 + 改了什么 + 渲染出的 prompt */
export interface DraftResult {
  draft: InterviewerDraft;
  source: 'llm' | 'local';
  notes: string[];
  fallbackReason: string | null;
  diff: DraftDiff[];
  id: string;
  version: number;
  digest: string;
  contract: IntentContract;
  systemPrompt: string;
  replayed: boolean;
  usage: Usage;
}

export interface DraftInput {
  description: string;
  jobTitle?: string;
  jdText?: string;
  resumeText?: string;
  /** 已经有一份草稿时再优化：服务端会算出改了什么 */
  before?: InterviewerDraft;
  /** 编辑既有面试官时传它的 id：名字改了也不能换人 */
  id?: string;
  /** false = 只用本地规则，一个网络包都不发 */
  useModel?: boolean;
  mode?: LlmMode;
  model?: string;
}

export function fetchInterviewers(): Promise<InterviewerLibrary> {
  return getJson<InterviewerLibrary>('/api/interviewers');
}

export function draftInterviewer(input: DraftInput): Promise<DraftResult> {
  return postJson<DraftResult>('/api/interviewers/draft', input);
}

export function saveInterviewer(input: {
  draft: InterviewerDraft;
  id?: string;
  source?: string;
}): Promise<{ ok: boolean; interviewer: InterviewerEntry }> {
  return postJson<{ ok: boolean; interviewer: InterviewerEntry }>('/api/interviewers', input);
}

export async function deleteInterviewer(id: string): Promise<void> {
  const res = await fetch('/api/interviewers/' + encodeURIComponent(id), { method: 'DELETE' });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as T;
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
  /** 这一场用什么跑；不传就沿用服务端启动时的模式。 */
  mode?: LlmMode;
  /** 联网时要用的模型名；回放模式会忽略它。 */
  model?: string;
  /** 这一场的面试官阵容：预设 id 或自定义 id，顺序即提问顺序。不传就用默认三位。 */
  interviewers?: string[];
}

export interface CreatedSession {
  id: string;
  mode: LlmMode;
  model: string;
  jobTitle: string;
  /** 服务端落定的阵容（已按上限截断、已校验存在） */
  panel: string[];
}

export async function createSession(input: CreateSessionInput): Promise<CreatedSession> {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as CreatedSession;
}

export type ImportKind = 'pdf' | 'docx' | 'text';

/** 服务端把 PDF / Word / 文本解出来的简历正文；文件本身不落库、不留盘。 */
export interface ImportedResume {
  kind: ImportKind;
  name: string;
  text: string;
  chars: number;
  notes: string[];
}

export const IMPORT_ACCEPT = '.pdf,.docx,.txt,.md,.markdown';

export async function importResumeFile(file: File): Promise<ImportedResume> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/import', { method: 'POST', body: form });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as ImportedResume;
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch('/api/sessions/' + encodeURIComponent(id), { method: 'DELETE' });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
}

export function reportUrl(id: string): string {
  return '/api/sessions/' + encodeURIComponent(id) + '/report.md';
}

/**
 * 可直接打印的报告页。print 为真时页面加载完自己调起打印对话框，
 * 「导出 PDF」因此是浏览器自带能力，服务端不需要装无头浏览器。
 */
export function reportHtmlUrl(id: string, print = false): string {
  const base = '/api/sessions/' + encodeURIComponent(id) + '/report.html';
  return print ? base + '?print=1' : base;
}

export function reportDocUrl(id: string): string {
  return '/api/sessions/' + encodeURIComponent(id) + '/report.doc';
}

export interface SseEvent {
  id: string | null;
  event: string;
  data: unknown;
}

/**
 * 一路模型调用的流式分片。
 * channel 是服务端给这一路调用起的名字（extract / probe:tech / answer:P1 / verdict:C1 / suggest:C1），
 * 界面据此把分片送回它属于的那张卡片；它不占用断线续传的 seq。
 */
export interface StreamChunk {
  channel: string;
  stage: string;
  kind: 'reasoning' | 'text';
  text: string;
}

/** 分片是锦上添花的数据：形状不认识就丢掉，绝不让它把整场质询带崩 */
export function asStreamChunk(data: unknown): StreamChunk | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const channel = record['channel'];
  const stage = record['stage'];
  const kind = record['kind'];
  const text = record['text'];
  if (typeof channel !== 'string' || channel.length === 0) return null;
  if (typeof stage !== 'string' || stage.length === 0) return null;
  if (kind !== 'reasoning' && kind !== 'text') return null;
  if (typeof text !== 'string' || text.length === 0) return null;
  return { channel: channel, stage: stage, kind: kind, text: text };
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
  panel?: string[];
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
