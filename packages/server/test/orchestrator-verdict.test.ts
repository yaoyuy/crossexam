/**
 * 判定阶段的测试。重点不是模型会不会判，而是**代码收敛规则是否真的拦得住**：
 * 说好话要证据、说坏话也要证据；一条主张整场都没答上来时，只拦「站得住」这一种
 * 过于乐观的判定，其余以模型看到的问答为准（它比一个布尔更清楚该算证据缺失还是无法回答）。
 */

import { describe, expect, it } from 'vitest';
import { segmentResume } from '@crossexam/shared';
import type { Answer, Claim, Probe } from '@crossexam/shared';
import { ALL_UNANSWERED_REASON, enforceVerdict, verdictClaims } from '../src/orchestrator/verdict.ts';
import type { AnsweredProbe } from '../src/orchestrator/verdict.ts';
import { LlmError } from '../src/llm/types.ts';
import { createScriptedClient } from './scripted.ts';
import type { ScriptedHandler } from './scripted.ts';

const RESUME = [
  '项目经历',
  '主导重构订单系统，首屏从 2.4s 降到 0.8s，日订单量 30 万。',
  '熟悉 TypeScript 与 Node.js。',
].join(String.fromCharCode(10));

const OUTLINE = segmentResume(RESUME);

function claim(id: string, text: string, quote: string): Claim {
  return {
    id, text, category: 'metric', weight: 0.8,
    anchor: { quote, start: RESUME.indexOf(quote), end: RESUME.indexOf(quote) + quote.length, exact: true },
  };
}

const C1 = claim('C1', '订单系统性能优化', '首屏从 2.4s 降到 0.8s');
const C2 = claim('C2', 'TypeScript 熟练度', '熟悉 TypeScript 与 Node.js');

const P1: Probe = {
  id: 'P1', claimId: 'C1', interviewerId: 'tech', round: 1, question: '这个 2.4s 是怎么测出来的？',
  anchor: { quote: '首屏从 2.4s 降到 0.8s', start: RESUME.indexOf('首屏从 2.4s 降到 0.8s'), end: RESUME.indexOf('首屏从 2.4s 降到 0.8s') + 15, exact: true },
  parentProbeId: null, rationale: '口径必须能说清',
};

const P2: Probe = {
  id: 'P2', claimId: 'C2', interviewerId: 'hr', round: 1, question: 'Node.js 你用到什么程度？',
  anchor: { quote: '熟悉 TypeScript 与 Node.js', start: RESUME.indexOf('熟悉 TypeScript 与 Node.js'), end: RESUME.indexOf('熟悉 TypeScript 与 Node.js') + 22, exact: true },
  parentProbeId: null, rationale: '核实熟悉的边界',
};

function answer(probeId: string, text: string): Answer {
  return { probeId, text, mode: 'simulated', citedAnchors: [] };
}

function said(probe: Probe, text: string): AnsweredProbe {
  return { probe, answer: answer(probe.id, text), answered: true };
}

function silent(probe: Probe): AnsweredProbe {
  return { probe, answer: answer(probe.id, '简历里没有写具体项目。'), answered: false };
}

function draft(kind: string, confidence: number, evidenceQuotes: string[] = []): string {
  return JSON.stringify({ kind, confidence, rationale: '模型给的理由', evidenceQuotes });
}

function handlerFor(map: Record<string, string>, extra?: Record<string, string>): ScriptedHandler {
  const all: Record<string, string> = { ...map, ...(extra ?? {}) };
  return (req) => {
    const text = req.messages.map((m) => m.content).join(' ');
    for (const key of Object.keys(all)) {
      if (text.indexOf(key) >= 0) {
        const hit = all[key];
        if (hit !== undefined) return hit;
      }
    }
    return new Error('没有为这条主张准备判定：' + text.slice(0, 40));
  };
}

function baseInput(over: Partial<Parameters<typeof verdictClaims>[0]> = {}) {
  const client = createScriptedClient(
    handlerFor({ '订单系统性能优化': draft('solid', 0.9, ['首屏从 2.4s 降到 0.8s']) }),
  );
  return {
    client,
    claims: [C1] as readonly Claim[],
    transcriptByClaim: { C1: [said(P1, '用 Lighthouse 在 Moto G4 上测的。')] } as Readonly<Record<string, readonly AnsweredProbe[]>>,
    resumeText: RESUME,
    outline: OUTLINE,
    ...over,
  };
}

