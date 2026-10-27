/**
 * 完整沙盘的端到端测试。
 *
 * 全部用脚本化模型跑，所以这条测试本身就是"离线演示"的骨架：
 * 它证明 report 里的每一条结论（哪条站得住、哪条答不上来、建议怎么改）
 * 都是这条流水线真的走出来的，而不是摆拍。
 *
 * 同时把三根保险丝逐个测到位：预算关停、轮次上限、没有新追问就停。
 */

import { describe, expect, it } from 'vitest';
import type { BudgetConfig, InterviewerRole } from '@crossexam/shared';
import type { LlmRequest } from '../src/llm/types.ts';
import { LlmError } from '../src/llm/types.ts';
import { runSession } from '../src/orchestrator/run.ts';
import type { RunEvent } from '../src/orchestrator/run.ts';
import { createScriptedClient } from './scripted.ts';
import type { ScriptedHandler } from './scripted.ts';

const NL = String.fromCharCode(10);

const RESUME = [
  '项目经历',
  '主导重构订单系统，首屏从 2.4s 降到 0.8s，日订单量 30 万。',
  '熟悉 TypeScript 与 Node.js。',
].join(NL);

const CLAIMS_JSON = JSON.stringify({
  claims: [
    { text: '订单系统性能优化', quote: '首屏从 2.4s 降到 0.8s', category: 'metric', weight: 0.9 },
    { text: 'TypeScript 熟练度', quote: '熟悉 TypeScript 与 Node.js', category: 'skill', weight: 0.6 },
  ],
});

const TECH_QUESTIONS = ['这个 2.4s 是怎么测出来的？', '测试设备和网络条件是什么？'];
const HR_QUESTIONS = ['Node.js 你用到什么程度？'];

const PERSONA_MARK: Record<string, string> = {
  tech: '技术面试官',
  hr: 'HR 面试官',
  hiring_manager: '业务主管',
};

function bodyOf(req: LlmRequest): string {
  return req.system + NL + req.messages.map((m) => m.content).join(NL);
}

/** 挑一个"上下文里还没出现过"的问题，用来模拟逐轮追问 */
function pickFresh(questions: readonly string[], body: string): string {
  for (const q of questions) if (body.indexOf(q) < 0) return q;
  return questions[questions.length - 1] ?? '';
}

interface RouterOptions {
  /** 作答是否老实（false = 一律答不上来，用来测"连续答不上来就关停"） */
  candid?: boolean;
  /** 判定模板，默认 overstated */
  verdictKind?: string;
  /** 建议模板 */
  suggestion?: { after: string };
  failProbe?: boolean;
}

