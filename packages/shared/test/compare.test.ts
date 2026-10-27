import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALIGN_THRESHOLD,
  SHIFT_LABEL,
  alignClaims,
  bigramsOf,
  compareHeadline,
  compareRuns,
  shiftDetail,
  textSimilarity,
  verdictCounts,
  verdictShift,
} from '../src/compare.ts';
import type { JudgedClaimLike } from '../src/shortfall.ts';

function claim(id: string, text: string, verdict: JudgedClaimLike['verdict'] = 'solid'): JudgedClaimLike {
  return { id, text, category: 'achievement', verdict };
}

describe('字符二元组相似度', () => {
  it('完全相同是 1，毫不相干接近 0', () => {
    expect(textSimilarity('把接口响应从 2.4 秒降到 0.8 秒', '把接口响应从 2.4 秒降到 0.8 秒')).toBe(1);
    expect(textSimilarity('把接口响应从 2.4 秒降到 0.8 秒', '持有 HCIP 认证')).toBeLessThan(0.1);
  });

  it('标点与全半角差异不影响相似度', () => {
    const plain = textSimilarity('订单系统重构', '订单系统重构');
    const noisy = textSimilarity('订单系统，重构。', '订单系统重构');
    expect(plain).toBe(1);
    expect(noisy).toBe(1);
  });

  it('改写后仍能对上：同一处经历换个说法，相似度高于阈值', () => {
    const before = '把订单接口的响应时间从 2.4 秒优化到 0.8 秒';
    const after = '订单接口响应时间由 2.4 秒降至 0.8 秒';
    expect(textSimilarity(before, after)).toBeGreaterThanOrEqual(DEFAULT_ALIGN_THRESHOLD);
  });

  it('空文本算 0，不抛错', () => {
    expect(textSimilarity('', '')).toBe(0);
    expect(textSimilarity('订单', '')).toBe(0);
    expect(bigramsOf('').size).toBe(0);
    expect(bigramsOf('好').has('好')).toBe(true);
  });
});

describe('两场主张对齐', () => {
  it('一模一样的两场，两条都能牵上，没有新增与删除', () => {
    const prev = [claim('C1', '把订单接口响应时间从 2.4 秒优化到 0.8 秒'), claim('C2', 'QPS 从 800 提升到 5000')];
    const next = [claim('C1', '把订单接口响应时间从 2.4 秒优化到 0.8 秒'), claim('C2', 'QPS 从 800 提升到 5000')];
    const result = alignClaims(prev, next);
    expect(result.pairs).toHaveLength(2);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.pairs[0]?.similarity).toBe(1);
  });

  it('完全不同的两场，一条都牵不上', () => {
    const prev = [claim('C1', '负责订单系统重构')];
    const next = [claim('C1', '持有 HCIP 认证')];
    const result = alignClaims(prev, next);
    expect(result.pairs).toHaveLength(0);
    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
  });

  it('一对一：一条被拆成两条时，只牵最像的那一条，另一条算新增', () => {
    const prev = [claim('C1', '把订单接口响应时间从 2.4 秒优化到 0.8 秒')];
    const next = [
      claim('C1', '把订单接口响应时间从 2.4 秒优化到 0.8 秒'),
      claim('C2', '把订单接口响应时间从 2.4 秒优化到 0.8 秒，覆盖 12 个业务线'),
    ];
    const result = alignClaims(prev, next);
    expect(result.pairs).toHaveLength(1);
    expect(result.added).toHaveLength(1);
  });

  it('同样的输入永远得到同样的配对（顺序确定）', () => {
    const prev = [claim('C1', '负责订单系统重构'), claim('C2', '负责支付系统重构')];
    const next = [claim('C1', '负责支付系统重构'), claim('C2', '负责订单系统重构')];
    const first = alignClaims(prev, next);
    const second = alignClaims(prev, next);
    expect(first.pairs.map((p) => p.prev.id + '>' + p.next.id)).toEqual(second.pairs.map((p) => p.prev.id + '>' + p.next.id));
    // 配对顺序跟这一场的主张顺序走，不跟上一场走：报告是按新简历从上往下读的
    expect(first.pairs.map((p) => p.prev.id)).toEqual(['C2', 'C1']);
    expect(first.pairs.map((p) => p.next.id)).toEqual(['C1', 'C2']);
  });

  it('阈值调高会把本来能牵上的拆成新增与删除', () => {
    const before = '把订单接口的响应时间从 2.4 秒优化到 0.8 秒';
    const after = '订单接口响应时间由 2.4 秒降至 0.8 秒';
    const low = alignClaims([claim('C1', before)], [claim('C1', after)], 0.2);
    const high = alignClaims([claim('C1', before)], [claim('C1', after)], 0.99);
    expect(low.pairs).toHaveLength(1);
    expect(high.pairs).toHaveLength(0);
  });
});

