# findings.md — 调研与发现

## F1. 赛题解读（2026-10-26）

来源：https://www.boxuegu.com/matchTrack/detail/?id=10039

- 赛事：全国高校 Vibe Coding 开发挑战赛 / AI创新应用挑战赛，**个人赛**。
- 省赛报名与作品提交截止同为 **2026-11-18**；评审意见约 2027 年 1 月底发布。
- 国赛报名 2026-12-10 ~ 12-21，提交截止 2026-12-27。
- 晋级：省赛一/二/三等奖晋级国赛。
- **缴费门槛**：原文「作品提交入口需参赛者完成缴费后，登录赛事个人中心所报赛项查看」。
- 组别规则：研究生组 / A组(985·211本科) / B组(普通本科) / C组(高职高专)，选错无条件取消资格。

### 评分权重（省赛与国赛完全一致）
| 维度 | 权重 |
| --- | --- |
| 过程可复现性与演进链路 | 25% |
| 解题有效性与实用价值 | 25% |
| 方法创新性与意图控制 | 20% |
| 工程质量与架构设计 | 15% |
| 用户体验与产品精细度 | 15% |

**推论**：这是一场过程分比赛。功能数量不是主要变量，「过程能否被复现」才是。

### 提交物硬要求
1. 公开仓库（GitHub/Gitee），**细粒度 commit**，明确禁止一次性 initial commit；
   每次提交应对应一次 AI 核心对话或一个功能模块。
2. **≥3 个核心功能迭代的完整 Prompt 链**（含提问、AI 建议、如何引导修 Bug）。
3. README 10 分钟极速复现指南（环境、依赖、环境变量模板）。
4. 演示视频 5–8 分钟 1080p，**其中 ≥2 分钟为 AI 协同过程复现展示**。
5. 技术文档 PDF ≤30 页：意图控制策略 / 架构设计 / 可复现性论证。

### 红线
> 「作品须为原创作品，**严禁直接使用已有开源项目包装参赛**。」

## F2. 参照物拆解：ResumeForge（2026-10-26）

来源：https://github.com/magicapple123/ResumeForge

- 本地优先 AI 求职工作台，Apache-2.0，**545 commits**，Python 后端 + Node 前端 + 桌面壳，SQLite 本地存储。
- 主流程 7 模块：岗位广场 / 简历中心 / 投递台 / 网申填表 / 求职进度 / 模拟面试 / 求职助手。
- 次级 8 模块：我的资料 / 收藏夹 / 资料箱 / 知识库 / 工作台 / 求职统计 / 事实台账 / 回收站。
- **真护城河 = 事实台账**：只有用户核实过的事实才允许进入生成，输出逐段可溯源，编造内容被拦截。
- 结论：作为「形态参照」高价值；作为「抄袭对象」是自杀（红线 + 创新分归零 + 体量不可比）。
  只能借鉴其**已验证的痛点**（求职资料散、AI 会替你编），不能借鉴其形态。

## F3. 过程证据可自动化 —— DSH 会话可导出（实测通过）

**这是本项目最重要的技术发现。**

- 存储位置：`%APPDATA%\dsh-desktop\harness\sessions\<工作区标识>\<session-id>\session.v4.jsonl.zstd`
- 格式：**zstd 多帧压缩**的 JSONL（每帧一个 zstd frame，本次会话 45 帧）。
- 解压方式：`node:zlib` 的 `zstdDecompressSync` **只解第一帧**；
  需扫描 magic `28 B5 2F FD` 逐帧解压（或改用流式/CLI）。
- 实测结果：45 帧全部解压成功，得 109 条事件，事件类型包含
  `user/message`、`assistant/message`、`tool/call`、`tool/result`、
  `step/start`、`step/end`、`session/title` 等。
- **推论**：Prompt 链快照可以**从第一行代码开始自动导出**，无需截图、无需事后补写。
  这直接消灭了提交物 #2 的造假风险，并且它本身就是「意图控制策略」的一手证据。

## F4. 本机环境（2026-10-26）

