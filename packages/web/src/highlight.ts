/**
 * 简历原文的高亮切分。
 *
 * 纯函数、无 React 依赖，因为「哪一段原文被引用过」是产品的核心可视化，
 * 值得单独测（见 packages/web/test/highlight.test.ts）。
 */
export interface Range {
  start: number;
  end: number;
}

export type SegmentKind = 'plain' | 'hit' | 'focus';

export interface Segment {
  text: string;
  kind: SegmentKind;
}

export function clampRange(range: Range, length: number): Range | null {
  const start = Math.max(0, Math.min(range.start, length));
  const end = Math.max(0, Math.min(range.end, length));
  return end > start ? { start, end } : null;
}

/** 把重叠或相邻的区间并起来，避免在原文上叠出一堆同色小块 */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.start <= last.end) {
      if (range.end > last.end) last.end = range.end;
      continue;
    }
    merged.push({ start: range.start, end: range.end });
  }
  return merged;
}

function anchorsToRanges(anchors: Range[], length: number): Range[] {
  const ranges: Range[] = [];
  for (const anchor of anchors) {
    const clamped = clampRange(anchor, length);
    if (clamped !== null) ranges.push(clamped);
  }
  return mergeRanges(ranges);
}

/**
 * 切成 普通 / 被引用过 / 当前聚焦 三种片段。聚焦优先于被引用过，
 * 这样「点了一条引文」时那一段一定是亮的，不会淹没在满屏高亮里。
 */
export function buildSegments(text: string, focus: Range | null, hits: Range[]): Segment[] {
  if (text.length === 0) return [];
  const focusRange = focus === null ? null : clampRange(focus, text.length);
  const hitRanges = anchorsToRanges(hits, text.length);

  const cuts = new Set<number>([0, text.length]);
  for (const range of hitRanges) {
    cuts.add(range.start);
    cuts.add(range.end);
  }
  if (focusRange !== null) {
    cuts.add(focusRange.start);
    cuts.add(focusRange.end);
  }

  const sorted = [...cuts].filter((point) => point >= 0 && point <= text.length).sort((a, b) => a - b);
  const segments: Segment[] = [];

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const start = sorted[i] ?? 0;
    const end = sorted[i + 1] ?? 0;
    if (end <= start) continue;
    const inFocus = focusRange !== null && focusRange.start <= start && end <= focusRange.end;
    const inHit = hitRanges.some((range) => range.start <= start && end <= range.end);
    const kind: SegmentKind = inFocus ? 'focus' : inHit ? 'hit' : 'plain';
    const previous = segments[segments.length - 1];
    if (previous !== undefined && previous.kind === kind) previous.text += text.slice(start, end);
    else segments.push({ text: text.slice(start, end), kind });
  }

  return segments;
}

/** 把区间换算成人看的「第 12–28 字」 */
export function describeRange(range: Range): string {
  return '第 ' + String(range.start + 1) + '–' + String(range.end) + ' 字';
}
