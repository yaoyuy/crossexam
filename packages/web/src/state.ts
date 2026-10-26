/**
 * 把事件流折叠成界面状态。
 *
 * 这里是**纯函数**：给同一串事件，永远得到同一屏画面。
 * 好处有两个：一是直播（SSE）和翻看历史（事件表）走同一条代码路径，
 * 界面不会出现「看着一样、其实两套逻辑」的偏差；二是可以直接对着事件序列做单测。
 */
import { EMPTY_USAGE } from './api.ts';
import type {
  Anchor,
  AnswerOutcome,
  Claim,
  ClaimCategory,
  EventRow,
  LlmStats,
  Probe,
  RejectedClaim,
  RejectedProbe,
  RunEvent,
  RunSummary,
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
};

export type SandboxAction =
  | { type: 'begin'; sessionId: string }
  | { type: 'session'; sessionId: string | null }
  | { type: 'event'; event: RunEvent }
  | { type: 'sse'; name: string; data: unknown }
  | { type: 'telemetry'; stats: LlmStats }
  | { type: 'focus'; anchor: Anchor | null }
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
