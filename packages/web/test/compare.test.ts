import { describe, expect, it } from 'vitest';
import type { ComparePair, CompareView } from '../src/api.ts';
import { compareFactsOf, shiftDetailOf } from '../src/compare.ts';

/**
 * 版本对比在界面上的说法：四种状态（还没取到 / 第一版 / 上一版被删 / 真比出来了）
 * 必须说四句不一样的话。把这条规则钉在这里，是因为它最容易在 JSX 里被压成一句。
 */

function pair(prevVerdict: ComparePair['prev']['verdict'], nextVerdict: ComparePair['next']['verdict'], shift: ComparePair['shift']): ComparePair {
  return {
    prev: { id: 'C1', text: '上一版那句', category: 'metric', verdict: prevVerdict },
    next: { id: 'C1', text: '这一版那句', category: 'metric', verdict: nextVerdict },
    similarity: 0.5,
    shift: shift,
  };
}

function view(patch: Partial<CompareView>): CompareView {
  return {
    sessionId: 's_2',
    first: false,
    parentMissing: false,
    parentSessionId: 's_1',
    parent: { id: 's_1', jobTitle: '后端工程师', createdAt: '2026-10-27T00:00:00.000Z', resumeHash: 'aaa' },
    resumeChanged: true,
    comparison: null,
    ...patch,
  };
}

describe('版本对比的界面说法', () => {
  it('还没取到就什么都别说', () => {
    expect(compareFactsOf(null)).toBeNull();
  });

  it('第一版说的是「改完再跑一遍」，不是「出错了」', () => {
    const facts = compareFactsOf(view({ first: true, parentSessionId: null, parent: null }));
    expect(facts).not.toBeNull();
    expect(facts!.status).toBe('这是第一版');
    expect(facts!.headline).toContain('改完再跑一遍');
    expect(facts!.rows).toEqual([]);
  });

  it('上一版被删了要说清是比不了，而不是给一串零', () => {
    const facts = compareFactsOf(view({ parentMissing: true }));
    expect(facts!.status).toBe('上一版不在了');
    expect(facts!.headline).toContain('比不了');
    expect(facts!.facts).toEqual([]);
  });

  it('简历没改时必须点明：判定变化不是改动带来的', () => {
    const facts = compareFactsOf(
      view({
        resumeChanged: false,
        comparison: {
          threshold: 0.34,
          pairs: [pair('overstated', 'solid', 'better')],
          added: [],
          removed: [],
          before: { judged: 1, solid: 0, weak: 1, counts: {} },
          after: { judged: 1, solid: 1, weak: 0, counts: {} },
          improved: [],
          worsened: [],
          probesBefore: 3,
          probesAfter: 3,
          headline: '站得住 0 → 1 条（共 1 → 1 条判定）',
        },
      }),
    );
    expect(facts!.status).toBe('比上次');
    expect(facts!.headline).toBe('站得住 0 → 1 条（共 1 → 1 条判定）');
    expect(facts!.facts.join(' ')).toContain('与上一版完全相同');
    expect(facts!.facts.join(' ')).toContain('追问 3 → 3 次');
  });

  it('只把变好变差摆出来，没变与没判定的不占位置', () => {
    const facts = compareFactsOf(
      view({
        comparison: {
          threshold: 0.34,
          pairs: [pair('overstated', 'solid', 'better'), pair('solid', 'solid', 'same'), pair(null, 'solid', 'unjudged')],
          added: [{ id: 'C9', text: '这一版新写的', category: 'skill', verdict: 'solid' }],
          removed: [],
          before: { judged: 2, solid: 1, weak: 1, counts: {} },
          after: { judged: 3, solid: 3, weak: 0, counts: {} },
          improved: [],
          worsened: [],
          probesBefore: 3,
          probesAfter: 1,
          headline: '站得住 1 → 3 条（共 2 → 3 条判定），变好 1 条，新增 1 条，追问 3 → 1 次',
        },
      }),
    );
    expect(facts!.rows.map((row) => row.id)).toEqual(['C1']);
    expect(facts!.rows[0]!.shift).toBe('better');
    expect(facts!.added).toEqual(['这一版新写的']);
    expect(facts!.facts.join(' ')).toContain('改过了');
  });

  it('一条对比结果说的是中文判定名，不是两个英文词', () => {
    expect(shiftDetailOf(pair('unsupported', 'solid', 'better'))).toBe('证据缺失 → 站得住（变好）');
    expect(shiftDetailOf(pair('solid', 'contradicts', 'worse'))).toBe('站得住 → 与原文矛盾（变差）');
    expect(shiftDetailOf(pair(null, 'solid', 'unjudged'))).toBe('未判定 → 站得住（没判定）');
  });
});
