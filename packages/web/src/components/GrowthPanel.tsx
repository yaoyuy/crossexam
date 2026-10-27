import { useState } from 'react';
import type { ClaimTrail, GrowthView } from '../api.ts';
import { SHIFT_LABEL, SHIFT_TONE } from '../compare.ts';
import { VERDICT_LABEL } from '../labels.ts';
import { Badge, Chip } from './Bits.tsx';

/**
 * 成长档案（P12 · ②）：这一场所在那条版本链上，每一版的主张轨迹。
 *
 * 做成覆盖层而不是第五栏，理由写在 docs/design/p12-review.md：四栏在 1600 宽下刚好，
 * 而这个功能是「偶尔回看一次」，不是常驻视角。
 */
export function GrowthPanel(props: { view: GrowthView | null; open: boolean; onClose: () => void }) {
  if (!props.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-ink-950/80 p-4 backdrop-blur-sm"
      data-shot="growth"
      role="dialog"
      aria-modal="true"
      aria-label="成长档案"
      onClick={props.onClose}
    >
      <section className="pane my-4 w-full max-w-4xl p-5" onClick={(event) => event.stopPropagation()}>
        <header className="flex flex-wrap items-center gap-2">
          <h2 className="text-[16px] font-semibold text-ink-100">成长档案</h2>
          <Chip className="border-ember-500/40 text-ember-300">一条主张改了几回，这里看得出来</Chip>
          <button
            type="button"
            className="btn btn-quiet ml-auto px-2.5 py-1 text-[12px]"
            onClick={props.onClose}
            data-shot="growth-close"
          >
            关掉
          </button>
        </header>
        <GrowthBody view={props.view} />
      </section>
    </div>
  );
}

function GrowthBody(props: { view: GrowthView | null }) {
  const [showAll, setShowAll] = useState(false);
  if (props.view === null) {
    return (
      <p className="mt-4 text-[12.5px] text-ink-400" data-shot="growth-empty">
        这一场还没有跑过，等都跑完再打开这里。
      </p>
    );
  }
  const view = props.view;
  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-ink-200" data-shot="growth-headline">
        {view.headline}
      </p>
      {view.trailNote === null ? null : (
        <p className="text-[12px] text-ink-400" data-shot="growth-note">
          {view.trailNote}
        </p>
      )}
      {view.broken ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[12px] text-amber-200" data-shot="growth-broken">
          {'再往前的第 ' + String(view.versions.length) + ' 版之前那一场已经被删掉了（' + (view.brokenAt ?? '') + '），轨迹只能从这一版算起。'}
        </p>
      ) : null}
      <VersionStrip view={view} />
      {view.persistent.length > 0 ? (
        <section data-shot="growth-persistent">
          <h3 className="text-[13px] font-semibold text-amber-200">改了还在被打回（{view.persistent.length} 条）</h3>
          <p className="mt-1 text-[11.5px] text-ink-400">这些主张出现过至少两版，每一版都没被判成「站得住」。</p>
          <ul className="mt-2 flex flex-col gap-2">
            {view.persistent.map((trail) => (
              <TrailRow key={trail.key} trail={trail} tone="warn" />
            ))}
          </ul>
        </section>
      ) : null}
      {view.fixed.length > 0 ? (
        <section data-shot="growth-fixed">
          <h3 className="text-[13px] font-semibold text-emerald-200">已经改站住（{view.fixed.length} 条）</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {view.fixed.map((trail) => (
              <TrailRow key={trail.key} trail={trail} tone="solid" />
            ))}
          </ul>
        </section>
      ) : null}
      <section data-shot="growth-all">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-ink-200">全部轨迹（{view.trails.length} 条）</h3>
          <button
            type="button"
            className="btn btn-quiet px-2 py-0.5 text-[11.5px]"
            onClick={() => setShowAll((open) => !open)}
            data-shot="growth-toggle"
          >
            {showAll ? '收起' : '展开'}
          </button>
        </div>
        {showAll ? (
          <ul className="mt-2 flex flex-col gap-2">
            {view.trails.map((trail) => (
              <TrailRow key={trail.key} trail={trail} tone={trail.persistent ? 'warn' : 'muted'} />
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

/** 一条轨迹横着摆：第 1 版 → 第 2 版 → 第 3 版，每一步带着它当时的判定 */
function VersionStrip(props: { view: GrowthView }) {
  return (
    <ol className="flex flex-wrap gap-2" data-shot="growth-versions">
      {props.view.versions.map((point) => (
        <li
          key={point.sessionId}
          className="min-w-[150px] flex-1 rounded-lg border border-ink-800 bg-ink-900/60 p-2.5"
        >
          <p className="text-[11px] text-ink-400">第 {point.version + 1} 版</p>
          <p className="mt-0.5 text-[12.5px] font-semibold text-ink-100">站得住 {point.solid}/{point.judged}</p>
          <p className="mt-0.5 text-[11px] text-ink-400">追问 {point.probes === null ? '没取到' : String(point.probes) + ' 次'}</p>
        </li>
      ))}
    </ol>
  );
}

function TrailRow(props: { trail: ClaimTrail; tone: 'warn' | 'solid' | 'muted' }) {
  const trail = props.trail;
  return (
    <li className="rounded-lg border border-ink-800 bg-ink-900/60 p-2.5" data-shot="growth-trail">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-ink-400">{trail.steps[0]?.claimId ?? ''}</span>
        <Badge tone={props.tone}>{trail.versions + ' 版'}</Badge>
        {trail.presentInLatest ? null : <Badge tone="muted">这一版里没有了</Badge>}
        <span className="text-[12.5px] text-ink-100">{trail.text}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {trail.steps.map((step) => (
          <span
            key={step.sessionId + step.claimId}
            className="inline-flex items-center gap-1 rounded-md border border-ink-800 bg-ink-950/60 px-1.5 py-0.5 text-[11px] text-ink-300"
          >
            <span className="text-ink-500">第 {step.version + 1} 版</span>
            <span>{step.verdict === null ? '没判' : VERDICT_LABEL[step.verdict]}</span>
            {step.shift === null ? null : (
              <Badge tone={SHIFT_TONE[step.shift]}>{SHIFT_LABEL[step.shift]}</Badge>
            )}
          </span>
        ))}
      </div>
    </li>
  );
}
