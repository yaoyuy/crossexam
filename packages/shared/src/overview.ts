/**
 * 历史仪表盘（P11 · C2）。
 *
 * 历史栏原本只是一列场次：跑得越多，越难看出这一段时间到底在变好还是在打转。
 * 这一层把同一批场次换个角度看：判定分布合起来是多少、哪个类别总被打回、
 * 追问次数是变多还是变少、同一份简历跑过几版。
 * 它只做聚合，不引入任何新判定，也不调模型——输入是什么判定，输出就是什么判定。
 *
 * 全是纯函数、同样输入同样输出。判定分布复用 compare.ts 的 verdictCounts、
 * 类别短板复用 shortfall.ts 的 categoryShortfalls：同一件事只算一次，
 * 否则仪表盘里的「站得住 5 条」与报告里的「站得住 5 条」迟早会变成两个数字。
 */
import type { CategoryShortfall, JudgedClaimLike } from './shortfall.ts';
import { categoryShortfalls } from './shortfall.ts';
import type { VerdictCounts } from './compare.ts';
import { verdictCounts } from './compare.ts';

/** 一场会话里仪表盘要看的全部东西。追问次数取不到就传 null，不许猜 0。 */
export interface SessionFacts {
  id: string;
  createdAt: string;
  jobTitle: string;
  /** 简历正文指纹：同一份简历改都没改再跑一遍，指纹相同 */
  resumeHash: string;
  claims: readonly JudgedClaimLike[];
  probes: number | null;
}

/** 趋势最多摆五个点：再多一排小柱子，横着就挤成一团了。 */
export const TREND_POINTS = 5;

export interface TrendPoint {
  sessionId: string;
  createdAt: string;
  jobTitle: string;
  /** 这一场判过的条数 */
  judged: number;
  /** 其中站得住的条数 */
  solid: number;
  probes: number | null;
}

/** 同一份简历的几次跑动归成一组：成长档案要看的就是这一组里的变化。 */
export interface ResumeGroup {
  resumeHash: string;
  sessions: number;
  latestId: string;
  latestCreatedAt: string;
}

export interface HistoryOverview {
  sessions: number;
  claims: number;
  verdicts: VerdictCounts;
  /** 按欠证据条数排好序的类别汇总，顺序由 categoryShortfalls 定 */
  categories: CategoryShortfall[];
  /** 平均每场追问次数；一场都没跑完是 null */
  meanProbes: number | null;
  /** 最近几场，**按时间升序**：左手边是更早的那一场 */
  trend: TrendPoint[];
  /** 不足两场时说明为什么没有趋势，避免读者以为是坏了 */
  trendNote: string | null;
  resumeGroups: ResumeGroup[];
  /** 同一份简历最多跑过几场（改完再跑一遍会 +1） */
  sameResumeRuns: number;
  /** 一句话结论，界面与报告共用 */
  headline: string;
}

/** 时间倒序（与库里的 ORDER BY 一致），并列时按 id 倒序，保证同一批输入永远同一顺序。 */
function newestFirst(a: SessionFacts, b: SessionFacts): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return Math.round((sum / values.length) * 10) / 10;
}

/** 一场会话在趋势图上的那个点。 */
export function trendPointOf(session: SessionFacts): TrendPoint {
  const counts = verdictCounts(session.claims);
  return {
    sessionId: session.id,
    createdAt: session.createdAt,
    jobTitle: session.jobTitle,
    judged: counts.judged,
    solid: counts.solid,
    probes: session.probes,
  };
}

/**
 * 一句话结论。它要能独立读懂，所以不复述编号，只说数量与最集中的那一类。
 * 「最集中的」只在真有欠证据时才说——没有就说「没有一条欠证据」，
 * 而不是拿一个 0 去填那个坑。
 */
export function overviewHeadline(overview: Omit<HistoryOverview, 'headline' | 'trendNote'>): string {
  if (overview.sessions === 0) return '还没有跑过任何一场。';
  if (overview.claims === 0) return String(overview.sessions) + ' 场都还没抽出主张。';
  const judged = overview.verdicts.judged;
  if (judged === 0) {
    return String(overview.sessions) + ' 场共 ' + String(overview.claims) + ' 条主张，一条都还没判。';
  }
  const parts: string[] = [];
  parts.push(String(overview.sessions) + ' 场共 ' + String(overview.claims) + ' 条主张');
  parts.push('已判 ' + String(judged) + ' 条里站得住 ' + String(overview.verdicts.solid) + ' 条');
  const weak = overview.verdicts.weak;
  if (weak > 0) {
    const focus = overview.categories.find((item) => item.weak > 0);
    if (focus === undefined) {
      parts.push('还欠 ' + String(weak) + ' 条');
    } else {
      parts.push('还欠 ' + String(weak) + ' 条，最集中的是「' + focus.label + '」' + String(focus.weak) + ' 条');
    }
  } else {
    parts.push('没有一条欠证据');
  }
  if (overview.meanProbes !== null) {
    parts.push('平均每场追问 ' + String(overview.meanProbes) + ' 次');
  }
  return parts.join('，') + '。';
}

/** 趋势那一行的文案，例如「最近 3 场：站得住 2 → 3 → 5 条」。不足两场返回 null。 */
export function trendLine(trend: readonly TrendPoint[]): string | null {
  if (trend.length < 2) return null;
  return '最近 ' + String(trend.length) + ' 场：站得住 ' + trend.map((point) => String(point.solid)).join(' → ') + ' 条';
}

/** 把一批场次聚合成仪表盘。入参顺序不限，输出顺序由 newestFirst 定死。 */
export function overviewOf(sessions: readonly SessionFacts[]): HistoryOverview {
  const ordered = [...sessions].sort(newestFirst);
  const allClaims: JudgedClaimLike[] = [];
  for (const session of ordered) for (const claim of session.claims) allClaims.push(claim);
  const probeValues: number[] = [];
  for (const session of ordered) if (session.probes !== null) probeValues.push(session.probes);
  const groups = new Map<string, ResumeGroup>();
  for (const session of ordered) {
    const found = groups.get(session.resumeHash);
    if (found === undefined) {
      groups.set(session.resumeHash, {
        resumeHash: session.resumeHash,
        sessions: 1,
        latestId: session.id,
        latestCreatedAt: session.createdAt,
      });
    } else {
      found.sessions += 1;
    }
  }
  const resumeGroups = [...groups.values()];
  let sameResumeRuns = 0;
  for (const group of resumeGroups) if (group.sessions > sameResumeRuns) sameResumeRuns = group.sessions;
  const recent = ordered.slice(0, TREND_POINTS).reverse();
  const partial = {
    sessions: ordered.length,
    claims: allClaims.length,
    verdicts: verdictCounts(allClaims),
    categories: categoryShortfalls(allClaims),
    meanProbes: meanOf(probeValues),
    trend: recent.map(trendPointOf),
    resumeGroups,
    sameResumeRuns,
  };
  const trendNote =
    partial.trend.length < 2
      ? '只跑了 ' + String(partial.sessions) + ' 场，趋势要等第二场跑完才看得出来。'
      : null;
  return { ...partial, trendNote, headline: overviewHeadline(partial) };
}
