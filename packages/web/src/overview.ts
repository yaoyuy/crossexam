/**
 * 历史仪表盘的界面文案与柱形几何（P11 · C2）。
 *
 * 服务端已经把数字算好了（shared/src/overview.ts 的纯函数），这里只做两件事：
 * 把数字摆成一眼能读的形状，以及在没有数据时给出人话，而不是一排 0。
 *
 * 抽成纯函数是为了能被测：柱子高度差一格、日期截错位，都是肉眼很难当场发现的错。
 */
import type { HistoryOverview, OverviewTrendPoint } from './api.ts';

/** 趋势图最多画几根柱子——与服务端 TREND_POINTS 同源，这里只是兜底。 */
export const MAX_BARS = 5;

export interface TrendBar {
  sessionId: string;
  /** 柱子下方的标签，形如「10-03」 */
  label: string;
  /** 标题交给浏览器悬浮提示，写清是哪一场、判了几条 */
  title: string;
  /** 站得住的条数占这排最大值的高度百分比，0–100 */
  solidHeight: number;
  /** 已判条数的高度百分比：站得住那截是它的一部分 */
  judgedHeight: number;
  solid: number;
  judged: number;
  probes: number | null;
}

export interface OverviewFacts {
  /** 一句话结论，直接来自服务端，界面不再自己造句 */
  headline: string;
  /** 没有趋势时的说明（不足两场），有趋势时为 null */
  trendNote: string | null;
  bars: TrendBar[];
  /** 每个类别一行，形如「技能掌握：2 条里 0 条站得住」 */
  categoryLines: string[];
  /** 同一份简历跑过几场，只有 >1 才值得说 */
  sameResumeNote: string | null;
  /** 空库时整块收起，只留一句话 */
  empty: boolean;
}

/** 从 ISO 时间取「月-日」：趋势图的柱子标签只放得下这么多。 */
export function dayLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (match === null) return iso;
  return String(match[2] ?? '') + '-' + String(match[3] ?? '');
}

function maxOf(points: readonly OverviewTrendPoint[]): number {
  let max = 0;
  for (const point of points) if (point.judged > max) max = point.judged;
  return max;
}

/** 一排柱子。高度按「这一批场次里判得最多的那场」归一，这样两次打开页面看到的比例一致。 */
export function trendBars(trend: readonly OverviewTrendPoint[]): TrendBar[] {
  const max = maxOf(trend);
  const bars: TrendBar[] = [];
  for (const point of trend) {
    const judgedHeight = max === 0 ? 0 : Math.round((point.judged / max) * 100);
    const solidHeight = max === 0 ? 0 : Math.round((point.solid / max) * 100);
    const parts = [dayLabel(point.createdAt) + ' ' + point.jobTitle, '站得住 ' + String(point.solid) + ' / 已判 ' + String(point.judged)];
    if (point.probes !== null) parts.push('追问 ' + String(point.probes) + ' 次');
    bars.push({
      sessionId: point.sessionId,
      label: dayLabel(point.createdAt),
      title: parts.join(' · '),
      solidHeight,
      judgedHeight,
      solid: point.solid,
      judged: point.judged,
      probes: point.probes,
    });
  }
  return bars;
}

/** 类别短板：只摆真的欠证据的那几类，没有就整段不出现（不是「0 条欠证据」）。 */
export function categoryLines(view: Pick<HistoryOverview, 'categories'>): string[] {
  const lines: string[] = [];
  for (const item of view.categories) {
    if (item.weak <= 0) continue;
    lines.push(item.label + '：' + String(item.judged) + ' 条里 ' + String(item.solid) + ' 条站得住（欠证据 ' + String(item.weak) + ' 条）');
  }
  return lines;
}

export function sameResumeNote(view: Pick<HistoryOverview, 'sameResumeRuns'>): string | null {
  if (view.sameResumeRuns <= 1) return null;
  return '同一份简历最多跑过 ' + String(view.sameResumeRuns) + ' 场，改完之后的变化可以直接比。';
}

export function overviewFactsOf(view: HistoryOverview | null): OverviewFacts | null {
  if (view === null) return null;
  return {
    headline: view.headline,
    trendNote: view.trendNote,
    bars: trendBars(view.trend.slice(-MAX_BARS)),
    categoryLines: categoryLines(view),
    sameResumeNote: sameResumeNote(view),
    empty: view.sessions === 0,
  };
}
