import { describe, expect, it } from 'vitest';
import { TREND_POINTS, overviewHeadline, overviewOf, trendLine, trendPointOf } from '../src/overview.ts';
import type { SessionFacts } from '../src/overview.ts';
import type { JudgedClaimLike } from '../src/shortfall.ts';

function claim(id: string, verdict: JudgedClaimLike['verdict'], category: JudgedClaimLike['category'] = 'achievement'): JudgedClaimLike {
  return { id, text: '主张 ' + id, category, verdict };
}

function session(id: string, createdAt: string, claims: JudgedClaimLike[], probes: number | null = 0, resumeHash = 'h1'): SessionFacts {
  return { id, createdAt, jobTitle: '后端工程师', resumeHash, claims, probes };
}

describe('历史仪表盘：空库与一场', () => {
  it('一场都没有时给一句能读懂的话，且没有趋势', () => {
    const overview = overviewOf([]);
    expect(overview.sessions).toBe(0);
    expect(overview.claims).toBe(0);
    expect(overview.verdicts.judged).toBe(0);
    expect(overview.meanProbes).toBeNull();
    expect(overview.trend).toEqual([]);
    expect(overview.headline).toBe('还没有跑过任何一场。');
    expect(overview.trendNote).toContain('趋势要等第二场');
  });

  it('只有一场时也说清「趋势要等第二场」，不假装有曲线', () => {
    const overview = overviewOf([session('s1', '2026-10-01T00:00:00.000Z', [claim('C1', 'solid'), claim('C2', 'unsupported')], 4)]);
    expect(overview.sessions).toBe(1);
    expect(overview.trend).toHaveLength(1);
    expect(overview.trendNote).not.toBeNull();
    expect(trendLine(overview.trend)).toBeNull();
    expect(overview.headline).toContain('已判 2 条里站得住 1 条');
    expect(overview.headline).toContain('平均每场追问 4 次');
  });
});

describe('历史仪表盘：多场聚合', () => {
  const many = [
    session('s1', '2026-10-01T00:00:00.000Z', [claim('C1', 'unsupported'), claim('C2', 'overstated')], 6, 'h1'),
    session('s2', '2026-10-02T00:00:00.000Z', [claim('C1', 'solid'), claim('C2', 'solid')], 4, 'h2'),
    session('s3', '2026-10-03T00:00:00.000Z', [claim('C1', 'solid'), claim('C2', 'solid'), claim('C3', null)], 2, 'h2'),
  ];

  it('判定分布是全部场次合起来算的，不是只算最后一场', () => {
    const overview = overviewOf(many);
    expect(overview.sessions).toBe(3);
    expect(overview.claims).toBe(7);
    expect(overview.verdicts.judged).toBe(6);
    expect(overview.verdicts.solid).toBe(4);
    expect(overview.verdicts.weak).toBe(2);
    expect(overview.verdicts.counts.unsupported).toBe(1);
  });

  it('平均追问只看拿得到数字的场次，不把 null 当 0', () => {
    const withNull = overviewOf([
      session('s1', '2026-10-01T00:00:00.000Z', [claim('C1', 'solid')], 6),
      session('s2', '2026-10-02T00:00:00.000Z', [claim('C1', 'solid')], null),
    ]);
    expect(withNull.meanProbes).toBe(6);
    const none = overviewOf([session('s9', '2026-10-01T00:00:00.000Z', [claim('C1', 'solid')], null)]);
    expect(none.meanProbes).toBeNull();
  });

  it('趋势按时间升序、最多五个点', () => {
    const overview = overviewOf(many);
    expect(overview.trend.map((point) => point.sessionId)).toEqual(['s1', 's2', 's3']);
    expect(overview.trendNote).toBeNull();
    expect(trendLine(overview.trend)).toBe('最近 3 场：站得住 0 → 2 → 2 条');
    const seven: SessionFacts[] = [];
    for (let index = 0; index < 7; index += 1) {
      const day = String(index + 1).padStart(2, '0');
      seven.push(session('s' + String(index), '2026-10-' + day + 'T00:00:00.000Z', [claim('C1', 'solid')], 1));
    }
    const trimmed = overviewOf(seven);
    expect(trimmed.trend).toHaveLength(TREND_POINTS);
    expect(trimmed.trend[trimmed.trend.length - 1]?.sessionId).toBe('s6');
  });

  it('同一份简历跑过几场能数出来（改完再跑一遍就会 +1）', () => {
    const overview = overviewOf(many);
    expect(overview.sameResumeRuns).toBe(2);
    expect(overview.resumeGroups).toHaveLength(2);
    const h2 = overview.resumeGroups.find((item) => item.resumeHash === 'h2');
    expect(h2?.sessions).toBe(2);
    expect(h2?.latestId).toBe('s3');
  });

  it('入参顺序不影响结果：聚合前先按时间排一遍', () => {
    const forward = overviewOf(many);
    const reversed = overviewOf([...many].reverse());
    expect(reversed).toEqual(forward);
  });

  it('结论那句话提到最集中的类别，没有欠证据时直说', () => {
    const bad = overviewOf([session('s1', '2026-10-01T00:00:00.000Z', [claim('C1', 'unsupported', 'skill'), claim('C2', 'unsupported', 'skill'), claim('C3', 'solid')], 3)]);
    expect(bad.headline).toContain('最集中的是「技能掌握」2 条');
    const good = overviewOf([session('s1', '2026-10-01T00:00:00.000Z', [claim('C1', 'solid')], 1)]);
    expect(good.headline).toContain('没有一条欠证据');
  });

  it('一条主张都没有时不说「已判 0 条里站得住 0 条」', () => {
    const empty = overviewOf([session('s1', '2026-10-01T00:00:00.000Z', [])]);
    expect(empty.headline).toBe('1 场都还没抽出主张。');
    const unjudged = overviewOf([session('s2', '2026-10-01T00:00:00.000Z', [claim('C1', null)])]);
    expect(unjudged.headline).toContain('一条都还没判');
  });
});

describe('历史仪表盘：趋势点与结论函数', () => {
  it('趋势点只带图表要用的四个数，判定复用 verdictCounts', () => {
    const point = trendPointOf(session('s1', '2026-10-01T00:00:00.000Z', [claim('C1', 'solid'), claim('C2', null)], 5));
    expect(point).toEqual({
      sessionId: 's1',
      createdAt: '2026-10-01T00:00:00.000Z',
      jobTitle: '后端工程师',
      judged: 1,
      solid: 1,
      probes: 5,
    });
  });

  it('overviewHeadline 是纯函数：同样的输入两次得到同一句话', () => {
    const input = {
      sessions: 2,
      claims: 4,
      verdicts: { judged: 4, solid: 2, weak: 2, counts: { solid: 2, unsupported: 2 } },
      categories: [],
      meanProbes: 3.5,
      trend: [],
      resumeGroups: [],
      sameResumeRuns: 1,
    };
    expect(overviewHeadline(input)).toBe(overviewHeadline(input));
    expect(overviewHeadline(input)).toContain('平均每场追问 3.5 次');
  });
});
