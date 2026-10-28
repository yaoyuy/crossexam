import { PRIVACY_NOTE } from '../help.ts';
import type { HealthInfo } from '../api.ts';
import { Pane } from './Bits.tsx';
import { THEME_LABEL } from '../theme.ts';
import type { Theme } from '../theme.ts';

/**
 * 设置页：只管「全局偏好」与「这台机器上的事」。
 *
 * 追问强度、改写风格、运行模式这些是逐场选择（它们决定这一场怎么跑、进契约指纹），
 * 刻意不放在这里——同一个开关出现在两页，迟早会有两套说法。
 */
export function SettingsPage(props: {
  theme: Theme;
  onToggleTheme: () => void;
  onOpenHelp: () => void;
  onOpenWizard: () => void;
  health: HealthInfo | null;
}) {
  return (
    <div className="flex flex-col gap-3" data-shot="settings-page">
      <Pane title="外观" dataShot="settings-theme-pane">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn px-3 py-1.5 text-[12.5px]"
            onClick={props.onToggleTheme}
            data-shot="settings-theme"
          >
            配色：{THEME_LABEL[props.theme]}
          </button>
          <span className="text-[11.5px] text-ink-400">深浅两套用的是同一套颜色变量，切换会记住。</span>
        </div>
      </Pane>

      <Pane title="上手" dataShot="settings-help-pane">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn px-3 py-1.5 text-[12.5px]"
            onClick={props.onOpenWizard}
            data-shot="settings-wizard"
          >
            走一遍新手向导
          </button>
          <button
            type="button"
            className="btn px-3 py-1.5 text-[12.5px]"
            onClick={props.onOpenHelp}
            data-shot="settings-help"
          >
            打开教程与常见问题
          </button>
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-400">
          向导只在第一次打开时自动出现一次；教程随时可查，里面还有三种运行模式的对照表。
        </p>
      </Pane>

      <Pane title="隐私与数据" dataShot="settings-privacy">
        <p className="text-[12px] leading-relaxed text-ink-300">{PRIVACY_NOTE}</p>
        <ul className="mt-2 flex flex-col gap-1 text-[11.5px] text-ink-400">
          <li>数据库：仓库根目录 data/crossexam.db（SQLite，单文件，删掉就等于清空历史）。</li>
          <li>
            卡带目录：
            <span className="font-mono text-[11px] text-ink-300">
              {props.health?.cassetteDir ?? '（还没连上本地服务）'}
            </span>
          </li>
          <li>上传的 PDF / Word 只在本机解析，字节不落盘、不发出去。</li>
        </ul>
      </Pane>

      <Pane title="启动与桌面" dataShot="settings-launch">
        <ul className="flex flex-col gap-1 text-[11.5px] leading-relaxed text-ink-400">
          <li>双击「启动.cmd」即可：它会检查 Node、装依赖、构建界面、起服务，然后开一个没有地址栏的应用窗口。</li>
          <li>「装个快捷方式.cmd」会在桌面放一个「质询室 CrossExam」图标，以后从图标进。</li>
          <li>服务与窗口是两件事：关掉那个黑色命令行窗口就等于关掉服务，页面会连不上。</li>
          <li>换端口：启动前设环境变量 CROSSEXAM_PORT，默认 8787。</li>
        </ul>
      </Pane>

      <Pane title="无障碍现状（如实说明）" dataShot="settings-a11y">
        <p className="text-[11.5px] leading-relaxed text-ink-400">
          界面用了语义化标签与 aria 属性，但还没做完整的键盘优先导航与读屏器逐屏核对；
          表单控件都能用 Tab 走到，弹层也标了 role=dialog，但没有做焦点陷阱。
          这一条写在「还没做的事」清单里，没有假装已完成。
        </p>
      </Pane>
    </div>
  );
}
