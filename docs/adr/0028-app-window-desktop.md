# ADR-0028：桌面端是「没有地址栏的浏览器窗口」，不是 exe

- 状态：已采纳（2026-10-28）
- 相关：ADR-0010（零安装启动器）、ADR-0003（单端口同时给接口与前端）、ADR-0027（界面按任务分页）

## 背景

用户要求「打包成桌面端，双击就能用」，参考物是他桌面上另一款软件。直接做 exe 有两条路：
Electron（上百 MB 下载）或 Tauri（要装 Rust 工具链），两条都会破坏「10 分钟极速复现」这条硬指标，
也违反 AGENTS.md §6 与 ADR-0010 已经定下的「不做需要本地编译的原生依赖」。

## 决策

1. **不打包 exe**：桌面形态 = 启动器 + 系统已有 Chromium 系浏览器的**应用模式窗口**。
2. **应用窗口**：`tools/launcher/src/plan.mjs` 的 `browserOpenArgs(url, platform, appPath)` 在有 `appPath` 时返回
   `{ command: appPath, args: ['--app=' + url, '--window-size=' + APP_WINDOW_SIZE] }`（`APP_WINDOW_SIZE = '1440,960'`）。
   `--app` 打开的是没有地址栏、没有标签页的窗口，看起来就是一个应用。
3. **找不到 Chromium 就退回默认浏览器**并在日志里说明（「找不到 Edge / Chrome，用系统默认浏览器打开（窗口会带地址栏）」）；
   `CROSSEXAM_LAUNCH_NO_BROWSER=1` 时完全不开窗口。
4. **探测逻辑是纯函数、可测试**：`appBrowserCandidates(platform, env)` 按平台给候选路径，win32 依次
   `ProgramFiles(x86) → ProgramFiles → LOCALAPPDATA`（Edge / Chrome / Brave），环境变量缺失就不编路径；
   `chooseAppBrowser(platform, env, exists)` 取第一个存在的，都没有返回 `null`。
   **不传 `appPath` 时 `browserOpenArgs` 的行为与以前逐字一致**（win32 `cmd /c start '' url`、darwin `open url`、linux `xdg-open url`），
   这条由单测看守（12 → 17 条）。
5. **快捷方式不变**：桌面快捷方式仍指向 `启动.cmd`（ADR-0010 的形态），`--shortcut` 那条路不动。

## 取舍

- **窗口尺寸不保证**：Edge 会记住同一个 app 窗口上次的尺寸（实测请求 `1440,960` 开出来 `945x1012`）。这是浏览器行为，不改。
- **「桌面端」的证据不是「窗口看起来像应用」**：用 UIA 树验证 `OmniboxViewViews`（地址和搜索栏）的 boundingBox 为 `null`——
  即地址栏确实没有被渲染，窗口里只有标题栏 + 页面。
- **代价是依赖机器上已有 Chromium 系浏览器**：没有就退回带地址栏的默认浏览器，功能一点不少，只是不好看。
- **不做托盘、开机自启、多窗口**：这些是桌面壳的事，不属于「把产品交到评委手里」。
