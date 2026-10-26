/**
 * 提示词渲染与主张抽取的测试。
 *
 * 两个重点：
 * 1. 提示词必须是确定性的——同样的输入渲染两次要逐字节相同。卡带按提示词指纹寻址，
 *    这里抖一个字节，整盘回放就废了。这条断言比它看上去重要。
 * 2. 锚定必须是"只认逐字引用"的——模型给的偏移量再合理也不采信。
 */

import { describe, expect, it } from 'vitest';
import { segmentResume, resolveAnchor } from '@crossexam/shared';
import {
  EXTRACT_SYSTEM,
  buildExtractPrompt,
  buildProbePrompt,
  probeSystem,
  renderResume,
} from '../src/orchestrator/prompts.ts';
import { ExtractError, extractClaims, rankClaims } from '../src/orchestrator/extract.ts';
import { createScriptedClient, jsonByPurpose } from './scripted.ts';
import { buildContracts } from '@crossexam/shared';

const RESUME = [
  '教育经历',
  '2021.09-2025.06 某某大学 计算机科学与技术 本科',
  '',
  '项目经历',
  '主导重构订单系统，首屏从 2.4s 降到 0.8s，日订单量 30 万。',
  '熟悉 TypeScript 与 Node.js，了解 React。',
].join(String.fromCharCode(10));

const JD = '负责前端性能优化与工程化建设。';

function claimsJson(items: unknown[]): string {
  return JSON.stringify({ claims: items });
}

describe('提示词渲染', function () {
  it('同样输入渲染两次逐字节相同（否则回放会失效）', function () {
    const outline = segmentResume(RESUME);
    const a = buildExtractPrompt({ resumeText: RESUME, outline, jdText: JD, maxClaims: 8 });
    const b = buildExtractPrompt({ resumeText: RESUME, outline, jdText: JD, maxClaims: 8 });
    expect(a).toBe(b);
    expect(a).toContain('2.4s');
    expect(a).toContain('8 条');
  });

  it('简历渲染带片段编号，且正文逐字保留', function () {
    const outline = segmentResume(RESUME);
    const rendered = renderResume(outline);
    expect(rendered).toContain('#0 [小节]');
    expect(rendered).toContain('主导重构订单系统，首屏从 2.4s 降到 0.8s，日订单量 30 万。');
    // 渲染出来的编号行不属于简历正文，不能被当成引文来源
    expect(RESUME).not.toContain('#0');
  });

  it('面试官的 system prompt 由契约渲染，包含预算数字', function () {
    const contracts = buildContracts(['tech'], { maxRoundsPerClaim: 3, maxProbesPerInterviewerPerClaim: 2, maxTotalProbes: 60 });
    const sys = probeSystem(contracts[0]!);
    expect(sys).toContain('技术面试官');
    expect(sys).toContain('最多追问 3 轮');
    expect(sys).toContain('最多提问 2 次');
    expect(sys).toContain('{"probes"');
  });

  it('追问提示词里带着"你还剩几次"，让模型自己看得到预算', function () {
    const outline = segmentResume(RESUME);
    const claim = {
      id: 'C1', text: '性能优化', category: 'metric' as const, weight: 0.9,
      anchor: { quote: '主导重构订单系统', start: 0, end: 8, exact: true },
    };
    const prompt = buildProbePrompt({
      claim, resumeText: RESUME, outline, asked: [], round: 2, remainingRounds: 1, quotaLeft: 1,
    });
    expect(prompt).toContain('第 2 轮追问');
    expect(prompt).toContain('你还可以问 1 次');
  });
});

