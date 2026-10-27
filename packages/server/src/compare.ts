/**
 * 版本对比的服务层（P11 · C1）。
 *
 * 纯计算在 packages/shared/src/compare.ts，这里只做三件事：
 * 把两场会话的主张从库里读出来、把追问次数数清楚、把链的合法性守住。
 *
 * 为什么不在 SQL 里做对比：对齐是一条纯函数，把它写进 SQL 就等于
 * 让「同一份结论」出现两份实现，而报告与界面已经够容易出现两个数字了。
 */
import type { Db } from './store/db.ts';
import { getSession, listClaims, listProbes } from './store/repo.ts';
import type { ClaimComparison, JudgedClaimLike, RunSnapshot } from '@crossexam/shared';
import { compareRuns } from '@crossexam/shared';

/**
 * 一条会话的对比结果。
 *
 * ¤第一版¤ 是一个正常状态而不是错误：大部分场次本来就没有上一版。
 * 所以 first 与 comparison 分成两块，前端不必靠 ¤comparison 为 null¤ 去猜原因——
 * 「没有父会话」和「父会话被删了」在界面上要说不同的话。
 */
export interface CompareView {
  sessionId: string;
  /** 没有父会话：这是第一版，没什么可比的 */
  first: boolean;
  /** 记了父会话 id，但那一场已经不在了（被删库、或从别的机器搬过来的库） */
  parentMissing: boolean;
  parentSessionId: string | null;
  parent: {
    id: string;
    jobTitle: string;
    createdAt: string;
    /** 父会话的简历版本指纹：两份简历是否真的一样，只看这个 */
    resumeHash: string;
  } | null;
  /** 父会话的简历与这一场是不是同一份（改过就会不同） */
  resumeChanged: boolean;
  comparison: ClaimComparison | null;
}

function snapshotOf(db: Db, sessionId: string): RunSnapshot {
  const claims: JudgedClaimLike[] = listClaims(db, sessionId).map((claim) => ({
    id: claim.id,
    text: claim.text,
    category: claim.category,
    // verdict 可能是 undefined（老数据），统一成 null：比较层只认「有没有判定」
    verdict: claim.verdict ?? null,
  }));
  return { claims, probes: listProbes(db, sessionId).length };
}

/**
 * 这一场跟它的父会话比一比。没有父会话时返回 first: true。
 *
 * 为什么这里没有环检测：版本链只在建档那一次写入，而那一场的 id 是服务端新生成的——
 * 一个还不存在的 id 不可能已经出现在任何一条父链上，环在结构上就长不出来。
 * 真正的风险不是环，是父会话被删了（parentMissing），那一种老实地单列一档。
 */
export function compareSessions(db: Db, sessionId: string): CompareView | null {
  const session = getSession(db, sessionId);
  if (session === null) return null;
  const parentId = session.parentSessionId;
  if (parentId === null || parentId === '') {
    return {
      sessionId,
      first: true,
      parentMissing: false,
      parentSessionId: null,
      parent: null,
      resumeChanged: false,
      comparison: null,
    };
  }
  const parent = getSession(db, parentId);
  if (parent === null) {
    return {
      sessionId,
      first: false,
      parentMissing: true,
      parentSessionId: parentId,
      parent: null,
      resumeChanged: true,
      comparison: null,
    };
  }
  return {
    sessionId,
    first: false,
    parentMissing: false,
    parentSessionId: parent.id,
    parent: {
      id: parent.id,
      jobTitle: parent.jobTitle,
      createdAt: parent.createdAt,
      resumeHash: parent.resumeHash,
    },
    resumeChanged: parent.resumeHash !== session.resumeHash,
    comparison: compareRuns(snapshotOf(db, parent.id), snapshotOf(db, sessionId)),
  };
}
