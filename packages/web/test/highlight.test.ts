import { describe, expect, it } from 'vitest';
import { buildSegments, clampRange, describeRange, mergeRanges } from '../src/highlight.ts';
import type { Range } from '../src/highlight.ts';

const TEXT = 'ABCDEFGHIJ';

function join(segments: { text: string }[]): string {
  return segments.map((s) => s.text).join('');
}

function kinds(segments: { kind: string }[]): string[] {
  return segments.map((s) => s.kind);
}

describe('区间与切分', () => {
  it('区间超出原文就裁掉，空区间返回 null', () => {
    expect(clampRange({ start: -5, end: 3 }, 10)).toEqual({ start: 0, end: 3 });
    expect(clampRange({ start: 8, end: 99 }, 10)).toEqual({ start: 8, end: 10 });
    expect(clampRange({ start: 4, end: 4 }, 10)).toBeNull();
    expect(clampRange({ start: 7, end: 3 }, 10)).toBeNull();
  });

  it('重叠或相接的区间合并，零散区间按起点排序', () => {
    const merged = mergeRanges([
      { start: 6, end: 8 },
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 3, end: 5 },
      { start: 9, end: 12 },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 8 },
      { start: 9, end: 12 },
    ]);
  });

  it('原文为空时不切任何片段', () => {
    expect(buildSegments('', null, [])).toEqual([]);
  });

  it('没有引用时整段是普通片段，拼接回来等于原文', () => {
    const segments = buildSegments(TEXT, null, []);
    expect(kinds(segments)).toEqual(['plain']);
    expect(join(segments)).toBe(TEXT);
  });

  it('单个引用切出 普通/命中/普通 三段', () => {
    const segments = buildSegments(TEXT, null, [{ start: 2, end: 5 }]);
    expect(kinds(segments)).toEqual(['plain', 'hit', 'plain']);
    expect(segments[1]?.text).toBe('CDE');
    expect(join(segments)).toBe(TEXT);
  });

  it('聚焦优先于命中，且相邻同色片段会合并', () => {
    const segments = buildSegments(TEXT, { start: 4, end: 8 }, [{ start: 2, end: 6 }]);
    expect(kinds(segments)).toEqual(['plain', 'hit', 'focus', 'plain']);
    expect(segments.map((s) => s.text)).toEqual(['AB', 'CD', 'EFGH', 'IJ']);
    expect(join(segments)).toBe(TEXT);
  });

  it('引用被并起来后不会叠出一堆同色小块', () => {
    const segments = buildSegments(TEXT, null, [
      { start: 1, end: 4 },
      { start: 3, end: 6 },
      { start: 9, end: 50 },
    ]);
    expect(kinds(segments)).toEqual(['plain', 'hit', 'plain', 'hit']);
    expect(segments.map((s) => s.text)).toEqual(['A', 'BCDEF', 'GHI', 'J']);
    expect(join(segments)).toBe(TEXT);
  });

  it('乱序与越界的引用也不会丢字', () => {
    const ranges: Range[] = [
      { start: 6, end: 9 },
      { start: -3, end: 1 },
      { start: 4, end: 400 },
    ];
    const segments = buildSegments(TEXT, { start: 0, end: 3 }, ranges);
    expect(join(segments)).toBe(TEXT);
    expect(kinds(segments)).toEqual(['focus', 'plain', 'hit']);
    expect(segments.map((s) => s.text)).toEqual(['ABC', 'D', 'EFGHIJ']);
  });

  it('已改写的区间是第四种颜色，优先级排在聚焦之后、命中之前', () => {
    const segments = buildSegments(TEXT, { start: 0, end: 2 }, [{ start: 6, end: 9 }], [{ start: 1, end: 4 }]);
    // 聚焦 0-2 压住已改写的 1-2，已改写 1-4 只是被切短，不丢字
    expect(kinds(segments)).toEqual(['focus', 'revised', 'plain', 'hit', 'plain']);
    expect(segments.map((s) => s.text)).toEqual(['AB', 'CD', 'EF', 'GHI', 'J']);
    expect(join(segments)).toBe(TEXT);
  });

  it('没传已改写区间时行为与从前完全一致', () => {
    const before = buildSegments(TEXT, { start: 4, end: 8 }, [{ start: 2, end: 6 }]);
    const after = buildSegments(TEXT, { start: 4, end: 8 }, [{ start: 2, end: 6 }], []);
    expect(after).toEqual(before);
  });

  it('区间说人话：0 基下标换算成第几字', () => {
    expect(describeRange({ start: 0, end: 5 })).toBe('第 1–5 字');
    expect(describeRange({ start: 11, end: 28 })).toBe('第 12–28 字');
  });
});