function router(opts: RouterOptions = {}): ScriptedHandler {
  const verdictKind = opts.verdictKind ?? 'overstated';
  return (req) => {
    const body = bodyOf(req);
    if (req.purpose === 'extract') return CLAIMS_JSON;

    if (req.purpose === 'probe') {
      if (opts.failProbe) return new LlmError('cassette-missing', '没有找到该提示词的卡带');
      if (req.system.indexOf(PERSONA_MARK['tech'] ?? '') >= 0) {
        const q = pickFresh(TECH_QUESTIONS, body);
        return JSON.stringify({
          probes: [{ claimId: 'C1', question: q, quote: '首屏从 2.4s 降到 0.8s', rationale: '数字要能说口径' }],
        });
      }
      const q = pickFresh(HR_QUESTIONS, body);
      return JSON.stringify({
        probes: [{ claimId: 'C2', question: q, quote: '熟悉 TypeScript 与 Node.js', rationale: '核实熟悉的边界' }],
      });
    }

    if (req.purpose === 'answer') {
      const tech = TECH_QUESTIONS.some((q) => body.indexOf(q) >= 0);
      if (tech && opts.candid !== false) {
        return JSON.stringify({
          answered: true,
          text: '用 Lighthouse 在 Moto G4 上测的，取三次中位数。',
          citedQuotes: ['首屏从 2.4s 降到 0.8s'],
        });
      }
      return JSON.stringify({ answered: false, text: '简历里没有写这一条的具体情况。', citedQuotes: [] });
    }

    if (req.purpose === 'verdict') {
      // C2（TypeScript 那条）故意让模型判「站得住」并给出能定位的证据：这一条整场
      // 都没答上来，正好用来测「原文这一句在面试现场没撑住」的降级。
      if (body.indexOf('TypeScript 熟练度') >= 0) {
        return JSON.stringify({ kind: 'solid', confidence: 0.7, rationale: '模型给的理由', evidenceQuotes: ['熟悉 TypeScript 与 Node.js'] });
      }
      return JSON.stringify({ kind: verdictKind, confidence: 0.7, rationale: '模型给的理由', evidenceQuotes: ['首屏从 2.4s 降到 0.8s'] });
    }

    if (req.purpose === 'suggest') {
      return JSON.stringify({
        claimId: body.indexOf('TypeScript 熟练度') >= 0 ? 'C2' : 'C1',
        problem: '只说主导，没说清范围',
        before: body.indexOf('TypeScript 熟练度') >= 0 ? '熟悉 TypeScript 与 Node.js' : '主导重构订单系统',
        after: opts.suggestion?.after ?? '参与重构订单系统，并负责首屏性能优化',
        why: '面试官会追问你到底主导了什么',
      });
    }

    // 反问环节：跑完沙盘轮到求职者提问。这里返回一条锚在简历原话上的反问，
    // 让测试也走一遍「反问必须带依据」这条路。
    if (req.purpose === 'counter') {
      return JSON.stringify({
        counters: [
          {
            text: '团队平时怎么排迭代？上线前会留多少缓冲？',
            kind: 'process',
            reason: '简历上写了三个项目都按期上线，排期方式值得问清楚。',
            reply: '两周一个迭代，上线前留两天缓冲。',
            quote: '首屏从 2.4s 降到 0.8s',
            sourceId: 'C1',
          },
        ],
      });
    }

    return new Error('脚本化模型没有为 purpose=' + req.purpose + ' 准备返回值');
  };
}

function baseInput(over: Partial<Parameters<typeof runSession>[0]> = {}) {
  const client = createScriptedClient(router());
  const oneRound: BudgetConfig = {
    maxRoundsPerClaim: 1,
    maxProbesPerInterviewerPerClaim: 2,
    maxTotalProbes: 60,
    maxConsecutiveUnanswerable: 2,
  };
  return {
    client,
    resumeText: RESUME,
    jdText: '招聘资深前端，要求性能优化经验。',
    panel: ['tech', 'hr'] as readonly InterviewerRole[],
    budgetConfig: oneRound,
    ...over,
  };
}

