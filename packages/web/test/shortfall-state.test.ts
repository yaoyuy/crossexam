/**
 * 按类别看短板（A3）在界面状态里的派生。
 *
 * 这一层的意义是「让按类别看短板这件事只写一遍」：报告与界面共用 shared/shortfall.ts，
 * 界面上做的只是字段搬运。所以这里守的是搬运没错——尤其中间态（还没判的主张）不能进短板名单。
 */
import { describe, expect, it } from 'vitest';
import type { Claim, VerdictOutcome } from '../src/api.ts';
import { applyEvent, initialSandbox, shortfallOf } from '../src/state.ts';

function claim(id: string, category: Claim['category']): Claim {
  return { id: id, text: '主张 ' + id, anchor: { start: 0, end: 4, quote: '主张 ' + id, exact: true }, category: category, weight: 1 };
}

function outcome(claimId: string, kind: VerdictOutcome['verdict']['kind']): VerdictOutcome {
  return {
    verdict: { claimId: claimId, kind: kind, confidence: 0.6, rationale: '为什么这么判', evidence: [], probeIds: [] },
    adjusted: false,
    adjustmentReason: null,
    droppedEvidence: [],
  };
}

const CLAIMS = [claim('C1', 'skill'), claim('C2', 'skill'), claim('C3', 'metric'), claim('C4', 'experience')];
const OUTCOMES = [outcome('C1', 'unsupported'), outcome('C2', 'solid'), outcome('C3', 'overstated')];

function judged() {
  const withClaims = applyEvent(initialSandbox, { type: 'claims', claims: CLAIMS, rejected: [] });
  return applyEvent(withClaims, { type: 'verdicts', verdicts: OUTCOMES, errors: [] });
}

describe('界面上的按类别看短板', () => {
  it('四个数对得上：总数含没判的，判定数只算判过的', () => {
    const plan = shortfallOf(judged());
    expect(plan.total).toBe(4);
    expect(plan.judged).toBe(3);
    expect(plan.solid).toBe(1);
    expect(plan.weak).toBe(2);
  });

  it('类别按欠得多少排，欠得一样多时看总数', () => {
    const plan = shortfallOf(judged());
    expect(plan.stats.map((item) => item.category)).toEqual(['skill', 'metric', 'experience']);
    expect(plan.stats[0]!.weak).toBe(1);
    expect(plan.stats[0]!.solid).toBe(1);
    expect(plan.stats[2]!.weak).toBe(0);
  });

  it('最该补的名单：站得住的不进，没判的也不进', () => {
    const plan = shortfallOf(judged());
    expect(plan.weakest.map((item) => item.id)).toEqual(['C1', 'C3']);
    expect(plan.weakest.some((item) => item.id === 'C2')).toBe(false);
    expect(plan.weakest.some((item) => item.id === 'C4')).toBe(false);
  });

  it('结论句直接能读：条数、类别、还有几条没判都在里面', () => {
    expect(shortfallOf(judged()).headline).toBe(
      '已判的 3 条里有 2 条还欠证据，最集中的是技能掌握 1 条、数字指标 1 条（还有 1 条没判）。',
    );
  });

  it('空场次与全站得住都有话说，不会显示成 0 条', () => {
    expect(shortfallOf(initialSandbox).headline).toBe('这场没有抽出可判定的主张。');
    const clean = applyEvent(initialSandbox, { type: 'claims', claims: [claim('C1', 'skill')], rejected: [] });
    const done = applyEvent(clean, { type: 'verdicts', verdicts: [outcome('C1', 'solid')], errors: [] });
    expect(shortfallOf(done).headline).toContain('全部站得住');
    expect(shortfallOf(done).weakest).toEqual([]);
  });
});
