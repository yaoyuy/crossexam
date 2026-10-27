/**
 * 采纳改写的前端纯逻辑。
 *
 * 这些函数不碰网络、不碰 React，所以能像数学一样断言：
 * 勾选是集合运算，三个计数是分类计数，高亮区间只是把 spans 换个形状。
 */
import { describe, expect, it } from 'vitest';
import {
  acceptAll,
  choosableClaimIds,
  isAccepted,
  revisionSummary,
  revisedDelta,
  skippedReason,
  spanRanges,
  toggleAccepted,
} from '../src/revisions.ts';
import type { RevisedResume } from '../src/revisions.ts';

function sample(overrides: Partial<RevisedResume> = {}): RevisedResume {
  const base: RevisedResume = {
    text: '张明 · 后端工程师' + String.fromCharCode(10) + '带过 2 个实习生。',
    digest: '0123456789abcdef',
    applied: [{ claimId: 'C1', start: 20, end: 30, before: '学习能力强，抗压能力强', after: '带过 2 个实习生' }],
    spans: [{ claimId: 'C1', start: 20, end: 28, before: '学习能力强，抗压能力强', after: '带过 2 个实习生' }],
    accepted: ['C1'],
    pending: ['C3'],
    skipped: [{ claimId: 'C2', reason: '同一段原文已经被别的建议改过了' }],
    updatedAt: '2026-10-26T14:00:00.000Z',
  };
  return { ...base, ...overrides };
}

describe('勾选只是一个集合', () => {
  it('勾上再点一次就是取消，顺序不影响结果', () => {
    expect(toggleAccepted([], 'C1')).toEqual(['C1']);
    expect(toggleAccepted(['C1'], 'C1')).toEqual([]);
    const once = toggleAccepted(['C1', 'C2'], 'C3');
    expect(once).toEqual(['C1', 'C2', 'C3']);
    expect(toggleAccepted(once, 'C1')).toEqual(['C2', 'C3']);
  });

  it('勾一个没勾过的就是加上（不是忽略），且不改动原数组', () => {
    const current = ['C1'] as string[];
    const next = toggleAccepted(current, 'C9');
    expect(next).toEqual(['C1', 'C9']);
    expect(current).toEqual(['C1']);
    expect(next).not.toBe(current);
  });

  it('全部采纳给的是新数组，改它不会回写到候选清单', () => {
    const candidates = ['C1', 'C3'] as string[];
    const chosen = acceptAll(candidates);
    chosen.push('C9');
    expect(candidates).toEqual(['C1', 'C3']);
  });
});

describe('三个计数回答「改到哪一步了」', () => {
  it('还没提交过时只有「本次勾选」有数', () => {
    expect(revisionSummary(null, ['C1', 'C2'])).toEqual({ accepted: 0, pending: 0, skipped: 0, chosen: 2 });
  });

  it('提交之后已改、待定、改不动分别来自服务端那一版', () => {
    const summary = revisionSummary(sample(), ['C1', 'C2']);
    expect(summary).toEqual({ accepted: 1, pending: 1, skipped: 1, chosen: 2 });
  });
});

describe('改动幅度', () => {
  it('没改过就是 0，改长了是正数，改短了是负数', () => {
    const original = '一二三四五';
    expect(revisedDelta(original, null)).toBe(0);
    expect(revisedDelta(original, sample({ text: '一二三四五六七八' }))).toBe(3);
    expect(revisedDelta(original, sample({ text: '一二' }))).toBe(-3);
  });
});

describe('哪条改不动、哪条已经进去了', () => {
  it('被跳过的带理由，没被跳过的给 null', () => {
    const revised = sample();
    expect(skippedReason(revised, 'C2')).toBe('同一段原文已经被别的建议改过了');
    expect(skippedReason(revised, 'C1')).toBeNull();
    expect(skippedReason(null, 'C2')).toBeNull();
  });

  it('已经写进这一版的主张查得出来', () => {
    const revised = sample();
    expect(isAccepted(revised, 'C1')).toBe(true);
    expect(isAccepted(revised, 'C3')).toBe(false);
    expect(isAccepted(null, 'C1')).toBe(false);
  });
});

describe('哪些主张可以勾选采纳', () => {
  const claims = [
    { id: 'C1', hasSuggestion: true },
    { id: 'C2', hasSuggestion: false },
    { id: 'C3', hasSuggestion: false },
    { id: 'C4', hasSuggestion: true },
  ];

  it('有建议的算，自己补了一句真话的也算', () => {
    expect(choosableClaimIds(claims, ['C3'])).toEqual(['C1', 'C3', 'C4']);
  });

  it('顺序照界面上主张的顺序，不按勾选或补充的先后', () => {
    expect(choosableClaimIds(claims, ['C3', 'C2'])).toEqual(['C1', 'C2', 'C3', 'C4']);
  });

  it('既没建议也没补充说明的，勾不上', () => {
    expect(choosableClaimIds([{ id: 'C9', hasSuggestion: false }], [])).toEqual([]);
    expect(choosableClaimIds([], ['C9'])).toEqual([]);
  });
});

describe('高亮区间', () => {
  it('取的是新文本坐标的 spans，不是原文坐标的 applied', () => {
    expect(spanRanges(sample())).toEqual([{ start: 20, end: 28 }]);
  });

  it('没有改写时是空数组，不是 null', () => {
    expect(spanRanges(null)).toEqual([]);
    expect(spanRanges(sample({ spans: [] }))).toEqual([]);
  });
});