| 项 | 值 |
| --- | --- |
| 工作目录 | `D:\CZB`（初始为空） |
| Node | v24.14.0 |
| npm | 11.9.0，registry 已指向 `https://registry.npmmirror.com` |
| pnpm | **未安装** → 用 npm workspaces |
| Python | 3.10.11 / 3.14（本项目不用） |
| git | 2.56.0.windows.2，user.name=`yaoyuy`，user.email=`<REDACTED:email>` |
| `node:sqlite` | ✅ 可用（有 ExperimentalWarning，功能正常） |
| 网络 | npmjs 200 / npmmirror 200 / github 200 |
| LLM Key | **环境中无任何 KEY/TOKEN 变量** → 需要用户提供；因此必须做离线回放模式 |

## F5. Hindsight 记忆服务不可用

`hindsight_search_knowledge_pages` 返回 `connect ECONNREFUSED 127.0.0.1:9077`。
本仓库为新仓库、尚无知识页，不影响主线。已记录，不再重试。

## F6. 通用 .gitignore 模板会误挡 npm workspaces 目录（2026-10-26）

gitignore-before-git 技能给的通用安全模板（6668 B，19 条 block 探针 + 8 条 allow 探针全过）
在「.NET / C#」段含有一条 packages/，本意是挡 NuGet 的包缓存目录。
本仓库用 npm workspaces，源码就放在 packages/shared/，同名 →
整个包被静默忽略，git add packages/... 报
"The following paths are ignored by one of your .gitignore files"。

处置：删掉该行（同一段的 *.nupkg 保留，NuGet 包本体照挡），
用 git check-ignore -v 确认 packages/shared/src/index.ts 恢复可见。