describe('主张抽取', function () {
  it('抽出的主张带原文坐标，且编号是确定的 C1/C2', async function () {
    const client = createScriptedClient(jsonByPurpose({
      extract: claimsJson([
        { text: '订单系统性能优化', quote: '首屏从 2.4s 降到 0.8s', category: 'metric', weight: 0.9 },
        { text: '熟悉 TypeScript', quote: '熟悉 TypeScript 与 Node.js', category: 'skill', weight: 0.6 },
      ]),
    }));
    const result = await extractClaims({ client, resumeText: RESUME, jdText: JD });
    expect(result.claims.map((c) => c.id)).toEqual(['C1', 'C2']);
    expect(result.rejected).toHaveLength(0);
    const first = result.claims[0]!;
    expect(RESUME.slice(first.anchor.start, first.anchor.end)).toBe('首屏从 2.4s 降到 0.8s');
    expect(first.anchor.exact).toBe(true);
    expect(result.usage.outputTokens).toBe(20);
  });

  it('引文在原文里找不到的主张被拦下，并给出可展示的原因', async function () {
    const client = createScriptedClient(jsonByPurpose({
      extract: claimsJson([
        { text: '主导过日活千万的系统', quote: '日活千万的推荐系统', category: 'achievement', weight: 0.9 },
        { text: '熟悉 TypeScript', quote: '熟悉 TypeScript 与 Node.js', category: 'skill', weight: 0.6 },
      ]),
    }));
    const result = await extractClaims({ client, resumeText: RESUME, jdText: JD });
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.id).toBe('C1');
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('找不到');
    expect(result.rejected[0]?.quote).toBe('日活千万的推荐系统');
  });

  it('不信模型给的偏移量：坐标以引文回原文重新定位为准', async function () {
    const client = createScriptedClient(jsonByPurpose({
      extract: claimsJson([
        { text: '性能优化', quote: '日订单量 30 万', category: 'metric', weight: 0.8, start: 0, end: 5 },
      ]),
    }));
    const result = await extractClaims({ client, resumeText: RESUME, jdText: JD });
    const anchor = result.claims[0]!.anchor;
    expect(anchor.start).toBe(RESUME.indexOf('日订单量 30 万'));
    expect(RESUME.slice(anchor.start, anchor.end)).toBe('日订单量 30 万');
  });

  it('全半角差异能被兜住，但会标记为归一化命中', async function () {
    const text = '负责订单系统（日均 30 万单），性能提升 40%。';
    const client = createScriptedClient(jsonByPurpose({
      extract: claimsJson([{ text: '订单规模', quote: '负责订单系统(日均 30 万单)', category: 'metric', weight: 0.7 }]),
    }));
    const result = await extractClaims({ client, resumeText: text, jdText: JD });
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.anchor.exact).toBe(false);
    expect(text.slice(result.claims[0]!.anchor.start, result.claims[0]!.anchor.end)).toContain('日均 30 万单');
  });

  it('引文过短会被拦下（防止锚到"我"这种无信息片段）', async function () {
    const client = createScriptedClient(jsonByPurpose({
      extract: claimsJson([{ text: '我', quote: '本科', category: 'other', weight: 0.5 }]),
    }));
    const result = await extractClaims({ client, resumeText: RESUME, jdText: JD });
    expect(result.claims).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain('过短');
  });

  it('重复引文只保留一条', async function () {
    const dup = { text: '性能优化', quote: '首屏从 2.4s 降到 0.8s', category: 'metric', weight: 0.9 };
    const client = createScriptedClient(jsonByPurpose({ extract: claimsJson([dup, { ...dup, text: '换个说法' }]) }));
    const result = await extractClaims({ client, resumeText: RESUME, jdText: JD });
    expect(result.claims).toHaveLength(1);
  });

  it('超过上限时按顺序截断', async function () {
    const many = [1, 2, 3, 4].map((n) => ({
      text: '主张' + String(n), quote: '日订单量 30 万', category: 'metric', weight: 0.5,
    }));
    const items = many.map((m, i) => ({ ...m, quote: i === 0 ? '首屏从 2.4s 降到 0.8s' : m.quote }));
    const client = createScriptedClient(jsonByPurpose({ extract: claimsJson(items) }));
    const result = await extractClaims({ client, resumeText: RESUME, jdText: JD, maxClaims: 2 });
    expect(result.claims).toHaveLength(2);
  });

  it('形状不对时整体失败，并把原始文本带出来供排查', async function () {
    const client = createScriptedClient(jsonByPurpose({ extract: '{"claims":[{"text":"缺字段"}]}' }));
    let caught: unknown;
    try {
      await extractClaims({ client, resumeText: RESUME, jdText: JD });
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof ExtractError).toBe(true);
    expect((caught as ExtractError).raw).toBe('{"claims":[{"text":"缺字段"}]}');
  });

  it('模型把 JSON 包在代码围栏里也能解析', async function () {
    const fence = String.fromCharCode(96).repeat(3);
    const body = claimsJson([{ text: '性能优化', quote: '首屏从 2.4s 降到 0.8s', category: 'metric', weight: 0.9 }]);
    const client = createScriptedClient(jsonByPurpose({ extract: fence + 'json' + String.fromCharCode(10) + body + String.fromCharCode(10) + fence }));
    const result = await extractClaims({ client, resumeText: RESUME, jdText: JD });
    expect(result.claims).toHaveLength(1);
  });

  it('rankClaims 按权重降序，同权重保持原顺序', function () {
    const mk = (id: string, w: number) => ({ id, text: id, category: 'other' as const, weight: w, anchor: resolveAnchor(RESUME, { quote: '熟悉 TypeScript 与 Node.js' }) as never });
    const ranked = rankClaims([mk('a', 0.4), mk('b', 0.9), mk('c', 0.4)] as never);
    expect(ranked.map((c) => c.id)).toEqual(['b', 'a', 'c']);
  });
});
