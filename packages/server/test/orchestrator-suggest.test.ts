/**
 * 修改建议阶段的测试。
 *
 * 这一层的价值全在"拦得住"：拦下定位不到的改前原文、拦下凭空多出来的数字、
 * 拦下等于没改的改写，并且对判定站得住的主张干脆不调模型。
 */

import { describe, expect, it } from 'vitest';
import { segmentResume } from '@crossexam/shared';
import type { Claim, Probe, Verdict } from '@crossexam/shared';
import { newNumbersIn, suggestClaims } from '../src/orchestrator/suggest.ts';
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
const QUOTE = '主导重构订单系统';

const C1: Claim = {
  id: 'C1', text: '订单系统性能优化', category: 'achievement', weight: 0.8,
  anchor: { quote: QUOTE, start: RESUME.indexOf(QUOTE), end: RESUME.indexOf(QUOTE) + QUOTE.length, exact: true },
};

const P1: Probe = {
  id: 'P1', claimId: 'C1', interviewerId: 'tech', round: 1, question: '首屏 0.8s 是哪个页面、什么网络条件？',
  anchor: C1.anchor, parentProbeId: null, rationale: '口径',
};

const TRANSCRIPT: Readonly<Record<string, readonly AnsweredProbe[]>> = {
  C1: [{ probe: P1, answer: { probeId: 'P1', text: '首页，4G。', mode: 'simulated', citedAnchors: [] }, answered: true }],
};

function verdict(kind: Verdict['kind']): Verdict {
  return { claimId: 'C1', kind, confidence: 0.7, rationale: '理由', evidence: [], probeIds: ['P1'] };
}

/**
 * 夹具照抄 SUGGEST_SYSTEM 里写的输出要求——**不含 claimId**。
 * 早先这里手写了 claimId，于是单元测试全绿，而真实模型照提示词不写 claimId，线上 100% 失败。
 */
function draft(over: Partial<{ problem: string; before: string; after: string; why: string }> = {}): string {
  return JSON.stringify({
    problem: over.problem ?? '只说主导，没说清范围',
    before: over.before ?? QUOTE,
    after: over.after ?? '参与重构订单系统',
    why: over.why ?? '面试官会追问你到底主导了什么',
  });
}

function handler(text: string): ScriptedHandler {
  return () => text;
}

function baseInput(over: Partial<Parameters<typeof suggestClaims>[0]> = {}) {
  return {
    client: createScriptedClient(handler(draft())),
    claims: [C1] as readonly Claim[],
    verdicts: [verdict('overstated')] as readonly Verdict[],
    transcriptByClaim: TRANSCRIPT,
    resumeText: RESUME,
    outline: OUTLINE,
    ...over,
  };
}

describe('简历修改建议', function () {
  it('正常建议被采纳，锚点落在被质疑的原句上', async function () {
    const result = await suggestClaims(baseInput());
    const outcome = result.outcomes[0]!;
    expect(outcome.status).toBe('suggested');
    expect(outcome.suggestion?.anchor.quote).toBe(QUOTE);
    expect(outcome.suggestion?.before).toBe(QUOTE);
    expect(outcome.suggestion?.after).toBe('参与重构订单系统');
    expect(outcome.suggestion?.claimId).toBe('C1');
  });

  it('模型不返回 claimId 也能出建议，且归属取主张自己的编号', async function () {
    const raw = JSON.stringify({
      problem: '没说清主导的范围',
      before: QUOTE,
      after: '参与重构订单系统',
      why: '面试官会追问你到底主导了什么',
    });
    expect(raw).not.toContain('claimId');
    const result = await suggestClaims(baseInput({ client: createScriptedClient(handler(raw)) }));
    expect(result.outcomes[0]?.status).toBe('suggested');
    expect(result.outcomes[0]?.suggestion?.claimId).toBe('C1');
    expect(result.errors).toEqual([]);
  });

  it('模型自报了一个错的主张编号，以主张自己的编号为准', async function () {
    const raw = JSON.stringify({
      claimId: 'C9',
      problem: '没说清主导的范围',
      before: QUOTE,
      after: '参与重构订单系统',
      why: '面试官会追问你到底主导了什么',
    });
    const result = await suggestClaims(baseInput({ client: createScriptedClient(handler(raw)) }));
    expect(result.outcomes[0]?.suggestion?.claimId).toBe('C1');
  });

  it('改前原文在简历里定位不到 —— 这条建议用户根本没法应用，拦下', async function () {
    const result = await suggestClaims(baseInput({
      client: createScriptedClient(handler(draft({ before: '负责整个订单中台建设' }))),
    }));
    expect(result.outcomes[0]?.status).toBe('rejected');
    expect(result.outcomes[0]?.reason).toContain('定位不到');
    expect(result.outcomes[0]?.suggestion).toBeNull();
  });

  it('改写里冒出新数字 = 新增事实，拦下', async function () {
    const result = await suggestClaims(baseInput({
      client: createScriptedClient(handler(draft({ after: '主导重构订单系统，QPS 提升 3 倍' }))),
    }));
    expect(result.outcomes[0]?.status).toBe('rejected');
    expect(result.outcomes[0]?.reason).toContain('新增事实');
    expect(result.outcomes[0]?.reason).toContain('3');
  });

  it('数字在简历别处出现过就不算新增，不误伤', async function () {
    const result = await suggestClaims(baseInput({
      client: createScriptedClient(handler(draft({ after: '参与重构订单系统，日订单量 30 万' }))),
    }));
    expect(result.outcomes[0]?.status).toBe('suggested');
  });

  it('改写后与原文相同等于没改，拦下', async function () {
    const result = await suggestClaims(baseInput({
      client: createScriptedClient(handler(draft({ after: QUOTE }))),
    }));
    expect(result.outcomes[0]?.status).toBe('rejected');
    expect(result.outcomes[0]?.reason).toContain('等于没改');
  });

  it('判定站得住的主张不给出建议，也不调用模型', async function () {
    const client = createScriptedClient(handler(draft()));
    const result = await suggestClaims(baseInput({ client, verdicts: [verdict('solid')] }));
    expect(result.outcomes[0]?.status).toBe('not-needed');
    expect(result.outcomes[0]?.reason).toContain('站得住');
    expect(client.calls).toHaveLength(0);
  });

  it('没有判定结果的主张先不动', async function () {
    const result = await suggestClaims(baseInput({ verdicts: [] }));
    expect(result.outcomes[0]?.status).toBe('not-needed');
    expect(result.outcomes[0]?.reason).toContain('没有判定结果');
  });

  it('解析失败只记账，卡带缺失整批抛出', async function () {
    const bad = await suggestClaims(baseInput({ client: createScriptedClient(handler('不是 JSON')) }));
    expect(bad.errors[0]?.claimId).toBe('C1');
    expect(bad.outcomes).toEqual([]);

    const gone = createScriptedClient(() => new LlmError('cassette-missing', '没有卡带'));
    await expect(suggestClaims(baseInput({ client: gone }))).rejects.toThrow(/卡带/);
  });

  it('数字指纹比对是纯函数，去重且认得小数', function () {
    expect(newNumbersIn('提升 3 倍，QPS 3 倍，延迟 0.2s', RESUME)).toEqual(['3', '0.2']);
    expect(newNumbersIn('首屏 0.8s，日订单量 30 万', RESUME)).toEqual([]);
  });
});