describe('复盘判定', function () {
  it('判定带上的原文证据被锚定，probeIds 由代码从问答记录里取', async function () {
    const result = await verdictClaims(baseInput());
    const v = result.outcomes[0]!.verdict;
    expect(v.kind).toBe('solid');
    expect(v.evidence).toHaveLength(1);
    expect(v.evidence[0]?.quote).toBe('首屏从 2.4s 降到 0.8s');
    expect(v.probeIds).toEqual(['P1']);
    expect(result.outcomes[0]?.adjusted).toBe(false);
  });

  it('说站得住却拿不出证据，一律降级为证据缺失', async function () {
    const result = await verdictClaims(baseInput({
      client: createScriptedClient(handlerFor({ '订单系统性能优化': draft('solid', 0.95) })),
    }));
    const outcome = result.outcomes[0]!;
    expect(outcome.verdict.kind).toBe('unsupported');
    expect(outcome.adjusted).toBe(true);
    expect(outcome.adjustmentReason).toContain('证据缺失');
    expect(outcome.verdict.confidence).toBe(0.95);
  });

  it('说与原文矛盾也要证据；证据定位不到时降级并记账', async function () {
    const result = await verdictClaims(baseInput({
      client: createScriptedClient(handlerFor({ '订单系统性能优化': draft('contradicts', 0.8, ['日订单量 300 万']) })),
    }));
    const outcome = result.outcomes[0]!;
    expect(outcome.verdict.kind).toBe('unsupported');
    expect(outcome.droppedEvidence).toEqual(['日订单量 300 万']);
    expect(outcome.adjustmentReason).toContain('与原文矛盾');
  });

  it('所有追问都没答上来，「站得住」降级为证据缺失', async function () {
    const result = await verdictClaims(baseInput({
      client: createScriptedClient(handlerFor({ '订单系统性能优化': draft('solid', 0.9, ['首屏从 2.4s 降到 0.8s']) })),
      transcriptByClaim: { C1: [silent(P1)] },
    }));
    const outcome = result.outcomes[0]!;
    expect(outcome.verdict.kind).toBe('unsupported');
    expect(outcome.adjustmentReason).toBe(ALL_UNANSWERED_REASON);
  });

  it('所有追问都没答上来，模型判的证据缺失原样保留', async function () {
    const result = await verdictClaims(baseInput({
      client: createScriptedClient(handlerFor({ '订单系统性能优化': draft('unsupported', 0.8) })),
      transcriptByClaim: { C1: [silent(P1)] },
    }));
    const outcome = result.outcomes[0]!;
    expect(outcome.verdict.kind).toBe('unsupported');
    expect(outcome.adjusted).toBe(false);
    expect(outcome.adjustmentReason).toBeNull();
  });

  it('模型判「无法回答」时不会被代码改回去', async function () {
    const result = await verdictClaims(baseInput({
      client: createScriptedClient(handlerFor({ '订单系统性能优化': draft('unanswerable', 0.8) })),
      transcriptByClaim: { C1: [silent(P1)] },
    }));
    const outcome = result.outcomes[0]!;
    expect(outcome.verdict.kind).toBe('unanswerable');
    expect(outcome.adjusted).toBe(false);
  });

  it('只要答上过一次，就不触发降级', async function () {
    const result = await verdictClaims(baseInput({
      client: createScriptedClient(handlerFor({ '订单系统性能优化': draft('overstated', 0.6) })),
      transcriptByClaim: { C1: [said(P1, '测过，但没留报告。')] },
    }));
    expect(result.outcomes[0]?.verdict.kind).toBe('overstated');
    expect(result.outcomes[0]?.adjusted).toBe(false);
  });

  it('从没被追问过的主张不触发强制规则', async function () {
    const result = await verdictClaims(baseInput({
      client: createScriptedClient(handlerFor({ '订单系统性能优化': draft('solid', 0.7, ['主导重构订单系统']) })),
      transcriptByClaim: {},
    }));
    expect(result.outcomes[0]?.verdict.kind).toBe('solid');
    expect(result.outcomes[0]?.verdict.probeIds).toEqual([]);
  });

  it('confidence 越界会被 schema 直接拒绝，不静默夹成 1', async function () {
    const result = await verdictClaims(baseInput({
      client: createScriptedClient(handlerFor({ '订单系统性能优化': draft('solid', 1.8, ['主导重构订单系统']) })),
    }));
    expect(result.outcomes).toEqual([]);
    expect(result.errors[0]?.message).toContain('判定返回不符合约定格式');
  });

  it('归一化函数自己也会夹一次，作为 schema 之外的第二道保险', function () {
    const enforced = enforceVerdict({
      claimId: 'C1',
      draft: { kind: 'unsupported', confidence: 3, rationale: '理由' },
      evidence: [],
      transcript: [],
    });
    expect(enforced.verdict.confidence).toBe(1);
  });

  it('两条主张各自判定，usage 累加，单条失败只记账', async function () {
    const client = createScriptedClient((req) => {
      const text = req.messages.map((m) => m.content).join(' ');
      if (text.indexOf('TypeScript 熟练度') >= 0) return '不是 JSON';
      return draft('solid', 0.9, ['首屏从 2.4s 降到 0.8s']);
    });
    const result = await verdictClaims(baseInput({
      client,
      claims: [C1, C2],
      transcriptByClaim: { C1: [said(P1, '测过。')], C2: [said(P2, '用过两年。')] },
    }));
    expect(result.outcomes).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.claimId).toBe('C2');
    expect(result.usage.outputTokens).toBe(20);
  });

  it('卡带缺失整批抛出', async function () {
    const client = createScriptedClient(() => new LlmError('cassette-missing', '没有卡带'));
    await expect(verdictClaims(baseInput({ client }))).rejects.toThrow(/卡带/);
  });
});
