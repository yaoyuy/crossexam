import { describe, expect, it } from 'vitest';
import {
  CATEGORY_ORDER,
  SHORTFALL_DEFAULT_LIMIT,
  WEAKNESS_RANK,
  categoryLine,
  categoryShortfalls,
  shortfallPlan,
  weakestClaims,
} from '../src/shortfall.ts';
import type { JudgedClaimLike } from '../src/shortfall.ts';
import type { ClaimCategory, VerdictKind } from '../src/domain.ts';

let seq = 0;
function claim(category: ClaimCategory, verdict: VerdictKind | null, id?: string): JudgedClaimLike {
  seq += 1;
  return { id: id ?? 'C' + seq, text: '主张 ' + (id ?? seq), category, verdict };
}

describe('按类别看短板', () => {
  it('按类别汇总：weak 是不含 solid 的判定数，未判的不算', () => {
    const claims = [
      claim('skill', 'unsupported', 'C1'),
      claim('skill', 'solid', 'C2'),
      claim('skill', null, 'C3'),
      claim('metric', 'overstated', 'C4'),
    ];
    const stats = categoryShortfalls(claims);
    const skill = stats.find((item) => item.category === 'skill');
    const metric = stats.find((item) => item.category === 'metric');
    expect(skill).toMatchObject({ total: 3, judged: 2, solid: 1, weak: 1 });
    expect(skill?.counts).toEqual({ unsupported: 1, solid: 1 });
    expect(metric).toMatchObject({ total: 1, judged: 1, solid: 0, weak: 1 });
    expect(stats).toHaveLength(2);
  });

  it('排序：欠得多的在前，一样多按总数，再一样按固定类别顺序', () => {
    const stats = categoryShortfalls([
      claim('other', 'unsupported'),
      claim('skill', 'unsupported'),
      claim('skill', 'unsupported'),
      claim('metric', 'solid'),
      claim('metric', 'unsupported'),
    ]);
    expect(stats.map((item) => item.category)).toEqual(['skill', 'metric', 'other']);
  });

  it('最该补的名单：站得住的不进，按欠证据程度排序，同程度保持原顺序', () => {
    const claims = [
      claim('skill', 'overstated', 'C1'),
      claim('skill', 'solid', 'C2'),
      claim('metric', 'unanswerable', 'C3'),
      claim('metric', 'unsupported', 'C4'),
      claim('metric', 'contradicts', 'C5'),
      claim('other', null, 'C6'),
    ];
    expect(weakestClaims(claims).map((item) => item.id)).toEqual(['C3', 'C5', 'C4']);
  });

  it('名单长度受 limit 限制，limit 为 0 时为空', () => {
    const claims = [claim('skill', 'unsupported'), claim('metric', 'overstated'), claim('other', 'unsupported')];
    expect(weakestClaims(claims, 2)).toHaveLength(2);
    expect(weakestClaims(claims, 0)).toEqual([]);
    expect(SHORTFALL_DEFAULT_LIMIT).toBe(3);
  });

  it('程度表：solid 最低，无法回答最高，数值越大越靠前', () => {
    expect(WEAKNESS_RANK.solid).toBe(0);
    expect(WEAKNESS_RANK.overstated).toBeLessThan(WEAKNESS_RANK.unsupported);
    expect(WEAKNESS_RANK.unsupported).toBeLessThan(WEAKNESS_RANK.contradicts);
    expect(WEAKNESS_RANK.contradicts).toBeLessThan(WEAKNESS_RANK.unanswerable);
  });

  it('一句话结论：空场次 / 一条没判 / 全部站得住 / 还有没判的说得清楚', () => {
    expect(shortfallPlan([]).headline).toBe('这场没有抽出可判定的主张。');
    expect(shortfallPlan([claim('skill', null)]).headline).toContain('一条都还没判');
    expect(shortfallPlan([claim('skill', 'solid')]).headline).toContain('全部站得住');
    const partial = shortfallPlan([claim('skill', 'solid'), claim('metric', null)]).headline;
    expect(partial).toContain('还有 1 条没判');
  });

  it('一句话结论：有短板时点名最集中的两类', () => {
    const plan = shortfallPlan([
      claim('skill', 'unsupported'),
      claim('skill', 'unsupported'),
      claim('metric', 'overstated'),
      claim('experience', 'solid'),
    ]);
    expect(plan.headline).toBe('已判的 4 条里有 3 条还欠证据，最集中的是技能掌握 2 条、数字指标 1 条。');
  });

  it('类别那一行：没判 / 全站得住 / 有短板三种说法', () => {
    const [pending] = categoryShortfalls([claim('timeline', null)]);
    expect(pending && categoryLine(pending)).toBe('时间线 · 1 条还没判');
    const [clean] = categoryShortfalls([claim('timeline', 'solid')]);
    expect(clean && categoryLine(clean)).toBe('时间线 · 1 条全部站得住');
    const [dirty] = categoryShortfalls([claim('ownership', 'unsupported'), claim('ownership', 'overstated')]);
    expect(dirty && categoryLine(dirty)).toBe('主导程度 · 欠 2 条（证据缺失 1 · 表述过度 1）');
  });

  it('总数对得上：total / judged / weak / solid 四个数互不矛盾', () => {
    const plan = shortfallPlan([
      claim('skill', 'solid'),
      claim('skill', 'unsupported'),
      claim('metric', null),
      claim('metric', 'unanswerable'),
    ]);
    expect(plan.total).toBe(4);
    expect(plan.judged).toBe(3);
    expect(plan.solid).toBe(1);
    expect(plan.weak).toBe(2);
    expect(plan.weak + plan.solid).toBe(plan.judged);
    expect(plan.weakest.map((item) => item.id)).toHaveLength(2);
  });

  it('同一份输入永远得到同一个结果（回放与报告都依赖这一点）', () => {
    const claims = [claim('skill', 'unsupported'), claim('metric', 'overstated'), claim('other', 'contradicts')];
    expect(JSON.stringify(shortfallPlan(claims))).toBe(JSON.stringify(shortfallPlan(claims)));
  });

  it('固定类别顺序覆盖全部七类，且四条报告里出现的都算得出来', () => {
    expect(CATEGORY_ORDER).toEqual(['skill', 'experience', 'achievement', 'metric', 'ownership', 'timeline', 'other']);
    const stats = categoryShortfalls(CATEGORY_ORDER.map((category) => claim(category, 'solid')));
    expect(stats).toHaveLength(CATEGORY_ORDER.length);
  });
});
