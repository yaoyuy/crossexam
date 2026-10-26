/**
 * 把事件流折叠成界面状态。
 *
 * 这里是**纯函数**：给同一串事件，永远得到同一屏画面。
 * 好处有两个：一是直播（SSE）和翻看历史（事件表）走同一条代码路径，
 * 界面不会出现「看着一样、其实两套逻辑」的偏差；二是可以直接对着事件序列做单测。
 */
import { asStreamChunk, EMPTY_USAGE } from './api.ts';
import type {
  Anchor,
  AnswerOutcome,
  Claim,
  ClaimCategory,
  EventRow,
  LlmStats,
  MatchSummary,
  Probe,
  RejectedRequirement,
  Requirement,
  RequirementMatch,
  RejectedClaim,
  RejectedProbe,
  RunEvent,
  RunSummary,
  StreamChunk,
  SuggestOutcome,
  Usage,
  VerdictKind,
  VerdictOutcome,
} from './api.ts';

export interface ProbeView {
  probe: Probe;
  answer: AnswerOutcome | null;
  answerError: string | null;
}

export interface ClaimView {
  claim: Claim;
  probes: ProbeView[];
  verdict: VerdictOutcome | null;
  suggestion: SuggestOutcome | null;
  /** 追问预算把这条主张关停了 */
  closed: boolean;
}

export interface StageMark {
  stage: string;
  round: number | null;
}

export type Phase = 'idle' | 'running' | 'done' | 'failed';

/** 一路调用已经收到的分片。这是观感数据：服务端不落库，翻历史时自然没有。 */
export interface StreamBuffer {
  channel: string;
  stage: string;
  /** 模型「想」的部分（只有思考模型会给），与正文分开存，界面上也分开显示 */
  reasoning: string;
  /** 模型「说」的部分 */
  text: string;
}

/** 单个 channel 最多留这么多字符；超出只留尾巴，界面本来就是看最新的一段 */
export const STREAM_CAP = 1200;

export interface SandboxState {
  phase: Phase;
  sessionId: string | null;
  stages: StageMark[];
  activeStage: string | null;
  activeRound: number | null;
  claims: ClaimView[];
  rejectedClaims: RejectedClaim[];
  rejectedProbes: RejectedProbe[];
  /** 追问过程中出现的错误；fatal 表示整场跑不下去 */
  errors: { message: string; fatal: boolean }[];
  notices: string[];
  budget: { totalProbes: number; open: string[]; closed: string[] } | null;
  summary: RunSummary | null;
  /** 最终用量（服务端 result 给的那份） */
  usage: Usage;
  /** 过程中轮询 /api/stats 得到的实时用量，比 result 早一步可看 */
  telemetry: LlmStats | null;
  eventCount: number;
  /** 本次上场的面试官，从追问事件里学到 */
  interviewers: string[];
  /** 点在引文上时高亮简历原文的哪一段 */
  focus: Anchor | null;
  /** 点在一条岗位要求上时，高亮它所属的那份 JD 原文的哪一段 */
  jdFocus: Anchor | null;
  /** 这场沙盘照着哪几份 JD 抽出、合并出来的要求清单；没有 JD 时为空 */
  requirements: Requirement[];
  /** 每条要求与主张的对照结果 */
  requirementMatches: RequirementMatch[];
  /** 锚不到 JD 原文、被丢掉的要求 */
  requirementRejected: RejectedRequirement[];
  /** 对照摘要；还没跑到 JD 阶段时为 null */
  requirementSummary: MatchSummary | null;
  /**
   * 正在流动的模型输出，按 channel 归位（extract / probe:tech / answer:P1 / verdict:C1 / suggest:C1）。
   * 刻意与事件流分开：分片是过程观感，事件日志才是可回放的真相。
   */
  streams: Record<string, StreamBuffer>;
}

export const initialSandbox: SandboxState = {
  phase: 'idle',
  sessionId: null,
  stages: [],
  activeStage: null,
  activeRound: null,
  claims: [],
  rejectedClaims: [],
  rejectedProbes: [],
  errors: [],
  notices: [],
  budget: null,
  summary: null,
  usage: EMPTY_USAGE,
  telemetry: null,
  eventCount: 0,
  interviewers: [],
  focus: null,
  jdFocus: null,
  requirements: [],
  requirementMatches: [],
  requirementRejected: [],
  requirementSummary: null,
  streams: {},
};

