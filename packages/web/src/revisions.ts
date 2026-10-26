/**
 * 采纳改写：前端这一侧的纯逻辑。
 *
 * 界面要回答三个问题，所以这里的函数也按这三件事组织：
 * 1. 我勾了哪几条？（勾选状态只是本地数组，服务端每次都从原文重算）
 * 2. 现在改到哪一步了？（已采纳 / 还没定 / 改不动，三个数分别数）
 * 3. 这次改动了多少？（改完的简历比原文长还是短，用户得看得见）
 *
 * 与 packages/server/src/revisions.ts 是两份代码、同一套语义：前端不能 import shared
 * （node:crypto 会打进浏览器包），所以类型在这里重复声明一份，靠测试对账。
 */

/** 一条落地的改写：区间是**原文**坐标，before 是原文该区间的逐字内容 */
export interface RevisionItem {
  claimId: string;
  start: number;
  end: number;
  before: string;
  after: string;
}

/** 被跳过的建议与理由（人话，直接显示） */
export interface RevisionSkipItem {
  claimId: string;
  reason: string;
}

/** 服务端返回的那一版改完的简历 */
export interface RevisedResume {
  text: string;
  digest: string;
  /** 已落地的改写，原文坐标 */
  applied: RevisionItem[];
  /** 同上，但是**新文本**坐标：给高亮用 */
  spans: RevisionItem[];
  accepted: string[];
  pending: string[];
  skipped: RevisionSkipItem[];
  updatedAt: string;
}

/** 勾选 / 取消一条建议。勾选顺序不影响结果：服务端每次都从原文重算。 */
export function toggleAccepted(current: readonly string[], claimId: string): string[] {
  return current.indexOf(claimId) < 0 ? [...current, claimId] : current.filter((id) => id !== claimId);
}

/** 一次勾上所有候选（界面上是「全部采纳」那颗按钮） */
export function acceptAll(candidates: readonly string[]): string[] {
  return [...candidates];
}

export interface RevisionSummary {
  /** 已经落到简历上的条数 */
  accepted: number;
  /** 有建议、但这次没勾的条数 */
  pending: number;
  /** 勾了却改不动的条数 */
  skipped: number;
  /** 勾了但还没提交的条数：按钮上那个数字就是它 */
  chosen: number;
}

export function revisionSummary(revised: RevisedResume | null, chosen: readonly string[]): RevisionSummary {
  if (revised === null) {
    return { accepted: 0, pending: 0, skipped: 0, chosen: chosen.length };
  }
  return {
    accepted: revised.accepted.length,
    pending: revised.pending.length,
    skipped: revised.skipped.length,
    chosen: chosen.length,
  };
}

/** 改完的简历比原文多了还是少了几字。导出前让人知道改动幅度，而不是给一个新文本框。 */
export function revisedDelta(original: string, revised: RevisedResume | null): number {
  return revised === null ? 0 : revised.text.length - original.length;
}

/** 某条主张为什么没改成；没被跳过就返回 null */
export function skippedReason(revised: RevisedResume | null, claimId: string): string | null {
  if (revised === null) return null;
  const found = revised.skipped.find((item) => item.claimId === claimId);
  return found === undefined ? null : found.reason;
}

/** 这条主张是不是已经被采纳进当前这一版简历里了 */
export function isAccepted(revised: RevisedResume | null, claimId: string): boolean {
  return revised !== null && revised.accepted.indexOf(claimId) >= 0;
}

/** 高亮用的区间：把 spans 收敛成 highlight.ts 认的形状 */
export function spanRanges(revised: RevisedResume | null): { start: number; end: number }[] {
  if (revised === null) return [];
  return revised.spans.map((item) => ({ start: item.start, end: item.end }));
}
