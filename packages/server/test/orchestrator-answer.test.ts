/**
 * 求职者 Agent 作答阶段的测试。
 *
 * 这个阶段最容易写歪的地方是"让它显得很能答"。所以这里刻意用最难看的用例封口：
 * 答不出来要老实说、编造的原文引用要被丢弃、解析失败不许被伪装成一次答不上来。
 */

import { describe, expect, it } from 'vitest';
import { segmentResume } from '@crossexam/shared';
import type { Claim, Probe } from '@crossexam/shared';
import { answerProbes, answeredFor, emptyAnswer } from '../src/orchestrator/answer.ts';
import { LlmError } from '../src/llm/types.ts';
import { createScriptedClient } from './scripted.ts';
import type { ScriptedHandler } from './scripted.ts';

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

const Q1 = '这个 2.4s 是怎么测出来的？';
const Q2 = 'Node.js 你用到什么程度？';

function probe(id: string, claimId: string, interviewerId: string, question: string): Probe {
  const quote = claimId === 'C1' ? '首屏从 2.4s 降到 0.8s' : '熟悉 TypeScript 与 Node.js';
  return {
    id, claimId, interviewerId, round: 1, question,
    anchor: { quote, start: RESUME.indexOf(quote), end: RESUME.indexOf(quote) + quote.length, exact: true },
    parentProbeId: null,
    rationale: '测试夹具',
  };
}

const P1 = probe('P1', 'C1', 'tech', Q1);
const P2 = probe('P2', 'C2', 'hr', Q2);

function answer(answered: boolean, text: string, citedQuotes: string[] = []): string {
  return JSON.stringify({ answered, text, citedQuotes });
}

const GOOD = answer(true, '用 Lighthouse 在 Moto G4 上测的，取三次中位数。', ['首屏从 2.4s 降到 0.8s']);
const FABRICATED = answer(true, '首屏从 2.0s 降到 0.5s。', ['首屏从 2.0s 降到 0.5s']);
const HONEST = answer(false, '简历里没有写 Node.js 的具体项目，只写了一句"熟悉"。');
const EMPTY = answer(true, '   ');

function handlerByQuestion(map: Record<string, string | Error>): ScriptedHandler {
  return (req) => {
    const all = req.system + ' ' + req.messages.map((m) => m.content).join(' ');
    for (const key of Object.keys(map)) {
      if (all.indexOf(key) >= 0) {
        const hit = map[key];
        return hit === undefined ? new Error('缺失夹具') : hit;
      }
    }
    return new Error('没有为该问题准备返回值');
  };
}

function baseInput(over: Partial<Parameters<typeof answerProbes>[0]> = {}) {
  const client = createScriptedClient(handlerByQuestion({ [Q1]: GOOD, [Q2]: HONEST }));
  return {
    client,
    probes: [P1, P2] as Probe[],
    claims: CLAIMS,
    resumeText: RESUME,
    outline: OUTLINE,
    history: [] as Probe[],
    ...over,
  };
}

