import { describe, expect, it } from 'vitest';
import type { HistoryOverview } from '../src/api.ts';
import { MAX_BARS, categoryLines, dayLabel, overviewFactsOf, sameJdNote, sameResumeNote, trendBars } from '../src/overview.ts';

function view(overrides: Partial<HistoryOverview> = {}): HistoryOverview {
  return {
    window: 200,
    sessions: 2,
    claims: 4,
    verdicts: { judged: 4, solid: 2, weak: 2, counts: { solid: 2, unsupported: 2 } },
    categories: [],
    meanProbes: 3,
    trend: [],
    trendNote: null,
    resumeGroups: [],
    sameResumeRuns: 1,
    jdGroups: [],
    sameJdRuns: 0,
    headline: '2 场共 4 条主张，已判 4 条里站得住 2 条。',
    ...overrides,
  };
}

describe('趋势柱子的几何', () => {
  it('日期只取到月-日，趋势图放得下', () => {
    expect(dayLabel('2026-10-03T12:34:56.000Z')).toBe('10-03');
    expect(dayLabel('2026-10-03')).toBe('10-03');
    expect(dayLabel('不是时间')).toBe('不是时间');
  });

  it('高度按这一批里判得最多的那场归一，不是按绝对条数', () => {
    const bars = trendBars([
      { sessionId: 's1', createdAt: '2026-10-01T00:00:00.000Z', jobTitle: '后端', judged: 2, solid: 0, probes: 6 },
      { sessionId: 's2', createdAt: '2026-10-02T00:00:00.000Z', jobTitle: '后端', judged: 4, solid: 4, probes: 2 },
    ]);
    expect(bars.map((bar) => bar.judgedHeight)).toEqual([50, 100]);
    expect(bars.map((bar) => bar.solidHeight)).toEqual([0, 100]);
    expect(bars[1]?.title).toContain('站得住 4 / 已判 4');
    expect(bars[1]?.title).toContain('追问 2 次');
  });

  it('全都没判时高度是 0 而不是除零', () => {
    const bars = trendBars([{ sessionId: 's1', createdAt: '2026-10-01T00:00:00.000Z', jobTitle: '后端', judged: 0, solid: 0, probes: null }]);
    expect(bars[0]?.judgedHeight).toBe(0);
    expect(bars[0]?.solidHeight).toBe(0);
    expect(bars[0]?.title).not.toContain('追问');
  });

  it('最多只画 MAX_BARS 根，取最近的那几场', () => {
    const trend = [];
    for (let index = 0; index < 9; index += 1) {
      trend.push({ sessionId: 's' + String(index), createdAt: '2026-10-0' + String(index + 1) + 'T00:00:00.000Z', jobTitle: '后端', judged: 1, solid: 1, probes: 1 });
    }
    const facts = overviewFactsOf(view({ trend }));
    expect(facts?.bars).toHaveLength(MAX_BARS);
    expect(facts?.bars[facts.bars.length - 1]?.sessionId).toBe('s8');
  });
});

describe('类别短板与提示', () => {
  it('只摆真的欠证据的类别，一条都没有就整段不出现', () => {
    expect(categoryLines(view())).toEqual([]);
    const lines = categoryLines(
      view({
        categories: [
          { category: 'skill', label: '技能掌握', total: 3, judged: 3, solid: 0, weak: 2, counts: { unsupported: 2 } },
          { category: 'metric', label: '数据与指标', total: 2, judged: 2, solid: 2, weak: 0, counts: { solid: 2 } },
        ],
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('技能掌握：3 条里 0 条站得住（欠证据 2 条）');
  });

  it('同一个岗位只跑过一场时不提，跑过多场时说清是哪个岗位', () => {
    expect(sameJdNote(view({ sameJdRuns: 1 }))).toBeNull();
    const many = sameJdNote(view({
      sameJdRuns: 3,
      jdGroups: [{ jdKey: 'k1', jdTitle: '高级后端工程师', sessions: 3, latestId: 's3', latestCreatedAt: '2026-10-03T00:00:00.000Z' }],
    }));
    expect(many).toContain('《高级后端工程师》最多跑过 3 场');
    const unnamed = sameJdNote(view({ sameJdRuns: 2, jdGroups: [] }));
    expect(unnamed).toContain('同一份岗位要求最多跑过 2 场');
  });

  it('同一份简历只跑过一场时不提「最多跑过几场」', () => {
    expect(sameResumeNote(view({ sameResumeRuns: 1 }))).toBeNull();
    expect(sameResumeNote(view({ sameResumeRuns: 3 }))).toContain('最多跑过 3 场');
  });
});

describe('整块的最小状态', () => {
  it('还没取到接口时不渲染（null，不是空壳）', () => {
    expect(overviewFactsOf(null)).toBeNull();
  });

  it('空库仍然给一句人话，并标成 empty', () => {
    const facts = overviewFactsOf(view({ sessions: 0, claims: 0, verdicts: { judged: 0, solid: 0, weak: 0, counts: {} }, headline: '还没有跑过任何一场。', trendNote: '只跑了 0 场，趋势要等第二场跑完才看得出来。' }));
    expect(facts?.empty).toBe(true);
    expect(facts?.headline).toBe('还没有跑过任何一场。');
    expect(facts?.bars).toEqual([]);
  });

  it('正常态把 headline 原样透传，界面不自己造句', () => {
    const facts = overviewFactsOf(view({ headline: '自定义结论' }));
    expect(facts?.headline).toBe('自定义结论');
    expect(facts?.empty).toBe(false);
  });
});
