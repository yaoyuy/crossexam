/**
 * HTTP 线上契约（前端这一侧的唯一出口）。
 *
 * 这里**刻意重复声明**服务端已经有的类型，而不是 import @crossexam/shared：
 * 前端消费的是 JSON，不是 TS 对象；而 shared 经由 util.ts 依赖 node:crypto，
 * 一旦被 Vite 打进浏览器包就会直接崩。真正需要防漂移的中文标签另有一条漂移测试
 * （packages/web/test/labels.test.ts）看着。
 */

import type { RevisedResume } from './revisions.ts';

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

/** 用户交进来的一份岗位描述。id 由服务端按顺序编（J1..Jn）。 */
export interface JobDescription {
  id: string;
  ordinal: number;
  title: string;
  text: string;
}

export type RequirementKind = 'must' | 'plus' | 'duty';

/** 从 JD 里抽出来的一条要求；anchor 锚在这条要求所属的那份 JD 原文上 */
export interface Requirement {
  id: string;
  kind: RequirementKind;
  text: string;
  keywords: string[];
  anchor: Anchor;
  /** 代表句出自哪份 JD（跨份合并后取引文最长的那一份） */
  jdId: string;
  /** 合并进来的所有 JD id，按 JD 顺序 */
  sources: string[];
}

/** 锚不到 JD 原文、被丢掉的要求：留在报告里说明「这条为什么没进对照」 */
export interface RejectedRequirement {
  key: string;
  jdId: string;
  quote: string;
  text: string;
  reason: string;
}

/** 反问的类别：问的是团队、技术栈、成长、业务还是流程 */
export type CounterKind = 'team' | 'tech' | 'growth' | 'business' | 'process';

/** 反问的依据来自哪里：岗位要求还是简历原话 */
export type CounterSource = 'jd' | 'resume';

/**
 * 一句可以反问 HR 的话。
 * anchor 一定非空：锚不上材料的反问在服务端就被丢掉了，不会走到界面上。
 * reply 是沙盘模拟出来的，不是真 HR 在答——界面必须把这点说清楚。
 */
export interface CounterQuestion {
  id: string;
  ordinal: number;
  text: string;
  kind: CounterKind;
  reason: string;
  reply: string;
  source: CounterSource;
  anchor: Anchor;
  /** source 是 jd 时才有值 */
  jdId: string | null;
}

/** 锚不回材料、被丢掉的反问：留在界面上说明「这句为什么没留下来」 */
export interface RejectedCounter {
  text: string;
  reason: string;
}

/** 简历对一条要求的回答程度。missing 不生成追问——没写过的经历，逼问没有意义。 */
export type MatchStatus = 'hit' | 'weak' | 'missing';

export interface RequirementMatch {
  requirementId: string;
  /** 命中的主张 id；missing 时是 null */
  claimId: string | null;
  status: MatchStatus;
  reason: string;
}

export interface MatchSummary {
  hit: number;
  weak: number;
  missing: number;
  total: number;
}