describe('判定变化', () => {
  it('欠证据程度下降是变好，上升是变差，相同是没变', () => {
    expect(verdictShift('unsupported', 'solid')).toBe('better');
    expect(verdictShift('solid', 'unanswerable')).toBe('worse');
    expect(verdictShift('solid', 'solid')).toBe('same');
    expect(verdictShift('overstated', 'unsupported')).toBe('worse');
    expect(verdictShift('contradicts', 'unsupported')).toBe('better');
  });

  it('任一边没判定就是没判定，不算没变', () => {
    expect(verdictShift(null, 'solid')).toBe('unjudged');
    expect(verdictShift('solid', null)).toBe('unjudged');
    expect(verdictShift(null, null)).toBe('unjudged');
  });

  it('四种变化的标签都是中文，且互不相同', () => {
    const labels = [SHIFT_LABEL.better, SHIFT_LABEL.same, SHIFT_LABEL.worse, SHIFT_LABEL.unjudged];
    expect(new Set(labels).size).toBe(4);
    expect(labels.every((label) => /[\u4e00-\u9fa5]/.test(label))).toBe(true);
  });

  it('shiftDetail 用中文判定名，不把英文枚举直接摆给读者', () => {
    const pair = {
      prev: claim('C1', 'x', 'unsupported'),
      next: claim('C1', 'x', 'solid'),
      similarity: 1,
      shift: verdictShift('unsupported', 'solid'),
    } as const;
    const detail = shiftDetail(pair);
    expect(detail).toContain('变好');
    expect(detail).not.toContain('unsupported');
  });
});

describe('判定分布与一句话结论', () => {
  it('只统计判定过的，没判定的不算进分母', () => {
    const counts = verdictCounts([claim('C1', 'a', 'solid'), claim('C2', 'b', null), claim('C3', 'c', 'unsupported')]);
    expect(counts.judged).toBe(2);
    expect(counts.solid).toBe(1);
    expect(counts.weak).toBe(1);
    expect(counts.counts.unsupported).toBe(1);
    expect(counts.counts.solid).toBe(1);
  });

  it('结论先说站得住几条，再报变好变差与增删', () => {
    const prev = [claim('C1', '负责订单系统重构与性能优化', 'unsupported')];
    const next = [claim('C1', '负责订单系统重构与性能优化', 'solid'), claim('C2', '持有 HCIP 认证', 'solid')];
    const comparison = compareRuns({ claims: prev, probes: 8 }, { claims: next, probes: 3 });
    expect(comparison.improved).toHaveLength(1);
    expect(comparison.added).toHaveLength(1);
    const headline = comparison.headline;
    expect(headline).toContain('站得住 0 → 2 条');
    expect(headline).toContain('变好 1 条');
    expect(headline).toContain('新增 1 条');
    expect(headline).toContain('追问 8 → 3 次');
  });

  it('追问次数拿不到时不编造，结论里干脆不提', () => {
    const partial = {
      threshold: DEFAULT_ALIGN_THRESHOLD,
      pairs: [],
      added: [],
      removed: [],
      before: verdictCounts([]),
      after: verdictCounts([]),
      improved: [],
      worsened: [],
      probesBefore: null,
      probesAfter: null,
    };
    expect(compareHeadline(partial)).not.toContain('追问');
  });

  it('两场完全没得比时结论也不炸', () => {
    const comparison = compareRuns({ claims: [] }, { claims: [] });
    expect(comparison.pairs).toHaveLength(0);
    expect(comparison.headline).toContain('站得住 0 → 0 条');
  });
});
