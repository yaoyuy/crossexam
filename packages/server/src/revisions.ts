/**
 * 采纳改写：把「改前 / 改后」真正落到简历上，并记住是哪几条。
 *
 * 三条硬约束：
 *
 * 1. **只认 claimId。** 客户端只说「我采纳 C3」，改前改后一律从库里那份建议读。
 *    接口若接受任意文本替换，就等于把「改简历」做成了一个注入面。
 * 2. **每次都从原文重算。** 采纳记录是集合，不是叠加：先采纳 C1 再采纳 C3，
 *    与一次采纳 [C1, C3] 得到逐字节相同的结果。否则「点了两次」和「点了一次」
 *    会长出两份不同的简历，而用户看不出差在哪。
 * 3. **改不动的要说出理由。** 区间错位、与原文对不上、没有建议——每一条都留一句
 *    人话，界面直接显示。悄悄少改一条是最坏的结果：用户以为改好了。
 */

import { applyRevisions, movedSpans, pendingClaimIds, revisionOf, reviseDigest } from '@crossexam/shared';
import type { Revision, RevisionSkip } from '@crossexam/shared';
import {
  clearRevisions as clearRevisionRows,
  getRevisedResume,
  getSession,
  insertRevision,
  listClaims,
  listRevisions,
  saveRevisedResume,
  withTransaction,
} from './store/index.ts';
import type { Db } from './store/index.ts';

/** 改完的简历 + 三份清单。界面要能回答「确认了几条、还剩几条、哪几条改不动」。 */
export interface RevisedView {
  text: string;
  digest: string;
  /** 已经落地的改写（原文坐标，按原文位置升序） */
  applied: Revision[];
  /** 每条改写在**新文本**里的区间：导出高亮用 */
  spans: Revision[];
  /** 已采纳的主张 id */
  accepted: string[];
  /** 有建议但还没采纳的主张 id */
  pending: string[];
  /** 被跳过的建议与理由 */
  skipped: RevisionSkip[];
  updatedAt: string;
}

export type AcceptResult =
  | { ok: true; view: RevisedView }
  | { ok: false; code: 400 | 404; error: string };

function toView(db: Db, sessionId: string): RevisedView | null {
  const row = getRevisedResume(db, sessionId);
  if (row === null) return null;
  const applied = listRevisions(db, sessionId).map((item) => ({
    claimId: item.claimId,
    start: item.start,
    end: item.end,
    before: item.before,
    after: item.after,
  }));
  return {
    text: row.text,
    digest: row.digest,
    applied,
    spans: movedSpans(applied),
    accepted: row.accepted,
    pending: row.pending,
    skipped: row.skipped,
    updatedAt: row.updatedAt,
  };
}

/** 会话当前那一版改完的简历；没采纳过就是 null。 */
export function revisedOf(db: Db, sessionId: string): RevisedView | null {
  return toView(db, sessionId);
}

/**
 * 采纳一批主张的改写建议，落库并返回新的视图。
 *
 * claimIds 是**本次确认的全部**主张，不是增量：用户取消勾选一条再确认，
 * 那条就该从改完的简历里消失。
 */
export function acceptRevisions(db: Db, sessionId: string, claimIds: readonly string[]): AcceptResult {
  const session = getSession(db, sessionId);
  if (session === null) return { ok: false, code: 404, error: '会话不存在：' + sessionId };

  const claims = listClaims(db, sessionId);
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const wanted: string[] = [];
  for (const id of claimIds) {
    if (wanted.indexOf(id) < 0) wanted.push(id);
  }

  const candidates: Revision[] = [];
  const early: RevisionSkip[] = [];
  for (const id of wanted) {
    const claim = byId.get(id);
    if (claim === undefined) {
      early.push({ claimId: id, reason: '这条主张不在这份简历里' });
      continue;
    }
    if (claim.suggestion === null) {
      early.push({ claimId: id, reason: '这条主张没有改写建议' });
      continue;
    }
    candidates.push(revisionOf(id, claim.suggestion));
  }

  // 一律基于**原文**重算，不读上一版的文本：这就是「采纳记录是集合不是叠加」。
  const result = applyRevisions(session.resumeText, candidates);
  const accepted = result.applied.map((item) => item.claimId);
  const suggested = claims.filter((claim) => claim.suggestion !== null).map((claim) => claim.id);
  const pending = pendingClaimIds(suggested, accepted);

  // 跳过理由按用户点名的顺序排：界面是照采纳列表逐条提示的
  const skipped: RevisionSkip[] = [];
  for (const id of wanted) {
    for (const item of early) if (item.claimId === id) skipped.push(item);
    for (const item of result.skipped) if (item.claimId === id) skipped.push(item);
  }

  const digest = reviseDigest(result.text);
  withTransaction(db, () => {
    clearRevisionRows(db, sessionId);
    result.applied.forEach((item, index) => {
      insertRevision(db, sessionId, item, index);
    });
    saveRevisedResume(db, { sessionId, text: result.text, digest, accepted, pending, skipped });
  });

  const view = toView(db, sessionId);
  if (view === null) return { ok: false, code: 404, error: '会话不存在：' + sessionId };
  return { ok: true, view };
}

/** 撤销全部采纳，回到原文。返回是否真的删掉了东西。 */
export function discardRevisions(db: Db, sessionId: string): boolean {
  if (getSession(db, sessionId) === null) return false;
  const had = getRevisedResume(db, sessionId) !== null;
  withTransaction(db, () => {
    clearRevisionRows(db, sessionId);
  });
  return had;
}

export type { RevisionSkip };
