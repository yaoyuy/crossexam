import { describe, expect, it } from 'vitest';
import type {
  Anchor,
  AnswerOutcome,
  Claim,
  ClaimCategory,
  EventRow,
  Probe,
  RunEvent,
  RunSummary,
  SuggestOutcome,
  VerdictKind,
  VerdictOutcome,
} from '../src/api.ts';
import {
  allAnchors,
  applyEvent,
  asRunEvent,
  categoryCounts,
  initialSandbox,
  progressOf,
  runEventFromRow,
  sandboxReducer,
  stateFromHistory,
  totalProbes,
  verdictCounts,
} from '../src/state.ts';
import type { SandboxState } from '../src/state.ts';

function anchor(quote: string): Anchor {
  return { start: 0, end: quote.length, quote: quote, exact: true };
}

function claim(id: string, category: ClaimCategory = 'metric'): Claim {
  return { id: id, text: '主张 ' + id, anchor: anchor('原文片段 ' + id), category: category, weight: 0.9 };
}

function probe(id: string, claimId: string, interviewerId: string, round = 1, parentProbeId: string | null = null): Probe {
  return {
    id: id,
    claimId: claimId,
    interviewerId: interviewerId,
    round: round,
    question: '问题 ' + id,
    anchor: anchor('追问引文 ' + id),
    parentProbeId: parentProbeId,
    rationale: '因为 ' + id,
  };
}

function answered(p: Probe, ok = true): AnswerOutcome {
  return {
    answer: { probeId: p.id, text: '回答 ' + p.id, mode: 'simulated', citedAnchors: [] },
    answered: ok,
    droppedCitations: [],
  };
}

function verdictOf(claimId: string, kind: VerdictKind, adjusted = false): VerdictOutcome {
  return {
    verdict: {
      claimId: claimId,
      kind: kind,
      confidence: 0.8,
      rationale: '理由 ' + claimId,
      evidence: [anchor('证据原文')],
      probeIds: ['P1'],
    },
    adjusted: adjusted,
    adjustmentReason: adjusted ? '模型拿不出可定位到简历原文的证据，按「证据缺失」处理' : null,
    droppedEvidence: [],
  };
}

function suggestionOf(claimId: string): SuggestOutcome {
  return {
    claimId: claimId,
    status: 'suggested',
    suggestion: {
      claimId: claimId,
      anchor: anchor('建议锚点'),
      problem: '问题',
      before: '改前',
      after: '改后',
      why: '为什么',
    },
    reason: null,
  };
}

const C1 = claim('C1');
const C2 = claim('C2', 'ownership');
const P1 = probe('P1', 'C1', 'tech', 1);
const P2 = probe('P2', 'C2', 'hr', 1);
const P3 = probe('P3', 'C1', 'tech', 2, 'P1');

const EVENTS: RunEvent[] = [
  { type: 'stage', stage: 'extract', round: null },
  { type: 'claims', claims: [C1, C2], rejected: [{ text: '锚不到的主张', quote: '编造原文', reason: '引用内容在简历原文中找不到（疑似编造）' }] },
  { type: 'stage', stage: 'probe', round: 1 },
  { type: 'probes', round: 1, probes: [P1, P2], rejected: [{ claimId: 'C1', question: '锚不到的提问', reason: '这条提问锚不到简历原文，已拦下' }] },
  { type: 'stage', stage: 'answer', round: 1 },
  { type: 'answers', answers: [answered(P1), answered(P2, false)], errors: [] },
  { type: 'budget', totalProbes: 2, open: ['C1', 'C2'], closed: [] },
  { type: 'stage', stage: 'probe', round: 2 },
  { type: 'probes', round: 2, probes: [P3], rejected: [] },
  { type: 'answers', answers: [answered(P3, false)], errors: [{ probeId: 'P3', message: '作答这一步炸了' }] },
  { type: 'budget', totalProbes: 3, open: ['C2'], closed: ['C1'] },
  { type: 'stage', stage: 'verdict', round: null },
  { type: 'verdicts', verdicts: [verdictOf('C1', 'unanswerable', true), verdictOf('C2', 'overstated')], errors: [{ claimId: 'C2', message: '第二条判定没跑出来' }] },
  { type: 'stage', stage: 'suggest', round: null },
  {
    type: 'suggestions',
    suggestions: [suggestionOf('C1'), { claimId: 'C2', status: 'not-needed', suggestion: null, reason: '判定为「站得住」，不需要改写' }],
    errors: [],
  },
];