export type SandboxAction =
  | { type: 'begin'; sessionId: string }
  | { type: 'session'; sessionId: string | null }
  | { type: 'event'; event: RunEvent }
  | { type: 'sse'; name: string; data: unknown }
  | { type: 'telemetry'; stats: LlmStats }
  | { type: 'focus'; anchor: Anchor | null }
  | { type: 'focus-jd'; anchor: Anchor | null }
  | { type: 'load'; state: SandboxState }
  | { type: 'reset' };

function stripAnchor(anchor: Anchor): Anchor {
  return { start: anchor.start, end: anchor.end, quote: anchor.quote, exact: anchor.exact };
}

function toClaimView(claim: Claim): ClaimView {
  return { claim: { ...claim, anchor: stripAnchor(claim.anchor) }, probes: [], verdict: null, suggestion: null, closed: false };
}

/** 服务端推的事件里 type 一定在 data 上；为稳妥起见缺了就退回 SSE 事件名 */
export function asRunEvent(name: string, data: unknown): RunEvent | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const type = typeof record['type'] === 'string' ? (record['type'] as string) : name;
  return { ...record, type } as unknown as RunEvent;
}

/** 事件表里存的就是事件本身（带 type），缺了就用 kind 兜底 */
export function runEventFromRow(row: EventRow): RunEvent | null {
  return asRunEvent(row.kind, row.payload);
}

/** 只保留结尾的 max 个字符：界面看的就是最新那段，thinking 想太久也不该把内存撑大。 */
function capTail(text: string): string {
  return text.length > STREAM_CAP ? '…' + text.slice(text.length - STREAM_CAP) : text;
}

/**
 * 把一片流式输出并进它所属的 channel。
 * 思考与正文分别累加：思考模型两边都会给，混进一个字符串就再也分不开了。
 */
export function applyStreamChunk(state: SandboxState, chunk: StreamChunk): SandboxState {
  const previous = state.streams[chunk.channel];
  const held: StreamBuffer = previous ?? {
    channel: chunk.channel,
    stage: chunk.stage,
    reasoning: '',
    text: '',
  };
  const next: StreamBuffer =
    chunk.kind === 'reasoning'
      ? {
          channel: chunk.channel,
          stage: chunk.stage,
          reasoning: capTail(held.reasoning + chunk.text),
          text: held.text,
        }
      : {
          channel: chunk.channel,
          stage: chunk.stage,
          reasoning: held.reasoning,
          text: capTail(held.text + chunk.text),
        };
  return { ...state, streams: { ...state.streams, [chunk.channel]: next } };
}

/**
 * 某个 channel 正在写的文本。**只在 running 时给值**：
 * 跑完以后留在屏幕上的应该是结论，而不是半截草稿。
 */
export function streamText(state: SandboxState, channel: string): string | null {
  if (state.phase !== 'running') return null;
  const buffer = state.streams[channel];
  return buffer === undefined || buffer.text.length === 0 ? null : buffer.text;
}

/**
 * 某个 channel 正在「想」的内容。与 streamText 一样只在 running 时给值：
 * 跑完以后留在屏幕上的应该是结论，而不是草稿。
 */
export function thoughtText(state: SandboxState, channel: string): string | null {
  if (state.phase !== 'running') return null;
  const buffer = state.streams[channel];
  return buffer === undefined || buffer.reasoning.length === 0 ? null : buffer.reasoning;
}

/**
 * 当前阶段正在写的那几路输出，给过程面板用来做「实况」一栏。
 * 按加入顺序取最后 limit 个再倒过来（最新的一路排最前），并发时顺序由分片到达决定。
 */
/**
 * 给界面用的实况文本：把正在写的 JSON 还原成人话，还没写到人话字段就返回 null。
 * ClaimBoard 与过程面板都用它，免得两边各自判断一遍。
 */
export function liveText(state: SandboxState, channel: string): string | null {
  const raw = streamText(state, channel);
  if (raw === null) return null;
  const text = readableStreamText(raw);
  return text === '' ? null : text;
}

