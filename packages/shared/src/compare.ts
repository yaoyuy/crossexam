/**
 * 简历版本对比（P11 · C1）。
 *
 * ¤改完再跑一遍¤ 这句话本身不需要任何新机制——建一场新会话就行。
 * 难的是让评委看见**改动的效果**：同一处主张，上一场判成什么、这一场判成什么。
 * 主张 id（C1..Cn）每场都从 1 重新编号，跨场次毫无意义——
 * 上一场的 C1 是订单重构，这一场的 C1 可能是某张证书。所以这一层只做一件事：
 * 用文本相似度把两场的主张一对一牵起来，牵上了才能比。
 *
 * 三个刻意的设计：
 * 1. 纯函数、不调模型。对比结论必须能在离线回放里一模一样地复现；
 *    要是让模型来判断¤这两句是不是同一件事¤，换一次模型就可能得出另一个结论，
 *    ¤比上次更好¤ 这种话就没有说服力了。
 * 2. 相似度用字符二元组 Jaccard。中文没有空格分词，二元组是零依赖里最稳的做法；
 *    它天生对语序不敏感、对虚词不敏感，正好对上¤改写只调措辞¤这个前提。
 * 3. 阈值是显式参数而不是魔数。改简历的力度可大可小，阈值给太高会让
 *    所有主张都变成¤新增¤，此时对比表看着很热闹、其实全是空的。
 */

import type { VerdictKind } from './domain.ts';
import { VERDICT_LABEL } from './domain.ts';
import type { JudgedClaimLike } from './shortfall.ts';
import { WEAKNESS_RANK } from './shortfall.ts';

/**
 * 判定变化：站在求职者角度说，不是站在仪表盘角度。
 * ¤没判定¤ 单独一档——判定阶段失败、或者会话跑了一半时，两边本来就没得比，
 * 混进¤没变¤会让人以为¤这条查过了¤。
 */
export type ShiftKind = 'better' | 'same' | 'worse' | 'unjudged';

export const SHIFT_LABEL: Record<ShiftKind, string> = {
  better: '变好',
  same: '没变',
  worse: '变差',
  unjudged: '没判定',
};

/**
 * 默认阈值。定在 0.34 是拿真实简历试出来的：
 * 同一处经历换个说法（¤把…降到了¤ → ¤…降至¤）大致落在 0.45–0.65；
 * 毫不相干的两条主张（一条写证书、一条写性能数字）几乎为 0；
 * 只用同一个主语、其余全不同的两条大约 0.2。0.34 落在后面那个空隙里。
 */
export const DEFAULT_ALIGN_THRESHOLD = 0.34;

/** 相似度保留四位小数：浮点数不该带着 0.49999999999999994 进报告 */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * 归一化：去掉所有空白与常见标点，只留下可比的字。
 * 不做同义词替换——那是另一件事（改写），放进对比会让人分不清
 * 到底是文本变了还是我们的口径变了。
 */
function squash(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    const code = ch.codePointAt(0) ?? 0;
    // 全角标点与常见 ASCII 标点一并去掉：它们不承载事实。
    if (code >= 0x3000 && code <= 0x303f) continue;
    if (code >= 0xff00 && code <= 0xff65) continue;
    if (code === 96) continue;
    if ('，。、；：！？（）【】《》·.,;:!?()[]{}<>"'.indexOf(ch) >= 0) continue;
    if ('-—_/|+=*&^%$#@~“”‘’「」'.indexOf(ch) >= 0) continue;
    out += ch;
  }
  return out.toLowerCase();
}

/** 字符二元组集合。单字文本退化成单字集合，空文本就是空集合。 */
export function bigramsOf(text: string): Set<string> {
  const body = squash(text);
  const set = new Set<string>();
  if (body.length === 0) return set;
  if (body.length === 1) {
    set.add(body);
    return set;
  }
  for (let i = 0; i + 1 < body.length; i += 1) set.add(body.slice(i, i + 2));
  return set;
}

