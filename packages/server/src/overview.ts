/**
 * 历史仪表盘（P11 · C2）的服务层：把库里的场次读出来，交给 shared 的纯函数算。
 *
 * 这一层只做「搬运」：哪一场、有几条主张、判成什么、问了几次。
 * 判定口径全在 shared/src/overview.ts 里，界面与报告读的必须是同一份结论。
 *
 * 只读不写：它不改任何会话，也不调模型。
 */
import type { Db } from './store/index.ts';
import { listClaims, listProbes, listSessions } from './store/index.ts';
import type { HistoryOverview, SessionFacts } from '@crossexam/shared';
import { overviewOf } from '@crossexam/shared';

/**
 * 仪表盘看的是「最近多少场」。不设上限的话，跑过几百场之后打开页面要读几百次库，
 * 而那些很早以前的场次对「这段路在变好还是打转」也没有意义。
 */
export const OVERVIEW_WINDOW = 200;

export interface OverviewView extends HistoryOverview {
  /** 这次统计覆盖的场次上限，界面据此说明「看的是最近 N 场」 */
  window: number;
}

/** 把一批会话读成仪表盘的输入。追问次数取真实的 probe 行数，不靠 budget 里的估计值。 */
function factsOf(db: Db, sessions: ReturnType<typeof listSessions>): SessionFacts[] {
  const facts: SessionFacts[] = [];
  for (const session of sessions) {
    const claims = listClaims(db, session.id).map((claim) => ({
      id: claim.id,
      text: claim.text,
      category: claim.category,
      verdict: claim.verdict ?? null,
    }));
    facts.push({
      id: session.id,
      createdAt: session.createdAt,
      jobTitle: session.jobTitle,
      resumeHash: session.resumeHash,
      claims,
      probes: listProbes(db, session.id).length,
    });
  }
  return facts;
}

/** 空库也要给一份说得通的结论，所以这里从不返回 null。 */
export function overviewSessions(db: Db, limit: number = OVERVIEW_WINDOW): OverviewView {
  const sessions = listSessions(db, limit);
  return { ...overviewOf(factsOf(db, sessions)), window: limit };
}
