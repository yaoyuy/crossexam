import { useState } from 'react';
import type { ClaimTrail, GrowthView } from '../api.ts';
import { SHIFT_LABEL, SHIFT_TONE } from '../compare.ts';
import { VERDICT_LABEL, VERDICT_TONE } from '../labels.ts';
import { Badge, Empty, Note, SectionCard } from './Bits.tsx';
import { Icon } from './Icon.tsx';

/**
 * 成长档案（P12 · ②）：这一场所在那条版本链上，每一版的主张轨迹。
 *
 * 做成覆盖层而不是第五栏，理由写在 docs/design/p12-review.md：四栏在 1600 宽下刚好，
 * 而这个功能是「偶尔回看一次」，不是常驻视角。
 *
 * P16 只动外观：卡片化（左侧 teal 色条 + 带图标的标题行）、顶部一排数字、
 * 版本链改成竖排时间线（每一版一行 .row，带进度条），判定一律用 .badge-*。
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
      <div className="my-4 w-full max-w-4xl" onClick={(event) => event.stopPropagation()}>
        <SectionCard
          title="成长档案"
          desc="一条主张改了几回，这里看得出来"
          icon="layers"
          accent="teal"
          dataShot="growth-card"
          actions={
            <button
              type="button"
              className="icon-btn"
              onClick={props.onClose}
              title="关掉成长档案"
              aria-label="关掉成长档案"
              data-shot="growth-close"
            >
              <Icon name="x" size={16} />
            </button>
          }
          bodyClassName="flex flex-col gap-4"
        >
          <GrowthBody view={props.view} />
        </SectionCard>
      </div>
    </div>
  );
}

function GrowthBody(props: { view: GrowthView | null }) {
  const [showAll, setShowAll] = useState(false);
  if (props.view === null) {
    return (
      <div data-shot="growth-empty">
        <Empty
          title="这一场还没有跑过，等都跑完再打开这里。"
          hint="跑完再点「改完再跑一遍」，这里就会把两版连成一条版本链。"
          icon="layers"
        />
      </div>
    );
  }
  const view = props.view;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-ink-200" data-shot="growth-headline">
        {view.headline}
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatBox label="版本" value={view.versions.length} hint="同一份简历跑过几场" accent="accent-teal" />
        <StatBox label="轨迹" value={view.trails.length} hint="连得起来的主张" accent="accent-teal" />
        <StatBox label="还在被打回" value={view.persistent.length} hint="改了还是站不住" accent="accent-amber" />
        <StatBox label="已经改站住" value={view.fixed.length} hint="从站不住变成站得住" accent="accent-mint" />
      </div>

      {view.trailNote === null ? null : (
        <Note tone="info" icon="info">
          <span data-shot="growth-note">{view.trailNote}</span>
        </Note>
      )}
      {view.broken ? (
        <Note tone="warn" icon="alert">
          <span data-shot="growth-broken">
            {'再往前的第 ' + String(view.versions.length) + ' 版之前那一场已经被删掉了（' + (view.brokenAt ?? '') + '），轨迹只能从这一版算起。'}
          </span>
        </Note>
      ) : null}

      <VersionStrip view={view} />

      {view.persistent.length > 0 ? (
        <section data-shot="growth-persistent">
          <SectionHead
            icon="alert"
            className="text-amber-ink"
            title={'改了还在被打回（' + String(view.persistent.length) + ' 条）'}
            hint="这些主张出现过至少两版，每一版都没被判成「站得住」。"
          />
          <ul className="mt-2 flex flex-col gap-2">
            {view.persistent.map((trail) => (
              <TrailRow key={trail.key} trail={trail} tone="warn" />
            ))}
          </ul>
        </section>
      ) : null}

      {view.fixed.length > 0 ? (
        <section data-shot="growth-fixed">
          <SectionHead
            icon="check"
            className="text-mint-400"
            title={'已经改站住（' + String(view.fixed.length) + ' 条）'}
            hint="这些主张在更早的版本里站不住，这一版追问下来站得住了。"
          />
          <ul className="mt-2 flex flex-col gap-2">
            {view.fixed.map((trail) => (
              <TrailRow key={trail.key} trail={trail} tone="solid" />
            ))}
          </ul>
        </section>
      ) : null}

      <section data-shot="growth-all">
        <div className="flex flex-wrap items-center gap-2">
          <SectionHead icon="list" className="text-ink-300" title={'全部轨迹（' + String(view.trails.length) + ' 条）'} />
          <button
            type="button"
            className="chip ml-auto cursor-pointer transition-colors hover:border-ember-500 hover:text-ink-100"
            onClick={() => setShowAll((open) => !open)}
            data-shot="growth-toggle"
          >
            <Icon name={showAll ? 'chevron-down' : 'chevron-right'} size={12} />
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

/** 小节标题：图标 + 一行字 +（可选）一句灰字说明 */
function SectionHead(props: {
  icon: 'alert' | 'check' | 'list';
  title: string;
  className: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <h3 className={'flex items-center gap-1.5 text-[13px] font-semibold ' + props.className}>
        <Icon name={props.icon} size={14} />
        {props.title}
      </h3>
      {props.hint === undefined ? null : <p className="mt-1 text-[11.5px] text-ink-400">{props.hint}</p>}
    </div>
  );
}