/** Jaccard：交集 / 并集。两边都空时算 0——两条空主张谈不上¤同一件事¤。 */
export function textSimilarity(a: string, b: string): number {
  const left = bigramsOf(a);
  const right = bigramsOf(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  const union = left.size + right.size - shared;
  if (union <= 0) return 0;
  return round4(shared / union);
}

/** 牵起来的一对：上一场的某条 ↔ 这一场的某条 */
export interface AlignedPair {
  prev: JudgedClaimLike;
  next: JudgedClaimLike;
  similarity: number;
}

export interface ClaimAlignment {
  pairs: AlignedPair[];
  /** 只在这一场出现：新加的、或者上一场被拆成了两条 */
  added: JudgedClaimLike[];
  /** 只在上一场出现：删掉的、或者改写后已经不像同一条 */
  removed: JudgedClaimLike[];
}

/**
 * 一对一贪心牵线。
 *
 * 为什么不是最优匹配（匈牙利算法那类）：主张数量是个位数到十几条，
 * 贪心已经能得到同样的结果，而且**顺序是确定的**——先看最像的一对。
 * 换成最优匹配反而多一处需要解释的实现，报告的结论还得再解释一遍。
 * 排序的兜底键是两边原始下标，保证同样的输入永远得到同样的配对。
 */
export function alignClaims(
  prev: readonly JudgedClaimLike[],
  next: readonly JudgedClaimLike[],
  threshold: number = DEFAULT_ALIGN_THRESHOLD,
): ClaimAlignment {
  const candidates: { prevIndex: number; nextIndex: number; similarity: number }[] = [];
  for (let i = 0; i < prev.length; i += 1) {
    const left = prev[i];
    if (left === undefined) continue;
    for (let j = 0; j < next.length; j += 1) {
      const right = next[j];
      if (right === undefined) continue;
      const similarity = textSimilarity(left.text, right.text);
      if (similarity < threshold) continue;
      candidates.push({ prevIndex: i, nextIndex: j, similarity });
    }
  }
  candidates.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    if (a.prevIndex !== b.prevIndex) return a.prevIndex - b.prevIndex;
    return a.nextIndex - b.nextIndex;
  });
  const usedPrev = new Set<number>();
  const usedNext = new Set<number>();
  const pairs: AlignedPair[] = [];
  for (const item of candidates) {
    if (usedPrev.has(item.prevIndex) || usedNext.has(item.nextIndex)) continue;
    usedPrev.add(item.prevIndex);
    usedNext.add(item.nextIndex);
    const left = prev[item.prevIndex];
    const right = next[item.nextIndex];
    if (left === undefined || right === undefined) continue;
    pairs.push({ prev: left, next: right, similarity: item.similarity });
  }
  // 按这一场的顺序摆：报告是按新简历从上往下读的；上一场删掉的那几条挂在最后。
  pairs.sort((a, b) => next.indexOf(a.next) - next.indexOf(b.next));
  const added: JudgedClaimLike[] = [];
  for (let j = 0; j < next.length; j += 1) {
    const right = next[j];
    if (right !== undefined && !usedNext.has(j)) added.push(right);
  }
  const removed: JudgedClaimLike[] = [];
  for (let i = 0; i < prev.length; i += 1) {
    const left = prev[i];
    if (left !== undefined && !usedPrev.has(i)) removed.push(left);
  }
  return { pairs, added, removed };
}

/**
 * 一条主张跨两场的判定变化。
 *
 * 方向靠 WEAKNESS_RANK（欠证据的程度）定：程度下降是变好，上升是变差。
 * 这个排名在 P10 A3 里就已经是¤短板¤的唯一口径了，这里复用而不是另起一套——
 * 两套口径迟早会打架，界面上说¤变好¤、报告里说¤更差了¤。
 * 任一边没判定就老实说没判定：把¤没判¤算成¤没变¤是在替模型下结论。
 */
export function verdictShift(prev: VerdictKind | null, next: VerdictKind | null): ShiftKind {
  if (prev === null || next === null) return 'unjudged';
  const before = WEAKNESS_RANK[prev];
  const after = WEAKNESS_RANK[next];
  if (after < before) return 'better';
  if (after > before) return 'worse';
  return 'same';
}

export interface ComparedPair extends AlignedPair {
  shift: ShiftKind;
}

export interface VerdictCounts {
  judged: number;
  solid: number;
  /** judged - solid */
  weak: number;
  counts: Partial<Record<VerdictKind, number>>;
}

