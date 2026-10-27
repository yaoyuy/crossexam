/**
 * 成长档案的服务层（P12 · ②）。
 *
 * 纯计算在 packages/shared/src/growth.ts，这里只做两件事：
 * 沿 session.parent_session_id 往上把版本链走完，再把每场的主张与追问数读出来。
 *
 * 为什么用版本链而不是简历指纹分组：采纳改写之后简历原文必然变了，
 * 指纹认不出亲——这一点 C1 已经定过（ADR-0018），这里沿用同一条口径。
 */
import type { Db } from './store/db.ts';
import { getSession, listClaims, listProbes } from './store/repo.ts';
import type { GrowthSession, GrowthView, JudgedClaimLike } from '@crossexam/shared';
import { growthOf } from '@crossexam/shared';

/** 一条版本链最多往上走这么多版。跑过几十版的人不该让一次打开页面读几十次库。 */
export const GROWTH_MAX_VERSIONS = 12;

export interface GrowthChainView extends GrowthView {
  /** 这一场自己的 id（不一定是链尾：看历史会话时可能从中间某一版点进来） */
  sessionId: string;
  /** 版本链的根（第一版） */
  rootId: string;
  /** 往上走的时候断在半路：有个父会话 id，但那场已经被删了 */
  broken: boolean;
  /** 断在这里的那个 id；没断就是 null */
  brokenAt: string | null;
  /** 实际读到的窗口上限 */
  window: number;
  /** 按时间升序（第一版在前），就是 versions 里元素的 sessionId */
  order: string[];
}

function factsOf(db: Db, sessionId: string): GrowthSession | null {
  const session = getSession(db, sessionId);
  if (session === null) return null;
  const claims: JudgedClaimLike[] = listClaims(db, sessionId).map((claim) => ({
    id: claim.id,
    text: claim.text,
    category: claim.category,
    verdict: claim.verdict ?? null,
  }));
  return {
    id: session.id,
    createdAt: session.createdAt,
    jobTitle: session.jobTitle,
    claims,
    // 真实行数，不拿预算里的估计值顶替——两者不是一回事
    probes: listProbes(db, sessionId).length,
  };
}

/**
 * 从这一场往上走到根。
 *
 * 走到哪算哪：父会话被删就停在那里并把 broken 标出来，不假装连续。
 * visited 是防呆用的——版本链在结构上长不出环（父 id 在写入时还不存在），
 * 但一个从别处搬过来的库可以有任意内容，死循环比报错难查得多。
 */
export function growthChainOf(db: Db, sessionId: string): GrowthChainView | null {
  const self = factsOf(db, sessionId);
  if (self === null) return null;
  const chain: GrowthSession[] = [self];
  const visited = new Set<string>([sessionId]);
  let cursor = sessionId;
  let rootId = sessionId;
  let broken = false;
  let brokenAt: string | null = null;
  while (chain.length < GROWTH_MAX_VERSIONS) {
    const row = getSession(db, cursor);
    if (row === null) break;
    const parentId = row.parentSessionId;
    if (parentId === null || parentId === '') {
      rootId = row.id;
      break;
    }
    if (visited.has(parentId)) break;
    const parent = factsOf(db, parentId);
    if (parent === null) {
      broken = true;
      brokenAt = parentId;
      break;
    }
    visited.add(parentId);
    chain.push(parent);
    cursor = parentId;
    rootId = parentId;
  }
  const view = growthOf(chain);
  // growthOf 已经按 createdAt 升序排过，order 跟着它走，免得界面上「第 N 版」对不上号
  const order = view.versions.map((point) => point.sessionId);
  return {
    ...view,
    sessionId,
    rootId,
    broken,
    brokenAt,
    window: GROWTH_MAX_VERSIONS,
    order,
  };
}