**教训（值得写进技术文档的「可复现性」一节）**：模板自带的探针只验证
「密钥有没有被挡住」，不会验证「源码有没有被挡住」——这两件事方向相反，
必须各测一遍。本项目的关键路径是 packages/*/src/** 与 tools/*/bin/**。

## F7. run_code 写大文件的可靠姿势（2026-10-26）

现象：同一个 run_code 程序里写 3 个较大的 TS 源文件（合计 > 20 KB）时，
程序体解析失败：Error: code run failed (exception): Expected ',', got '<lexing error>'。
换成把约 12 KB 的 summary 文本拼在一起也会复现（错误变成 Expected ',', got 'ident'）。

已排除（各自做过最小复现，均正常）：含 glob 注释符的路径字符串、含美元花括号的普通字符串。

**结论（已验证）**：文件内容改用 String.raw 模板字面量承载，
内容中不得出现反引号与美元花括号；一次程序写 1–2 个文件即可稳定通过。
这是工具链约束，不是本项目的代码问题，记录以免重复踩坑。


## F8. node:sqlite 可用，但有两个必须知道的差异（2026-10-26）

Node 24 内置的 node:sqlite 在本机实测可用（启动时一行 ExperimentalWarning，功能正常），
因此存储层零原生依赖，Windows 上不需要任何编译工具链——这直接支撑了「10 分钟复现」的目标。

两个差异必须记住：

1. **外键约束是按连接生效的**，open 之后必须自己发一次 PRAGMA foreign_keys = ON。
   漏了不会报错，只会安静地留下"父行删了、子行还在"的孤儿数据，很久以后才以
   "数据对不上"的形式暴露。
2. **prepare().all() 的返回类型很宽**（unknown[]），TS 会在每一处用法上报错。
   处置：在仓储层用一个私有辅助函数收口，而不是在调用点到处断言。
   断言会绕过类型检查，收口函数不会。

另：PRAGMA user_version 是现成的迁移版本位，不需要自己建一张版本表。

## F9. 思考过程与缓存字段有两套命名，兼容层必须都认（2026-10-26）

同一份 OpenAI 兼容协议，不同厂商的字段名不一致，实测：

- 思考过程：DeepSeek 用 delta.reasoning_content，OpenAI 用 delta.reasoning；
- 缓存命中：DeepSeek 用 prompt_cache_hit_tokens，OpenAI 用 prompt_tokens_details.cached_tokens；
- 推理 token：completion_tokens_details.reasoning_tokens。

任何只认一套的适配层，换一个模型就会静默丢掉用量或思考过程（不报错，只是数字少了）。
因此 readUsage 与 parseSseData 都把两套名字一起认。
这条也解释了为什么卡带指纹刻意不含模型名：换模型不该让整盘卡带失效。
## F10. 通用 .gitignore 模板的 bin/ 段会静默挡掉自己的源码（2026-10-26）

这是本仓库第二次被同一类问题咬到（第一次见 F6：模板的 `packages/` 挡了 npm workspaces）。
这次是模板的 .NET 段里有一行 `bin/`（本意挡编译产物），把
`packages/server/src/bin/serve.ts` 和 `tools/dsh-export/bin/dsh-export.mjs` 一起忽略了。
后果特别隐蔽：文件在磁盘上、`node` 直接跑得通、`npm run smoke` 能够把服务起起来；
只有 `git status` 里看不到它们。P0 那次提交因此漏掉了导出器 CLI ——
package.json 声明了 bin，但仓库里没有那个文件，克隆下来的人一跑就报找不到。

处置：在 .gitignore 末尾追加两条取回规则 `!tools/*/bin/` 与 `!packages/*/src/bin/`，
并用 `git check-ignore -v` 逐条确认关键路径可见。

**教训（写进流程）**：厂商模板的忽略规则要**正反各测一遍**——
既要验证「密钥真的被挡住」，也要验证「源码真的没被挡住」。
探针只测一个方向，就会得到「19 条加密探针全过」这种让人放心的假结论。
关键路径清单：`packages/*/src/**`、`tools/*/bin/**`、`tools/*/src/**`。

## F11. 同进程的 app.request 测试全绿，不等于服务能跑（2026-10-26）

HTTP 层有 11 条测试，全部用 Hono 的 `app.request()` 走接口，全部通过。
可真起一个服务进程（`node packages/server/src/bin/serve.ts`）再打同一个接口时，
第一次写入就报 `no such table: session`：

- 建表函数 `migrate(db)` 是存在的，也是幂等的；
- 但 `openDatabase()` 原来只发 PRAGMA，建表要靠调用方记得再调一次；
- 测试用例里每个 rig 都「顺手」调了 migrate，于是这个假设从来没被验证过。

`app.request()` 不经过端口、不经过进程启动路径，因此看不见这类「启动顺序」问题。
随后写的 `tools/smoke/smoke.mjs` 真起进程、真打 HTTP、真等 SSE 收尾，
一次就把这个 bug 钉了出来；同一次冒烟还确认了「SSE 一定会以成功或明确失败收尾」
这条产品承诺在真实网络栈下成立。

**教训**：单元测试证明的是「函数逻辑对」，冒烟证明的是「产品能跑」。
这两句话之间隔着一个进程边界，而事故恰好长在边界上。

## F12. 录制端的「成功」不等于素材齐全：逐项容错会吞掉整段失败（2026-10-26）

合成演示卡带第一版跑完退出码 0，磁盘上却只有 16/27 盘卡带：10 条 answer 与
1 条 suggest 全部缺失，stderr 干干净净。直到换回放模式才炸：

    LlmError: 回放模式找不到这一条记录。用途「answer」的指纹是 11b561bbda2d225fcad8ff25，
    请用 CROSSEXAM_MODE=record 联网跑一次把它录下来。

根因有两层，第二层才是真正危险的：

1. lineAfter(prompt, '## 面试官的问题') 取「标题之后到第一个换行」，但真实提示词里
   标题独占一行、问题在下一行，于是它返回空字符串。10 条回答全部抛
   「演示脚本没有覆盖这个问题：」。
2. **编排层对单个面试官 / 单条主张的失败是逐项容错的**（这是对的：一个面试官掉线不该
   拖垮整场质询），于是这 10 次抛错被当作「这一项失败，跳过」处理，整体照样算跑完。

于是失败从「响亮报错」退化成「静默缺料」，而缺料的证据只在回放时才出现——
如果没写回放自检，这批残缺卡带会被提交进仓库，评委点开演示时才发现。

**处置**：lineAfter 先看标题行内有没有内容（有就直接返回），没有才取下一行；
生成器（demo-seed.ts）加一条「五个阶段逐个点名」的断言，缺任何一阶段即 problems 非空、
退出码 1。门禁层面由 demo-cassette.test.ts 用已提交卡带跑真实 HTTP 兜底。

**教训**：逐项容错是产品正确性，但**录制 / 生成类工具必须自己统计覆盖率**，
不能把「整体没抛错」当作「素材齐全」。凡是允许「部分失败」的流程，
都要额外问一句：这次到底成功了几个？

## F13. String.raw 里出现反引号会当场截断程序体（2026-10-26）

写 fixtures/README.md 第一版时，正文里带了反引号（想给 npm run seed:demo 加行内代码样式），
run_code 直接报「Error: code run failed (exception): Expected a semicolon」——
模板字面量在反引号处提前结束，后面整段正文变成非法 JS。

这与 F7 是同一个坑的两副面孔：F7 是「程序体太大」，F13 是「内容里含模板字面量的定界符」。
两条合起来就是本仓库写文件的可靠姿势：

- 文件内容用 String.raw 承载；
- 内容里**绝不出现反引号与美元花括号**（要行内代码样式就用「」，要代码块就用四空格缩进）；
- 一次程序只写 1–2 个文件；确实需要反引号时，改用「字符串数组 join」并控制程序体大小。
## F14. PERSONA_PRESETS 的真实形状是三层，不是一层（2026-10-26）

写 packages/web/test/labels.test.ts 的漂移断言时，我照印象把人设写成了 `{ name, blurb }`，
实际形状是：

    PERSONA_PRESETS[role] = { persona: { name, role, seniority, tone, blurb }, goal, tactics }

断言当场报 `expected '技术面试官' to be undefined`。

**教训**：写「对照实现」的漂移测试之前，先把真实结构打印一遍（console.log 或读源码），
不要照印象断言。漂移测试的价值在于它盯着别人改，不在于它盯着我的记忆——
但这次它先盯住了我的记忆，也算物尽其用。

## F15. npm install -w <workspace> 会静默失败，退出码仍是 0（2026-10-26）

给前端包装 Tailwind 时用过 `npm install -w @crossexam/web ...`，命令 exit 0、stderr 只有一行
`npm warn workspaces @crossexam/web in filter set, but no workspace folder present`，
**依赖根本没被写进 packages/web/package.json**，直到构建报「找不到 tailwind」才发现。

**教训**：workspace 过滤安装装完必须核对目标 workspace 的 package.json 真的多了那一条；
只信退出码会得到一个「装过了」的错误结论。这条与 F10、F11 同族：
**退出码为 0 不代表事情办成了**，凡是「静默忽略」的机制都要在事后做一次正面确认。

## F16. 不装 Playwright 也能驱动真浏览器：Edge + CDP + Node 自带 WebSocket（2026-10-26）

P3 需要「真的在浏览器里点一遍」而不是只看编译过不过，但仓库里没有 Playwright（也不该为一个 demo 装）。
零依赖路径：

1. spawn 系统 Edge：`--headless=new --disable-gpu --no-first-run --remote-debugging-port=9222
   --user-data-dir=<临时目录> about:blank`；
2. HTTP 轮询 `http://127.0.0.1:9222/json/version` 与 `/json/list`，取 page target 的 webSocketDebuggerUrl；
3. 用 Node 22+ 自带的全局 WebSocket 连上去，发 Runtime.evaluate / Page.captureScreenshot / Emulation.*；
4. 同时收 Runtime.exceptionThrown、consoleAPICalled(error|warning)、Log.entryAdded —— 这才是「零报错」的证据。

**边界（踩过）**：`window.scrollTo` 对本项目的三栏布局完全无效——滚动容器是各栏的 pane div，
不是 window，所以截图只会得到同一屏内容（四张 212492 B 的图一模一样）。要截下方内容必须
滚动对应元素（element.scrollTop = N 或 scrollIntoView）。

**顺带**：这条路径本身可以固化成可复跑的截图命令（P4 要做的 npm run shots），
演示视频与 README 的截图都从它出，而不是靠手点。
