import { PAGE_ITEMS } from '../pages.ts';
import type { PageId } from '../pages.ts';
import type { HealthInfo, HistoryOverview, SessionSummary } from '../api.ts';
import { Chip, IconTile, SectionCard } from './Bits.tsx';
import { Icon } from './Icon.tsx';

/**
 * 首页：第一眼要回答「这是什么、我现在该点哪」。
 *
 * 刻意不放任何按钮之外的东西：六个页面的入口各占一张卡片，
 * 卡片上写的是「这一页管什么」，而不是功能清单——功能清单属于教程。
 *
 * P16 之后这里多了两层视觉引导（原来六块卡片一样重，眼睛没有落点）：
 * 主视觉卡掺一点琥珀底色并把主按钮放大，其余五页的磁贴用 pages.ts 里定的强调色，
 * 「投料台是天蓝、质询台是紫」这套对应关系因此从左侧栏一路延续到首页。
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
  const pages = PAGE_ITEMS.filter((item) => item.id !== 'home');
  return (
    <div className="flex flex-col gap-3" data-shot="home-page">
      <SectionCard
        title="把简历放到火上烤一遍"
        desc="多 Agent 对抗式面试沙盘"
        icon="rocket"
        accent="ember"
        dataShot="home-hero"
        className="card-hero"
      >
        <p className="max-w-[70ch] text-[13px] leading-relaxed text-ink-300">
          喂进简历与目标岗位，几位面试官 Agent 会并发追问；每条主张都会被判成
          「站得住 / 表述过度 / 证据缺失 / 与原文矛盾 / 无法回答」，再反推回简历，
          告诉你哪一句该改、怎么改。
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary px-4 py-2 text-[13px] font-semibold"
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
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Chip className="border-mint-500/40 text-mint-400">不需要 API Key 也能跑完整场</Chip>
          <Chip title={props.health?.cassetteDir ?? ''}>
            {props.health === null ? '连接本地服务中…' : '卡带 ' + props.health.cassetteDir.split(/[\\/]/).pop()}
          </Chip>
        </div>
      </SectionCard>

      <SectionCard
        title="最近一场"
        desc={latest === null ? '还没有跑过' : latest.jobTitle}
        icon="clock"
        accent="sky"
        dataShot="home-latest"
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
      </SectionCard>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {pages.map((item) => (
          <button
            key={item.id}
            type="button"
            data-shot={'home-card-' + item.id}
            className={'tile accent-' + item.accent}
            onClick={() => props.onOpenPage(item.id)}
          >
            <IconTile icon={item.icon} accent={item.accent} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-ink-100">{item.label}</span>
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-400">{item.blurb}</span>
            </span>
            <Icon name="chevron-right" size={14} className="ml-auto shrink-0 text-ink-600" />
          </button>
        ))}
      </div>
    </div>
  );
}