describe('完整沙盘', function () {
  it('一条流水线跑到底：抽取、追问、作答、判定、建议', async function () {
    const events: RunEvent[] = [];
    const result = await runSession(baseInput({ onEvent: (e) => { events.push(e); } }));

    expect(result.claims.map((c) => c.id)).toEqual(['C1', 'C2']);
    expect(result.probes.map((p) => p.id)).toEqual(['P1', 'P2']);
    expect(result.rounds).toBe(1);
    expect(result.budget.totalProbes).toBe(2);

    const byClaim = new Map(result.verdicts.map((v) => [v.claimId, v]));
    expect(byClaim.get('C1')?.kind).toBe('overstated');
    // C2 整场没答上来：即使模型判「站得住」，也会被降级成证据缺失
    expect(byClaim.get('C2')?.kind).toBe('unsupported');
    const c2 = result.verdictDetails.find((v) => v.verdict.claimId === 'C2');
    expect(c2?.adjusted).toBe(true);
    expect(c2?.adjustmentReason).toContain('站得住');

    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0]?.before).toBe('主导重构订单系统');

    // P10-A4：反问也是这一场的产物，而且依据必须锚回材料。
    expect(result.counters).toHaveLength(1);
    expect(result.counters[0]?.source).toBe('resume');
    expect(result.counters[0]?.anchor.quote).toBe('首屏从 2.4s 降到 0.8s');
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  it('事件序列就是给前端播的那条时间线', async function () {
    const events: RunEvent[] = [];
    await runSession(baseInput({ onEvent: (e) => { events.push(e); } }));
    expect(events.map((e) => e.type)).toEqual([
      'stage', 'claims',
      'stage', 'probes',
      'stage', 'answers', 'budget',
      'stage', 'verdicts',
      'stage', 'suggestions',
      'stage', 'counter',
    ]);
    const stages = events.filter((e): e is Extract<RunEvent, { type: 'stage' }> => e.type === 'stage');
    expect(stages.map((s) => s.stage)).toEqual(['extract', 'probe', 'answer', 'verdict', 'suggest', 'counter']);
    expect(stages[1]?.round).toBe(1);
  });

  it('预算账本才是真正的闸门：轮数上限调成 1 就只跑一轮', async function () {
    const events: RunEvent[] = [];
    const result = await runSession(baseInput({ maxRounds: 5, onEvent: (e) => { events.push(e); } }));
    expect(result.rounds).toBe(1);
    const roundsOf = (id: string) => result.budget.claims.find((c) => c.claimId === id)?.rounds;
    expect(roundsOf('C1')).toBe(1);
    expect(roundsOf('C2')).toBe(1);
  });

  it('连续答不上来就关停这条主张，后续轮次不再摆上桌', async function () {
    const client = createScriptedClient(router({ candid: false }));
    const result = await runSession(baseInput({
      client,
      maxRounds: 3,
      budgetConfig: { maxRoundsPerClaim: 3, maxProbesPerInterviewerPerClaim: 2, maxTotalProbes: 60, maxConsecutiveUnanswerable: 1 },
    }));
    expect(result.rounds).toBe(1);
    expect(result.budget.claims.find((c) => c.claimId === 'C2')?.closeReason).toContain('答不上来');
    expect(result.verdicts.find((v) => v.claimId === 'C2')?.kind).toBe('unsupported');
  });

  it('多轮追问会形成链条，直到没有新问题为止', async function () {
    const result = await runSession(baseInput({
      maxRounds: 3,
      budgetConfig: { maxRoundsPerClaim: 3, maxProbesPerInterviewerPerClaim: 2, maxTotalProbes: 60, maxConsecutiveUnanswerable: 2 },
    }));
    // R1 各问一条；R2 tech 换新问题，hr 那条被去重；R3 两人都没新鲜问题，
    // 追问全被去重 → 触发「没有新追问」的收尾，循环才停。
    expect(result.rounds).toBe(3);
    expect(result.probes.length).toBe(3);
    const chain = result.probes.filter((p) => p.claimId === 'C1');
    expect(chain.map((p) => p.question)).toEqual(['这个 2.4s 是怎么测出来的？', '测试设备和网络条件是什么？']);
    expect(chain[1]?.parentProbeId).toBe(chain[0]?.id);
    const hrProbes = result.probes.filter((p) => p.interviewerId === 'hr');
    expect(hrProbes).toHaveLength(1);
    expect(result.notices.join(' ')).toContain('没有任何新的追问');
  });

  it('maxClaims 为 0 时如实说明没抽到主张，不假装跑过', async function () {
    const result = await runSession(baseInput({ maxClaims: 0 }));
    expect(result.claims).toEqual([]);
    expect(result.rounds).toBe(0);
    expect(result.verdicts).toEqual([]);
    expect(result.notices.join(' ')).toContain('没有抽到可被追问的主张');
  });

  it('环境坏了要留下一封遗书再抛：错误事件先于异常', async function () {
    const events: RunEvent[] = [];
    const client = createScriptedClient(router({ failProbe: true }));
    await expect(runSession(baseInput({ client, onEvent: (e) => { events.push(e); } }))).rejects.toThrow(/卡带/);
    const last = events[events.length - 1];
    expect(last?.type).toBe('error');
    expect(last?.type === 'error' ? last.fatal : false).toBe(true);
  });

  it('被拦下的建议会写进 notices，不会静默消失', async function () {
    const client = createScriptedClient(router({ suggestion: { after: '主导重构订单系统，QPS 提升 3 倍' } }));
    const result = await runSession(baseInput({ client }));
    expect(result.suggestions.some((s) => s.after.indexOf('3 倍') >= 0)).toBe(false);
    expect(result.notices.join(' ')).toContain('修改建议被拦下');
  });
});
