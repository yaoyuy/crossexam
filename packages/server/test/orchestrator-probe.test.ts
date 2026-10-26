/**
 * 一轮并发追问的测试。
 *
 * 用内存里的预算账本 + 脚本化模型，把三道闸门逐个测穿：
 * 预算不够时被拒、引文锚不上时被拦、重复提问被合并。
 * 还要测两个容易被忽略的边界：单个面试官失败不能让整轮崩掉，
 * 但卡带缺失必须让整轮崩掉（否则会静默产出一场"没有追问"的空演示）。
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGET, buildContracts, initBudget, segmentResume } from '@crossexam/shared';
import type { BudgetConfig, Claim, IntentContract, Probe } from '@crossexam/shared';
import { MAX_PROBES_PER_TURN, runProbeRound } from '../src/orchestrator/probe.ts';
import { LlmError } from '../src/llm/types.ts';
import { createScriptedClient } from './scripted.ts';

const RESUME = [
  '项目经历',
  '主导重构订单系统，首屏从 2.4s 降到 0.8s，日订单量 30 万。',
  '熟悉 TypeScript 与 Node.js。',
].join(String.fromCharCode(10));

const OUTLINE = segmentResume(RESUME);

function claim(id: string, quote: string, text: string): Claim {
  return {
    id, text, category: 'metric', weight: 0.8,
    anchor: { quote, start: RESUME.indexOf(quote), end: RESUME.indexOf(quote) + quote.length, exact: true },
  };
}

const CLAIMS: Claim[] = [
  claim('C1', '首屏从 2.4s 降到 0.8s', '订单系统性能优化'),
  claim('C2', '熟悉 TypeScript 与 Node.js', '熟悉 TypeScript'),
];

const BUDGET_VIEW = { maxRoundsPerClaim: 3, maxProbesPerInterviewerPerClaim: 2, maxTotalProbes: 60 };

function panel(roles: string[]): IntentContract[] {
  return buildContracts(roles as never, BUDGET_VIEW);
}

const TECH_Q = JSON.stringify({
  probes: [{ claimId: 'C1', question: '这个 2.4s 是怎么测出来的？', quote: '首屏从 2.4s 降到 0.8s', rationale: '数字必须能说出口径。' }],
});
const HR_Q = JSON.stringify({
  probes: [{ claimId: 'C2', question: 'Node.js 你用到什么程度？', quote: '熟悉 TypeScript 与 Node.js', rationale: '核实"熟悉"的边界。' }],
});

function handlerWith(byInterviewer: Record<string, string>, failIds: string[] = []) {
  return (req: { purpose: string; system: string }) => {
    for (const id of failIds) {
      if (req.system.indexOf(PERSONA_MARK[id] ?? id) >= 0) return new Error('模拟网络抖动');
    }
    for (const id of Object.keys(byInterviewer)) {
      if (req.system.indexOf(PERSONA_MARK[id] ?? id) >= 0) return byInterviewer[id]!;
    }
    return new Error('没有为该面试官准备返回值：' + req.system.slice(0, 40));
  };
}

const PERSONA_MARK: Record<string, string> = {
  tech: '技术面试官',
  hr: 'HR 面试官',
  hiring_manager: '业务主管',
  stress: '压力面试官',
  domain_expert: '领域专家',
};

function baseInput(over: Partial<Parameters<typeof runProbeRound>[0]> = {}) {
  const client = createScriptedClient(handlerWith({ tech: TECH_Q, hr: HR_Q }));
  return {
    client,
    contracts: panel(['tech', 'hr']),
    claims: CLAIMS,
    resumeText: RESUME,
    outline: OUTLINE,
    budget: initBudget(CLAIMS.map((c) => c.id), DEFAULT_BUDGET),
    round: 1,
    history: [] as Probe[],
    ...over,
  };
}

describe('一轮追问', function () {
  it('两个面试官各问一条，编号连续且账本被记账', async function () {
    const input = baseInput();
    const result = await runProbeRound(input);
    expect(result.probes.map((p) => p.id)).toEqual(['P1', 'P2']);
    expect(result.probes.map((p) => p.interviewerId)).toEqual(['tech', 'hr']);
    expect(result.probes[0]?.round).toBe(1);
    expect(result.probes[0]?.parentProbeId).toBeNull();
    expect(result.probes[0]?.anchor.quote).toBe('首屏从 2.4s 降到 0.8s');
    expect(result.budget.totalProbes).toBe(2);
    expect(result.outcomes.map((o) => o.asked)).toEqual([1, 1]);
    expect(result.outcomes.every((o) => o.error === null)).toBe(true);
  });

  it('引文锚不上时被拦下，且不消耗预算', async function () {
    const client = createScriptedClient(handlerWith({
      tech: JSON.stringify({ probes: [{ claimId: 'C1', question: '你重构前的架构是什么？', quote: '微服务架构与领域驱动设计', rationale: '想当然地假设了简历没写的东西。' }] }),
      hr: HR_Q,
    }));
    const result = await runProbeRound(baseInput({ client }));
    expect(result.probes).toHaveLength(1);
    expect(result.probes[0]?.interviewerId).toBe('hr');
    expect(result.rejected[0]?.reason).toContain('锚定失败');
    expect(result.budget.totalProbes).toBe(1);
  });

  it('预算用尽时闸门直接拒绝，模型自己看不见也没用', async function () {
    const zero: BudgetConfig = { maxRoundsPerClaim: 3, maxProbesPerInterviewerPerClaim: 2, maxTotalProbes: 0 };
    const result = await runProbeRound(baseInput({ budget: initBudget(CLAIMS.map((c) => c.id), zero) }));
    expect(result.probes).toHaveLength(0);
    expect(result.rejected.length).toBeGreaterThan(0);
    expect(result.rejected[0]?.reason).toContain('预算闸门拦截');
  });

  it('跨面试官重复提问被合并，不消耗两次预算', async function () {
    const same = JSON.stringify({ probes: [{ claimId: 'C1', question: '这个 2.4s 是怎么测出来的？', quote: '首屏从 2.4s 降到 0.8s', rationale: '同一个点。' }] });
    const client = createScriptedClient(handlerWith({ tech: same, hr: same }));
    const result = await runProbeRound(baseInput({ client }));
    expect(result.probes).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('重复');
  });

  it('引用不存在的主张编号会被丢弃', async function () {
    const client = createScriptedClient(handlerWith({
      tech: JSON.stringify({ probes: [{ claimId: 'C99', question: '这是哪段经历？', quote: '熟悉 TypeScript 与 Node.js', rationale: '编号编错了。' }] }),
      hr: HR_Q,
    }));
    const result = await runProbeRound(baseInput({ client }));
    expect(result.rejected.some((r) => r.reason.indexOf('不存在') >= 0)).toBe(true);
  });

  it('单个面试官调用失败时其他面试官照常发问，失败被单独记录', async function () {
    const input = baseInput({ client: createScriptedClient(handlerWith({ tech: TECH_Q, hr: HR_Q }, ['tech'])) });
    const result = await runProbeRound(input);
    expect(result.probes).toHaveLength(1);
    expect(result.probes[0]?.interviewerId).toBe('hr');
    const tech = result.outcomes.find((o) => o.interviewerId === 'tech');
    expect(tech?.error).toContain('模拟网络抖动');
    expect(tech?.asked).toBe(0);
  });

  it('卡带缺失必须整轮抛出，不能静默变成一场没有追问的演示', async function () {
    const client = createScriptedClient(() => new LlmError('cassette-missing', '找不到卡带'));
    let caught: unknown;
    try {
      await runProbeRound(baseInput({ client }));
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof LlmError).toBe(true);
  });

  it('第二轮追问会挂到同一位面试官同一主张的上一条下面，形成追问链', async function () {
    const first = await runProbeRound(baseInput());
    const round2 = JSON.stringify({
      probes: [
        { claimId: 'C1', question: '那 0.8s 又是怎么复测的？', quote: '首屏从 2.4s 降到 0.8s', rationale: '继续追口径。' },
        { claimId: 'C2', question: 'TypeScript 的类型体操你写过吗？', quote: '熟悉 TypeScript 与 Node.js', rationale: '追深度。' },
      ],
    });
    const second = await runProbeRound(baseInput({
      round: 2,
      budget: first.budget,
      history: first.probes,
      client: createScriptedClient(handlerWith({ tech: round2, hr: round2 })),
    }));
    expect(second.probes).toHaveLength(2);
    expect(second.probes[0]?.parentProbeId).toBe('P1');
    expect(second.probes[0]?.round).toBe(2);
    expect(second.budget.totalProbes).toBe(4);
  });

  it('已关停的主张不再摆上桌', async function () {
    const budget = { ...initBudget(CLAIMS.map((c) => c.id), DEFAULT_BUDGET) };
    budget.claims['C1'] = { ...budget.claims['C1']!, closed: true, closeReason: '已连续 2 次答不上来' };
    const seen: string[] = [];
    const client = createScriptedClient((req) => {
      seen.push(req.messages[0]!.content);
      return HR_Q;
    });
    await runProbeRound(baseInput({ client, budget }));
    expect(seen.length).toBeGreaterThan(0);
    // 简历原文当然还是整份都给，被摘掉的是"可追问主张清单"里的 C1
    const claimBlock = seen[0]!.split('## 你此前问过的问题')[0]!;
    expect(claimBlock).not.toContain('[C1]');
    expect(claimBlock).toContain('[C2]');
  });

  it('一位面试官一轮最多问几条有上限', function () {
    expect(MAX_PROBES_PER_TURN).toBe(2);
  });
});