describe('求职者 Agent 作答', function () {
  it('引用原文的回答会被锚定到具体字符区间', async function () {
    const result = await answerProbes(baseInput({ probes: [P1] }));
    expect(result.errors).toEqual([]);
    const hit = result.outcomes[0];
    expect(hit?.answered).toBe(true);
    expect(hit?.answer.citedAnchors).toHaveLength(1);
    expect(hit?.answer.citedAnchors[0]?.quote).toBe('首屏从 2.4s 降到 0.8s');
    expect(RESUME.slice(hit!.answer.citedAnchors[0]!.start, hit!.answer.citedAnchors[0]!.end)).toBe('首屏从 2.4s 降到 0.8s');
    expect(hit?.answer.mode).toBe('simulated');
  });

  it('编造的"简历原文"被丢弃并记账，但回答本身不被改写', async function () {
    const result = await answerProbes(baseInput({ probes: [P1], client: createScriptedClient(handlerByQuestion({ [Q1]: FABRICATED })) }));
    const hit = result.outcomes[0];
    expect(hit?.answer.citedAnchors).toEqual([]);
    expect(hit?.droppedCitations).toEqual(['首屏从 2.0s 降到 0.5s']);
    expect(hit?.answer.text).toContain('2.0s');
    expect(hit?.answered).toBe(true);
  });

  it('简历里没写就老实说没写，不计入"有效作答"', async function () {
    const result = await answerProbes(baseInput({ probes: [P2] }));
    expect(result.outcomes[0]?.answered).toBe(false);
    expect(result.outcomes[0]?.answer.citedAnchors).toEqual([]);
    expect(answeredFor(result, 'P2')).toBe(false);
  });

  it('自称答上了但正文是空白，归一为没答上', async function () {
    const result = await answerProbes(baseInput({ probes: [P2], client: createScriptedClient(handlerByQuestion({ [Q2]: EMPTY })) }));
    expect(result.outcomes[0]?.answered).toBe(false);
  });

  it('一批追问按顺序给出结果，usage 累加', async function () {
    const result = await answerProbes(baseInput());
    expect(result.outcomes.map((o) => o.answer.probeId)).toEqual(['P1', 'P2']);
    expect(result.errors).toEqual([]);
    expect(result.usage.inputTokens).toBe(20);
    expect(result.usage.outputTokens).toBe(40);
    expect(answeredFor(result, 'P1')).toBe(true);
    expect(answeredFor(result, 'P2')).toBe(false);
  });

  it('单条解析失败只记账，不会伪造一次"答不上来"', async function () {
    const client = createScriptedClient(handlerByQuestion({ [Q1]: '这不是 JSON', [Q2]: HONEST }));
    const result = await answerProbes(baseInput({ client }));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.probeId).toBe('P1');
    expect(result.errors[0]?.message).toContain('作答返回不符合约定格式');
    expect(result.outcomes.map((o) => o.answer.probeId)).toEqual(['P2']);
    expect(answeredFor(result, 'P1')).toBe(false);
  });

  it('卡带缺失必须整批抛出，不能静默演成一场"没人答得上"的面试', async function () {
    const client = createScriptedClient(() => new LlmError('cassette-missing', '没有找到该提示词的卡带'));
    await expect(answerProbes(baseInput({ client }))).rejects.toThrow(/卡带/);
  });

  it('普通网络错误不整批崩掉', async function () {
    const client = createScriptedClient(handlerByQuestion({ [Q1]: new Error('模拟网络抖动'), [Q2]: HONEST }));
    const result = await answerProbes(baseInput({ client }));
    expect(result.errors[0]?.message).toBe('模拟网络抖动');
    expect(result.outcomes).toHaveLength(1);
  });

  it('追问引用了不存在的主张时被丢弃', async function () {
    const ghost = probe('P9', 'C9', 'tech', Q1);
    const result = await answerProbes(baseInput({ probes: [ghost] }));
    expect(result.outcomes).toEqual([]);
    expect(result.errors[0]?.message).toContain('不存在的主张');
  });

  it('提示词里带上别的面试官已经问过的问题，但不重复自己这一条', async function () {
    const client = createScriptedClient(handlerByQuestion({ [Q1]: GOOD }));
    await answerProbes(baseInput({ probes: [P1], history: [P1, P2], client }));
    const sent = client.calls[0]!;
    const body = sent.messages.map((m) => m.content).join(String.fromCharCode(10));
    expect(body).toContain(Q2);
    expect(body.indexOf(Q1)).toBe(body.lastIndexOf(Q1));
    expect(sent.purpose).toBe('answer');
    expect(sent.json).toBe(true);
  });

  it('没有作答时的占位答案长得像一条空回答', function () {
    const blank = emptyAnswer('P7');
    expect(blank.probeId).toBe('P7');
    expect(blank.text).toBe('');
    expect(blank.citedAnchors).toEqual([]);
  });
});