export function liveChannels(state: SandboxState, limit = 4): StreamBuffer[] {
  if (state.phase !== 'running' || state.activeStage === null) return [];
  const stage = state.activeStage;
  const channels = Object.keys(state.streams).filter(
    (channel) => channel === stage || channel.startsWith(stage + ':'),
  );
  return channels
    .slice(Math.max(0, channels.length - limit))
    .reverse()
    .map((channel) => state.streams[channel] as StreamBuffer);
}

/** 只保留结尾的 max 个字符，用于实况栏那种窄格子 */
export function tailText(text: string, max: number): string {
  return text.length <= max ? text : '…' + text.slice(text.length - max);
}

// 五个阶段吐出来的都是 JSON，直接把原始分片铺在屏幕上等于让用户看日志。
// 这里做一次**纯展示**的提取：从还没写完的 JSON 里把第一句人话字段捞出来。
// 它不解析 JSON（分片是半截的，parse 必然失败），只是顺着字符串字面量读下去，
// 所以恰好能显示「正在写」——写一半也读得出来。
const READABLE_KEYS = ['text', 'question', 'rationale', 'after', 'why', 'problem'] as const;

const UNESCAPE: Record<string, string> = {
  n: String.fromCharCode(10),
  t: String.fromCharCode(9),
  r: '',
  '"': '"',
  '\\': '\\',
  '/': '/',
};

/**
 * 把流式分片里正在写的那句人话取出来；取不到（还没写到、或根本不是在写 JSON）就返回空串。
 * 空串的含义是「这会儿还没有能给人看的内容」，界面据此决定要不要显示实况行。
 */
export function readableStreamText(raw: string): string {
  const text = raw.startsWith('…') ? raw.slice(1) : raw;
  if (!text.startsWith('{') && !text.startsWith('[')) return text;
  for (const key of READABLE_KEYS) {
    const marker = '"' + key + '":"';
    const at = text.indexOf(marker);
    if (at < 0) continue;
    let out = '';
    let index = at + marker.length;
    while (index < text.length) {
      const char = text[index] as string;
      if (char === '\\') {
        const next = text[index + 1];
        if (next === undefined) break;
        out += UNESCAPE[next] ?? next;
        index += 2;
        continue;
      }
      if (char === '"') break;
      out += char;
      index += 1;
    }
    return out.trim();
  }
  return '';
}

function addProbe(state: SandboxState, probe: Probe): SandboxState {
  if (state.claims.every((item) => item.claim.id !== probe.claimId)) return state;
  const duplicate = state.claims.some((item) => item.probes.some((p) => p.probe.id === probe.id));
  if (duplicate) return state;
  const interviewers = state.interviewers.includes(probe.interviewerId)
    ? state.interviewers
    : [...state.interviewers, probe.interviewerId];
  const claims = state.claims.map((item) =>
    item.claim.id === probe.claimId
      ? { ...item, probes: [...item.probes, { probe: { ...probe, anchor: stripAnchor(probe.anchor) }, answer: null, answerError: null }] }
      : item,
  );
  return { ...state, claims, interviewers };
}

function mapClaim(state: SandboxState, claimId: string, fn: (item: ClaimView) => ClaimView): SandboxState {
  return { ...state, claims: state.claims.map((item) => (item.claim.id === claimId ? fn(item) : item)) };
}

