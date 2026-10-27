# tools/ui-shots —— 可复跑的界面截图

一条命令，真起服务 + 真起浏览器（系统 Edge/Chrome，走 CDP），把界面每个关键状态截成 25 张 PNG。
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

## 踩过的坑（另有 F17/F18 记在 findings.md）

1. **别用 `window.scrollTo`**：本项目的三栏布局里，滚动容器是每一栏自己的 `div`，不是 window。
   所以脚本按 `data-shot` 找到栏位，滚 `lastElementChild`（也就是 Pane 的正文容器）。
2. **界面上的 `data-shot` 属性是给这个脚本用的稳定锚点**（四栏容器、四个按钮、意图契约区块与它的展开按钮 `contract-toggle` / `contract-prompt`、实时输出栏 `live` 与它的思考行 `live-reasoning`、新手教程的 `help-open` / `help-close`、配色按钮 `theme`）。
   改界面时不要随手删——删了截图脚本会明确报「等不到界面状态」，而不是截出一堆错图。
3. **拍直播画面要等它真的有字**：`04-live-output.png` 拍的是模型正在写字的那一栏，脚本会先等 `[data-shot="live"]` 的文本长度超过 30，再滚到栏位中间才按快门；不等就会拍到一只空盒子。
4. **思考那一行只在 answer / verdict 两个阶段出现，窗口只有一两百毫秒**：`05-thinking.png` 不能靠外面每 150 毫秒轮询一次（会漏），
   而是把轮询塞进页面里（`setInterval` 10 毫秒的 Promise），抓住 `[data-shot="live-reasoning"]` 有字的那一刻再截图。
5. **最后一张要离开单页应用**：`14-report.png` 拍的是服务端渲染的报告页（PDF 的来源），脚本先向 `/api/sessions` 要一个会话编号，
   再 `Page.navigate` 过去。因为是最后一步，导航走掉不会影响前面的图；但它也意味着这一张拍不了「刚跑完、还在直播」的界面。
   另外改完界面记得先 `npm run build`：截图取的是 `packages/web/dist`，不是开发服务器。
6. **第一次打开会自动弹一次新手教程**：脚本开头先把它关掉再拍正片，`12-help.png` 是快结束时回头补拍的——
   否则 01 起每一张都会盖着一层教程。同理，任何新写的浏览器脚本都要先处理这个弹层。
7. **收尾必须发 CDP 的 `Browser.close`**：Windows 上 `proc.kill()` 只结束启动器，浏览器进程树还活着并继续占着调试端口；
   下一轮脚本会连上这个旧浏览器（profile 里已经写着「教程看过了」），拍出来的图与断言全是假的。现在收尾顺序是 
   `await closeBrowser(port)` → `killTree(browser)` → `killTree(server)` → 仍占用就告警；起浏览器前还会先预检端口、只认 `about:blank` 的 page target（见 findings F40）。

## 它顺便是一道界面门禁

脚本会同时收集 `Runtime.exceptionThrown`、`console.error/warning`、浏览器日志的报错，
不为空就退出码 1。也就是说：「编译过」不算数，「在真浏览器里点一遍、控制台干净」才算数。
