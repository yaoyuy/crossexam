/**
 * 历史仪表盘（P11 · C2）：历史栏顶端那一块。
 *
 * 它回答的问题是「这一阵子到底在变好还是在打转」——所以摆的是跨场次的聚合，
 * 不是某一场的细节。数字全部来自服务端 /api/sessions/overview，
 * 这里不重算任何判定（重算就会出现「界面说 5 条、报告说 4 条」）。
 */
import type { HistoryOverview } from '../api.ts';
import { MAX_BARS, overviewFactsOf } from '../overview.ts';

/** 一根柱子：底下是已判总数，里面填站得住的那截。零条判定的场次留一条灰线，表示「跑过但没判」。 */
function Bar(props: { label: string; title: string; solidHeight: number; judgedHeight: number }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1" title={props.title}>
      <div className="flex h-12 w-full items-end justify-center gap-[2px]">
        <div className="relative flex h-full w-2.5 items-end overflow-hidden rounded-sm bg-ink-800">
          <div className="w-full rounded-sm bg-ember-500/70" style={{ height: props.judgedHeight + '%' }} />
        </div>
        <div className="relative flex h-full w-2.5 items-end overflow-hidden rounded-sm bg-ink-850">
          <div className="w-full rounded-sm bg-emerald-500/70" style={{ height: props.solidHeight + '%' }} />
        </div>
      </div>
      <span className="truncate text-[10px] text-ink-500">{props.label}</span>
    </div>
  );
}

export function OverviewBar(props: { view: HistoryOverview | null }) {
  const facts = overviewFactsOf(props.view);
  // 一场都没跑时整块不出现：新用户第一眼看到的该是投料台，不是一排空柱子。
  if (facts === null || facts.empty) return null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-ink-800 pt-2.5" data-shot="overview">
      <span className="flex items-center justify-between gap-2 text-[11px] text-ink-400">
        <span>这些场次加起来</span>
        <span className="text-[10px] text-ink-500">最近 {String(Math.min(props.view?.window ?? 0, MAX_BARS))} 场见右侧</span>
      </span>
      <p className="text-[11.5px] leading-relaxed text-ink-200" data-shot="overview-headline">
        {facts.headline}
      </p>
      {facts.bars.length > 0 ? (
        <div className="flex items-end gap-1" data-shot="overview-trend">
          {facts.bars.map((bar) => (
            <Bar
              key={bar.sessionId}
              label={bar.label}
              title={bar.title}
              solidHeight={bar.solidHeight}
              judgedHeight={bar.judgedHeight}
            />
          ))}
        </div>
      ) : null}
      {facts.trendNote !== null ? (
        <p className="text-[10.5px] text-ink-500" data-shot="overview-note">
          {facts.trendNote}
        </p>
      ) : null}
      {facts.categoryLines.length > 0 ? (
        <ul className="flex flex-col gap-0.5" data-shot="overview-categories">
          {facts.categoryLines.map((line) => (
            <li key={line} className="text-[10.5px] text-ink-400">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {facts.sameJdNote !== null ? (
        <p className="text-[10.5px] text-ink-500" data-shot="overview-jd">
          {facts.sameJdNote}
        </p>
      ) : null}
      {facts.sameResumeNote !== null ? (
        <p className="text-[10.5px] text-ink-500" data-shot="overview-resume">
          {facts.sameResumeNote}
        </p>
      ) : null}
    </div>
  );
}