export function applyEvent(state: SandboxState, event: RunEvent): SandboxState {
  const base: SandboxState = { ...state, eventCount: state.eventCount + 1 };

  switch (event.type) {
    case 'stage': {
      return {
        ...base,
        activeStage: event.stage,
        activeRound: event.round,
        stages: [...state.stages, { stage: event.stage, round: event.round }],
      };
    }
    case 'claims': {
      return { ...base, claims: event.claims.map(toClaimView), rejectedClaims: event.rejected };
    }
    case 'probes': {
      let next: SandboxState = { ...base, rejectedProbes: [...state.rejectedProbes, ...event.rejected] };
      for (const probe of event.probes) next = addProbe(next, probe);
      if (event.probes.length === 0) {
        next = { ...next, notices: [...next.notices, '第 ' + String(event.round) + ' 轮没有任何新的追问，质询到此结束'] };
      }
      return next;
    }
    case 'answers': {
      let next = base;
      for (const outcome of event.answers) {
        const probeId = outcome.answer.probeId;
        next = {
          ...next,
          claims: next.claims.map((item) => ({
            ...item,
            probes: item.probes.map((pv) =>
              pv.probe.id === probeId ? { ...pv, answer: outcome, answerError: null } : pv,
            ),
          })),
        };
      }
      for (const error of event.errors) {
        next = {
          ...next,
          claims: next.claims.map((item) => ({
            ...item,
            probes: item.probes.map((pv) =>
              pv.probe.id === error.probeId ? { ...pv, answerError: error.message } : pv,
            ),
          })),
        };
      }
      return next;
    }
    case 'budget': {
      const closed = new Set(event.closed);
      return {
        ...base,
        budget: { totalProbes: event.totalProbes, open: event.open, closed: event.closed },
        claims: state.claims.map((item) => ({ ...item, closed: closed.has(item.claim.id) })),
      };
    }
    case 'verdicts': {
      let next = base;
      for (const outcome of event.verdicts) {
        next = mapClaim(next, outcome.verdict.claimId, (item) => ({
          ...item,
          verdict: {
            ...outcome,
            verdict: {
              ...outcome.verdict,
              evidence: outcome.verdict.evidence.map(stripAnchor),
            },
          },
        }));
      }
      for (const error of event.errors) {
        next = { ...next, errors: [...next.errors, { message: '主张 ' + error.claimId + ' 没能给出判定：' + error.message, fatal: false }] };
      }
      return next;
    }
    case 'requirements': {
      // 要求清单整批替换：它是这一场的输入派生出来的表，不存在「追加」语义
      return {
        ...base,
        requirements: event.requirements,
        requirementMatches: event.matches,
        requirementRejected: event.rejected,
        requirementSummary: event.summary,
      };
    }
    case 'suggestions': {
      let next = base;
      for (const outcome of event.suggestions) {
        next = mapClaim(next, outcome.claimId, (item) => ({
          ...item,
          suggestion: {
            ...outcome,
            suggestion:
              outcome.suggestion === null
                ? null
                : { ...outcome.suggestion, anchor: stripAnchor(outcome.suggestion.anchor) },
          },
        }));
      }
      for (const error of event.errors) {
        next = { ...next, errors: [...next.errors, { message: '主张 ' + error.claimId + ' 的改写建议没生成：' + error.message, fatal: false }] };
      }
      return next;
    }
    case 'error': {
      return {
        ...base,
        errors: [...state.errors, { message: event.message, fatal: event.fatal }],
        phase: event.fatal ? 'failed' : state.phase,
      };
    }
    default: {
      return base;
    }
  }
}

export function sandboxReducer(state: SandboxState, action: SandboxAction): SandboxState {
  switch (action.type) {
    case 'reset':
      return initialSandbox;
    case 'load':
      return action.state;
    case 'begin':
      return { ...initialSandbox, phase: 'running', sessionId: action.sessionId };
    case 'session':
      return { ...state, sessionId: action.sessionId };
    case 'event':
      return applyEvent(state, action.event);
    case 'sse': {
      if (action.name === 'stream') {
        const chunk = asStreamChunk(action.data);
        return chunk === null ? state : applyStreamChunk(state, chunk);
      }
      if (action.name === 'result') {
        const summary = action.data as RunSummary;
        return {
          ...state,
          phase: 'done',
          summary,
          usage: summary.usage,
          // 直播时界面自己推断的提示语到这里换成服务端的权威版本
          notices: summary.notices,
        };
      }
      if (action.name === 'fatal') {
        const detail = action.data as { message?: unknown };
        const message = typeof detail.message === 'string' ? detail.message : '质询中断了';
        return { ...state, phase: 'failed', errors: [...state.errors, { message, fatal: true }] };
      }
      const event = asRunEvent(action.name, action.data);
      return event === null ? state : applyEvent(state, event);
    }
    case 'telemetry':
      return { ...state, telemetry: action.stats };
    case 'focus':
      return { ...state, focus: action.anchor };
    case 'focus-jd':
      return { ...state, jdFocus: action.anchor };
    default:
      return state;
  }
}