/** 一个小数字块：与 Stat 同一套外观，但值必须是数字，口径写在 hint 里 */
function StatBox(props: { label: string; value: number; hint: string; accent: string }) {
  return (
    <div className={'stat-card ' + props.accent}>
      <span className="stat-label">{props.label}</span>
      <span className="stat-value">{String(props.value)}</span>
      <span className="stat-hint">{props.hint}</span>
    </div>
  );
}

/** 版本链：竖排时间线，每一版一行，带一条「站得住 / 判定」的比例条 */
function VersionStrip(props: { view: GrowthView }) {
  return (
    <section>
      <SectionHead icon="list" className="text-ink-300" title="版本链" hint="同一个根会话往下跑出来的每一版，越往下越新。" />
      <ol className="mt-2 flex flex-col gap-1.5" data-shot="growth-versions">
        {props.view.versions.map((point) => {
          const percent = point.judged === 0 ? 0 : Math.round((point.solid / point.judged) * 100);
          return (
            <li key={point.sessionId} className="row">
              <span className="step-num shrink-0">{point.version + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[12.5px] font-semibold text-ink-100">第 {point.version + 1} 版</span>
                  <span className="text-[11.5px] text-ink-300">站得住 {point.solid}/{point.judged}</span>
                  <span className="text-[11px] text-ink-500">
                    追问 {point.probes === null ? '没取到' : String(point.probes) + ' 次'}
                  </span>
                  <span className="ml-auto truncate text-[11px] text-ink-500" title={point.jobTitle}>
                    {point.jobTitle}
                  </span>
                </div>
                <div className="progress mt-1.5" title={'站得住 ' + String(percent) + '%'}>
                  <span className="progress-fill accent-mint" style={{ width: String(percent) + '%' }} />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TrailRow(props: { trail: ClaimTrail; tone: 'warn' | 'solid' | 'muted' }) {
  const trail = props.trail;
  return (
    <li className="row" data-shot="growth-trail">
      <span className="shrink-0 font-mono text-[11px] text-ink-500">{trail.steps[0]?.claimId ?? ''}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={props.tone}>{trail.versions + ' 版'}</Badge>
          {trail.presentInLatest ? null : <Badge tone="muted">这一版里没有了</Badge>}
          <span className="min-w-0 text-[12.5px] leading-relaxed text-ink-200">{trail.text}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {trail.steps.map((step, index) => (
            <span key={step.sessionId + step.claimId} className="inline-flex items-center gap-1.5">
              {index === 0 ? null : <Icon name="chevron-right" size={11} className="text-ink-500" />}
              <span className="inline-flex items-center rounded-md border border-ink-800 bg-ink-950/60 px-1.5 py-0.5 text-[11px] text-ink-400">
                第 {step.version + 1} 版
              </span>
              <Badge tone={step.verdict === null ? 'muted' : VERDICT_TONE[step.verdict]}>
                {step.verdict === null ? '没判' : VERDICT_LABEL[step.verdict]}
              </Badge>
              {step.shift === null ? null : <Badge tone={SHIFT_TONE[step.shift]}>{SHIFT_LABEL[step.shift]}</Badge>}
            </span>
          ))}
        </div>
      </div>
    </li>
  );
}