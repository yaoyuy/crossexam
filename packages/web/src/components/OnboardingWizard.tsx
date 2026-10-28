import { useEffect, useState } from 'react';
import { WIZARD_STEPS } from '../help.ts';
import type { PageId } from '../pages.ts';

/**
 * 多步新手向导：第一次打开时牵着走一遍，一步只讲一件事。
 *
 * 每走一步都把背后的页面切过去——向导说的是哪一页，用户看到的就是哪一页，
 * 否则「第二步 · 挑面试官」讲完，人还得自己找那三个按钮在哪。
 * 走完或跳过都会记一个键，之后不再自动出现（教程面板随时还能手动打开）。
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm"
      data-shot="wizard"
      role="dialog"
      aria-modal="true"
      aria-label="新手向导"
      onClick={props.onClose}
    >
      <section className="pane w-full max-w-xl p-5" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-2">
          <span className="text-[11px] text-ink-500">
            第 {index + 1} / {WIZARD_STEPS.length} 步
          </span>
          <button
            type="button"
            className="btn btn-quiet ml-auto px-2.5 py-1 text-[12px]"
            onClick={props.onClose}
            data-shot="wizard-skip"
          >
            跳过，直接开始用
          </button>
        </header>

        <h2 className="mt-2 text-[16px] font-semibold text-ink-100" data-shot="wizard-title">
          {step.title}
        </h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-300" data-shot="wizard-body">
          {step.body}
        </p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {step.points.map((point) => (
            <li
              key={point}
              className="rounded-lg border border-ink-800 bg-ink-900/60 px-2.5 py-1.5 text-[12px] text-ink-300"
            >
              {point}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center gap-1.5" data-shot="wizard-progress">
          {WIZARD_STEPS.map((item, dot) => (
            <span
              key={item.id}
              className={'h-1.5 w-6 rounded-full ' + (dot <= index ? 'bg-ember-500/70' : 'bg-ink-800')}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2">
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
            className="btn btn-primary px-3 py-1.5 text-[12.5px]"
            onClick={() => (last ? props.onClose() : setIndex((current) => current + 1))}
            data-shot="wizard-next"
          >
            {last ? '开始用' : '下一步'}
          </button>
          <span className="ml-auto text-[11px] text-ink-500">随时可以在顶部「新手教程」里重看这几步</span>
        </div>
      </section>
    </div>
  );
}
