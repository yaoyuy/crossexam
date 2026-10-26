import type { ReactNode } from 'react';
import { VERDICT_GLOSS, VERDICT_LABEL, VERDICT_TONE } from '../labels.ts';
import { describeRange } from '../highlight.ts';
import type { Anchor, VerdictKind } from '../api.ts';

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

export function Badge(props: { tone: 'solid' | 'warn' | 'danger' | 'muted' | 'ember'; children: ReactNode; title?: string }) {
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

export function Empty(props: { title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="text-sm text-ink-300">{props.title}</p>
      {props.hint === undefined ? null : <p className="max-w-md text-xs leading-relaxed text-ink-400">{props.hint}</p>}
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

export function Stat(props: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col" title={props.hint}>
      <span className="text-[10px] uppercase tracking-wide text-ink-400">{props.label}</span>
      <span className="text-sm font-semibold text-ink-100">{props.value}</span>
    </div>
  );
}
