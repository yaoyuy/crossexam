/**
 * 采纳改写建议：把「改前 / 改后」真正落到简历文本上。
 *
 * 三条硬约束，写在代码里而不是写在文档里：
 *
 * 1. **只认原文区间，不认客户端传来的文本。** 采纳请求只带 claimId，改前改后
 *    一律从数据库里那份建议读出来；否则「把简历改一遍」就变成了一个接受任意
 *    字符串替换的接口。
 * 2. **区间必须落在原文上。** 用 isGrounded 复核一次，锚不上的建议一律跳过并
 *    给出理由，绝不「按记忆里的位置硬替换」——一次错位会把整份简历改乱。
 * 3. **倒序应用。** 一条建议改完，它后面的所有字符位置都会平移。从后往前改，
 *    前面的区间就不用重算；同时用一个右边界护栏挡住区间重叠的两条建议，
 *    保证结果与「先改哪条」无关。
 */

import type { Suggestion } from './domain.ts';
import { normalizeWithMap } from './anchor.ts';
import { shortHash } from './util.ts';

/** 一条被采纳的改写：区间是**原文**里的位置，before 是原文该区间的逐字内容 */
export interface Revision {
  claimId: string;
  start: number;
  end: number;
  before: string;
  after: string;
}

/** 被跳过的建议：理由要能直接显示给用户看 */
export interface RevisionSkip {
  claimId: string;
  reason: string;
}

export interface ReviseResult {
  /** 改完之后的简历全文 */
  text: string;
  /** 真正落地的改写，按原文位置**升序**排列（便于展示） */
  applied: Revision[];
  skipped: RevisionSkip[];
}

/** 建议 → 改写。after 为空或与 before 相同的不算改写（suggest 阶段已拦，这里再兜一次）。 */
export function revisionOf(claimId: string, suggestion: Suggestion): Revision {
  return {
    claimId,
    start: suggestion.anchor.start,
    end: suggestion.anchor.end,
    before: suggestion.before,
    after: suggestion.after,
  };
}

/** 采纳记录的指纹：改完的简历变了，指纹就该变 */
export function reviseDigest(text: string): string {
  return shortHash(text, 16);
}

/**
 * 两段文本是否指的是同一段原文。
 *
 * 只比归一化后的结果（空白折叠、全半角标点统一、大小写统一），不比原始字节：
 * 锚定阶段本来就是归一化命中的，要求这里逐字节相等，会让「标点被模型写成全角」
 * 这种完全无害的差异变成一条改不动的建议。
 */
function sameText(actual: string, claimed: string): boolean {
  if (actual === claimed) return true;
  const a = normalizeWithMap(actual).norm.trim();
  const b = normalizeWithMap(claimed).norm.trim();
  return a.length > 0 && a === b;
}

/**
 * 把若干条改写应用到简历原文上。
 *
 * 结果是确定性的：同样的原文 + 同样的一组改写，无论传入顺序如何，
 * 得到逐字节相同的结果（因此也得到相同的指纹）。
 */
export function applyRevisions(resumeText: string, revisions: readonly Revision[]): ReviseResult {
  // 升序扫一遍：每条都与「上一条真正落地」的右边界比，重叠的后者让位。
  // 这样既不用倒序改文本（下面的文本替换仍然按升序逐次做，因为每次都基于最新的 text），
  // 也保证了结果与传入顺序无关。
  const ordered = revisions
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (a.item.start !== b.item.start) return a.item.start - b.item.start;
      return a.item.claimId < b.item.claimId ? -1 : a.item.claimId > b.item.claimId ? 1 : 0;
    });

  const applied: Revision[] = [];
  const skips: { index: number; skip: RevisionSkip }[] = [];
  let text = resumeText;
  // 已经落地的最右边界：下一条的 start 不能落在它左边
  let lastEnd = -1;
  // 文本已经被改过多少：每落地一条，后面所有位置就平移这么多
  let delta = 0;

  for (const entry of ordered) {
    const item = entry.item;
    const start = item.start;
    const end = item.end;
    const skip = (reason: string): void => {
      skips.push({ index: entry.index, skip: { claimId: item.claimId, reason } });
    };

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > resumeText.length || end <= start) {
      skip('改写区间不在简历正文范围内');
      continue;
    }
    if (item.after.length === 0) {
      skip('改写后的内容是空的');
      continue;
    }
    if (start < lastEnd) {
      skip('与另一条已采纳的改写落在同一段原文上，只保留一条');
      continue;
    }
    // 只认原文：区间上真实的那段字必须与「改前」对得上（允许空白与全半角标点差异，
    // 因为锚定阶段本来就是归一化命中的）。对不上就拒绝，绝不错位硬改。
    if (!sameText(resumeText.slice(start, end), item.before)) {
      skip('改前原文与简历对不上（简历可能已经被改过）');
      continue;
    }

    const at = start + delta;
    text = text.slice(0, at) + item.after + text.slice(at + (end - start));
    // before 一律取原文该区间的逐字内容：模型给的 before 可能少个空格，
    // 展示时要用原文，否则「改前」那一行会让人以为简历里真有那句。
    applied.push({ claimId: item.claimId, start, end, before: resumeText.slice(start, end), after: item.after });
    lastEnd = end;
    delta += item.after.length - (end - start);
  }

  // 跳过原因按调用方给的顺序返回：界面是照采纳列表逐条提示的
  skips.sort((a, b) => a.index - b.index);
  return { text, applied, skipped: skips.map((entry) => entry.skip) };
}

/**
 * 改写落位之后，每条改动在**新文本**里的区间。
 *
 * 导出带高亮的简历时要用它：applied 的区间是原文坐标，
 * 前面每改一条，后面的位置就平移 after.length - (end - start)。
 * 只需要 applied：applied 已经是按原文位置升序排好的，平移量可以自己累加出来，
 * 再传一份原文进来反而给了「两份原文不一致」的机会。
 */
export function movedSpans(applied: readonly Revision[]): Revision[] {
  const out: Revision[] = [];
  let delta = 0;
  for (const item of applied) {
    const start = item.start + delta;
    const end = start + item.after.length;
    out.push({ claimId: item.claimId, start, end, before: item.before, after: item.after });
    delta += item.after.length - (item.end - item.start);
  }
  return out;
}

/**
 * 改完之后还剩哪些问题没有处理。
 *
 * 给界面用：用户采纳了三条、还有五条没理，要能一眼看出「还没改完」，
 * 而不是以为导出就等于改好了。
 */
export function pendingClaimIds(all: readonly string[], accepted: readonly string[]): string[] {
  return all.filter((id) => accepted.indexOf(id) < 0);
}
