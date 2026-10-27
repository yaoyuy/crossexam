/**
 * 一岗一版：按岗位要求把简历挑一遍，只做「留下 / 去掉」，一个字的表述都不改。
 *
 * 为什么不顺手改写：改写已经由 suggest 通道负责（有锚点、有数字闸门、有三档收敛程度）。
 * 让两条路都能改同一句话，等于给「简历里为什么会多出一个数字」留两个入口——
 * 这正是 F27 那类事故的温床。所以这里只有选择与排序，没有生成。
 *
 * 为什么无关的行也留下：岗位没提教育背景，不等于教育背景该删。
 * 只有「这条主张对不上这个岗位的任何一条要求」才去掉那一行——被去掉的每一行都能逐条解释。
 */
import type { Anchor, Requirement, RequirementMatch } from './domain.ts';
import type { ResumeSegment } from './segment.ts';
import { segmentResume } from './segment.ts';
import type { Revision } from './revise.ts';

const NL = String.fromCharCode(10);

/** 这一行为什么留下 / 为什么去掉 */
export type TailorReason = 'no-claim' | 'matched' | 'unmatched';

export const TAILOR_REASON_LABEL: Record<TailorReason, string> = {
  'no-claim': '这一行没有可被追问的主张，任何岗位都留着',
  matched: '这条主张对得上这个岗位的要求',
  unmatched: '这条主张对不上这个岗位的任何要求',
};

export interface TailorLine {
  /** 原文段号 */
  index: number;
  text: string;
  keep: boolean;
  /** 小节标题行：永远留下——删了它读者就不知道下面那段是什么 */
  header: boolean;
  reason: TailorReason;
  claimIds: string[];
  /** 因为对上了哪几条要求才留下（reason 为 matched 时非空） */
  requirementIds: string[];
}

export interface TailorResult {
  jdTitle: string;
  /** false 表示一条主张都对不上，这一版没敢筛，text 仍是原文 */
  ok: boolean;
  /** 空态说明或补充说明；没问题时为 null */
  note: string | null;
  text: string;
  lines: TailorLine[];
  keptSegments: number;
  droppedSegments: number;
  keptClaims: string[];
  droppedClaims: string[];
  /** 这个岗位有多少条要求简历里根本没写（缺口，不生成追问，见 D43） */
  missingRequirements: number;
  headline: string;
}

export interface TailorClaimLike {
  id: string;
  anchor: Anchor;
}

export interface TailorInput {
  /** 基础文本：没采纳过改写就是简历原文，采纳过就是改完的那一版 */
  text: string;
  claims: readonly TailorClaimLike[];
  /** 把主张坐标从原文挪到 text 上；没采纳过就传空数组（坐标恒等） */
  applied?: readonly Revision[];
  /** 这个岗位的要求（已由调用方按 JD 过滤） */
  requirements: readonly Requirement[];
  /** 这些要求与主张的对照结果（同样已按 JD 过滤） */
  matches: readonly RequirementMatch[];
  jdTitle: string;
}

export interface ClaimRange {
  claimId: string;
  start: number;
  end: number;
}

/**
 * 把每条主张的坐标挪到 text 上。
 *
 * 采纳过改写时，一条主张的新坐标不是「原文坐标 + 位移」这么简单：
 * 被整句改写过的那条，改后长度与改前不同，得用改动区间算新长度。
 * 只认「改动区间与主张区间完全重合」这一种情况——宁可退回位移近似，也不要猜半个区间。
 */
export function claimRanges(
  claims: readonly TailorClaimLike[],
  applied: readonly Revision[] = [],
): ClaimRange[] {
  const ordered = applied.slice().sort((a, b) => a.start - b.start);
  const shiftBefore = (at: number): number => {
    let delta = 0;
    for (const item of ordered) {
      if (item.end <= at) delta += item.after.length - item.before.length;
      else break;
    }
    return delta;
  };
  return claims.map((claim) => {
    const exact = ordered.find((item) => item.start === claim.anchor.start && item.end === claim.anchor.end);
    if (exact !== undefined) {
      const start = exact.start + shiftBefore(exact.start);
      return { claimId: claim.id, start, end: start + Math.max(exact.after.length, 1) };
    }
    const delta = shiftBefore(claim.anchor.start);
    return { claimId: claim.id, start: claim.anchor.start + delta, end: claim.anchor.end + delta };
  });
}

function claimsIn(segment: ResumeSegment, ranges: readonly ClaimRange[]): ClaimRange[] {
  return ranges.filter((range) => range.start >= segment.start && range.start < segment.end);
}

export function tailorHeadline(keptClaims: number, droppedClaims: number, missing: number, jdTitle: string): string {
  const head =
    '按《' + jdTitle + '》：留下 ' + String(keptClaims) + ' 条主张、去掉 ' + String(droppedClaims) + ' 条';
  return missing === 0 ? head : head + '，另有 ' + String(missing) + ' 条要求简历里没写';
}

