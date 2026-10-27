import { describe, expect, it } from 'vitest';
import { applyRevisions } from '../src/revise.ts';
import {
  SUPPLEMENT_LIMITS,
  insertionPointAfter,
  normalizeSupplement,
  supplementBlock,
  supplementDigest,
  supplementProblem,
  supplementRevision,
} from '../src/supplement.ts';

const NL = String.fromCharCode(10);
const RESUME = ['张明 · 后端工程师', '主导重构订单系统，首屏从 2.4s 降到 0.8s。', '学习能力强。'].join(NL);
const QUOTE = '首屏从 2.4s 降到 0.8s';
const GOOD = '在 30 万日订单的系统里做过一次全链路压测，压测报告已归档。';

function anchorOf(quote: string) {
  const start = RESUME.indexOf(quote);
  expect(start).toBeGreaterThan(-1);
  return { start, end: start + quote.length, quote, exact: true };
}

describe('补充说明：长度与空白', () => {
  it('空、太短、太长、带换行都会被挡住，且理由是人话', () => {
    expect(supplementProblem('')).toContain('先写一句真话');
    expect(supplementProblem('   ')).toContain('先写一句真话');
    expect(supplementProblem('三个字')).toContain('至少 4 个字符');
    expect(supplementProblem('四个字符')).toBeNull();
    expect(supplementProblem('补'.repeat(SUPPLEMENT_LIMITS.maxChars))).toBeNull();
    expect(supplementProblem('补'.repeat(SUPPLEMENT_LIMITS.maxChars + 1))).toContain('最多 200 个字符');
    expect(supplementProblem('第一句' + NL + '第二句')).toContain('别换行');
  });

  it('前后空白会被去掉，指纹跟着内容走', () => {
    expect(normalizeSupplement('  ' + GOOD + '  ')).toBe(GOOD);
    expect(supplementDigest('  ' + GOOD + ' ')).toBe(supplementDigest(GOOD));
    expect(supplementDigest(GOOD)).not.toBe(supplementDigest(GOOD + '另外一句。'));
    expect(supplementDigest(GOOD)).toHaveLength(16);
  });
});

describe('补充说明：插在哪儿（由代码算）', () => {
  it('落在这条主张锚点所在那一行的行尾', () => {
    const anchor = anchorOf(QUOTE);
    const at = insertionPointAfter(RESUME, anchor);
    expect(RESUME.slice(0, at).endsWith('。')).toBe(true);
    expect(RESUME.charAt(at)).toBe(NL);
  });

  it('锚点落在最后一行且没有换行时追加到文末', () => {
    const text = '只有一行，没有换行';
    const anchor = { start: 0, end: 4, quote: '只有一行', exact: true };
    expect(insertionPointAfter(text, anchor)).toBe(text.length);
  });

  it('行尾是 CRLF 时插在 CR 之前，不把换行劈成两半', () => {
    const CR = String.fromCharCode(13);
    const crlf = ['第一行。', '第二行。'].join(CR + NL);
    const anchor = { start: 0, end: 3, quote: '第一行', exact: true };
    const at = insertionPointAfter(crlf, anchor);
    expect(crlf.charAt(at)).toBe(CR);
    expect(crlf.charAt(at + 1)).toBe(NL);
  });

  it('锚点越界时夹到正文长度，绝不抛错', () => {
    const anchor = { start: 0, end: 9999, quote: '随便', exact: true };
    expect(insertionPointAfter(RESUME, anchor)).toBe(RESUME.length);
    const negative = { start: -5, end: -1, quote: '随便', exact: true };
    expect(insertionPointAfter(RESUME, negative)).toBe(RESUME.indexOf(NL));
  });
});

describe('补充说明：它是一条插入型改写', () => {
  it('区间长度为零、改前为空，改后是换行加那句话', () => {
    const item = supplementRevision('C1', RESUME, anchorOf(QUOTE), GOOD);
    expect(item.claimId).toBe('C1');
    expect(item.start).toBe(item.end);
    expect(item.before).toBe('');
    expect(item.after).toBe(supplementBlock(GOOD));
    expect(supplementBlock(GOOD)).toBe(NL + GOOD);
  });

  it('应用之后多了一行，原文一个字都没动', () => {
    const result = applyRevisions(RESUME, [supplementRevision('C1', RESUME, anchorOf(QUOTE), GOOD)]);
    expect(result.skipped).toEqual([]);
    expect(result.applied).toHaveLength(1);
    expect(result.text.split(NL)).toEqual([
      '张明 · 后端工程师',
      '主导重构订单系统，首屏从 2.4s 降到 0.8s。',
      GOOD,
      '学习能力强。',
    ]);
    expect(result.text).toContain('首屏从 2.4s 降到 0.8s。');
  });

  it('与同一条主张的改写建议可以同时生效（插入点在替换区间右侧）', () => {
    const anchor = anchorOf(QUOTE);
    const suggestion = { claimId: 'C1', start: anchor.start, end: anchor.end, before: QUOTE, after: '首屏从 2.4s 降到 0.8s（压测口径：单机 4 核 8G）' };
    const insert = supplementRevision('C1', RESUME, anchor, GOOD);
    const result = applyRevisions(RESUME, [suggestion, insert]);
    expect(result.skipped).toEqual([]);
    expect(result.applied.map((item) => item.start === item.end)).toEqual([false, true]);
    expect(result.text).toContain('（压测口径：单机 4 核 8G）');
    expect(result.text.split(NL)).toContain(GOOD);
  });

  it('长度为零但改前不为空，仍然算非法区间', () => {
    const bogus = { claimId: 'C9', start: 3, end: 3, before: '有字', after: '新句' };
    const result = applyRevisions(RESUME, [bogus]);
    expect(result.applied).toEqual([]);
    expect(result.skipped[0]?.reason).toContain('区间不在简历正文范围内');
  });
});
