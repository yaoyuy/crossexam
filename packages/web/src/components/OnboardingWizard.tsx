import { useEffect, useState } from 'react';
import { WIZARD_STEPS } from '../help.ts';
import type { PageId } from '../pages.ts';
import { Icon } from './Icon.tsx';

/**
 * 多步新手向导：第一次打开时牵着走一遍，一步只讲一件事。
 *
 * 每走一步都把背后的页面切过去——向导说的是哪一页，用户看到的就是哪一页，
 * 否则「第二步 · 挑面试官」讲完，人还得自己找那三个按钮在哪。
 * 走完或跳过都会记一个键，之后不再自动出现（教程面板随时还能手动打开）。
 *
 * P16 只动外观：顶部多一条进度条 + 一排步骤圆点，标题与正文的字号层级拉开，
 * 三条要点从裸段落变成带对勾的行。「第 N / 5 步」这句仍然留在 wizard-progress 里。
 */
export function OnboardingWizard(props: {
  open: boolean;
  onClose: () => void;
  onPage: (page: PageId) => void;
}) {
  const [index, setIndex] = useState(0);
  const step = WIZARD_STEPS[index];

  // 每次重新打开都从头讲一遍：向导不是「上次讲到哪儿」的续播
  useEffect(() => {
    if (props.open) setIndex(0);
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const page = WIZARD_STEPS[index]?.page;
    if (page !== undefined) props.onPage(page);
  }, [props.open, index]);

  if (!props.open || step === undefined) return null;
  const last = index === WIZARD_STEPS.length - 1;
  const percent = Math.round(((index + 1) / WIZARD_STEPS.length) * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm"
      data-shot="wizard"
      role="dialog"
      aria-modal="true"
      aria-label="新手向导"
      onClick={props.onClose}
    >
      <section
        className="card accent-bar accent-ember w-full max-w-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="card-head">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-ember-500/15 text-ember-400">
              <Icon name="rocket" size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="card-title truncate">新手向导</h2>
              <p className="card-desc">每走一步，背后的页面都会跟着切过去。</p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-quiet ml-auto shrink-0 px-2.5 py-1 text-[12px]"
            onClick={props.onClose}
            data-shot="wizard-skip"
          >
            跳过，直接开始用
          </button>
        </header>

        <div className="card-pad flex flex-col gap-4">
          <div className="flex flex-col gap-2" data-shot="wizard-progress">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11.5px] font-semibold text-ink-200">
                第 {index + 1} / {WIZARD_STEPS.length} 步
              </span>
              <span className="text-[11px] text-ink-500">
                {last ? '最后一步，点「开始用」收工' : '还剩 ' + String(WIZARD_STEPS.length - index - 1) + ' 步'}
              </span>
            </div>
            <div className="progress" title={'向导进度 ' + String(percent) + '%'}>
              <span className="progress-fill" style={{ width: String(percent) + '%' }} />
            </div>
            <div className="steps">
              {WIZARD_STEPS.map((item, dot) => (
                <span
                  key={item.id}
                  className={'step ' + (dot === WIZARD_STEPS.length - 1 ? '' : 'flex-1 ') + (dot <= index ? 'step-on' : '')}
                  title={item.title}
                >
                  <span className="step-num">{dot + 1}</span>
                  {dot === WIZARD_STEPS.length - 1 ? null : <span className="step-line" />}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-[17px] font-semibold leading-snug text-ink-100" data-shot="wizard-title">
              {step.title}
            </h3>
            <p className="text-[12.5px] leading-relaxed text-ink-300" data-shot="wizard-body">
              {step.body}
            </p>
          </div>

          <ul className="flex flex-col gap-1.5">
            {step.points.map((point) => (
              <li
                key={point}
                className="flex items-start gap-2 rounded-[10px] border border-ink-800 bg-ink-850/40 px-2.5 py-1.5 text-[12px] leading-relaxed text-ink-300"
              >
                <Icon name="check" size={13} className="mt-0.5 shrink-0 text-mint-400" />
                <span className="min-w-0">{point}</span>
              </li>
            ))}
          </ul>

          <hr className="divider" />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn px-3 py-1.5 text-[12.5px]"
              disabled={index === 0}
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
              data-shot="wizard-prev"
            >
              上一步
            </button>
            <button
              type="button"
              className="btn btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px]"
              onClick={() => (last ? props.onClose() : setIndex((current) => current + 1))}
              data-shot="wizard-next"
            >
              {last ? '开始用' : '下一步'}
              <Icon name={last ? 'check' : 'chevron-right'} size={14} />
            </button>
            <span className="text-[11px] text-ink-500">随时可以在顶部「新手教程」里重看这几步</span>
          </div>
        </div>
      </section>
    </div>
  );
}