export function tailorResume(input: TailorInput): TailorResult {
  const ranges = claimRanges(input.claims, input.applied ?? []);
  const bounds = ranges.filter((range) => range.start >= 0 && range.end <= input.text.length);
  const relevant = new Map<string, string[]>();
  for (const match of input.matches) {
    if (match.claimId === null || match.status === 'missing') continue;
    const list = relevant.get(match.claimId) ?? [];
    if (!list.includes(match.requirementId)) list.push(match.requirementId);
    relevant.set(match.claimId, list);
  }
  const missing = input.requirements.length - input.matches.filter((m) => m.status !== 'missing').length;

  // 还没上传岗位要求：没有可对照的东西，这一版就是原文——不摆出一副「筛过了」的样子。
  if (input.requirements.length === 0) {
    return {
      jdTitle: input.jdTitle,
      ok: true,
      note: '还没有这个岗位的要求可以对照，这一版就是原文。',
      text: input.text,
      lines: [],
      keptSegments: 0,
      droppedSegments: 0,
      keptClaims: [],
      droppedClaims: [],
      missingRequirements: 0,
      headline: '没有可对照的要求，这一版就是原文',
    };
  }

  // 一条都对不上就别筛：真筛下去会把所有成果都筛掉，交回去的是一份空壳。
  if (relevant.size === 0) {
    return {
      jdTitle: input.jdTitle,
      ok: false,
      note:
        '这份简历没有一条主张对得上《' + input.jdTitle +
        '》的要求。真按岗位筛，会把所有成果都筛掉——与其给你一份空壳，不如先补缺口。',
      text: input.text,
      lines: [],
      keptSegments: 0,
      droppedSegments: 0,
      keptClaims: [],
      droppedClaims: [],
      missingRequirements: missing,
      headline: '没有一条对得上，这一版没敢筛',
    };
  }

  const outline = segmentResume(input.text);
  const byStart = new Map<number, ResumeSegment>();
  for (const segment of outline.segments) byStart.set(segment.start, segment);

  const lines: TailorLine[] = [];
  const keptLines: string[] = [];
  const keptClaims: string[] = [];
  const droppedClaims: string[] = [];
  let keptSegments = 0;
  let droppedSegments = 0;
  let droppedAnything = false;

  let cursor = 0;
  for (;;) {
    let eol = input.text.indexOf(NL, cursor);
    const rawEnd = eol;
    if (eol < 0) eol = input.text.length;
    const raw = input.text.slice(cursor, eol);
    const leading = raw.length - raw.trimStart().length;
    const segment = byStart.get(cursor + leading);
    if (segment === undefined) {
      keptLines.push(raw);
    } else {
      const inside = claimsIn(segment, bounds);
      const claimIds = inside.map((range) => range.claimId);
      const requirementIds: string[] = [];
      for (const claimId of claimIds) {
        for (const requirementId of relevant.get(claimId) ?? []) {
          if (!requirementIds.includes(requirementId)) requirementIds.push(requirementId);
        }
      }
      const header = segment.kind === 'header';
      const matched = requirementIds.length > 0;
      const keep = header || claimIds.length === 0 || matched;
      const reason: TailorReason = header || claimIds.length === 0 ? 'no-claim' : matched ? 'matched' : 'unmatched';
      lines.push({ index: segment.index, text: segment.text, keep, header, reason, claimIds, requirementIds });
      if (keep) {
        keptSegments += 1;
        keptLines.push(raw);
        for (const claimId of claimIds) if (!keptClaims.includes(claimId)) keptClaims.push(claimId);
      } else {
        droppedSegments += 1;
        droppedAnything = true;
        for (const claimId of claimIds) if (!droppedClaims.includes(claimId)) droppedClaims.push(claimId);
      }
    }
    if (rawEnd < 0) break;
    cursor = rawEnd + 1;
  }

  let text = keptLines.join(NL);
  if (droppedAnything) text = text.replace(/(\n\s*){3,}/g, NL + NL);
  text = text.replace(/[ \t]+$/gm, '').trim() + NL;
  if (!droppedAnything) text = input.text.endsWith(NL) ? input.text : input.text + NL;

  return {
    jdTitle: input.jdTitle,
    ok: true,
    note: droppedClaims.length === 0 ? '这个岗位没有筛掉任何一条主张：这份简历对得上它。' : null,
    text,
    lines,
    keptSegments,
    droppedSegments,
    keptClaims,
    droppedClaims,
    missingRequirements: missing,
    headline: tailorHeadline(keptClaims.length, droppedClaims.length, missing, input.jdTitle),
  };
}