/** 判定分布。只统计出现过的判定，省得界面上摆一排 0。 */
export function verdictCounts(claims: readonly JudgedClaimLike[]): VerdictCounts {
  const counts: Partial<Record<VerdictKind, number>> = {};
  let judged = 0;
  let solid = 0;
  for (const claim of claims) {
    if (claim.verdict === null) continue;
    judged += 1;
    if (claim.verdict === 'solid') solid += 1;
    counts[claim.verdict] = (counts[claim.verdict] ?? 0) + 1;
  }
  return { judged, solid, weak: judged - solid, counts };
}

/** 一场会话里对比需要的东西。追问次数取不到就传 null，不许猜 0。 */
export interface RunSnapshot {
  claims: readonly JudgedClaimLike[];
  probes?: number | null;
}

export interface ClaimComparison {
  threshold: number;
  pairs: ComparedPair[];
  added: JudgedClaimLike[];
  removed: JudgedClaimLike[];
  before: VerdictCounts;
  after: VerdictCounts;
  improved: ComparedPair[];
  worsened: ComparedPair[];
  probesBefore: number | null;
  probesAfter: number | null;
  /** 一句话结论，报告与界面共用；两边各写一句迟早不一致 */
  headline: string;
}

function arrow(before: number, after: number): string {
  return String(before) + ' → ' + String(after);
}

function shiftWord(shift: ShiftKind): string {
  if (shift === 'better') return '变好';
  if (shift === 'worse') return '变差';
  return SHIFT_LABEL[shift];
}

/**
 * 一句话结论。写给¤想立刻知道这一版有没有用¤的人看，所以先说站得住几条。
 * 新增 / 删除也要说：只报了变好、没说主张从 12 条变成 8 条，读者会以为改得更好了，
 * 其实是删掉了难答的部分——那正是这份对比要防的事。
 */
export function compareHeadline(comparison: Omit<ClaimComparison, 'headline'>): string {
  const parts: string[] = [];
  parts.push(
    '站得住 ' + arrow(comparison.before.solid, comparison.after.solid) + ' 条（共 ' +
      arrow(comparison.before.judged, comparison.after.judged) + ' 条判定）',
  );
  if (comparison.improved.length > 0) parts.push('变好 ' + String(comparison.improved.length) + ' 条');
  if (comparison.worsened.length > 0) parts.push('变差 ' + String(comparison.worsened.length) + ' 条');
  if (comparison.added.length > 0) parts.push('新增 ' + String(comparison.added.length) + ' 条');
  if (comparison.removed.length > 0) parts.push('不在上一版了 ' + String(comparison.removed.length) + ' 条');
  if (comparison.probesBefore !== null && comparison.probesAfter !== null) {
    parts.push('追问 ' + arrow(comparison.probesBefore, comparison.probesAfter) + ' 次');
  }
  return parts.join('，');
}

/** 对比两场。第二个参数是¤这一场¤，报告与界面都按这个方向读。 */
export function compareRuns(
  prev: RunSnapshot,
  next: RunSnapshot,
  options: { threshold?: number } = {},
): ClaimComparison {
  const threshold = options.threshold ?? DEFAULT_ALIGN_THRESHOLD;
  const alignment = alignClaims(prev.claims, next.claims, threshold);
  const pairs: ComparedPair[] = alignment.pairs.map((pair) => ({
    ...pair,
    shift: verdictShift(pair.prev.verdict, pair.next.verdict),
  }));
  const improved = pairs.filter((pair) => pair.shift === 'better');
  const worsened = pairs.filter((pair) => pair.shift === 'worse');
  const before = verdictCounts(prev.claims);
  const after = verdictCounts(next.claims);
  const partial: Omit<ClaimComparison, 'headline'> = {
    threshold,
    pairs,
    added: alignment.added,
    removed: alignment.removed,
    before,
    after,
    improved,
    worsened,
    probesBefore: prev.probes ?? null,
    probesAfter: next.probes ?? null,
  };
  return { ...partial, headline: compareHeadline(partial) };
}

/**
 * 给每一条对比结果配一句人话，报告与界面共用。
 * 不配的话读者只看到 ¤unsupported → solid¤ 两个英文词，
 * 而这两个词在界面上本来就标着中文（判定标签），这里必须对齐同一套词。
 */
export function shiftDetail(pair: ComparedPair): string {
  const before = pair.prev.verdict === null ? '未判定' : VERDICT_LABEL[pair.prev.verdict];
  const after = pair.next.verdict === null ? '未判定' : VERDICT_LABEL[pair.next.verdict];
  return before + ' → ' + after + '（' + shiftWord(pair.shift) + '）';
}
