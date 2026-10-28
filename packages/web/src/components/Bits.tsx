import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';
import type { Accent } from '../pages.ts';
import { VERDICT_GLOSS, VERDICT_LABEL, VERDICT_TONE } from '../labels.ts';
import { describeRange } from '../highlight.ts';
import type { Anchor, VerdictKind } from '../api.ts';

/**
 * 页头：每个页面顶上那一行「标题 + 一句话说明 + 右侧动作」。
 *
 * 参考物里每一页都是这个结构（标题下面一行灰字说清楚这页干什么），
 * 所以抽成组件而不是每页各写一遍——不然六页会长出六种字号。
 */
export function PageHead(props: {
  icon: IconName;
  title: string;
  sub?: ReactNode;
  accent?: Accent;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head" data-shot="page-head">
      <div className="min-w-0">
        <h1 className="page-title">
          <IconTile icon={props.icon} accent={props.accent} size={18} />
          <span className="truncate">{props.title}</span>
        </h1>
        {props.sub === undefined ? null : <p className="page-sub">{props.sub}</p>}
      </div>
      {props.actions === undefined ? null : <div className="page-head-actions">{props.actions}</div>}
    </header>
  );
}

/** 图标磁片：页头、首页磁贴、卡片标题共用同一个形状与底色规则 */
export function IconTile(props: { icon: IconName; accent?: Accent; size?: number }) {
  return (
    <span
      className={'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ' + accentBox(props.accent ?? 'ember')}
    >
      <Icon name={props.icon} size={props.size ?? 16} />
    </span>
  );
}

/** 图标底色的三种例子都写成静态类名，Tailwind 才不会把动态拼出来的类名扫掉 */
function accentBox(accent: Accent): string {
  if (accent === 'sky') return 'bg-sky-500/15 text-sky-400';
  if (accent === 'violet') return 'bg-violet-500/15 text-violet-400';
  if (accent === 'mint') return 'bg-mint-500/15 text-mint-400';
  if (accent === 'teal') return 'bg-teal-500/15 text-teal-400';
  if (accent === 'slate') return 'bg-ink-700/40 text-ink-300';
  return 'bg-ember-500/15 text-ember-400';
}

/**
 * 文档流里的卡片（不是固定高度的 pane）：页面滚动时它跟着滚。
 *
 * 左边缘那条色条是参考物里最显眼的一处：一眼能看出这张卡属于哪个板块。
 */
export function SectionCard(props: {
  title: ReactNode;
  desc?: ReactNode;
  icon?: IconName;
  accent?: Accent;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  dataShot?: string;
  /** 关掉左侧色条（默认开着） */
  plain?: boolean;
  /** 额外的类名（首页主视觉卡用它掺底色） */
  className?: string;
}) {
  const accent = props.accent ?? 'ember';
  return (
    <section
      data-shot={props.dataShot}
      className={
        'card ' + (props.plain === true ? '' : 'accent-bar accent-' + accent) + (props.className === undefined ? '' : ' ' + props.className)
      }
    >
      <div className="card-head">
        <div className="min-w-0">
          <h2 className="card-title flex items-center gap-2">
            {props.icon === undefined ? null : <Icon name={props.icon} size={16} className="text-ink-400" />}
            <span className="truncate">{props.title}</span>
          </h2>
          {props.desc === undefined ? null : <p className="card-desc">{props.desc}</p>}
        </div>
        {props.actions === undefined ? null : <div className="flex shrink-0 items-center gap-2">{props.actions}</div>}
      </div>
      <div className={'card-pad ' + (props.bodyClassName ?? '')}>{props.children}</div>
    </section>
  );
}

/** 固定高度的分栏（质询台那种）：头部简朴、正文自己滚 */
export function Pane(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** 给自动化截图用的稳定锚点，界面上不可见（tools/ui-shots 按它定位要滚动的栏）。 */
  dataShot?: string;
}) {
  return (
    <section data-shot={props.dataShot} className={'pane flex min-h-0 flex-col ' + (props.className ?? '')}>
      <header className="pane-head">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink-100">{props.title}</h2>
          {props.subtitle === undefined ? null : (
            <p className="truncate text-[11px] text-ink-400">{props.subtitle}</p>
          )}
        </div>
        {props.actions === undefined ? null : <div className="flex shrink-0 items-center gap-2">{props.actions}</div>}
      </header>
      <div className={'min-h-0 flex-1 overflow-auto ' + (props.bodyClassName ?? 'p-3')}>{props.children}</div>
    </section>
  );
}