function live(events: RunEvent[]): SandboxState {
  let state = sandboxReducer(initialSandbox, { type: 'begin', sessionId: 's1' });
  for (const event of events) state = sandboxReducer(state, { type: 'event', event: event });
  return state;
}

const ROWS: EventRow[] = EVENTS.map((event, index) => ({
  seq: index + 1,
  kind: event.type,
  payload: event as unknown as Record<string, unknown>,
  createdAt: '2026-10-26T00:00:00.000Z',
}));

const SUMMARY: RunSummary = {
  rounds: 2,
  claims: 2,
  probes: 3,
  verdicts: [verdictOf('C1', 'unanswerable').verdict],
  suggestions: 1,
  rejectedClaims: 1,
  notices: ['服务端的权威提示', '第 2 轮没有任何新的追问，质询到此结束'],
  usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, reasoningTokens: 0 },
};

describe('直播折叠', () => {
  it('开跑就进入运行态，主张与追问落在对应的卡片上', () => {
    const state = live(EVENTS);
    expect(state.phase).toBe('running');
    expect(state.sessionId).toBe('s1');
    expect(state.claims.map((c) => c.claim.id)).toEqual(['C1', 'C2']);
    expect(state.claims[0]?.probes.map((p) => p.probe.id)).toEqual(['P1', 'P3']);
    expect(state.claims[1]?.probes.map((p) => p.probe.id)).toEqual(['P2']);
    expect(state.interviewers).toEqual(['tech', 'hr']);
    expect(state.rejectedClaims).toHaveLength(1);
    expect(state.rejectedProbes).toHaveLength(1);
    expect(state.eventCount).toBe(EVENTS.length);
    expect(state.errors.map((e) => e.fatal)).toEqual([false]);
    expect(state.errors[0]?.message).toContain('第二条判定没跑出来');
  });

  it('作答与作答失败分别落在追问上', () => {
    const state = live(EVENTS);
    const first = state.claims[0]?.probes[0];
    expect(first?.answer?.answered).toBe(true);
    expect(first?.answerError).toBeNull();
    const second = state.claims[0]?.probes[1];
    expect(second?.answer?.answered).toBe(false);
    expect(second?.answerError).toBe('作答这一步炸了');
  });

  it('预算事件同时更新计数与主张关停状态', () => {
    const state = live(EVENTS);
    expect(state.budget).toEqual({ totalProbes: 3, open: ['C2'], closed: ['C1'] });
    expect(state.claims[0]?.closed).toBe(true);
    expect(state.claims[1]?.closed).toBe(false);
  });

  it('判定与建议分别落位，站得住的主张没有建议', () => {
    const state = live(EVENTS);
    expect(state.claims[0]?.verdict?.verdict.kind).toBe('unanswerable');
    expect(state.claims[0]?.verdict?.adjusted).toBe(true);
    expect(state.claims[0]?.verdict?.adjustmentReason).toContain('证据缺失');
    expect(state.claims[0]?.suggestion?.suggestion?.after).toBe('改后');
    expect(state.claims[1]?.suggestion?.status).toBe('not-needed');
    expect(state.claims[1]?.suggestion?.suggestion).toBeNull();
  });

  it('一轮没有新追问时自己补一句收尾提示', () => {
    let state = sandboxReducer(initialSandbox, { type: 'event', event: { type: 'claims', claims: [C1], rejected: [] } });
    state = applyEvent(state, { type: 'probes', round: 3, probes: [], rejected: [] });
    expect(state.notices).toEqual(['第 3 轮没有任何新的追问，质询到此结束']);
    expect(state.claims[0]?.probes).toHaveLength(0);
  });

  it('不认识的主张编号与重复的追问编号都被丢弃', () => {
    let state = sandboxReducer(initialSandbox, { type: 'event', event: { type: 'claims', claims: [C1], rejected: [] } });
    state = applyEvent(state, { type: 'probes', round: 1, probes: [P1, probe('P9', 'C9', 'hr'), P1], rejected: [] });
    expect(state.claims[0]?.probes.map((p) => p.probe.id)).toEqual(['P1']);
    expect(state.interviewers).toEqual(['tech']);
  });

  it('致命错误把整场置为失败', () => {
    const state = applyEvent(initialSandbox, { type: 'error', fatal: true, message: '回放模式找不到这一条记录' });
    expect(state.phase).toBe('failed');
    expect(state.errors[0]?.fatal).toBe(true);
  });
});