/** 追问阶段看到的「要求 → 主张」对照表；只有 hit / weak 会进提示词 */
export interface RequirementNote {
  id: string;
  kind: RequirementKind;
  status: MatchStatus;
  label: string;
  claimId: string | null;
  jdId: string;
  jdTitle: string;
  text: string;
  jdQuote: string;
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
  /** 这条追问照着哪条岗位要求问的；没有第二条锚时为 null */
  requirementId?: string | null;
  /** 岗位要求原文的锚点（锚在那份 JD 上）；没有第二条锚时为 null */
  jdAnchor?: Anchor | null;
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
  | {
      type: 'requirements';
      requirements: Requirement[];
      rejected: RejectedRequirement[];
      matches: RequirementMatch[];
      summary: MatchSummary;
    }
  | { type: 'counter'; counters: CounterQuestion[]; rejected: RejectedCounter[] }
  | { type: 'suggestions'; suggestions: SuggestOutcome[]; errors: SuggestError[] }
  | { type: 'error'; fatal: boolean; message: string };

export interface RunSummary {
  rounds: number;
  claims: number;
  probes: number;
  verdicts: Verdict[];
  suggestions: number;
  rejectedClaims: number;
  counters: number;
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
  /** 三档追问强度：名字、一句话说明与四个预算数字都由服务端给，界面不自己编。 */
  difficulties?: DifficultyChoice[];
  defaultDifficulty?: string;
  /** 三档改写风格：只给名字与一句话说明，不给指南——指南是提示词的事。 */
  styles?: StyleChoice[];
  defaultStyle?: string;
}

/** 一档改写风格。它不进契约指纹：契约描述「谁在问」，风格描述「改得多狠」。 */
export interface StyleChoice {
  id: string;
  label: string;
  hint: string;
}

/**
 * 一档追问强度。界面只负责挑一个 id，**预算数字一律不在这边写死**：
 * 它是契约指纹的一部分，两边各写一份就一定有对不上的那天。
 */
export interface DifficultyChoice {
  id: string;
  label: string;
  hint: string;
  budget: ContractBudget & { maxConsecutiveUnanswerable: number };
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

/** 历史仪表盘（P11 · C2）：把最近若干场换个角度看。字段与服务端 HistoryOverview 一一对应。 */
export interface OverviewCounts {
  judged: number;
  solid: number;
  weak: number;
  counts: Partial<Record<VerdictKind, number>>;
}

export interface OverviewCategory {
  category: ClaimCategory;
  label: string;
  total: number;
  judged: number;
  solid: number;
  weak: number;
  counts: Partial<Record<VerdictKind, number>>;
}

export interface OverviewTrendPoint {
  sessionId: string;
  createdAt: string;
  jobTitle: string;
  judged: number;
  solid: number;
  probes: number | null;
}

export interface OverviewResumeGroup {
  resumeHash: string;
  sessions: number;
  latestId: string;
  latestCreatedAt: string;
}

export interface HistoryOverview {
  /** 这次统计覆盖的场次上限 */
  window: number;
  sessions: number;
  claims: number;
  verdicts: OverviewCounts;
  categories: OverviewCategory[];
  meanProbes: number | null;
  /** 最近几场，按时间升序：左手边是更早的那一场 */
  trend: OverviewTrendPoint[];
  /** 不足两场时说明为什么没有趋势 */
  trendNote: string | null;
  resumeGroups: OverviewResumeGroup[];
  sameResumeRuns: number;
  headline: string;
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

/** 用户当场补的一句真话：不是模型生成的，也不回写简历原文。 */
export interface SessionSupplement {
  claimId: string;
  text: string;
  digest: string;
  createdAt: string;
  updatedAt: string;
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
  /** 这场沙盘照着哪几份 JD 问的（没上传时是空数组） */
  jds: JobDescription[];
  /** 抽出来并跨份合并后的要求清单 */
  requirements: Requirement[];
  /** 锚不到 JD 原文、没进对照的那些要求 */
  requirementRejected: RejectedRequirement[];
  /** 每条要求与主张的对照结果 */
  requirementMatches: RequirementMatch[];
  /** 追问阶段实际摆上桌的对照表（只有 hit / weak） */
  requirementNotes: RequirementNote[];
  requirementSummary: MatchSummary;
  /** 用户当场补的那些真话。采纳之后它们会作为新的一行加进简历 */
  supplements: SessionSupplement[];
  /** 跑完给出的反问清单；没有可依据的材料时是空数组 */
  counters: CounterQuestion[];
  /** 锚不回材料、没上桌的反问 */
  counterRejected: RejectedCounter[];
  /** 这一场问得有多狠。旧会话可能没有，界面按默认档处理。 */
  difficulty?: string;
  /** 这一场的改写建议改得多狠。旧会话可能没有，界面按默认档处理。 */
  style?: string;
}


/* ---------------------------------------------- 版本对比（改完再跑一遍） */

/** 对比里的一条主张：只比判定，所以不带锚点与权重 */
export interface CompareClaim {
  id: string;
  text: string;
  category: ClaimCategory;
  /** 没判定是 null 而不是 undefined：对比层只认「有没有判定」 */
  verdict: VerdictKind | null;
}

/** better 变好 / same 没变 / worse 变差 / unjudged 至少一边没判定 */
export type ShiftKind = 'better' | 'same' | 'worse' | 'unjudged';

/** 牵上的一对主张：prev 是上一版，next 是这一版 */
export interface ComparePair {
  prev: CompareClaim;
  next: CompareClaim;
  similarity: number;
  shift: ShiftKind;
}

export interface CompareCounts {
  judged: number;
  solid: number;
  weak: number;
  counts: Partial<Record<VerdictKind, number>>;
}

export interface CompareSummary {
  threshold: number;
  pairs: ComparePair[];
  added: CompareClaim[];
  removed: CompareClaim[];
  before: CompareCounts;
  after: CompareCounts;
  improved: ComparePair[];
  worsened: ComparePair[];
  probesBefore: number | null;
  probesAfter: number | null;
  /** 一句话结论由服务端算好（报告与界面共用同一句） */
  headline: string;
}

export interface CompareView {
  sessionId: string;
  /** 没有上一版：这是第一场，本来就没什么可比的 */
  first: boolean;
  /** 记了上一版，但那一场已经不在了 */
  parentMissing: boolean;
  parentSessionId: string | null;
  parent: { id: string; jobTitle: string; createdAt: string; resumeHash: string } | null;
  /** 这一场与上一场的简历是不是同一份 */
  resumeChanged: boolean;
  comparison: CompareSummary | null;
}

/**
 * 成长档案的接口契约（P12 · ②）。
 *
 * 刻意与服务端 growth.ts 重复声明而不 import：web 包不引 @crossexam/shared，
 * 因为它依赖 node:crypto，进浏览器会崩（同 api.ts 头部那条注释）。
 * 漂移由服务端 packages/server/test/growth.test.ts 的接口返回体看守——它是同一份事实的
 * 唯一作者，界面这边只负责照着画。
 */
export interface GrowthPoint {
  sessionId: string;
  createdAt: string;
  jobTitle: string;
  version: number;
  judged: number;
  solid: number;
  weak: number;
  probes: number | null;
}

export interface TrailStep {
  sessionId: string;
  version: number;
  claimId: string;
  text: string;
  verdict: VerdictKind | null;
  shift: ShiftKind | null;
}

export interface ClaimTrail {
  key: string;
  firstVersion: number;
  lastVersion: number;
  versions: number;
  text: string;
  verdict: VerdictKind | null;
  presentInLatest: boolean;
  everSolid: boolean;
  persistent: boolean;
  steps: TrailStep[];
}

export interface GrowthView {
  sessionId: string;
  rootId: string;
  broken: boolean;
  brokenAt: string | null;
  window: number;
  order: string[];
  versions: GrowthPoint[];
  trails: ClaimTrail[];
  persistent: ClaimTrail[];
  fixed: ClaimTrail[];
  single: number;
  headline: string;
  trailNote: string | null;
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
  /** 这份契约是按哪一档算出来的 */
  difficulty?: string;
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
export function fetchContracts(panel?: string[], difficulty?: string): Promise<ContractsResponse> {
  const parts: string[] = [];
  if (panel !== undefined && panel.length > 0) parts.push('panel=' + panel.join(','));
  if (difficulty !== undefined && difficulty !== '') parts.push('difficulty=' + encodeURIComponent(difficulty));
  const query = parts.length > 0 ? '?' + parts.join('&') : '';
  return getJson<ContractsResponse>('/api/contracts' + query);
}


/** 岗位模板：12 个行业 × 3 个岗位的原创 JD 与示例简历（P9） */
export interface TemplateItem {
  id: string;
  industry: string;
  title: string;
  jd: string;
  resume: string;
  /** 这类简历常见的坑，2–3 条 */
  hints: string[];
  /** 推荐的内置面试官（两位） */
  presets: string[];
  /** 模板自带的自建面试官草稿，与用户自己配的那位同构 */
  custom: InterviewerDraft;
  /** 文案指纹：改一个字就变，界面靠它判断手里的模板是不是旧的 */
  digest: string;
}

export interface TemplateLimits {
  jdMin: number;
  jdMax: number;
  resumeMin: number;
  resumeMax: number;
  hintsMin: number;
  hintsMax: number;
  hintMin: number;
  hintMax: number;
  presetsCount: number;
  industryCount: number;
  perIndustry: number;
}

export interface TemplateLibrary {
  industries: string[];
  templates: TemplateItem[];
  limits: TemplateLimits;
}

/** 一键采用的结果：填什么、换哪几位面试官，都由服务端算好，界面不自己拼 */
export interface AppliedTemplate {
  ok: boolean;
  /** false 表示这位面试官库里本来就有，直接复用了（同一套模板点两次不会多出一位） */
  created: boolean;
  template: { id: string; industry: string; title: string; jd: string; resume: string; hints: string[]; digest: string };
  panel: string[];
  interviewer: InterviewerEntry;
}

export function fetchTemplates(): Promise<TemplateLibrary> {
  return getJson<TemplateLibrary>('/api/templates');
}

export function applyTemplate(id: string): Promise<AppliedTemplate> {
  return postJson<AppliedTemplate>('/api/templates/' + encodeURIComponent(id) + '/apply', {});
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

export function fetchOverview(limit?: number): Promise<HistoryOverview> {
  const suffix = limit === undefined ? '' : '?limit=' + String(limit);
  return getJson<HistoryOverview>('/api/sessions/overview' + suffix);
}

export async function listSessions(limit = 20): Promise<SessionSummary[]> {
  const data = await getJson<{ sessions: SessionSummary[] }>('/api/sessions?limit=' + String(limit));
  return data.sessions;
}

export function getSession(id: string): Promise<SessionView> {
  return getJson<SessionView>('/api/sessions/' + encodeURIComponent(id));
}

/** 跟上一版比。第一场也回 200（first 为真），不是 404。 */
export function fetchCompare(id: string): Promise<CompareView> {
  return getJson<CompareView>('/api/sessions/' + encodeURIComponent(id) + '/compare');
}

export function fetchGrowth(id: string): Promise<GrowthView> {
  return getJson<GrowthView>('/api/sessions/' + encodeURIComponent(id) + '/growth');
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
  /** 1–8 份岗位描述（标题可省，省了取正文第一行）；不传或不给正文就等于没有 JD。 */
  jds?: { title: string; text: string }[];
  /** 追问强度：gentle / normal / hard。不传就是常规档。 */
  difficulty?: string;
  /** 改写风格：conservative / normal / bold。不传就是常规档。 */
  style?: string;
  /** 这一场是从哪一场改完再跑出来的：报告与界面据此说清「比上次」。 */
  parentSessionId?: string;
}

export interface CreatedSession {
  id: string;
  mode: LlmMode;
  model: string;
  jobTitle: string;
  /** 服务端落定的追问强度 */
  difficulty: string;
  /** 服务端落定的改写风格 */
  style: string;
  /** 服务端落定的阵容（已按上限截断、已校验存在） */
  panel: string[];
  /** 落定的 JD 编号与标题（只回编号，正文留在库里） */
  jds: { id: string; ordinal: number; title: string }[];
  /** 这一场记下的上一版（没传就是 null） */
  parentSessionId: string | null;
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

/**
 * 整场打成一个单文件 HTML（附件下载）。
 * 里面没有外链、没有图片、没有统计脚本——发给别人，他断网双击也能看完整场。
 */
export function bundleUrl(id: string): string {
  return '/api/sessions/' + encodeURIComponent(id) + '/bundle.html';
}

/* ---------------------------------------------- 采纳改写与改完的简历导出 */

/** 会话当前那一版改完的简历；没采纳过就是 null（不是空串：没采纳过和改成了空是两件事） */
export async function fetchRevisions(id: string): Promise<RevisedResume | null> {
  const data = await getJson<{ revised: RevisedResume | null }>('/api/sessions/' + encodeURIComponent(id) + '/revisions');
  return data.revised;
}

/**
 * 确认采纳。claims 是**本次确认的全部**主张，不是增量：
 * 取消勾选一条再提交，那条就该从改完的简历里消失。
 */
export async function acceptRevisions(id: string, claims: readonly string[]): Promise<RevisedResume> {
  const data = await postJson<{ revised: RevisedResume }>('/api/sessions/' + encodeURIComponent(id) + '/revisions', {
    claims: [...claims],
  });
  return data.revised;
}

/**
 * 记下一句补充说明。按主张 id 一条，再调一次就是改这一条（不占新名额）。
 * 它不写进简历原文：勾上并「确认采纳」之后才会作为新的一行加进去。
 */
export async function saveSupplement(id: string, claimId: string, text: string): Promise<SessionSupplement> {
  const data = await postJson<{ supplement: SessionSupplement }>(
    '/api/sessions/' + encodeURIComponent(id) + '/supplements',
    { claimId: claimId, text: text },
  );
  return data.supplement;
}

export async function deleteSupplement(id: string, claimId: string): Promise<void> {
  const res = await fetch('/api/sessions/' + encodeURIComponent(id) + '/supplements/' + encodeURIComponent(claimId), {
    method: 'DELETE',
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
}

export async function discardRevisions(id: string): Promise<void> {
  const res = await fetch('/api/sessions/' + encodeURIComponent(id) + '/revisions', { method: 'DELETE' });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
}

export function resumeTextUrl(id: string): string {
  return '/api/sessions/' + encodeURIComponent(id) + '/resume.txt';
}

/** 可打印的简历页：print 为真时页面加载完自己调起打印，另存为 PDF 就是导出 */
export function resumeHtmlUrl(id: string, options: { print?: boolean; marks?: boolean } = {}): string {
  const params: string[] = [];
  if (options.print === true) params.push('print=1');
  if (options.marks === true) params.push('marks=1');
  const base = '/api/sessions/' + encodeURIComponent(id) + '/resume.html';
  return params.length === 0 ? base : base + '?' + params.join('&');
}

export function resumeDocUrl(id: string, marks = true): string {
  const base = '/api/sessions/' + encodeURIComponent(id) + '/resume.doc';
  return marks ? base + '?marks=1' : base;
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