export type Tone = 'solid' | 'warn' | 'danger' | 'muted' | 'ember' | 'sky' | 'violet' | 'teal';

export function Badge(props: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={'badge badge-' + props.tone} title={props.title}>
      {props.children}
    </span>
  );
}

export function Chip(props: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span className={'chip ' + (props.className ?? '')} title={props.title}>
      {props.children}
    </span>
  );
}

export function Dots() {
  return (
    <span className="dots inline-flex items-end gap-[1px] text-ember-400" aria-label="进行中">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}

export function VerdictBadge(props: { kind: VerdictKind; adjusted?: boolean }) {
  return (
    <Badge tone={VERDICT_TONE[props.kind]} title={VERDICT_GLOSS[props.kind]}>
      {VERDICT_LABEL[props.kind]}
      {props.adjusted === true ? ' · 代码收敛' : ''}
    </Badge>
  );
}

export function Quote(props: { anchor: Anchor; onFocus?: (anchor: Anchor) => void; label?: string }) {
  const clickable = props.onFocus !== undefined;
  return (
    <div className="flex flex-col gap-1">
      {props.label === undefined ? null : <span className="text-[11px] text-ink-400">{props.label}</span>}
      <button
        type="button"
        className={'quote text-left ' + (clickable ? 'cursor-pointer hover:brightness-110' : 'cursor-default')}
        title={'简历原文 ' + describeRange(props.anchor) + (props.anchor.exact ? '（逐字命中）' : '（标点归一化后命中）')}
        onClick={() => props.onFocus?.(props.anchor)}
      >
        {props.anchor.quote}
      </button>
    </div>
  );
}

export function WeightBar(props: { value: number }) {
  const percent = Math.round(Math.max(0, Math.min(1, props.value)) * 100);
  return (
    <span className="inline-flex items-center gap-2" title={'追问价值 ' + String(percent) + '%'}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-800">
        <span className="block h-full rounded-full bg-ember-500" style={{ width: String(percent) + '%' }} />
      </span>
      <span className="text-[11px] text-ink-400">{percent}%</span>
    </span>
  );
}

/** 空状态：一句说明 + 一行提示，带一张「虚线插画」的位置（参考物里都是这个形状） */
export function Empty(props: { title: string; hint?: string; icon?: IconName }) {
  return (
    <div className="empty">
      <span className="empty-art">
        <Icon name={props.icon ?? 'file'} size={26} />
      </span>
      <p className="empty-title">{props.title}</p>
      {props.hint === undefined ? null : <p className="empty-hint">{props.hint}</p>}
    </div>
  );
}

/** 提示条：蓝=说明、黄=注意 */
export function Note(props: { tone?: 'info' | 'warn' | 'plain'; icon?: IconName; children: ReactNode }) {
  const tone = props.tone ?? 'plain';
  const cls = tone === 'info' ? 'note note-info' : tone === 'warn' ? 'note note-warn' : 'note';
  const icon: IconName = props.icon ?? (tone === 'warn' ? 'alert' : 'info');
  return (
    <div className={cls}>
      <Icon name={icon} size={15} className="note-ico" />
      <div className="min-w-0">{props.children}</div>
    </div>
  );
}

export function ErrorNotes(props: { errors: { message: string; fatal: boolean }[] }) {
  if (props.errors.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {props.errors.map((error, index) => (
        <li
          key={String(index) + error.message}
          className={
            'rounded-lg border px-2.5 py-1.5 text-[12px] leading-relaxed ' +
            (error.fatal
              ? 'border-rose-ink/40 bg-rose-ink/10 text-rose-ink'
              : 'border-amber-ink/30 bg-amber-ink/10 text-amber-ink')
          }
        >
          {error.message}
        </li>
      ))}
    </ul>
  );
}

/** 统计小卡：参考物里每页顶部那排数字块 */
export function Stat(props: { label: string; value: ReactNode; hint?: string; accent?: Accent }) {
  return (
    <div className={'stat-card accent-' + (props.accent ?? 'ember')} title={props.hint}>
      <span className="stat-label">{props.label}</span>
      <span className="stat-value">{props.value}</span>
      {props.hint === undefined ? null : <span className="stat-hint">{props.hint}</span>}
    </div>
  );
}
