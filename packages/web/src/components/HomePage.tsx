import { PAGE_ITEMS } from '../pages.ts';
import type { PageId } from '../pages.ts';
import type { HealthInfo, HistoryOverview, SessionSummary } from '../api.ts';
import { Chip, Pane } from './Bits.tsx';

/**
 * 首页：第一眼要回答「这是什么、我现在该点哪」。
 *
 * 刻意不放任何按钮之外的东西：六个页面的入口各占一张卡片，
 * 卡片上写的是「这一页管什么」，而不是功能清单——功能清单属于教程。
 */
export function HomePage(props: {
  health: HealthInfo | null;
  overview: HistoryOverview | null;
  sessions: SessionSummary[];
  busy: boolean;
  onUseDemo: () => void;
  onOpenPage: (page: PageId) => void;
  onLoadSession: (id: string) => void;
  onOpenWizard: () => void;
}) {
  const latest = props.sessions[0] ?? null;
  return (
    <div className="flex flex-col gap-3" data-shot="home-page">
      <Pane title="把简历放到火上烤一遍" dataShot="home-hero" subtitle="多 Agent 对抗式面试沙盘">
        <p className="text-[12.5px] leading-relaxed text-ink-300">
          喂进简历与目标岗位，几位面试官 Agent 会并发追问；每条主张都会被判成
          「站得住 / 表述过度 / 证据缺失 / 与原文矛盾 / 无法回答」，再反推回简历，
          告诉你哪一句该改、怎么改。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary px-3 py-1.5 text-[12.5px]"
            onClick={props.onUseDemo}
            disabled={props.busy}
            data-shot="home-demo"
          >
            一键示例，先看一遍
          </button>
          <button
            type="button"
            className="btn px-3 py-1.5 text-[12.5px]"
            onClick={props.onOpenWizard}
            data-shot="home-wizard"
          >
            重看新手向导
          </button>
          <button
            type="button"
            className="btn px-3 py-1.5 text-[12.5px]"
            onClick={() => props.onOpenPage('intake')}
            data-shot="home-to-intake"
          >
            我自己贴简历
          </button>
          <Chip className="border-mint-500/40 text-mint-400">不需要 API Key 也能跑完整场</Chip>
          <Chip title={props.health?.cassetteDir ?? ''}>
            {props.health === null ? '连接本地服务中…' : '卡带 ' + props.health.cassetteDir.split(/[\\/]/).pop()}
          </Chip>
        </div>
      </Pane>

      <Pane
        title="最近一场"
        dataShot="home-latest"
        subtitle={latest === null ? '还没有跑过' : latest.jobTitle}
      >
        {latest === null ? (
          <p className="text-[12px] leading-relaxed text-ink-400">
            跑完一场之后，这里会告诉你上一场是对着哪个岗位问的、判定分布如何，
            并且一键翻回去重看过程。
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-ink-300">{latest.createdAt}</span>
            <span className="font-mono text-[11px] text-ink-500">{latest.id}</span>
            <button
              type="button"
              className="btn px-2.5 py-1 text-[12px]"
              onClick={() => props.onLoadSession(latest.id)}
              data-shot="home-load-latest"
            >
              翻回这一场
            </button>
            <button
              type="button"
              className="btn px-2.5 py-1 text-[12px]"
              onClick={() => props.onOpenPage('history')}
              data-shot="home-to-history"
            >
              看全部历史
            </button>
          </div>
        )}
        {props.overview === null ? null : (
          <p className="mt-2 text-[12px] leading-relaxed text-ink-400" data-shot="home-overview">
            {props.overview.headline}
          </p>
        )}
      </Pane>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {PAGE_ITEMS.filter((item) => item.id !== 'home').map((item) => (
          <button
            key={item.id}
            type="button"
            data-shot={'home-card-' + item.id}
            className="rounded-lg border border-ink-800 bg-ink-900/60 p-3 text-left transition-colors hover:border-ember-500/40"
            onClick={() => props.onOpenPage(item.id)}
          >
            <span className="block text-[13px] font-semibold text-ink-100">{item.label}</span>
            <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-400">{item.blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