/** 翻看一场已经跑完的会话：把事件表按同样的折叠方式重放一遍 */
export function stateFromHistory(sessionId: string, rows: EventRow[], notices: string[]): SandboxState {
  let state: SandboxState = { ...initialSandbox, sessionId, phase: 'running' };
  for (const row of rows) {
    const event = runEventFromRow(row);
    if (event !== null) state = applyEvent(state, event);
  }
  return { ...state, phase: state.errors.some((e) => e.fatal) ? 'failed' : 'done', notices };
}

export interface Progress {
  claims: number;
  probed: number;
  answered: number;
  judged: number;
  suggestions: number;
}

export function progressOf(state: SandboxState): Progress {
  let probed = 0;
  let answered = 0;
  let judged = 0;
  let suggestions = 0;
  for (const item of state.claims) {
    if (item.probes.length > 0) probed += 1;
    if (item.probes.some((pv) => pv.answer !== null && pv.answer.answered)) answered += 1;
    if (item.verdict !== null) judged += 1;
    if (item.suggestion !== null && item.suggestion.suggestion !== null) suggestions += 1;
  }
  return { claims: state.claims.length, probed, answered, judged, suggestions };
}

export function verdictCounts(state: SandboxState): { kind: VerdictKind; count: number }[] {
  const order: VerdictKind[] = ['solid', 'overstated', 'unsupported', 'contradicts', 'unanswerable'];
  const tally = new Map<VerdictKind, number>();
  for (const item of state.claims) {
    if (item.verdict === null) continue;
    const kind = item.verdict.verdict.kind;
    tally.set(kind, (tally.get(kind) ?? 0) + 1);
  }
  return order.filter((kind) => tally.has(kind)).map((kind) => ({ kind, count: tally.get(kind) ?? 0 }));
}

export function totalProbes(state: SandboxState): number {
  return state.claims.reduce((sum, item) => sum + item.probes.length, 0);
}

export interface CategoryTally {
  category: ClaimCategory;
  count: number;
}

export function categoryCounts(claims: ClaimView[]): CategoryTally[] {
  const tally = new Map<ClaimCategory, number>();
  for (const item of claims) {
    tally.set(item.claim.category, (tally.get(item.claim.category) ?? 0) + 1);
  }
  return [...tally.entries()].map(([category, count]) => ({ category, count }));
}

/** 全部锚点：用于在简历原文上画「被追问过的位置」 */
export function allAnchors(state: SandboxState): Anchor[] {
  const anchors: Anchor[] = [];
  for (const item of state.claims) {
    anchors.push(item.claim.anchor);
    for (const pv of item.probes) anchors.push(pv.probe.anchor);
  }
  return anchors;
}

/** 一条要求的对照结果；还没对照过时为 null */
export function requirementMatch(state: SandboxState, requirementId: string): RequirementMatch | null {
  for (const match of state.requirementMatches) if (match.requirementId === requirementId) return match;
  return null;
}

/** 这条主张被哪几条岗位要求对上了（只有 hit / weak 会有对应主张） */
export function requirementsForClaim(state: SandboxState, claimId: string): Requirement[] {
  const ids = new Set<string>();
  for (const match of state.requirementMatches) {
    if (match.claimId === claimId && match.status !== 'missing') ids.add(match.requirementId);
  }
  return state.requirements.filter((requirement) => ids.has(requirement.id));
}

/** 某份 JD 上被抽成要求的位置：在 JD 原文里画出「这句话被拿去问过」 */
export function anchorsOfJd(state: SandboxState, jdId: string): Anchor[] {
  return state.requirements.filter((requirement) => requirement.jdId === jdId).map((requirement) => requirement.anchor);
}

/** 对照摘要的人话：还没跑 JD 阶段时说清「这场没有岗位要求」 */
export function matchConclusionOf(summary: MatchSummary | null, jdCount: number): string {
  if (jdCount === 0) return '这场没有上传岗位要求，面试官按各自的经验追问。';
  if (summary === null || summary.total === 0) return '岗位要求还没抽出对照结果。';
  return (
    '岗位要求共 ' + String(summary.total) + ' 条：简历答得上 ' + String(summary.hit) + ' 条、答得含糊 ' +
    String(summary.weak) + ' 条、没写 ' + String(summary.missing) + ' 条。'
  );
}
