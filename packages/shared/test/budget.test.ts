import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUDGET,
  budgetSnapshot,
  canProbe,
  closeClaim,
  consumeProbe,
  initBudget,
  openClaims,
  probeableClaims,
  recordAnswer,
} from '../src/budget.ts';

describe('追问预算账本', () => {
  it('初始状态允许追问', () => {
    const s = initBudget(['c1']);
    expect(canProbe(s, 'c1', 'tech')).toEqual({ allowed: true, remainingRounds: 3 });
  });

  it('三条来自不同面试官的追问把轮数用满后，再来问谁都被挡下', () => {
    const speakers = ['tech', 'hr', 'stress'];
    let s = initBudget(['c1']);
    for (let i = 0; i < DEFAULT_BUDGET.maxRoundsPerClaim; i++) {
      const who = speakers[i]!;
      expect(canProbe(s, 'c1', who).allowed).toBe(true);
      s = consumeProbe(s, 'c1', who);
    }
    const gate = canProbe(s, 'c1', 'hiring_manager');
    expect(gate.allowed).toBe(false);
    if (gate.allowed) return;
    expect(gate.reason).toContain('轮数上限');
  });

  it('同一个面试官问满自己的额度就被挡下，理由是额度而不是轮数', () => {
    let s = initBudget(['c1']);
    for (let i = 0; i < DEFAULT_BUDGET.maxProbesPerInterviewerPerClaim; i++) {
      s = consumeProbe(s, 'c1', 'tech');
    }
    const gate = canProbe(s, 'c1', 'tech');
    expect(gate.allowed).toBe(false);
    if (gate.allowed) return;
    expect(gate.reason).toContain('额度');
  });

  it('单个面试官额度用尽后别人仍可提问', () => {
    let s = initBudget(['c1']);
    s = consumeProbe(s, 'c1', 'tech');
    s = consumeProbe(s, 'c1', 'tech');
    expect(canProbe(s, 'c1', 'tech').allowed).toBe(false);
    expect(canProbe(s, 'c1', 'hr').allowed).toBe(true);
  });

  it('全场总次数上限生效', () => {
    let s = initBudget(['c1', 'c2'], { ...DEFAULT_BUDGET, maxTotalProbes: 2 });
    s = consumeProbe(s, 'c1', 'tech');
    s = consumeProbe(s, 'c2', 'hr');
    const gate = canProbe(s, 'c1', 'stress');
    expect(gate.allowed).toBe(false);
    if (gate.allowed) return;
    expect(gate.reason).toContain('全场追问上限');
  });

  it('连续答不上来达阈值即自动关停该主张——这就是死循环在设计上不成立的地方', () => {
    let s = initBudget(['c1']);
    s = recordAnswer(s, 'c1', false);
    expect(canProbe(s, 'c1', 'tech').allowed).toBe(true);
    s = recordAnswer(s, 'c1', false);
    expect(s.claims.c1?.closed).toBe(true);
    expect(canProbe(s, 'c1', 'tech').allowed).toBe(false);
    expect(openClaims(s)).toEqual([]);
  });

  it('答上一次就把「答不上来」的计数清零', () => {
    let s = initBudget(['c1']);
    s = recordAnswer(s, 'c1', false);
    s = recordAnswer(s, 'c1', true);
    s = recordAnswer(s, 'c1', false);
    expect(s.claims.c1?.closed).toBe(false);
  });

  it('状态不可变：入账不会改到旧状态', () => {
    const before = initBudget(['c1']);
    const after = consumeProbe(before, 'c1', 'tech');
    expect(before.totalProbes).toBe(0);
    expect(before.claims.c1?.rounds).toBe(0);
    expect(after.totalProbes).toBe(1);
    expect(after.claims.c1?.rounds).toBe(1);
  });

  it('手动关停后可解释关停原因', () => {
    let s = initBudget(['c1']);
    s = closeClaim(s, 'c1', '该主张缺少任何可核实的数字');
    const gate = canProbe(s, 'c1', 'tech');
    expect(gate.allowed).toBe(false);
    if (gate.allowed) return;
    expect(gate.reason).toBe('该主张缺少任何可核实的数字');
  });

  it('快照带出前端画额度条所需的一切', () => {
    let s = initBudget(['c1', 'c2']);
    s = consumeProbe(s, 'c1', 'tech');
    const snap = budgetSnapshot(s);
    expect(snap.totalProbes).toBe(1);
    expect(snap.maxTotalProbes).toBe(DEFAULT_BUDGET.maxTotalProbes);
    expect(snap.claims).toHaveLength(2);
    expect(snap.claims[0]).toEqual({ claimId: 'c1', rounds: 1, maxRounds: 3, closed: false, closeReason: null });
  });

  it('额度用尽的主张还开着，但已经不值得再摆上桌', () => {
    let s = initBudget(['c1']);
    s = consumeProbe(s, 'c1', 'tech');
    s = consumeProbe(s, 'c1', 'tech');
    // openClaims 只说"没被关停"，额度耗尽它照样算开着——编排器照它开轮会白烧一次模型调用
    expect(openClaims(s)).toEqual(['c1']);
    expect(probeableClaims(s, ['tech'])).toEqual([]);
    // 换个还有额度的面试官，同一主张就又能问
    expect(probeableClaims(s, ['tech', 'hr'])).toEqual(['c1']);
  });

  it('全场总次数用尽后，所有主张都不再可追问', () => {
    let s = initBudget(['c1', 'c2'], { ...DEFAULT_BUDGET, maxTotalProbes: 1 });
    s = consumeProbe(s, 'c1', 'tech');
    expect(openClaims(s)).toEqual(['c1', 'c2']);
    expect(probeableClaims(s, ['tech', 'hr'])).toEqual([]);
  });

  it('连续答不上来被自动关停后，也不再可追问', () => {
    let s = initBudget(['c1']);
    s = recordAnswer(s, 'c1', false);
    s = recordAnswer(s, 'c1', false);
    expect(probeableClaims(s, ['tech'])).toEqual([]);
  });

  it('未知主张直接拒绝', () => {
    const s = initBudget(['c1']);
    const gate = canProbe(s, 'nope', 'tech');
    expect(gate.allowed).toBe(false);
  });
});
