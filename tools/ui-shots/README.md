# tools/ui-shots —— 可复跑的界面截图

一条命令，真起服务 + 真起浏览器（系统 Edge/Chrome，走 CDP），把界面每个关键状态截成 10 张 PNG。
README 配图、技术文档插图、演示视频封面都从这里出——**不是手点的图，随时能重生成**。

## 用法

    npm run build              # 截图要的是真实构建产物，不是开发服务器
    npm run shots              # 输出到 docs/screenshots/

可选参数：

| 参数 | 作用 |
| --- | --- |
| `--out <dir>` | 换输出目录 |
| `--url <base>` | 驱动一个已经在跑的服务，不再自己起进程 |
| `--port <n>` | 自己起服务时用哪个端口（默认 8791） |
| `--keep` | 保留临时目录与浏览器进程，便于排查 |
| `--allow-console` | 控制台有报错也照样出图（默认报错即失败） |
| `--quiet` | 不转发服务端日志 |

浏览器查找顺序：`CROSSEXAM_BROWSER` 环境变量 → 常见安装路径（Windows 的 Edge/Chrome，
macOS 与 Linux 的同名路径）。找不到就报错，不会静默跳过。

## 为什么不用 Playwright

仓库有一条硬约束：不引入需要本地编译的原生依赖。而且评委机器上大概率已经装了 Edge 或 Chrome。
CDP 是纯 JSON 协议，Node 22 自带全局 WebSocket，于是「真浏览器验证」可以零依赖做到。

## 三个踩过的坑（另有 F17/F18 记在 findings.md）

1. **别用 `window.scrollTo`**：本项目的三栏布局里，滚动容器是每一栏自己的 `div`，不是 window。
   所以脚本按 `data-shot` 找到栏位，滚 `lastElementChild`（也就是 Pane 的正文容器）。
2. **界面上的 `data-shot` 属性是给这个脚本用的稳定锚点**（四栏容器、四个按钮、意图契约区块与它的展开按钮 `contract-toggle` / `contract-prompt`、实时输出栏 `live`）。
   改界面时不要随手删——删了截图脚本会明确报「等不到界面状态」，而不是截出一堆错图。
3. **拍直播画面要等它真的有字**：`04-live-output.png` 拍的是模型正在写字的那一栏，脚本会先等 `[data-shot="live"]` 的文本长度超过 30，再滚到栏位中间才按快门；不等就会拍到一只空盒子。

## 它顺便是一道界面门禁

脚本会同时收集 `Runtime.exceptionThrown`、`console.error/warning`、浏览器日志的报错，
不为空就退出码 1。也就是说：「编译过」不算数，「在真浏览器里点一遍、控制台干净」才算数。
