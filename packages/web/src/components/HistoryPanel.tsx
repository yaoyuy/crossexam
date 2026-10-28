import type { ReactNode } from 'react';
import { SESSION_STATUS_LABEL } from '../labels.ts';
import type { HistoryOverview, SessionSummary } from '../api.ts';
import { Chip, Pane } from './Bits.tsx';
import { OverviewBar } from './OverviewBar.tsx';

/**
 * 历史一页：跨场次仪表盘 + 跑过的每一场。
 *
 * 这一块原先挤在投料台底部，跑过几场之后它把「开始质询」按钮挤到屏幕外，
 * 而它本身又不是投料的一部分——分开之后投料台只回答「这一场怎么跑」，
 * 历史页只回答「以前跑过什么」。
 */
export function HistoryPanel(props: {
  sessions: SessionSummary[];
  /** 跨场次聚合。null 表示还没取到，整块不渲染 */
  overview: HistoryOverview | null;
  activeSessionId: string | null;
  onLoadSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3" data-shot="history-page">
      <OverviewBar view={props.overview} />
      <Pane
        title="历史会话"
        dataShot="history"
        subtitle={
          props.sessions.length === 0
            ? '还没有跑过一场'
            : String(props.sessions.length) + ' 场 · 点任意一场翻回它的过程与报告'
        }
        bodyClassName="p-3"
      >
        {props.sessions.length === 0 ? (
          <p className="text-[11.5px] text-ink-500">
            还没有跑过。跑完一场就会出现在这里，可以随时翻回来重看过程。
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {props.sessions.map((session) => (
              <li
                key={session.id}
                className={
                  'flex items-center gap-2 rounded-lg border px-2.5 py-2 ' +
                  (session.id === props.activeSessionId
                    ? 'border-ember-500/40 bg-ember-500/5'
                    : 'border-ink-800 bg-ink-850/50')
                }
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => props.onLoadSession(session.id)}
                >
                  <span className="block truncate text-[12.5px] text-ink-100">{session.jobTitle}</span>
                  <span className="block truncate font-mono text-[10.5px] text-ink-500">
                    {session.id} · {session.llmMode}
                  </span>
                </button>
                <Chip>{SESSION_STATUS_LABEL[session.status] ?? session.status}</Chip>
                <button
                  type="button"
                  title="删除这一场"
                  className="px-1 text-[13px] text-ink-500 hover:text-rose-ink"
                  onClick={() => props.onDeleteSession(session.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </Pane>
      {props.children}
    </div>
  );
}