describe('SSE 收尾', () => {
  it('result 用服务端的权威提示覆盖直播期自己推断的提示', () => {
    let state = live([{ type: 'probes', round: 3, probes: [], rejected: [] }]);
    expect(state.notices).toHaveLength(1);
    state = sandboxReducer(state, { type: 'sse', name: 'result', data: SUMMARY });
    expect(state.phase).toBe('done');
    expect(state.notices).toEqual(SUMMARY.notices);
    expect(state.usage.outputTokens).toBe(20);
    expect(state.summary?.probes).toBe(3);
  });

  it('fatal 把失败原因留给界面展示', () => {
    const state = sandboxReducer(initialSandbox, { type: 'sse', name: 'fatal', data: { fatal: true, message: '卡带缺失' } });
    expect(state.phase).toBe('failed');
    expect(state.errors[0]).toEqual({ message: '卡带缺失', fatal: true });
  });

  it('没有 message 的 fatal 也有兜底文案', () => {
    const state = sandboxReducer(initialSandbox, { type: 'sse', name: 'fatal', data: {} });
    expect(state.errors[0]?.message).toBe('质询中断了');
  });

  it('普通事件按 SSE 事件名兜底识别类型', () => {
    let state = sandboxReducer(initialSandbox, { type: 'event', event: { type: 'claims', claims: [C1], rejected: [] } });
    state = sandboxReducer(state, { type: 'sse', name: 'probes', data: { round: 1, probes: [P1], rejected: [] } });
    expect(state.claims[0]?.probes).toHaveLength(1);
  });

  it('不是对象的数据直接忽略，不会把界面搞脏', () => {
    const state = sandboxReducer(initialSandbox, { type: 'sse', name: 'probes', data: '不是对象' });
    expect(state).toEqual(initialSandbox);
    expect(asRunEvent('probes', null)).toBeNull();
  });
});

describe('翻历史与统计', () => {
  it('事件表重放出来的画面与直播一致，只是阶段与提示由服务端给定', () => {
    const state = live(EVENTS);
    const history = stateFromHistory('s1', ROWS, SUMMARY.notices);
    expect(history.phase).toBe('done');
    expect(history.notices).toEqual(SUMMARY.notices);
    expect(history.claims).toEqual(state.claims);
    expect(history.budget).toEqual(state.budget);
    expect(history.errors).toEqual(state.errors);
    expect(history.interviewers).toEqual(state.interviewers);
    expect(history.rejectedClaims).toEqual(state.rejectedClaims);
    expect(history.eventCount).toBe(state.eventCount);
  });

  it('历史里有致命错误时重放结果是失败', () => {
    const rows: EventRow[] = [
      { seq: 1, kind: 'stage', payload: { type: 'stage', stage: 'extract', round: null }, createdAt: 'x' },
      { seq: 2, kind: 'error', payload: { type: 'error', fatal: true, message: '断在抽取' }, createdAt: 'x' },
    ];
    const history = stateFromHistory('s2', rows, []);
    expect(history.phase).toBe('failed');
    expect(history.errors).toHaveLength(1);
  });

  it('事件行缺了 type 就用 kind 兜底', () => {
    const row: EventRow = { seq: 1, kind: 'budget', payload: { totalProbes: 4, open: [], closed: ['C1'] }, createdAt: 'x' };
    const event = runEventFromRow(row);
    expect(event?.type).toBe('budget');
  });

  it('统计口径：追问数、被追问主张、判定分布、被引用锚点', () => {
    const state = live(EVENTS);
    expect(progressOf(state)).toEqual({ claims: 2, probed: 2, answered: 1, judged: 2, suggestions: 1 });
    expect(totalProbes(state)).toBe(3);
    expect(allAnchors(state)).toHaveLength(5);
    expect(verdictCounts(state)).toEqual([
      { kind: 'overstated', count: 1 },
      { kind: 'unanswerable', count: 1 },
    ]);
    expect(categoryCounts(state.claims)).toEqual([
      { category: 'metric', count: 1 },
      { category: 'ownership', count: 1 },
    ]);
  });

  it('聚焦与重置：点引文只改高亮，重置回到空场', () => {
    let state = sandboxReducer(initialSandbox, { type: 'focus', anchor: C1.anchor });
    expect(state.focus).toEqual(C1.anchor);
    state = sandboxReducer(state, { type: 'telemetry', stats: { calls: 3, replayedCalls: 3, liveCalls: 0, distinctDigests: 3, inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, reasoningTokens: 0 } });
    expect(state.telemetry?.calls).toBe(3);
    expect(sandboxReducer(state, { type: 'reset' })).toEqual(initialSandbox);
  });
});
