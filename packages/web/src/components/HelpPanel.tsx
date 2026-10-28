import { FAQ, HELP_STEPS, MODE_ROWS, PRIVACY_NOTE } from '../help.ts';
import type { ModeRow } from '../help.ts';
import { Badge, Note } from './Bits.tsx';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';

/**
 * 新手教程：一屏讲完「这是什么 / 怎么用 / 三种模式区别 / 隐私」。
 * 做成覆盖层而不是新页面，是为了不打断手头那一场质询。
 *
 * P16 起外形与正文区的卡片统一：左上角一条强调色、标题行带图标，
 * 内部再分三小节（怎么用 / 三种模式 / 常见问题），每节一个小标题而不是一大段裸文字。
 */
export function HelpPanel(props: { open: boolean; onClose: () => void }) {
  if (!props.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-ink-950/80 p-4 backdrop-blur-sm"
      data-shot="help"
      role="dialog"
      aria-modal="true"
      aria-label="新手教程"
      onClick={props.onClose}
    >
      <section
        className="card accent-bar accent-ember my-4 w-full max-w-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="card-head">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-ember-500/15 text-ember-400">
              <Icon name="book" size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="card-title truncate">新手教程 · 四步用起来</h2>
              <p className="card-desc">一屏讲完「怎么用 / 三种模式差在哪 / 简历存到哪去」，随时可以回到这里重看。</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Badge tone="ember">不需要 API Key 也能跑完一整场</Badge>
            <button
              type="button"
              className="btn btn-primary px-3 py-1.5 text-[12px]"
              onClick={props.onClose}
              data-shot="help-close"
            >
              知道了，开始用
            </button>
          </div>
        </header>

        <div className="card-pad flex flex-col gap-5">
          <section>
            <HelpSection icon="list" title="四步用起来" accent="text-ember-400" />
            <ol className="mt-2.5 flex flex-col gap-2">
              {HELP_STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="flex items-start gap-3 rounded-[10px] border border-ink-800 bg-ink-850/40 p-3"
                >
                  <span className="step-num mt-0.5 shrink-0">{index + 1}</span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink-100">{step.title}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-ink-400">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <HelpSection icon="table" title="三种模式的区别" accent="text-sky-400" />
            <div className="mt-2.5 overflow-hidden rounded-[10px] border border-ink-800">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="bg-ink-850/80 text-[11px] text-ink-400">
                    <th className="px-3 py-2 font-medium">模式</th>
                    <th className="px-3 py-2 font-medium">要 API Key 吗</th>
                    <th className="px-3 py-2 font-medium">它在做什么</th>
                    <th className="px-3 py-2 font-medium">什么时候用</th>
                  </tr>
                </thead>
                <tbody>
                  {MODE_ROWS.map((row) => (
                    <tr key={row.mode} className="border-t border-ink-800 align-top">
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2 font-semibold text-ink-100">
                          <Icon name={MODE_ICON[row.mode]} size={14} className="text-ember-400" />
                          <span className="whitespace-nowrap">{row.label}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={row.needsKey === '不需要' ? 'solid' : 'warn'}>{row.needsKey}</Badge>
                      </td>
                      <td className="px-3 py-2.5 leading-relaxed text-ink-300">{row.what}</td>
                      <td className="px-3 py-2.5 leading-relaxed text-ink-400">{row.when}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <Note tone="warn" icon="shield">
            <span className="font-semibold text-amber-ink">隐私：</span>
            {PRIVACY_NOTE}
          </Note>

          <section>
            <HelpSection icon="bulb" title="常见问题" accent="text-violet-400" />
            <ul className="mt-2.5 flex flex-col gap-2">
              {FAQ.map((item) => (
                <li key={item.title} className="rounded-[10px] border border-ink-800 bg-ink-850/40 p-3">
                  <p className="flex items-start gap-1.5 text-[12.5px] font-semibold text-ink-200">
                    <Icon name="chevron-right" size={13} className="mt-0.5 shrink-0 text-ink-500" />
                    <span className="min-w-0">{item.title}</span>
                  </p>
                  <p className="mt-1 pl-[19px] text-[12px] leading-relaxed text-ink-400">{item.body}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </section>
    </div>
  );
}

/** 三种模式各配一个图标：对照表里一眼能分出「不联网 / 联网落盘 / 联网不落盘」 */
const MODE_ICON: Record<ModeRow['mode'], IconName> = {
  replay: 'play',
  record: 'zap',
  live: 'monitor',
};

/** 小节标题：图标 + 一行字，与卡片头同一套字号层级 */
function HelpSection(props: { icon: IconName; title: string; accent: string }) {
  return (
    <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-100">
      <Icon name={props.icon} size={14} className={props.accent} />
      {props.title}
    </h3>
  );
}