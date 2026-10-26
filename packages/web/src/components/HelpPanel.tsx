import { FAQ, HELP_STEPS, MODE_ROWS, PRIVACY_NOTE } from '../help.ts';
import { Chip } from './Bits.tsx';

/**
 * 新手教程：一屏讲完「这是什么 / 怎么用 / 三种模式区别 / 隐私」。
 * 做成覆盖层而不是新页面，是为了不打断手头那一场质询。
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
        className="pane my-4 w-full max-w-3xl p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex flex-wrap items-center gap-2">
          <h2 className="text-[16px] font-semibold text-ink-100">新手教程 · 四步用起来</h2>
          <Chip className="border-ember-500/40 text-ember-300">不需要 API Key 也能跑完一整场</Chip>
          <button
            type="button"
            className="btn btn-quiet ml-auto px-2.5 py-1 text-[12px]"
            onClick={props.onClose}
            data-shot="help-close"
          >
            知道了，开始用
          </button>
        </header>

        <ol className="mt-4 flex flex-col gap-2.5">
          {HELP_STEPS.map((step) => (
            <li key={step.title} className="rounded-lg border border-ink-800 bg-ink-900/60 p-3">
              <p className="text-[13px] font-semibold text-ink-100">{step.title}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-300">{step.body}</p>
            </li>
          ))}
        </ol>

        <h3 className="mt-5 text-[13.5px] font-semibold text-ink-100">三种模式的区别</h3>
        <div className="mt-2 overflow-hidden rounded-lg border border-ink-800">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-ink-850 text-ink-400">
              <tr>
                <th className="px-2.5 py-1.5 font-medium">模式</th>
                <th className="px-2.5 py-1.5 font-medium">要 API Key 吗</th>
                <th className="px-2.5 py-1.5 font-medium">它在做什么</th>
                <th className="px-2.5 py-1.5 font-medium">什么时候用</th>
              </tr>
            </thead>
            <tbody>
              {MODE_ROWS.map((row) => (
                <tr key={row.mode} className="border-t border-ink-800 align-top">
                  <td className="px-2.5 py-1.5 font-semibold text-ink-100">{row.label}</td>
                  <td className="px-2.5 py-1.5 text-ink-300">{row.needsKey}</td>
                  <td className="px-2.5 py-1.5 text-ink-300">{row.what}</td>
                  <td className="px-2.5 py-1.5 text-ink-400">{row.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 rounded-lg border border-amber-ink/30 bg-amber-ink/5 p-2.5 text-[12px] leading-relaxed text-ink-300">
          <span className="font-semibold text-amber-ink">隐私：</span>
          {PRIVACY_NOTE}
        </p>

        <h3 className="mt-5 text-[13.5px] font-semibold text-ink-100">常见问题</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {FAQ.map((item) => (
            <li key={item.title} className="rounded-lg bg-ink-850/60 p-2.5">
              <p className="text-[12.5px] font-medium text-ink-200">{item.title}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-400">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
