# progress.md — 会话日志

> 每完成一段工作追加一条。只写「做了什么、为什么、结果如何」，不写流水账。

## Session 1 · 2026-10-26 · P0 奠基

**目标**：先把「过程证据」自动化，再开始写业务代码。

- [x] 读取赛题详情（boxuegu id=10039），提取时间线 / 提交物 / 评分权重 / 红线
- [x] 拆解参照物 ResumeForge（形态、护城河、体量）
- [x] 与用户确认方向：选 A（多 Agent 对抗式面试沙盘）
- [x] 环境探测：Node 24 / npm 11.9 / git 2.56 / node:sqlite 可用 / 无 LLM Key
- [x] 实测 DSH 会话导出可行性（key finding F3）
- [x] 装载 `gitignore-before-git` 技能并安装**已验证**的 .gitignore（19 条 block 探针全过）
- [x] 建立规划文件 task_plan.md / findings.md / progress.md
- [x] AGENTS.md 工程约定
- [x] 仓库骨架 + package.json（npm workspaces）
- [x] `tools/dsh-export`：DSH 会话 → Prompt 链 Markdown 导出器
- [x] 第一批细粒度提交

**环境阻塞**：Hindsight 记忆服务 ECONNREFUSED（127.0.0.1:9077），已跳过。

### 本节的关键判断

赛题 25% 的权重压在「过程可复现性与演进链路」上，提交物 #2 又硬性要求
「≥3 个核心功能迭代的完整 Prompt 链」。**这件事如果靠事后回忆补写，既不可信也一定会漏掉纠偏过程。**
所以 P0 的第一件事不是写业务代码，而是把过程证据的采集自动化。

### tools/dsh-export：把 Prompt 链变成过程副产品

DSH 把每次提问、回复、思考、工具调用都落在本地会话文件里。导出器把它读出来直接生成 Markdown，
于是 `docs/prompt-chain/` 下的每一份快照都是**当时**产生的，而不是事后作文。

实现过程中踩到两个坑，都写进了工具 README：

1. 会话文件是**多帧拼接**的 zstd。`zlib.zstdDecompressSync` 只解第一帧，
   必须自己扫魔数 `28 B5 2F FD` 逐帧解压（本次会话 45 帧）。测试用
   `zlib.zstdCompressSync` 造真实多帧数据，不手写字节。
2. `user/message` 里混着真人输入和系统注入（`runtime-context` / `skill-catalog` /
   `plugin:hindsight` / `time-context` / `agent-instructions`）。只有
   `source.kind === "user"` 才是真人提问，其余默认丢弃。

顺带把「过程分」的另外两项也一起满足了：

- run_code 内部的 `tool/ptc-dispatch` 子调用会挂在父调用下折叠展示——这是**真实的操作链路**，
  比截图有说服力。
- 落盘前统一扫描并替换疑似密钥（OpenAI / Anthropic / GitHub / AWS / Bearer / `KEY=value`），
  因为导出物要进公开仓库。

**一次真实的自我纠错**：首版在解析层和渲染层各截断一次，输出里出现
「…已省略 11044 字符（原始长度…）」的套娃。已改为**只在渲染层截断**，
并补了回归测试断言 `此处省略` 只出现一次。这条正好是提交物 #2 想要的
「发现 Bug → 引导修复」素材。

实测：2 个会话 → 328 KB Markdown，4 个测试文件 29 条断言全绿。

### 未完成 / 下一步

- `npm run verify` 目前只剩 `test` 能跑：`typecheck` 与 `build` 需要 P1 的 TS 包落地。
  **这一点如实记录，不假装门禁是绿的。**
- 本机没有 LLM API Key → P1 起就必须把离线 replay 模式当一等公民做，而不是兜底。

### 待用户确认

- 赛事缴费是否已完成（作品提交入口的前置条件）。
- LLM API Key（不提供则全程走 replay 模式，功能演示不受影响）。

## Session 2 · 2026-10-26 · P1 内核（上半）：shared 确定性内核

**目标**：把「确定性」的部分先从 LLM 手里拆出来——凡是能用纯代码保证正确的事，
绝不交给模型。shared 里每个模块都对应技术文档的一个论点。

### 落盘的六个模块（packages/shared/src/）

| 模块 | 一句话 | 对应论点 |
| --- | --- | --- |
| domain.ts | 领域模型与联合类型 | 类型即文档 |
| anchor.ts | 证据锚定：quote 回原文重新定位 | 创新点 1 |
| segment.ts | 简历确定性切分 | 给锚定提供稳定坐标系 |
| budget.ts | 追问预算账本 | 创新点 2 |
| contract.ts | 结构化意图契约 + 确定性渲染 | 创新点 3 |
| schemas.ts | zod 单一入口 | 模型输出不落库 |

两处刻意设计，直接进技术文档：

1. **resolveAnchor 不信任模型给的坐标。** 模型经常把 start/end 算错、却把 quote 抄对，
   所以坐标一律以 quote 回原文重新定位为准，模型给的坐标只当提示。
   全角标点先归一化再匹配，但归一化命中会被标成 exact=false，不冒充逐字命中。
2. **追问预算是记账，不是建议。** prompt 里写「最多追问 3 次」模型可以不听；
   这里把「每主张轮数 / 每面试官额度 / 全场总次数」做成 canProbe 的强制闸门，
   再加「连续 2 次答不上来自动关停该主张」，死循环在设计上不成立。

### 门禁

npm run verify **第一次全绿**：typecheck（tsc --noEmit）+ 9 个测试文件 78 条断言 + build。
build 改为 npm run build --workspaces --if-present，P2 落地 server/web 后会自动纳入。

### 踩到的三个坑

1. **通用 .gitignore 模板误挡源码目录**（详见 findings F6）：模板 .NET 段的 packages/
   与本仓库 npm workspaces 的 packages/ 同名，整个 shared 包被静默忽略，git add 直接拒绝。
2. **run_code 一次性写多个大文件会解析失败**（详见 findings F7）：改用 String.raw 承载文件内容。
3. **一处测试断言写错了**：误以为「每主张 3 轮」会先于「每面试官 2 次」触发，实际先撞额度。
   已拆成两条断言，分别锁死「轮数上限」和「额度上限」两条拒绝路径。

### 提交

本轮 9 个细粒度提交（含上一会话遗留的 2 个），工作区干净，git status --porcelain 为空。

### 下一步

P1 下半：llm/ 适配层（流式 + 回放 fixture，无 Key 也能跑）与 node:sqlite 存储层。


## Session 3 — 2026-10-26（P1 下半：LLM 适配层与存储层）

### 做了什么

**LLM 适配层（packages/server/src/llm/）**

- live.ts：OpenAI 兼容 /chat/completions 客户端，SSE 自己按行解析。
  超时用 AbortController 且定时器挂在响应上（流读完才清，避免误杀正在读的流）；
  400/422 归为 bad-request，其余非 2xx 归为 http-error 且信息里带响应体前 400 字符。
  缺配置时抛 not-configured，**点名缺哪几个环境变量**，并提示可以切 replay——
  报错信息要能直接指导评委下一步动作，而不是只说"配置错误"。
- reasoning（思考过程）从 SSE 一直到卡带、到流式事件、到回放全层打通。
  赛题 UX 维度点名要「流式、思考可视化」；如果只有联网时才看得到思考过程，
  离线复现的评委就看不到这一层，等于把 15% 的 UX 分让出去。
- index.ts：按 CROSSEXAM_MODE 装配客户端，**默认 replay**。
  record 模式的输出目录默认就是卡带目录，录完立刻能用同一个目录回放验证。

**存储层（packages/server/src/store/）**

- db.ts / schema.ts / repo.ts 三个文件，五张表：session / claim / probe / event / llm_call。
- 外键在每个连接上单独打开；版本比代码新时拒绝启动；事务显式拒绝嵌套。
- 仓储只搬数据不做判定，且**每个函数只发一条语句**，原子性交给调用方组合。

### 三个值得写进技术文档的判断

1. **为什么自己解析 SSE，不用 SDK。** 这层会被评委读到，也决定了 record 模式
   录下来的分片与当时推给前端的完全一致。SDK 恰恰把分片粒度藏起来。
2. **为什么默认 replay。** 默认值就是产品对外的第一印象。默认 live 意味着评委
   没有 API Key 时第一步就报错；默认 replay 意味着没有 Key 也能完整跑一遍全流程。
3. **为什么 llm_call 只存指纹和用量、不存提示词正文。** 于是"这次演示到底联网没有、
   花了多少 token"变成一条 SQL 就能验证的事实，而简历不会因此多存一份副本。

### 门禁

npm run verify **exit 0**：typecheck + **13 个测试文件 117 条断言** + build。
llm-live.test.ts 全程假 fetch（零网络）；store.test.ts 全程内存库（零磁盘）。

### 踩到的三个坑

1. tools.edit 的 old_string 必须与实际缩进逐字符一致，按记忆里的缩进写会报
   old_string was not found；改用短且唯一的锚点即可。
2. 用 String.raw 写文件时，SQL 里的空对象字面量会与外层引号打架，
   TS1005: ',' expected；把那一行改成双引号包裹即可。
3. npx tsc --noEmit 接 | head 时，退出码是 head 的，不是 tsc 的——
   判断成败不能只看 exit code。

### 提交

本轮 7 个细粒度提交，工作区干净（git status --porcelain 为空）。

### 下一步

P2：http 层（Hono + SSE 端点 + 事件续传）与 orchestrator（抽取主张 → 并发追问 → 判定 → 反推建议）。
---

## Session 3（2026-10-26）P2 收口：把沙盘变成一个能跑的服务

### 这一段做了什么

1. **五阶段流水线落库**（pipeline.ts）：抽取 → 组庭 → 并发追问 → 逐条判定 → 反推建议，
   每一步都往事件表追加一行，事件序号即前端续传游标；跑完能拿到完整 SessionView。
2. **HTTP 层**（http/app.ts，Hono）：健康检查、示例简历、建档、会话详情、事件续传、
   报告下载、统计，以及最关键的 `POST /api/sessions/:id/run` —— 默认 SSE 直播。
3. **本地服务入口**（bin/serve.ts）：`npm run dev` 起一个能直接打开的服务，
   启动横幅直接告诉使用者当前是回放还是联网、数据库在哪、卡带在哪。
4. **Markdown 报告**（report.ts）：把一次质询导出成可下载、可贴进简历工作流的报告。
5. **一键体验的示例简历**（demo-content.ts）：不需要准备任何材料就能把全流程跑一遍。
6. **真进程冒烟**（tools/smoke/smoke.mjs）并纳入提交门禁。

### 六个模块各自对应哪条论点

| 模块 | 对应 |
| --- | --- |
| pipeline 事件流 | 评分「过程可复现性」：过程本身就是数据，不是事后补的说明 |
| SSE 续传 | 用户体验 15% 里点名的「流式、思考可视化」 |
| 报告导出 | 解题有效性 25%：结论要能带走、能落到简历上 |
| 示例简历 | 10 分钟复现：评审不需要准备素材 |
| 真进程冒烟 | 工程质量 15%：承诺「能跑」就要有证据 |
| 事件表只追加 | 可复现回放：任何一次演示都能从库里重放 |

### 门禁

`npm run verify` **exit 0**：typecheck + **21 个测试文件 / 200 条断言** + 冒烟 9 项 + build。

### 这一段抓到的两个真 Bug

1. **表没建**：`openDatabase` 只发 PRAGMA，建表靠调用方记得调 `migrate`。
   单测里每个 rig 都顺手调了，所以从没暴露；真起服务第一次写入就 `no such table: session`。
   已改为连接即建表（只读连接跳过），并补了一条回归测试「不额外调用 migrate 也能直接写会话」。见 F11。
2. **源码被忽略规则挡掉**：模板 .gitignore 的 `bin/` 段把 `packages/*/src/bin/` 与 `tools/*/bin/`
   一起忽略了 —— P0 那次提交因此漏掉了导出器 CLI（package.json 声明了 bin 却不在仓库里）。
   已追加两条取回规则并逐条 `git check-ignore -v` 确认。见 F10。

为什么这两个 bug 值得写进日志：它们都不是「代码写错了」，而是**验证方式有盲区**。
第一个的盲区是进程边界，第二个的盲区是只验证了「密钥被挡住」而没验证「源码没被挡住」。
提交物 #2 要的是 AI 协同的真实过程，而真实过程里本来就包含这类返工。

### 提交

本轮 12 个细粒度提交（feat 7 / fix 2 / refactor 1 / chore 1 / test 1），工作区干净。

### 下一步

离线演示卡带（seed:demo）：让 `CROSSEXAM_MODE=replay` 下示例简历能完整跑完，
使「没有 API Key 也能 10 分钟复现」从一句承诺变成一条可执行的命令。之后进 P3 前端。

---

## Session 4（2026-10-26）P2 收尾：离线演示卡带

### 这一段做了什么

把「没有 API Key 也能 10 分钟复现」从一句承诺变成一条命令：「npm run seed:demo」
铺好 29 盘卡带，之后 CROSSEXAM_MODE=replay（默认值）下点一次示例简历就能跑完
一整场质询——抽取、三位面试官的并发追问、逐条判定、反推建议，全程零网络。

四件事：

1. **确定性演示剧本**（scripted-demo.ts）：写死谁问什么、候选人怎么答、每条主张怎么判、
   建议怎么改；它按**真实提示词**渲染回答，所以录下来的卡带与将来回放时的提示词逐字节对应。
2. **边跑边录的客户端**：按 digestFor(request) 写盘，录完立刻用只读回放客户端在另一个内存库里
   重跑一遍，**两遍结果签名必须完全一致**（否则退出码 1）。
3. **seed:demo 命令**（bin/seed-demo.ts）：打印卡带目录、各阶段条数、两遍摘要、自检结论；
   自检不过就失败退出，避免残缺卡带被提交。
4. **漂移门禁**（demo-cassette.test.ts）：用仓库里已提交的卡带走真实 HTTP 跑一遍完整沙盘。
   提示词改一个字，指纹就变，这条测试立刻红——它比人肉回归可靠，因为指纹是算出来的。

### 剧本刻意覆盖的四种判定与两类代码级收敛

| 主张 | 剧本走向 | 想证明什么 |
| --- | --- | --- |
| C1 首屏 2.4s→0.8s | 答得出，且给出指标口径 | 站得住：模型想放过时，代码不额外加戏 |
| C2 QPS 800→5000 | 承认前后口径不一致 | 表述过度：判定要落到具体口径差异上 |
| C3 RBAC 覆盖 12 个业务线 | 连续两次答不上来 | 代码强制「无法回答」，不靠模型自觉 |
| C4 熟悉 TypeScript / Node.js | 同上 | 同上，验证收敛与主张类型无关 |
| C5 年度技术突破奖 | 模型想判站得住，却给不出证据引文 | 证据缺失：缺证据自动降级，模型说了不算 |

另有一条**故意锚不到**的主张（引文「精通分布式事务与高并发架构」不在简历里），
用来演示锚定机制会把幻觉式主张直接拦在门外，而不是把它摆上台去问。

### 这一段抓到的两个真 Bug

1. **标题行取值取到空字符串，整段回答阶段静默失败**（见 F12）。
   合成的第一版「成功」退出，磁盘上却只有 16/27 盘卡带——10 条回答与 1 条建议全缺，
   stderr 干干净净。直到回放才报「找不到这一条记录」。
   根因不在录制器，而在**编排层的逐项容错**：单个阶段失败被吞掉，整体照样算跑完。
   修法两条：修 lineAfter 的取行逻辑；生成器自己点名五个阶段是否都录到。
2. **insertSession 的 llmMode 是 StoredLlmMode 不是 string**（packages/server/src/store/repo.ts:28）：
   tsc --noEmit 直接报 TS2322。这条没什么可讲的，但它证明了门禁里 typecheck 不是摆设——
   同一个提交如果只跑 vitest，类型错误会一路进仓库。

### 门禁

npm run verify **exit 0**：typecheck + **22 个测试文件 / 203 条断言** + 冒烟 9 项 + build。
npm run seed:demo 自检通过：3 轮 · 5 条主张 · 10 次追问 · 判定 站得住 1 / 表述过度 1 /
无法回答 2 / 证据缺失 1 · 4 条改写建议 · 拦下 1 条 · 估算 token 23533。

### 提交

本轮 4 个细粒度提交（feat 3 / test 1），工作区干净。

### 下一步

P3 前端：Vite + React + Tailwind，质询舞台做流式可视化与思考过程展示，
判定视图与报告下载。这批卡带同时是 P4 演示视频的素材。
## Session 5（2026-10-26）P3 前端：三栏质询界面 + 单端口演示

### 做了什么

1. **前端独立成包**（packages/web）：Vite 8 + React 19 + Tailwind v4，自己的 tsconfig（含 .tsx 与
   vite/client 类型），根 typecheck 改成再串一遍各包的 typecheck。
2. **线上契约与 SSE**：api.ts 重新声明 HTTP 类型（前端消费 JSON，不引 shared——shared 经 util.ts
   依赖 node:crypto，进浏览器包即崩）；跑沙盘是 POST，所以用 fetch + ReadableStream 手切 SSE。
3. **纯函数折叠器** state.ts：把事件流折成界面状态，直播（SSE）与翻历史（事件表）共用一条路径；
   highlight.ts 负责把简历原文切成「普通 / 被引用 / 当前聚焦」三种片段。
4. **三栏界面**：左栏投料台与面试官面板、中栏主张卡片与追问链、右栏简历原文联动高亮；
   判定被代码收敛时用琥珀色写明「这条判定不是模型直接给的」。
5. **单端口演示**（server/src/http/static.ts）：/api 放行，其余走静态资源并对前端路由回退 index.html；
   npm run preview = 构建 + 起服，评审打开 http://127.0.0.1:8787 就是完整产品。

### 真浏览器实测（不是只看编译过不过）

Playwright 没装（npx 也不会自动装），于是用系统 Edge 无头 + CDP 零依赖驱动（Node 自带全局 WebSocket）：
点「一键示例」→ 点「开始质询」→ 等跑完 → 截图。结果：**控制台 0 条报错/警告**，
整场跑完 3 轮、5 条主张、10 次追问，界面显示「调用 29 次 · 回放 29 · token 23533」「事件 18」「追问 10」，
判定分布与建议、被拦下的追问、被锚定机制拦下的主张都在页面上。

### 两个坑

1. **TS6133 未使用的 import**：web 的 typecheck 第一次报 highlight.ts(7,1) 里 Anchor 声明未使用。
   低级错误，但正好说明 web 包的 typecheck 确实进了门禁。
2. **漂移测试先红了一次，红得有价值**：我照印象把 PERSONA_PRESETS 当成 { name, blurb } 来断言，
   实际形状是 { persona: { name, blurb }, goal, tactics }。测试当场报「expected 技术面试官 to be undefined」，
   打印真实结构后改正。这条测试的存在意义被它自己证明了。

### 门禁

npm run verify **exit 0**：typecheck（根 + 各包）+ **25 个测试文件 / 234 条断言** + 冒烟 9 项 + build。
前端产物：CSS 20.41 kB、JS 257.24 kB（gzip 80.47 kB）。

### 提交

本轮 7 个细粒度提交（chore 2 / feat 4 / test 1），工作区干净。

### 下一步

P4 打磨：把「开跑时的流式观感」做细（慢放节奏、阶段高亮、思考过程的呈现），
并把无头浏览器截图固化成一条可复跑的命令（演示视频与 README 都要用）。
## Session 6（2026-10-26）P4 打磨第一步：界面截图变成一条命令

### 做了什么

1. **给界面加自动化锚点**：Pane 支持 dataShot，投料台/质询过程/主张与追问/简历原文四栏
   以及「一键示例 / 开始质询 / 即时 / 慢放」四个按钮都带上了 `data-shot`。
   这些属性在界面上不可见，作用是把「自动化怎么找到这个元素」从脆弱的文案匹配变成显式契约。
2. **tools/ui-shots（零依赖）**：自己起服务（临时 DB、replay 模式）+ 自己起系统 Edge/Chrome（CDP），
   按锚点走完整流程并截 7 张图，顺便把 `Runtime.exceptionThrown` 与 console 的 error/warning 当失败。
   也就是说「编译过」不算数，「在真浏览器里点一遍、控制台干净」才算数。
3. **npm run shots** 落地，输出 docs/screenshots/（已提交）：README 配图、技术文档插图、视频封面全从这里出。

### 两个坑（都写进 findings）

1. **F17**：CDP 的 Runtime.evaluate 共用一个全局作用域，两段表达式都写 `const pane = ...`，
   第二段直接抛 `Identifier 'pane' has already been declared`。表达式改成不含声明后才好。
2. **F18**：`finally` 里的 `rmSync` 撞上 Windows 文件占用抛 EPERM，**截图全成功、命令却报失败**，
   日志最后一行还是「Permission denied」，完全看不出图其实都出好了。改成带重试的清理，失败只提示不上抛。
   教训：收尾动作失败不该改变主流程的结论。

### 附带确认的事实

播放节奏（即时 / 慢放）不复用任何服务端逻辑，只是把 SSE 排成队列按间隔放出去——
慢放不改变任何判定结果，只是让人眼跟得上；这一点在代码注释里写明了，避免被误读成「演示模式会改结果」。

### 门禁

npm run verify **exit 0**（typecheck + 25 文件 / 234 断言 + 冒烟 9 项 + build）；
npm run shots 控制台 0 报错，7 张图全部生成。

### 下一步

P4 剩余：思考过程的呈现（把「问这个是因为…」之外的模型推理也摊开）、空状态与错误态的细节打磨；
然后进 P5：README 十分钟复现指南、技术文档 PDF、5–8 分钟演示视频。

## Session 7（2026-10-26）P4：把意图契约摊到台面上

### 这一段的动机

评分表里 20% 是「方法创新性与意图控制」，但意图契约（人设 / 目标 / 手法 / 禁区 / 预算）原先只活在服务端内存里，
界面上一个字都看不到——评委只能相信我们的说法，没法验证。这一段把它变成可看、可核对的东西。

### 做了什么

1. **服务端契约视图**（pipeline.ts）：新增 `contractViews(roles, budget, stored)`，读侧按同样输入重算契约全文与指纹；
   `SessionView` 增加 `contracts`。库里只存 `{id, version, digest}`，界面拿到的是「重算结果 + 对账结论」。
2. **`GET /api/contracts`**（http/app.ts）：纯确定性接口，不调模型、不读库，支持 `?panel=`，开跑前就能看；
   未知角色明确 400 并列出可选值。
3. **前端摊开契约**（web/src/contract.ts + StageRail.tsx + App.tsx）：每个面试官一张卡，展开看六行
   （人设/目标/手法/禁区/共同约束/追问预算），再点一下能看到他实际拿到的 System Prompt 原文；
   徽章显示对账状态——「与运行时一致 · 指纹 b2171c82」或「契约已漂移 · 运行时 xxxx → 现在 yyyy」。
4. **测试**：server 3 条（默认面板、非法角色 400、跑完后 storedDigest 与 digest 一致）、web 4 条（六行文案、预算文案、指纹截断、三种对账状态）。
5. **截图器补两张图**：08-contracts.png（契约摊开）、09-system-prompt.png（该面试官的 System Prompt 原文）。

### 一个有意的取舍

契约**不做落库副本**，只落指纹，读时重算。存副本能让界面少算一次，但会让「界面显示的就是真正在跑的那份」
变成一句无法验证的断言——改了契约，老会话仍然展示旧副本，且没有任何信号。
重算 + 对账把这件事变成可判定的状态，也和赛题「意图控制」的要求对齐：意图是声明式的、可解释、可版本化的。见 F19。

另外，`/api/contracts` 对未知角色报 400，而 `/run?panel=` 仍然宽容过滤。这不是疏忽：
契约接口的返回值就是它的全部内容，静默丢弃等于把错误伪装成成功；run 接口滤掉未知角色后仍是一场合法演出。见 F20。

### 门禁

npm run verify **exit 0**：typecheck（根 + web）+ **26 个测试文件 / 241 条断言** + 冒烟 9 项 + build
（vite 8.3.5，27 modules，CSS 20.90 kB、JS 261.08 kB gzip 81.59 kB）。
npm run shots 控制台 0 报错，9 张图全部重新生成（01-intake 变大是因为契约区块在开跑前就可见——三条 pending）。

### 下一步

P4 剩余：模型推理过程的呈现、空状态与错误态细节；然后进 P5（README 10 分钟复现、技术文档 PDF、演示视频脚本）。
## Session 8（2026-10-26）P5 起步：把「10 分钟复现」从一句话变成一条命令

### 这一段的动机

评分表 25% 是「过程可复现性与演进链路」，而 README 里「10 分钟能跑起来」原先只是**一句承诺**。
承诺要能被复核才算证据，于是这一段做了三件事：写复现预演、按预演暴露的问题修代码、补齐 README。

### 做了什么

1. **tools/repro/repro-check.mjs**（`npm run repro`）：把仓库当成评委第一次见到它的样子——
   干净临时目录里 clone → npm install → npm run verify → 起服 → 建档 → 跑完一场 → 取报告，逐步计时，
   超过 10 分钟就退出码 1。上游工作区脏时直接拒绝（`--allow-dirty` 仅供调试脚本用）。
2. **干净目录实测**：clone 2.5 s + install 14.0 s + verify 14.9 s + 起服跑完一场 0.8 s = **约 35 秒**，
   「10 分钟极速复现」这条承诺有据可查；数字写进 README 与 tools/repro/README.md。
3. **修掉一个复现级 bug**：README 一直让评委 `cp .env.example .env`，但后端从来没有载入过 `.env`——
   配置静默不生效（`CROSSEXAM_MODE=live` 写了也还是回放）。新增 env.ts 用 Node 自带的 process.loadEnvFile，
   启动横幅打印实际载入了哪个文件，补 3 条测试。见 F21。
4. **README 重写**：十分钟复现步骤、为什么不需要 Key、实测耗时表、命令表、复现 FAQ、四个技术支点、架构图、文档索引。

### 两个坑

1. **Windows 上 npm.cmd 不能无 shell 地 spawn**：Node 从 20.12 起直接拒绝，而带 shell 又触发 DEP0190（参数不转义）。
   最后改成「node + 本机自带的 npm-cli.js」，比 shell 拼接更干净，行为也与评委敲 npm 一致。
2. **summary.verdicts 是数组不是数字**：第一版预演把判定数打印成了 `[object Object],[object Object]…`，
   顺手补上判定分布（solid / overstated / unanswerable / unanswerable / unsupported），反而更有说服力。

### 门禁

npm run verify **exit 0**：typecheck + **27 个测试文件 / 244 条断言** + 冒烟 9 项 + build。
npm run repro **exit 0**：干净目录 34.5 s 跑通全流程。

### 下一步

P5：技术文档 PDF、演示视频脚本（含 ≥2 分钟 AI 协同过程复现）、Prompt 链快照刷新、发布清单（建远端仓库 + 逐项核对提交物）。

## Session 9（2026-10-26）P4：live 模式也逐字吐字（不只是回放）+ 一次测量事故

### 起因：用户给了 DeepSeek Key，要求真跑一遍、核一遍代码

核代码时发现了三件事，这一节处理的是第三件（前两件见 Session 8 之后的两个 fix 提交）：

1. suggestionDraftSchema 要 claimId、而提示词从没让模型给 → live 实测 9 条建议全炸，离线却全绿（F23）；
2. claim/probe 表用全局主键，同进程第二场会话必撞 UNIQUE（已改会话内复合主键，SCHEMA_VERSION=2）；
3. **live 模式下界面上看不到流式吐字**：五个阶段全走 client.complete()，live.ts 的 stream() 没有任何业务调用方。
   而「流式、思考可视化」是赛题明写的评分项，且只有 live 才是真实使用场景。

### 做法：流式做成客户端包装，不改五个阶段

- 新增 packages/server/src/llm/streaming.ts：withStreaming(inner, sink) 把 complete() 变成
  「for await inner.stream()，按 channel 外推分片，最终结果取 done」；没有 done 直接抛 bad-request。
- LlmRequest 增加 channel；stageRequest 增加第四参；五个阶段分别传
  extract / probe:面试官 / answer:追问编号 / verdict:主张编号 / suggest:主张编号。
- SSE 新增不带 id 的 event: stream。**分片不进事件表、不落库、不参与卡带指纹**——写成 ADR-0004，
  理由是分片是观感而不是结论，断线续传的语义只落在阶段边界上。
- 前端：api.asStreamChunk 逐字段校验 → state 里 applyStreamChunk / streamText / liveChannels /
  readableStreamText（模型吐的是 JSON，界面只取它正在写的那句人话：text / question / rationale / after / why / problem）；
  StageRail 新增「实时输出」栏，ClaimBoard 在作答与判定处显示 LiveLine；
  分片走独立快队列（40 ms 3 片），所以慢放模式下也能看见字一个个出来，而主队列节奏不变。

### 测试与产物

- 新增 server test/llm-streaming.test.ts（5 条）与 web test/stream.test.ts（17 条）；
  http.test.ts 补断言：SSE 里出现 event: stream 与各路 channel，且**事件表仍是 16 条**（分片不进日志的回归门禁）。
- 门禁 npm run verify exit 0：**29 个测试文件 / 271 条断言** + 冒烟 9 项 + build。
- 截图器新增 04-live-output.png（等实况栏真的有字再按快门），其余顺延为 05–10；
  旧的 6 张已删除，README 与截图清单同步改名。npm run shots：10 张图、控制台 0 报错。

### 一次测量事故（F22）

第一次 live 实测报「收到流式分片 0 片」，我差点把它当产品缺陷去改代码。真因是 8796 端口上还挂着
**流式功能落地之前**启动的旧服务：脚本自己 spawn 的新服务抢不到端口就退了，探测打到旧进程，
于是「没有流式」只是旧代码的正常表现——数据库路径（.tmp/live2 vs .tmp/live3）才是铁证。

换成「起服务前先自检端口为空、跑完核对写的是自己的库」的脚本后：**5814 片 / 29 路 channel /
0 片进事件表 / 21 条阶段事件 / 7 主张 7 判定，17 项全 PASS**。

### 关键判断

分片给眼睛看，事件日志才是可回放的真相。两者分开之后，演示里可以放心开着流式跑，
而不必担心「为了好看把日志搅浑」——这也正是技术文档里「过程可复现性」那 25% 想看到的东西。

### 下一步

P5：技术文档 PDF、演示视频脚本（含 ≥2 分钟 AI 协同过程复现）、Prompt 链快照刷新、
发布清单（建远端仓库 + 逐项核对提交物）。
---

## Session 10（2026-10-26）P4：核代码核出来的两个潜伏缺陷

### 这一段做了什么

继续执行「用真 Key 整体过一遍、测每个功能、核代码」这条指令。上一节修的是能看见的失败（建议全炸），
这一节修的是**看不见的失败**：两个缺陷在离线演示、单元测试、真浏览器验收里全都不会红，
只有换个输入形状才会炸。

### 缺陷一：追问表「一轮一条」的唯一约束（见 F24）

schema v2 给 probe 表加了 `UNIQUE (session_id, claim_id, round, interviewer_id)`，
而编排器允许同一位面试官在一轮里对同一条主张问两条（MAX_PROBES_PER_TURN = 2）。
两条同时出现时 insertProbe 撞约束，整场事务回滚、接口 500。

为什么一直没暴露：合成卡带里每位面试官每轮对每条主张恰好只问一条，真实模型跑的两场也恰好没撞上。
这是**潜伏缺陷**——评委只要点一次就可能撞到，且撞到时的现象是「服务端 500」，最没有解释力的一种失败。

处置：SCHEMA_VERSION 提到 3，走正式迁移去掉那条约束（不是直接改 DDL——改 DDL 不动版本号会让已有库
静默停在旧结构）。迁移步骤冻结在自己时点：新增 DDL_V2 保留旧约束，DDL 才是当前形态。
顺带把作答援引的原文锚点存进 answer_cites_json：历史会话重开时「求职者援引了哪几句原文」
是判定可读性的一部分，丢了就只剩一段孤零零的话。

### 缺陷二：PANEL_SIZE 是一行没人读的配置（见 F25）

.env.example 从 P0 起就写着 `PANEL_SIZE=4`（注释「并发质询的面试官数量上限（1-6）」），
全仓库没有任何一处读它。评委照说明书填了也不起作用——这是与 F21（.env 从未被载入）同一类问题，
但更隐蔽：.env 至少还有一层「文件被读了」的假象，这一行是纯粹的空气。

处置：接上。createApp 收 panelSize，按请求的 ?panel= 或默认面板取到面板后截断；
只截断不补齐（默认面板本来 3 位，这个变量只在点名更多面试官时起作用）；
非法值当没设（一个手滑的字符串不该把面板压成 1 位）；启动横幅新增一行「面板上限」，让配置是否生效一眼可见。

### 测试

- store.test.ts 补 v2→v3 迁移（老数据照旧读得回、追问表能塞进同轮第二条）与「援引原文也落盘」；
- session-pipeline.test.ts 补「一位面试官一轮问同一主张两条也落得进库」——这条是唯一约束的正面回归，
  注意轮数上限必须 >1，否则第二条先被轮数闸门拦下，测的就不是约束了；
- env.test.ts 补 parsePanelSize 的三种情形（空值、1-6、非法值）；
- http.test.ts 补「上限只截断不补齐」与「上限对开跑同样生效」两条。

### 门禁

npm run verify **exit 0**：typecheck + **30 个测试文件 / 292 条断言** + 冒烟 9 项 + build。
真进程复核：PANEL_SIZE=2 起服，横幅打「面板上限 2 位（PANEL_SIZE）」，/api/contracts 默认面板被压成 tech,hr。
复现预演复测（本机同一天第二次）：clone 7.6 s + install 15.5 s + verify 13.8 s + 起服跑完 0.5 s = **40.1 s**，
与 README 原写的 35 s 差在 clone 冷热缓存；两份 README 已按新实测更新，并注明「量级才是重点」。

### 教训

「所有测试都绿」证明的是**被测的那条路径**对。这两个缺陷都长在测试与演示从不走的分支上：
一个需要「同一轮问两条」这种真实模型偶发、合成剧本从不出现的形状；
一个根本不在代码路径上（配置文件里的一行）。核代码的价值就在这类地方——它不是跑测试，而是问「哪条路径没人走」。

### 下一步

P5：技术文档 PDF、演示视频脚本（含 ≥2 分钟 AI 协同过程复现）、Prompt 链快照刷新、
发布清单（建远端仓库 + 逐项核对提交物）。
---

## Session 11（2026-10-26）P5：技术文档 PDF 也做成一条命令

### 交付物形态

docs/tech/ 七份 Markdown（封面 + 六章，35185 字符）→ npm run docs:pdf → docs/CrossExam-技术文档.pdf（26 页）。
章节按评分表组织：问题定义（25% 解题有效性）· 意图控制策略（20% 方法创新性）· 架构设计（15% 工程质量）
· 可复现性论证（25% 过程可复现）· 实测证据 · 局限与取舍。每个数字旁边都标着它的来源命令。

### 为什么整条渲染链路自己写（F26）

本机实测没有 pandoc、Python 的 markdown 包也不存在，而这份文档的读者是评委——
他们要在自己机器上一条命令重建它。多一个依赖就多一个复现失败点，于是写了 300 行的
tools/docs/md2html.mjs（只实现技术文档真正用到的十来种语法），再用系统自带的 Edge
打印成 PDF。顺带把「页数 ≤ 30」做成构建失败条件：正则读 PDF 的 /Count，超限即 exit 1。

自己写渲染器的代价是得自己承担它的 bug：测试写完立刻抓到一条——列表栈里只存了标签名，
判断写成 item.indent < 'ul'，永远是 false，于是嵌套列表被静默压平成同一层。
文档里当时没有嵌套列表，所以打印出来看不出来；这正是「测试先于排版发现」的例子。

### 排版收敛过程（34 页 → 26 页）

第一版 34 页超限，收敛路径：字号与行高（9.4pt / 1.55）· 表格 8.3pt 且只禁单行断行、不整表禁断
（break-inside: avoid 会把长表整体挪到下一页、前一页留一大片空白）· 表头 table-header-group 每页重复
· 封面单独渲染并占满第一页。

### 数字一致性（F27）

技术文档写「复现耗时 34.5 s」，README 写「约 40 秒」，两份都是实测、都对，但摆在一起就是矛盾。
重跑一次 npm run repro 拿到 33.9 s（clone 4.0 / install 14.4 / verify 13.1 / 跑完 0.4），
三处（README、tools/repro/README、技术文档 4.1.1 与 4.7）统一成同一个数，并注明同机多次实测落在 34–40 s。
教训：同一个事实写在两份文档里，就必须由同一次测量喂给两边，否则交付物自己会打自己的脸。

### 门禁

npm run verify exit 0：typecheck + 31 个测试文件 / 308 条断言 + 冒烟 9 项 + build。
npm run docs:pdf 26 页（上限 30）。PDF 逐页抽看：封面、第 3 页（流程图与判定表）、第 6 页（契约 JSON）、
第 17 页（第四章开头）、第 21 页（门禁与代码规模表）、第 26 页（结语）排版正常。

### 下一步

P5 剩余：演示视频脚本（含 ≥2 分钟 AI 协同过程复现）、Prompt 链快照刷新、发布清单。
---

## Session 12（2026-10-26）P5 收口：视频脚本、发布清单、Prompt 链刷新

### 交付物

| 产物 | 命令 / 位置 | 数字 |
| --- | --- | --- |
| 演示视频脚本 | `docs/video/script.md` | 七段分镜约 7 分 20 秒；AI 协同段 3:20–5:40 共 2 分 20 秒 |
| 发布清单 | `docs/release-checklist.md` | 五项提交物逐项对照；四项标为只有本人能决定 |
| Prompt 链快照 | `npm run export:prompt` | 11 份 / 4.9 MB；明文密钥 0 处，脱敏命中 5 类 |

### 视频脚本的关键取舍

赛题要求 5–8 分钟且 **≥2 分钟是 AI 协同过程复现**，所以脚本第四节（3:20–5:40）专门留给
四次真实迭代：证据锚定不信模型坐标（D7）· 用户给 Key 后真跑暴露的 claimId Bug（c8a6e90 / F23）·
并发追问撞出的唯一约束（schema v3 / D20）· 同进程测试全绿但真进程报 no such table（F11）。
第四节全部取材于 `docs/prompt-chain/` 的自动导出快照，不是事后补写的故事——这是「过程分」唯一可靠的做法。

另外在准备清单里写死一条：**录像时不要露出 API Key**（不要录 live 演示，必须录就先清屏、用 `.env` 而不是内联环境变量），
并且只用内置示例简历。这两个都是「录完才发现要重录」的类型。

### 交付物数字的一致性（F27 的落地）

技术文档里 292 条断言 / 20.90 kB CSS / 112 个提交都已经过期（现在是 308 / 21.75 kB / 120 余次）。
一次性把三份文档（README、技术文档、tools/repro/README）与代码规模表全部对齐到同一次测量；
提交数改成「120 余次」而不是精确值，因为每提交一次这个数字就过期一次。

### 门禁

npm run verify exit 0：typecheck + 31 个测试文件 / 308 条断言 + 冒烟 9 项 + build；
npm run docs:pdf 26 页（上限 30）；工作区干净，提交数 124。

### 仍然只能由本人完成的事

1. 建公开仓库并 push，把地址填回 README 的 `<仓库地址>` 占位；
2. 定 LICENSE 署名（README 已声明 MIT，但还缺文件）；
3. 按脚本录制 5–8 分钟演示视频；
4. 确认赛事缴费与参赛组别（选错组别无条件取消资格）。

---

## Session 13 · 界面点测：把每个功能真的点一遍（2026-10-26）

上一轮回答「测试是不是把每个功能都点过」时发现一个证据缺口：冒烟测试只打 HTTP 接口，
截图工具只出图，**没有一个东西真的在浏览器里点过按钮**。于是补了一个 `tools/ui-e2e/e2e.mjs`
（零依赖：Node 自带 fetch/WebSocket + 系统 Edge + CDP），自起服务与无头浏览器，
按十一个场景点完整条链路，最后打印 PASS/FAIL 与零控制台报错，红了退出码 1。

覆盖：空状态与灰按钮 · 浏览器里手打简历 · 回放模式缺卡带时的响亮报错 · 一键示例 ·
面试官面板增删与契约条数联动 · 跑完一场（卡片/判定/建议条数与服务端对齐）· 下载报告 ·
遥测与契约对账/展开 System Prompt · 清空 · 历史会话列出/载回/删除/清空 · 控制台零报错。
共 31 项断言，全部通过。`npm run e2e:ui` 可复跑；**故意不进 verify**（要浏览器、一两分钟）。

### 它抓到两个真缺陷（都改完了）

1. **面板顺序跟着点击历史走**（F28）：先取消 HR 再勾回来，面板数组就变成 `[tech, hiring_manager, hr]`，
   而追问编号、契约条数、提示词都按面板顺序生成——回放模式整盘卡带对不上。
   改为在 web 侧定义 `PANEL_ORDER` 并用 `nextPanel()` 归一化，集合语义不携带顺序。
2. **连点两次删除按钮**（F29）：第二次打在已删除的会话上，服务端如实回 404，控制台一行红。
   改为点下去先把那一行从本地列表摘掉，失败再拉回刷新。

两个都属于「接口是对的、界面没接上」，单元测试与冒烟测试都看不见。

### 门禁

npm run verify exit 0：typecheck + **31 个测试文件 / 310 条断言** + 冒烟 9 项 + build；
npm run e2e:ui 31/31 通过、控制台 0 报错；工作区干净。

### 教训

「每个功能都测过」这句话必须能被一条命令重放。补上这条命令之后，第一次跑就抓到两个缺陷——
说明此前的「测过」是接口层面的测过，不是产品层面的测过。
## Session 14 · P1-1 判定口径：把责任归属交回模型（2026-10-26）

用用户的真实简历（12 条主张 / 18 次追问）跑出来，判定几乎一边倒：修正前 5 条「无法回答」，
而模型的理由里写的却是「证据缺失」。核到根因是代码级收敛把「全体未答」一律改判，
吃掉了模型已经做对的判断（F31）。本轮的处置与验证：

### 改了什么

- verdict.ts：降级规则收窄为「模型判站得住、但整场没答上来 → 证据缺失」，理由文案同步改写；
- prompts.ts 的 VERDICT_SYSTEM：两档判据写成可判别的「责任在谁」——证据缺失 = 简历的错、
  无法回答 = 人的错，拿不准判证据缺失；
- scripted-demo.ts：演示里保留一个真·无法回答（自我评价那条，候选人明确承认举不出事例），
  其余走证据缺失，四种判定在离线演示里仍然齐全；
- demo-seed.ts：生成器清理旧指纹的孤儿卡带（F32），只删 model=scripted-demo 的那一批。

### 验证

- 真实简历 live A/B（同一份简历、同一个 JD、同机同日）：修正前 5 unanswerable / 5 unsupported / 2 solid，
  修正后 11 unsupported / 1 unanswerable，建议由 9 条变 12 条；
- 示例简历 live 重跑：10 条主张 / 18 次追问 / 20.0 s，判定 10 条证据缺失；
- 离线卡带重录：29 盘、两遍签名一致 df5664d4894c、判定 站得住 1 / 表述过度 1 / 证据缺失 2 / 无法回答 1；
- npm run verify exit 0：31 个测试文件 / 313 条断言 + 冒烟 9 项 + build。

### 代价（如实记录）

判定区分度下降：真实模型下这一场 10 条全是「证据缺失」。结构性的原因是求职者 Agent
只依据简历作答，说不出「我不会」。要恢复区分度，得先给它一个「承认不会」的表达方式（见 6.1 第 2 条）。

### 下一步

P1-2 思考可视化（接 deepseek-reasoner，把 reasoning 分片单独显示）✅ 见 Session 15、P1-3 报告导出 PDF/Word。
## Session 15 · P1-2 思考可视化：让界面真的多出一行斜体（2026-10-26）

赛题 UX 那条明写「流式、思考可视化」。流式在 Session 12 已经做完，思考这一半此前是空的：
`LlmClient.stream` 一直在解析 `reasoning_content`，但没有任何阶段用思考模型，界面上也就无思考可显示。

### 做了什么

- 装配层新增阶段路由 `withStageModels(inner, routes)`（packages/server/src/llm/routing.ts）：
  按 `req.purpose` 给请求带一个 `model`；默认只把 **verdict** 交给 `deepseek-reasoner`
  （`CROSSEXAM_REASONING_MODEL` / `CROSSEXAM_REASONING_STAGES` 可改）。五个阶段的编排代码一行没动。
- `LlmRequest.model` 与早先的 `channel` 一样**不参与卡带指纹**，所以换模型不必重录任何一盘离线卡带（ADR-0005）。
- 前端把分片按 `kind` 分成两路：`StreamBuffer` 里 `reasoning` 与 `text` 各自累加，
  左栏实时输出多一行斜体思考，徽章写「思考 + 输出」。
- 离线演示也要看得见：合成脚本（scripted-demo.ts）给 answer 与 verdict 写中文合成思考，
  写进卡带的 `response.reasoning`，回放客户端按 24 字软切吐成 reasoning 分片。
- 截图器新增 05-thinking.png（等 `[data-shot="live-reasoning"]` 有内容再拍），其余图整体改名到 06–11，共 11 张。

### 验证

- `npm run seed:demo`：29 盘卡带，15 个文件被改写（10 answer + 5 verdict），两遍自检签名一致 `428b82589a88`；
- 真机 live（`CROSSEXAM_REASONING_MODEL=deepseek-reasoner`，只路由 verdict）：10/10 项通过，
  **2355 片思考分片、8 路 `verdict:*` 通道、7412 片正文分片、`reasoningTokens`=2355、整场 22.7 s、无 fatal**；
- `npm run shots`：11 张截图、控制台 0 报错；
- `npm run verify` exit 0：32 个测试文件 / 323 条断言 + 冒烟 9 项 + build。

### 两条如实记录

- 模型给的思考文本通常是英文，界面上中英混排；**不翻译**（翻译等于我们替模型复述，思考就不再是它的思考）。
- 默认只路由 verdict 是刻意的：追问一轮要十几次调用，全交给思考模型会把一场从十几秒拉成几分钟。

### 下一步

P1-3 报告导出 PDF/Word；随后是真机可见浏览器逐功能点测（用用户的真实简历）、按方案 A 录演示视频、
补 LICENSE 与发布清单。

## Session 16（2026-10-26）P1-3：报告导出三种形态（P1 三项优化的第三项）

### 做了什么

- 新增 `packages/server/src/report-html.ts`：与 `report.ts` 吃同一个 `SessionView`，输出**自带打印样式**的 HTML
  （`@page A4`、判定徽章配色、`.claim/.probe/.advice` 不跨页断开、不引用任何外部资源）；`?print=1` 时注入 `window.print()`。
- 两条新接口：`GET /api/sessions/:id/report.html?print=1`（inline）与 `GET /api/sessions/:id/report.doc`（`application/msword` 附件）。
  服务端**不生成 PDF**：那要么带无头浏览器、要么引原生 PDF 库，都会破坏「十分钟复现」；PDF 由浏览器「另存为」得到（ADR-0006）。
- 界面头部原来的一个「下载报告」换成三个按钮：报告 .md / 报告 PDF（新窗口，自动弹打印）/ 报告 Word。
- 测试：server 新增 3 条（HTML 报告内容与 `window.print()` 的有无、`.doc` 的类型与附件名、未知会话 404），web 新增 3 条（三种网址形状与转义）。

### 验证

- `npm run verify` exit 0：typecheck + **33 个测试文件 / 329 条断言 / 4.2 s** + 冒烟 9 项 + build（vite 8.3.5 / 27 modules / CSS 21.86 kB / JS 266.60 kB gzip 83.17 kB）。
- 真机验收（`.tmp/report-check.mjs`，**12/12 PASS**）：服务端 HTML 经 Edge `--print-to-pdf` 得到 **438305 B / 6 页** PDF；
  真界面上三个按钮的 href 分别以 `/report.md`、`/report.html?print=1`、`/report.doc` 结尾；Markdown 仍含「一、主张与判定」。
- `npm run shots` 先补了一步拍报告页（`12-report.png`），**12 张截图、控制台 0 报错**。

### 三条如实记录

- Word 走的是「HTML + .doc 后缀 + application/msword」这条老路：可编辑、零依赖，但没有 `.docx` 的严格结构（复杂页眉页脚不会有）。
- PDF 的最终版式取决于浏览器（本机 Edge 打印为 6 页）；服务端负责的是内容与分页提示，不是像素级版式。
- 第一轮验收脚本报了 1 项 FAIL 与随后 1 项超时，查下去**两次都是脚本自己的错**（恒真的等待条件、从别的测试抄来的夹具问句），产品侧无缺陷；写进 findings F34。

### 下一步

真机可见浏览器逐功能点测（用用户的真实简历做样例）→ 方案 A 录演示视频 → 补 LICENSE 与发布清单。

## Session 17 · 2026-10-26 · 可见浏览器逐功能点测（真机，用真实简历）

**目标**：把「每个功能都点过一遍」从承诺变成可复核的记录——打开真实（可见）浏览器，用用户 2024 年的真实简历当样例，回放与联网各跑一遍。

### 做了什么

- 三个一次性脚本（在 .tmp，不入库）：`vis-lib.mjs`（找密钥 / 起服务 / 起可见 Edge / CDP 客户端 / PASS-FAIL 打点器）、`vis-part-a.mjs`（回放模式逐项）、`vis-part-b.mjs`（联网 + 真实简历）。
- **回放模式 46 项断言全过**：空状态四条机制、简历太短的中文报错（界面 + 接口 400）、一键示例（361 字 / 235 字）、五个面试官角色与人设、增删面试官时契约随之变化、慢放高亮、阶段时间线、实时输出逐字、思考行、五张主张卡片、判定条数与服务端一致、中文判定标签、代码收敛标注、改写建议、被锚定的主张被拦下、追问链与轮次、契约六行 + System Prompt + 「与运行时一致」、点引文右栏「聚焦 第 81–108 字」、遥测与「追问 10」、三种报告各真取一遍、重跑 409、未知接口 404、载回历史、删除、清空。**控制台 0 报错**。
- **联网 + 真实简历 18 项全过**：真实简历 1007 字（含 11 个 U+00A0）贴进界面即可跑；跑完 29–31 s；12 条主张全部锚定成功（11 条逐字 + 1 条归一化）；12 条判定；17–18 次追问 / 3 轮；12 条建议；界面思考行最长 221 字；报告 Markdown 16.4–17.7 K 字符。**控制台 0 报错**。
- 六个先前报 FAIL 的项全部查清是**脚本自己的时序问题**（拿「跑完没有」当判据太早、思考行只在运行中出现却被外部轮询、期望值从别的测试抄来），产品侧无缺陷；两条写进 findings F34/F35。

### 抓到的两个产品侧缺陷（都已修）

- **工具的跨进程等待没有超时**：可见浏览器下 `Page.captureScreenshot` 可以永不返回，连接与进程都还在，脚本永久卡住（第一遍 part A 真的挂了 11 分钟，只能按端口杀进程）。处置：截图器 `npm run shots` 与界面点测 `npm run e2e:ui` 的每条 CDP 命令加 20 秒超时——最坏情况是少一张图，而不是整轮没有结论。见 findings F35。
- **提示词里的编号重复**：VERDICT_SYSTEM 的纪律清单里有两个「4.」，而这段提示词正是界面上「System Prompt」按钮摊开给人看的内容。改成 4/5 之后，5 盘 verdict 卡带的指纹全变，必须重跑 `npm run seed:demo`（清理旧卡带 5 条，两遍签名仍是 `428b82589a88`）——漂移门禁按设计生效。见 findings F36。

### 验证

- `npm run verify` exit 0：typecheck + **33 个测试文件 / 329 条断言** + 冒烟 9 项 + build（vite 8.3.5 / 27 modules / CSS 21.86 kB / JS 266.60 kB gzip 83.17 kB）。
- `npm run e2e:ui` **33/33** 仍全过（加了 CDP 超时之后重跑）。
- 两轮真机点测：回放 46/46、联网 + 真实简历 18/18；两次都是控制台 0 报错。

### 下一步

方案 A 录演示视频（含 ≥2 分钟 AI 协同过程复现）→ 补 LICENSE 与发布清单 → 公开仓库地址。
## Session 18 · 2026-10-26 · 用户提了 12 项优化，先做完第 1、3、6 项

**背景**：用户看完一轮实测后给了 12 项要求（深浅配色 / doc·pdf 导入 / 新手教程 / 自定义面试官并可用 API 优化 / 页面内切模式与模型 / 证据缺失说明 / 零门槛安装 / 确认后自动改简历并导出 / 录屏推迟 / 桌面快捷方式 / 更多功能清单 / 全部完成后重测）。这一轮先做三项能立刻闭环的。

### 深浅配色（第 1 项）

没有在两个组件里各写一套颜色，而是**只覆盖 CSS 变量**：Tailwind v4 的 `bg-ink-900` 编译成 `var(--color-ink-900)`，于是在 `:root[data-theme='light']` 里重写那十几个变量，全界面跟着换。切换只写 `document.documentElement.dataset.theme`，选择存 localStorage，并在 `createRoot().render()` **之前**应用，否则浅色用户会先看到一帧深色。

一处必须改的细节：深色下 ember-300 是亮橙（用在引用块的斜体说明上），到了白底几乎看不见，浅色下要压成 #8a3f0c 这种深橙。**变量覆盖不是照抄数值，逐项都要问「它在另一套底色上还读得清吗」。**

### 新手教程（第 3 项）

`packages/web/src/help.ts` 放文案（四步上手 / 三种模式对照表 / 隐私口径 / 5 条 FAQ），`components/HelpPanel.tsx` 只负责渲染，`shouldAutoOpenHelp()` 决定首开是否自动弹。三件事因此变成可测试的纯函数，18 条断言里有 15 条是纯函数断言。

其中隐私口径是**新增的事实陈述**，不是装饰：简历只写本机 SQLite；离线回放不联网；只有联网录制与联网直连会把简历发给配置的模型服务商。这句话以前只存在于 README，现在用户第一次打开就能看到。

### 判定口径（第 6 项）

每条判定除理由外多出一行「为什么这样判：<固定口径>」，外加可展开的判据说明。判据是常量表 `VERDICT_CRITERIA`（rule + basis），不是模型现编的——模型给的是「这一条为什么」，固定口径回答的是「这个档位是什么意思」。两者都在界面上，读者不必靠推理去猜「证据缺失」和「与原文矛盾」的区别。

### 拆提交手法（值得记）

App.tsx 同时含配色与教程两件事，硬拆会把文件改两遍。做法：先把完整版复制到 `.tmp/App.full.tsx`，再逐条 edit 摘掉教程相关 6 处（两个 import、一个 state、一个回调、头部按钮、末尾渲染），提交配色；然后 `cp` 回来提交教程。**代价是要记住「摘掉哪 6 处」；收益是每个提交都能对上一次对话。**

### 验证

- `npm run verify` exit 0：typecheck + **35 个测试文件 / 345 条断言** + 冒烟 9 项 + build（CSS 24.67 kB / JS 275.79 kB gzip 86.62 kB）。
- `npm run shots` 14 张、控制台 0 报错（新增 12-help 与 13-light，报告页改名 14-report）。
- `npm run e2e:ui` **40/40**（新增：首开自动弹教程、教程讲清三种模式、教程写明隐私口径、点「知道了」收起、配色切换并记住、每条判定都有判定口径）。

### 两条教训

- 组件自带「首次自动弹」会打乱所有浏览器脚本：截图器现在开头先点掉弹层，点测脚本则干脆把它当成一项断言。见 findings F38。
- 浅色主题不是把颜色取反，而是逐项检查对比度；`--color-ember-300` 在白底上必须变深。见 findings F37。

### 下一步

继续 12 项里的其余项：doc/pdf 导入 → 自定义面试官 + API 优化（含非计算机专业预设）→ 页面内切模式与模型 → 确认后自动改简历并导出 → 零门槛安装 → 桌面快捷方式 → 可增加功能清单 → 全部完成后再次全功能测试。录像留到最后（用户明确要求）。

## Session 19 · 2026-10-26 · 第 2 项：从 PDF / Word 导入简历，顺带修掉一个会让所有浏览器脚本假失败的坑

**背景**：12 项里的第 2 项「支持 doc 和 pdf 导入简历」。这一项决定了非计算机专业的用户能不能用起来——
不会复制粘贴的人，只会在浏览器里点「选文件」。

### 解析链：四条路，四条不同的取舍

- **PDF 用 unpdf 1.9.1**（纯 JS、零依赖、内联裁剪过的 pdf.js）。对比过 pdfjs-dist：34.9 MB，还带可选原生依赖
  @napi-rs/canvas，直接与「10 分钟复现」冲突。取文字只需要 extractText，够用。
- **.docx 自己拆**：docx 就是 zip，node:zlib 的 inflateRawSync 解出 word/document.xml，按段落标签取文本，
  一百行不到，零依赖。
- **老版 .doc 明确拒绝（415）**，并提示「用 Word / WPS 另存为 .docx 再导入」。试过的 word-extractor 解析质量不稳，
  而且本机造不出可信样本——没有样本的代码就是没验证过的代码，于是把它卸载了。
- **txt / md 先 UTF-8 再试 GBK**，取乱码少的那个：中文用户手里真的会有 GBK 的 txt。

上传的字节不落库不留盘，解析完只把文本交给与粘贴完全相同的路径——隐私口径与代码一致。
错误分三档：413 太大 / 415 格式不支持（含老版 doc）/ 422 解析不出内容（扫描件、空文件、损坏）。

### 界面上怎么接

简历那一块原本是 label（点哪儿都能聚焦到 textarea），现在要放一个按钮，**label 会把第一个 labelable 后代
当成自己的控件**，于是点输入框会弹出选文件对话框——改成 div。隐藏 input 的 onChange 里先读文件再
`event.target.value = ''`，否则同一个文件连选两次不会再触发 change。

### 抓到的真缺陷：孤儿浏览器占着调试端口

给点测加导入场景后，e2e 从第 6 项开始连续 FAIL（「第一次打开自动弹出新手教程」），最后在 e2e.mjs:199 抛
`Cannot read properties of null (reading 'click')`。产品与构建都没问题（干净 profile 实测教程确实会弹）——
**脚本连上的是上一轮遗留的浏览器**：两个工具都用 proc.kill() 收尾，Windows 上只结束启动器，Edge 进程树还活着；
9344 端口上同时有两个监听者，旧 profile 里 `crossexam.seen-help=1` 早写过了，于是这条断言必然失败。
一次清出 57 个孤儿 Edge 进程。

处置三件一起做：收尾改发 CDP 的 Browser.close（taskkill /T /F 兜底）· 起浏览器前预检调试端口，被占用就响亮失败 ·
只认 `type === 'page' && url === 'about:blank'` 的 target，收尾后再 warnIfPortBusy。见 findings F40。

### 验证

- `npm run verify` exit 0：typecheck + **36 个测试文件 / 360 条断言** + 冒烟 9 项 + build（318 ms）。
- `npm run e2e:ui` **42/42**（新增：从文件导入后解析结果落进输入框、并写明文件类型与字数）。
- `npm run shots` 14 张、控制台 0 报错；跑完孤儿 Edge 0 个、9344 与 8811 端口空。

### 两条教训

- 解析器的可信度取决于**夹具是怎么造出来的**：pymupdf 的 china-s 字体没有 ToUnicode，浏览器看得见、解析器读不出，
  差点把「夹具不对」判成「解析器坏了」。见 findings F39。
- 浏览器脚本的第一条断言应该是「我连的是我自己刚开的那个浏览器」；把端口占用当沉默事实，
  失败会长得像产品缺陷，排查方向会完全跑偏。见 findings F40。

### 下一步

12 项里的其余项：自定义面试官 + 用 API 优化自己的契约（含非计算机专业预设）→ 页面内切 live/回放与模型 →
确认问题后自动改简历并导出 PDF/DOC → 零门槛安装（含桌面快捷方式，需用户同意）→ 可增加功能清单 →
全部完成后再次全功能测试。录像仍留到最后。

---

---


## Session 20 · 2026-10-26 · 第 5 项：页面里自己选离线回放还是联网模型

**目标**：用户问「live 模型与离线回放的区别是什么，能不能在页面里选择切换模型」。这不只是加个开关——
它要求「这一场用什么跑」变成可留档、可解释、可复现的一件事。

- 后端：`live.ts` 新增 `listLiveModels()`（先 `resolveLiveConfig`，配不全就**一个网络包都不发**直接返回原因）；
  `AppOptions` 加 `clientFactory`；`POST /api/sessions` 接受 `mode` 与 `model`，落进会话行的 `llmMode` 与 `meta.model`；
  跑的时候按**会话行**建客户端（单一事实来源在库里，不用内存 Map）；新增 `GET /api/models`；`/api/health` 补
  `modes` / `modeLabels` / `live: {ready, missing}`。
- 前端：投料台加「运行模式」三选一（离线回放 / 联网直连 / 联网录制）+ 模型 `input + datalist`（可下拉可手填）；
  只切到联网才去拉清单；拉不到也给出下一步文案（缺哪个环境变量 / 接口返回什么），不静默失败。
- 门禁：`npm run verify` 全绿（36 个测试文件 / 369 条断言 + 冒烟 9 项 + build）；`npm run e2e:ui` 47/47；
  `npm run shots` 15 张（新增 `15-modes.png`），控制台 0 报错，跑完孤儿 Edge 0 个。

### 一处真缺陷（点测抓到的）

e2e 里「没配置联网就明说缺哪个环境变量」先失败后成功：等待条件写的是「模型输入框出现且提示非空」，
而那一刻提示还是 `正在向后端要模型清单…`——**元素在点击瞬间就出现了，结论是几百毫秒后异步回来的**。
改成「提示里不再有那句过程文案」再断言，见 findings F41。顺带把两个浏览器脚本继承来的 `LLM_*` 显式抹掉，
让「没配好联网」这条分支不随本机环境变化。

### 下一步

12 项里的其余项：确认问题后自动改简历并导出 PDF/DOC → 零门槛安装（含桌面快捷方式，需用户同意）→
可增加功能清单 → 全部完成后再次全功能测试。录像仍留到最后。
---

## Session 21 · 2026-10-26 · 第 4 项：面试官不写死在代码里

**目标**：用户第 4 条要求「不能只有技术面试官，要能在页面里自己设置面试官，并通过 API 对自己的契约进行优化，
所有专业的人都能用」。难点不在界面，在于**自建面试官不能是自由文本**——否则它绕开了整个第 2 章的意图控制。

- shared：新增 `interviewer.ts`。`InterviewerDraft` 是窄字段（名称/领域/资历/语气/简介/目标/手法 2–5 条），
  过 `interviewerDraftSchema`；`buildCustomContract` 把它补成与五位预设同构的 `IntentContract`（`persona.role='custom'`），
  于是渲染、指纹、约束条款全部复用。另有 `DOMAIN_ALIASES`（18 个行业）、`DRAFT_SEEDS`（6 条非计算机示例）、
  `TACTIC_RULES`（7 条按措辞触发的中文手法）与 `localDraftFromText`——纯规则、确定性、**不联网**。
- server：schema v4 加全局 `interviewer` 表；`orchestrator/panel.ts` 统一 `PRESET_ROLES` / `normalizePanelIds` / `resolvePanel`；
  `orchestrator/optimize.ts` 走模型并 zod 校验，失败退回本地规则且明说没走模型；HTTP 新增
  `GET /api/interviewers`、`POST /api/interviewers/draft`、`POST /api/interviewers`、`DELETE /api/interviewers/:id`；
  `POST /api/sessions` 收 `interviewers` 并把解析出的 `panel` 写进 `meta.panel`（契约冻结在会话里）。
- 前端：`studio.ts`（与 shared 逐字对账的常量 + 前端预检）+ `InterviewerStudio.tsx`（一句话描述、六个非计算机种子、
  AI 补成契约 / 只用本地规则两键、「AI 改了什么」diff、渲染出的 System Prompt、库里自建面试官的编辑与删除）；
  阵容从 `InterviewerRole[]` 改成 `string[]`，自定义排在预设之后且顺序稳定（顺序会进提示词指纹）。
- 门禁：`npm run verify` 全绿（**38 个测试文件 / 404 条断言** + 冒烟 9 项 + vite 32 modules / JS 298.51 kB）；
  `npm run e2e:ui` 连跑三轮 **56/56**；`npm run shots` **16 张**（新增 `16-studio.png`），控制台 0 报错。

### 三处真缺陷（都是点测 / 测试抓到的）

1. **预算配置多喂一个字段就误报契约漂移**（F42）：`BudgetConfig` 四字段、契约只声明三个，
   `resolvePanel` 与 `contractViews` 有一处没收窄，同一场在「跑」与「对账」两处算出不同指纹。
2. **e2e 断言查了按钮标签**（F43）：「医护」是按钮上的字，填进描述框的正文写的是「临床护士」，断言假失败。
3. **seed 点击竞态**：点完种子按钮立刻读描述框读到空串，改成先点再等 value 非空。

### 下一步

12 项里还剩：确认问题后自动改简历并导出 PDF/DOC（第 8 项）→ 零门槛安装与桌面快捷方式（第 7、10 项，需用户同意）→
可增加功能清单（第 11 项）→ 全部完成后再次全功能测试（第 12 项）。录像仍留到最后。
---


## Session 22 · 2026-10-26 · 第 8 项：勾选建议，简历当场改成能发出去的一版

**目标**：用户第 8 条要求「提出问题后，用户确认后应自动把简历做对应修改，并提供 PDF 或 DOC 导出」。
难点不在导出（第 6 项已经有「服务端出 HTML、PDF 交给浏览器」这条路），在于**「改」这个写操作该收多窄**。

- shared：新增 `revise.ts`。`Revision` 是「原文区间 → 新文本」的结构化替换；`applyRevisions(原文, 候选)` 一次算完，
  返回 `{text, applied, skipped}`；`movedSpans(applied)` 按累计位移把改动坐标换算到新文本上（不接受调用方传原文）；
  `pendingClaimIds(suggested, accepted)` 算「还有哪些没动」。11 条测试。
- server：schema v5 加 `revision` 表与 `revised_resume`；`revisions.ts` 是写操作的服务层——
  **只认 claimId**（改前改后从库里那条建议读）、**每次从原文重算**（采纳记录是集合不是叠加）、改不动就进 `skipped` 并给中文理由；
  `resume-export.ts` 是简历渲染器（与报告渲染器分开），默认导出干净一版，`marks=1` 才标绿。
  HTTP 六个接口：`GET/POST/DELETE /api/sessions/:id/revisions` 与 `resume.txt` / `resume.html` / `resume.doc`。
- 前端：`revisions.ts`（纯函数）+ `RevisionBar.tsx`（已改/待定/改不动/本次勾选四枚计数、全部采纳、确认采纳、
  三个导出入口、全部撤销）；`ClaimBoard` 的建议块加「采纳」勾选框，改不动的显示「勾了但没改成：…」；
  `ResumePane` 标题在「简历原文」与「改完的简历」之间切换，副标题给出字数与改动处数；`highlight.ts` 的 `buildSegments`
  多接一路「已改写」区间，聚焦与已改写重叠时聚焦优先、已改写只被切短不丢字。
- 门禁：`npm run verify` 全绿（**41 个测试文件 / 441 条断言 / 4.1 s** + 冒烟 9 项 + vite 34 modules / JS 306.54 kB）；
  `npm run e2e:ui` **67/67**（新增 11 条：勾选框条数、全部采纳计数、确认后服务端真改了、三个导出各自取一遍并核对内容、撤销回原文）；
  `npm run shots` **17 张**（新增 `17-adopt.png`），控制台 0 报错。

### 三处值得记的决定

1. **接口只收主张 id，不收文本替换**（ADR-0009）：否则带着 sessionId 就能往简历里写任意内容。
2. **采纳记录是集合不是操作序列**（F44）：撤销不需要反向操作，先 C1 后 C3 与一次 [C1, C3] 逐字节相同。
3. **简历渲染器与报告渲染器分开**（F45）：复用会让导出的简历带上满屏判定徽章，那不是要发给 HR 的东西。

### 下一步

12 项里还剩：零门槛安装与桌面快捷方式（第 7、10 项，需用户同意）→ 可增加功能清单（第 11 项）→
全部完成后再次全功能测试（第 12 项）。录像仍留到最后。
---

## Session 23 · 2026-10-26 · 第 7、10 项：不敲命令也能用起来

**目标**：用户第 7 条「完全没用过计算机的人都能直接安装迅速用起来」+ 第 10 条「经用户允许自动创建桌面快捷方式」。
难点不在起服务——在**判断该做哪几步**，而且这份判断必须能测。

- `tools/launcher/src/plan.mjs`（纯函数、零 IO）：`parseNodeVersion`（严格三段，认不出返回 null 不猜）、
  `compareVersions` / `nodeVersionOk`（下限 22.5.0）、`launcherSteps`（按 `hasDependencies` / `hasWebBuild` 决定走几步）、
  `makeShortcutScript`（WScript.Shell 脚本）、`browserOpenArgs`（win32 用 `cmd /c start`、darwin 用 `open`、其余 `xdg-open`）、
  `reuseNote`、`psQuote`、`desktopShortcutDir`。
- `tools/launcher/launch.mjs`：只碰文件与起进程。先 `fetch('/api/health')` 探测（命中就只打印复用提示并 exit 0），
  否则按 `launcherSteps` 走，起服务后每 400ms 轮询健康检查，通了再开浏览器；`--shortcut-only` 只建快捷方式。
- 入口：`启动.cmd`（CRLF + `chcp 65001`，`where node` 查不到就打印下载页并 `pause`）/ `启动.sh` / `装个快捷方式.cmd`；
  `package.json` 加 `npm run launch`。
- 真机实测：第一次约 20 秒（装依赖 + 构建），第二次约 2 秒；第二次跑直接命中复用分支；
  快捷方式真在 `C:\Users\xinyi\Desktop` 建出来（TargetPath 指向 `启动.cmd`、WorkDir 指向仓库根）。
- 门禁：`npm run verify` 全绿（**42 个测试文件 / 453 条断言** + 冒烟 9 项 + vite 34 modules / JS 306.54 kB）。

### 两处坑（写进 findings）

1. **F46**：入口脚本第一版把判断全写在脚本里 → 没法测；抽成纯函数后「第二次不该 npm install」一行断言守住。
   顺带发现 `makeShortcutScript` 无条件写 `IconLocation`（空串让桌面图标变白纸）、`desktopShortcutDir` 返回原生分隔符。
2. **F47**：`launch.mjs` 第一版直接 spawn，双击两次就撞端口吐堆栈；用 `spawnSync(node -e fetch)` 探测又因 Windows 引号转义静默失败，
   改回当前进程 `await fetch` 才稳。

### 下一步

12 项里还剩：可增加功能清单（第 11 项）→ 全部完成后再次全功能测试（第 12 项）。录像仍留到最后。
---

## Session 24 · 2026-10-26 · 第 12 项：把每一处都真的点一遍（回放 67 项 + 联网 32 项）

**目标**：用户第 12 条「在这些优化完成之后再次进行全功能测试」。做法不是再跑一次 `npm run e2e:ui`——
那套只覆盖回放模式。这一轮要验的是**产品在真实条件下**成立：真浏览器、真联网、用户的真实简历（PDF）。

### 三条独立的验证轨道

| 轨道 | 形态 | 结果 |
| --- | --- | --- |
| 回放 | `npm run e2e:ui`（无头 Edge，67 项） | 67/67，控制台 0 报错 |
| 联网 + 真简历 | `.tmp/live-full-all.mjs`（真起服务 + 真调 DeepSeek + PDF 导入） | 32/32，整场 19–28 s |
| 出图 | `npm run shots` | 17 张，控制台 0 报错 |

联网那条最贵也最有价值：把 `C:/Users/xinyi/Desktop/第三版简历.pdf` 拖进导入框，1006 字，
12 条主张全部锚定、12 条判定、18 次追问、3 轮、8 条建议、「改 8 处 1209 字」；
打开思考模型后思考分栏最长一次读到 221 字（英文，界面原样显示，不翻译）。

### 脚本里修掉的四个缺陷（都是脚本错，产品没错）

1. **给 `input` 设值报 InvalidStateError**：`querySelectorAll('input')[0]` 拿到的是隐藏的 `type=file`。
   **页面里 input 的顺序不是人眼看到的顺序。**
2. **`webSocketDebuggerUrl` 是 undefined**：上一轮残留的 Edge 占着 9355，`/json/version` 通但 `/json/list` 里没有 `about:blank`。
   选目标时要「优先 `about:blank`，兜底第一个 page」，并且跑之前用 pwsh 清残留（bash 里套 `powershell -Command` 时 `$_` 会被 bash 吃掉）。
3. **「每条主张都带锚点 —— 0/0」**：`waitText('置信度')` 命中的是 verdict 阶段的中间态，此时库里那一场还是 `scoring`、claims 表 0 行。
   这是 F41 的第二次复现，而且是我自己写的脚本又踩：**等到文字出现 ≠ 等到这一步做完**，要轮询 `/api/sessions` 到 `status==='done'`。
4. **JSON 字段猜错**：`view.verdicts` 的元素是 `{verdict, adjusted, adjustmentReason, droppedEvidence}`，`kind` 在 `v.verdict.kind`；
   而 claim 行的 `claim.verdict` 直接就是 kind 字符串。两处形状不一样，不能想当然。

### 一处真设计问题（已修，见 F48）

联网脚本里「切到联网后等结论」那段循环跑了 18 秒还 PASS——因为清单拉成功时 `[data-shot=mode-note]` 元素**直接消失**，
`textContent` 恒为空，条件永远不满足，最后拿上一轮的过程文案做了断言。
处置：状态收进 `packages/web/src/runmode.ts`（`modelNoteOf` / `isPendingNote` / `MODEL_NOTE_PENDING`），界面与点测读同一个返回值，6 条单测。

### 门禁

`npm run verify` 全绿：**43 个测试文件 / 459 条断言 / 4.8 s** + 冒烟 9 项 + vite 35 modules / JS 306.75 kB（gzip 95.63 kB）。

---

## Session 25 · 2026-10-27 · P9：岗位模板库（12 个行业 × 3 个岗位）

### 目标

用户 m07544 第 2 条说「D1 行业模板库还是太少了」。这条要求的场景是：不懂某个行业的人打开这个工具，
面对空白投料台不知道该喂什么料。模板要解决的就是这十秒钟。范围按 roadmap-v2 第 3 节拍板：**36 条 = 12 个行业 × 3 个岗位**。

### 做了什么

| 层 | 产出 |
| --- | --- |
| shared | `templates/types.ts`（`JobTemplate` + `TEMPLATE_LIMITS`）· `templates/part1..part4.ts`（各 9 条）· `templates.ts`（合并 + `TEMPLATE_INDUSTRIES` / `templateById` / `templatesOfIndustry` / `templateDigest` / `templateProblems`）· `test/templates.test.ts` 8 条 |
| server | `GET /api/templates`（只读，附指纹）· `POST /api/templates/:id/apply`（幂等采用：派生面试官 id、`created` 区分新建与复用）· `test/http.test.ts` 新增 6 条 |
| web | `templates.ts`（分组 / 默认行业 / 采用提示，纯函数）· `components/TemplatePicker.tsx`（行业 chip + 该行业岗位）· 接进投料台最上方 · `test/templates.test.ts` 8 条 |
| tools | 点测新增「岗位模板库」场景 9 条（含幂等与清空）· 截图新增 `18-templates.png` |

### 三处真问题（都不是设计阶段发现的）

1. **part1.ts 的 9 条全部低于字数下限**（JD 159 字、示例简历 161 字）。全库自检报 17 条，测试 3 failed。
   处置：交给原 part3 的 subagent 只改 part1 的 jd/resume 两字段（它有上下文，也是它先报出这个问题的），改到 `templateProblems` 归零；
   模糊表述（下降明显 / 参与抢救十余次 / 深受学生喜爱…）全部保留未洗白。
2. **点测脚本崩了就不收浏览器**（F51）：新场景第一次失败（那会儿前端还没重新构建，见 F52）抛异常，收尾那几行没执行，
   Edge 留在 9344 端口上；下一轮开局直接「调试端口已被占用」，一条断言都没跑——一次失败变成连续失败。
   处置：整段点测包进 `try { … } finally { 关浏览器; 清理; 查端口; 写 summary }`。
3. **反面断言被「总数不对」兜住**（F49）：我第一版把**单条模板**喂给 `templateProblems` 做反面测试，结果每条规则都因为「总数不对」通过。
   处置：拿整份 36 条当底子，只注入一处毛病，再断言报出来的问题里包含对应关键词。

### 门禁与实测

`npm run verify` exit 0：**45 个测试文件 / 481 条断言 / 4.2 s** + 冒烟 9 项 + vite 37 modules / CSS 26.16 kB / JS 309.48 kB（gzip 96.40 kB）。
`npm run e2e:ui` **76/76**、控制台 0 报错；`npm run shots` **18 张**、控制台 0 报错。
实测明细：`12 个行业 / 3 个岗位` · 切到财务会计得到 `tpl-fin-general-ledger,tpl-fin-cost,tpl-fin-internal-audit` · 点「三甲医院 药房主管」后 258/183 字与岗位名一起填好 · 契约 3 条、自建面试官 1 → 2 位 · 再点一次提示「这位面试官库里本来就有，直接复用了」且自建数不变。

### 下一步

P8 多 JD 岗位审阅（1–8 份 JD、双锚点、schema v6、卡带重录）。

## Session 26 · 2026-10-27 · P8：岗位要求审阅（1–8 份 JD，追问挂第二处锚点）

### 目标

用户 m07544 第 2 条说「用户可以自己多上传一些 JD 让面试官阅览之后，面试官根据这些 JD 中的要求和 jd 所需的知识，审阅它的简历提出问题」，
第 5 条则要第二个大功能。范围按 roadmap-v2 第 4、6 节拍板：**1–8 份 JD → 逐份抽要求 → 跨份归并 → 与主张逐条对照 → 前两组（答得上 / 答得含糊）拿去追问，一条追问同时挂 JD 原文与简历原文两处锚点**。

### 做了什么

| 层 | 产出 |
| --- | --- |
| shared | `schemas.ts` 增 `jdRequirementListSchema` / `jdGroupListSchema` / `jdMatchListSchema`（`probeDraftSchema` 加可选 `requirementId` + `jdQuote`）· `requirements.ts`（`REQUIREMENT_LIMITS`（8 份、40–6000 字、每份 ≤12 条、合计 ≤30）· `jdTitleOf` / `jdIdOf` / `normalizeJdText` / `jdDigest` / `jdProblems` · `groundExtracted` / `mergeExtracted`（一条都不丢，漏掉的成员由代码兜回）· `requirementNotes` / `matchSummary` / `matchConclusion`）· `domain.ts` 增 `JobDescription` / `Requirement` / `RequirementMatch` 与 `MATCH_LABEL` / `REQUIREMENT_KIND_LABEL` · `test/requirements.test.ts` 14 条 |
| server | 编排层新增 `jd.ts`（`extractRequirements` 逐份并发 / `mergeRequirements` / `matchRequirements`）· `prompts.ts` 增三个阶段（`jd-extract` / `jd-merge` / `jd-match`）与 `renderRequirementNotes` · `probe.ts` 双锚点（`jdAnchorOf` 要求两个字段同时给，锚不回就退回普通追问并在 rationale 里说明）· `run.ts` 只在有 JD 时跑三阶段 · `pipeline.ts` 落三张表并把六项加进 `SessionView` · **schema v7**（`probe` 补五列 + 表重建迁移）· 两份报告加「二、岗位要求对照」章节 · HTTP `POST /api/sessions` 收 `jds` · `test/jd.test.ts` 6 条 + `test/store.test.ts` 迁移 1 条 + `test/demo-cassette.test.ts` 扩到八阶段 |
| web | 投料台 JD 块改成 1–8 份列表编辑器（增删、逐份校短、`jd-problem` 提示）· 右栏改成「简历原文 / 岗位要求原文」分屏，共用同一套聚焦与高亮机制 · 中栏新增「岗位要求对照」栏（三组分组、每条要求一张卡、「为什么这么判」、点引文两栏同时聚焦）· `test/jds.test.ts` 7 条 + `test/requirements-state.test.ts` 9 条 |
| tools | `scripted-demo.ts` 增三个阶段与 `requirementNotesIn()`（离线也吐第二处锚，一条主张只挂一次要求）· `seed:demo` 重录 **32 盘**（两遍签名一致 `39ed9f94068b`）· 点测新增两个场景、**88/88** · 截图新增 `19-requirements.png` |

### 三处真问题（都不是设计阶段发现的）

1. **双锚点只活在事件流里**（F54）：`Probe.requirementId` / `jdAnchor` 是可选字段，第一版写完就收工——直播时界面上看得见，测试全绿。
   直到要「重开一场历史会话」才发现 `probe` 表根本没有这几列，双锚点在重开的那一刻就没了。处置：`SCHEMA_VERSION` 6 → **7**，
   `probe` 补 `requirement_id` / `jd_quote` / `jd_start` / `jd_end` / `jd_exact` 五列并做一次表重建迁移；**另起 v7 而不是改 v6**，
   因为任何已跑过 v6 的库都会因表结构对不上而静默出错。迁移测试用手搓的 v6 最小库守住老数据读得回。
2. **「至少要有一份 JD。」把纯简历场次整条路堵死**（F55）：这条校验站在「这个功能叫岗位审阅」的角度看天经地义，
   但产品的第一条用法就是「只想拿简历自己练一场」。处置：`jdProblems([])` 返回空数组，并加一条测试守着；
   顺带暴露出四处测试夹具的桩 JD 不足 40 字——那才是真该报 400 的东西（**保留校验、改夹具**）。
3. **离线演示里双锚点全都没了**（F56）：合成脚本 `probeText()` 只认「主张 + 引文」，不认提示词里新出现的「岗位要求里对得上的几条」小节，
   于是联网跑有双锚点、离线演示没有——而评委第一次接触这个产品走的正是离线演示。处置：让合成脚本按正则读回 `renderRequirementNotes()` 的渲染行，
   把 `requirementId` 与 `jdQuote` 一起吐出来。

另外两处踩在工具上的坑：点测脚本把 Node 这侧的变量 `firstReq` 拼进了**页面**表达式，页面抛 `ReferenceError`、外层看起来只是「等元素超时」（F57）；
`python` 插入阶段表那次因 `.tmp/p8rows.txt` 还没写就先读而 FileNotFoundError（先 write 再跑即成功）。

### 门禁与实测

`npm run verify` exit 0：**49 个测试文件 / 520 条断言 / 5.02 s** + 冒烟 9 项 + vite build 40 modules / CSS 27.45 kB / JS 321.07 kB（gzip 99.64 kB）。
`npm run e2e:ui` **88/88**、控制台 0 报错；`npm run shots` **19 张**、控制台 0 报错；仓库提交 215 个。
实测明细：一键示例的 235 字 JD 抽出 **7 条要求**（答得上 1 / 答得含糊 3 / 没写 3）· 双锚点追问 **4 处** · 服务端落库 32 盘卡带 · 两遍 seed 签名一致 `39ed9f94068b` · token 29,654。

### 下一步

P10 把「问」做深（A1 让求职者补一句真话 / A2 追问难度档位 / A3 报告按类别看短板 / A4 反问环节）。

## Session 27 · 2026-10-27 · P10：把「问」做深（短板 / 追问强度 / 补充说明 / 轮到你了）

### 目标

按 roadmap-v2 第 1 节与用户 m07596「按建议来」，P10 做 A 组四项：**A3 报告按主张类别看短板 · A2 追问难度档位 · A1 让求职者补一句真话 · A4 反问环节**。
四项共享一条设计前提：**都在同一份对话记录上换一个角度，一律不新增判定口径**——它们只把已有的主张、判定、依据重新聚合或重新用一遍，
所以四栏的数字必须永远对得上，且每一个都能在零网络下由仓库里的卡带复现。

### 做了什么

| 层 | 产出 |
| --- | --- |
| shared | `shortfall.ts`（`categoryShortfalls` / `weakestClaims` / `shortfallPlan` / `categoryLine` / `shortfallHeadline`，排序规则：欠得多的类别在前、同程度保持主张原顺序）· `difficulty.ts`（`DIFFICULTIES` 三档：温和 2/1/40 · 常规 3/2/60 · 挑刺 4/2/80，`budgetOf` / `contractBudgetView` 只换预算）· `supplement.ts`（`supplementProblem` / `insertionPointAfter` / `supplementRevision` 产出零宽插入）· `counters.ts`（`groundCounters`：依据必须锚回简历或 JD，锚不回当场进 `rejected`；id 截断后重编所以 Q1..Qn 连续）· `domain.ts` 增 `CounterQuestion` / `RejectedCounter` 与两套中文标签 · 四个测试文件共 43 条 |
| server | schema **v8**（`revision` 主键换 `(session_id, ordinal)`，因为一条主张可能同时落替换 + 插入两条改动；新增 `supplement` 表，只存那句话不存坐标）与 **v9**（新增 `counter` 表）· `revisions.ts` 采纳时把补充说明按主张锚点现算成插入 · 新接口 `POST/DELETE /api/sessions/:id/supplements` · 编排层 `counter.ts` + `prompts.ts` 的 `counter` 阶段（第九个阶段）· 两份报告都加「你补的证据」「轮到你了」两节 · `report.ts` 与 `report-html.ts` 的短板一节 · 测试：`counter.test.ts` 5 条 / `difficulty.test.ts` 7 条 / `supplements.test.ts` / `revisions.test.ts` 扩 |
| web | `state.ts` 折叠 `counter` 事件并派生 `shortfallOf` · `components/CounterBoard.tsx`（「轮到你了」一栏：类别徽章、依据来源、引文按钮、「为什么值得问」与标注是模拟的回答）· `IntakePanel` 的追问强度三 chip 与说明 · `ClaimBoard` 的「补一句真话」块 · `StageRail` 的「按类别看短板」块（点名单跳回简历原文）· `api.ts` / `labels.ts` 跟上九个阶段 · 前端测试 `studio` / `difficulty` / `shortfall-state` / `counters-state` / `revisions` / `highlight` 各扩 |
| tools | 离线演示脚本补上反问与三档预算（`DEMO_COUNTER_PLANS` 4 条、`requirementNotesIn()` 之外再读回要求小节；`seed:demo` 重录 **48 盘**卡带，两遍签名一致）· 点测新增「追问强度」「按类别看短板」「补充说明」「轮到你了」四个场景，共 **117/117** · 截图新增 `20-shortfall` / `21-difficulty` / `22-supplement` / `23-counters` 四张，共 **23 张** |

### 四处真问题（都不是设计阶段发现的）

1. **点测跑的是旧构建产物**（F58）：「轮到你了」做完后前端测试全绿、类型检查干净，可点测三条断言红、还报「等元素超时」，
   看起来像新组件没渲染。真原因是服务端托管的是 `packages/web/dist`，我改了源码却没 `npm run build`——`npm run build` 之后同一条命令 117/117。
2. **大文件 read 全量读会截断，写回去就把尾巴写没了**（F59）：`tools/ui-e2e/e2e.mjs` 实际 695 行，read 回来 656 行，拼回去 write 之后末尾收尾逻辑整段蒸发、`node --check` 报 `Unexpected end of input`。
   处置：`git checkout --` 复原，改成「grep 找唯一锚点 + 同程序内 read 局部 + edit」。
3. **零宽插入不能推进最右边界**（F60）：补充说明是零宽插入，第一版对它也执行 `lastEnd = end`，于是落在同一位置上的替换型改写被判成重叠而丢掉；
   改成 `if (!insertion) lastEnd = end;`。同一处放宽让老断言 X2（零宽 + 改前为空串）从「合法拒绝」变成「不该拒绝」，被红着的门禁抓了出来——旧断言按旧语义写，语义变了就得跟着改。
4. **断言点了页面上不存在的按钮**（F61）：「点短板名单里的主张」这条按服务端顺序取第一条短板拼 id 去点，而名单只有前 3 条，被上限挡掉的那条在页面上没有按钮——点了等于没点。
   处置：先从页面取第一个真实存在的 `^shortfall-C[0-9]+$` 拿到 `data-shot` 再回查主张；同族坑还有「存下之后编辑区收起，删除按钮不再渲染」，断言前先确认元素存在。

### 门禁与实测

`npm run verify` exit 0：**58 个测试文件 / 598 条断言 / 6.1 s** + 冒烟 9 项 + vite build 42 modules / CSS 28.75 kB / JS 332.86 kB（gzip 102.80 kB）。
`npm run e2e:ui` **117/117**、控制台 0 报错；`npm run shots` **23 张**、控制台 0 报错；`fixtures/llm` **48 盘**卡带；仓库提交 253 个。
实测明细（`.tmp/doc-stats2.mts` 直接调 `runAndPersist`，常规档）：46 ms · 3 轮 · 5 主张 / 10 追问 / 5 判定（站得住 1 · 表述过度 1 · 证据缺失 2 · 无法回答 1）· 4 条建议 ·
**4 句反问（依据 JD 2 · 依据简历原话 2）** · 7 条岗位要求（答得上 1 / 答得含糊 3 / 没写 3）· 每位面试官 tech 4 / hr 3 / hiring_manager 3 · token 31,172（输入 27,050 · 输出 4,122 · 思考 724）· 调用 33 次、事件 24 条。
追问强度三档实测：契约指纹常规档 `042b385f` → 挑刺档 `cf9c6457` → 切回常规回到 `042b385f`（换档真的换了契约）。

### 下一步

P11 改与复用：B2 逐条并排改动对照 ✅ · B1 改写风格档位 · C1 简历版本对比 · C2 历史仪表盘 · C3 单文件 HTML 打包。

## Session 28（2026-10-27）· P11 B2：改前改后并排对照

**目标**：采纳改写之后，用户要能看见「哪一句被改成了什么、它落在简历的什么位置」——报告与界面都要有，且两处必须是同一份结论。

**产出**

| 层 | 落点 |
| --- | --- |
| shared | `packages/shared/src/revise.ts` 新增 `SIDE_CONTEXT_CHARS` / `SideRow` / `clipSide` / `sideBySide`（改动行 + 上下文行）；测试 +5 条 |
| server | `report.ts` 新增 `sideBySideLines` / `sideCell` 与「六、改前改后对照」一节；`report-html.ts` 新增 `sideSection` + 五条 CSS；`renderReport` / `ReportHtmlOptions` 收 `applied`；三条导出路由把 `revisedOf(...).applied` 传进去；测试 +3 条 |
| web | `RevisionBar` 新增「并排看改动」开关（`data-shot=revision-diff-toggle` / `revision-diff`），默认收起 |
| tools | `e2e.mjs` +4 项（121/121）；`shots.mjs` +1 张（24 张） |

**真问题**

- 报告章节编号跟着内容走：没采纳过时不该出现「六」，否则复现方式跳号。改成按 `applied` 是否为空决定六七（`reproSection(view, hasSide)`）。
- 复现方式章节编号在两份渲染器里各写一遍就会不一致，最终仍由同一个判断（`applied.length > 0`）驱动两处。
- `report.html` / `report.doc` 两个路由原先直接内联 `c.req.param('id')`，加 `revisedOf(db, id)` 时暴出 `TS2304: Cannot find name id`，补上局部绑定。

**门禁与实测**：`npm run verify` exit 0（58 个测试文件 / 606 条断言 + 冒烟 9 项 + vite 42 modules）；`npm run e2e:ui` **121/121**；`npm run shots` **24 张**；卡带 48 盘。

**下一步**：P11 的 B1 改写风格档位（只调措辞收敛，不突破事实边界；改 suggest 提示词要重录卡带）。
## Session 29（2026-10-27）· P11 B1：改写风格三档

**目标**：同一处「表述过度」，有人想只删几个形容词，有人想整句重写——给用户一个只调**措辞收敛程度**的旋钮，且不突破事实边界。

**产出**

| 层 | 落点 |
| --- | --- |
| shared | `packages/shared/src/style.ts`：`REWRITE_STYLES=[conservative,normal,bold]` / `DEFAULT_REWRITE_STYLE=normal` / `REWRITE_STYLE_LABEL`（保守/常规/敢改）/ `REWRITE_STYLE_HINT` / `REWRITE_STYLE_GUIDE` / `rewriteStyleOf` / `rewriteStyleViews`；测试 +6 条 |
| server | `prompts.ts` 的 suggest 系统提示词带上档位；`run.ts` / `suggest.ts` / `pipeline.ts` 透传 `style`；`session.meta.style` 落库；`GET /api/health` 下发 `styles` + `defaultStyle`；非法档位 400；`report.ts` / `report-html.ts` 抬头加「追问强度」「改写风格」两行；测试 +7 条 |
| web | `IntakePanel` 三档 chip（插在「追问强度」之后、「播放节奏」之前）+ 说明段；`api.ts` / `contract.ts` / `App.tsx` 接线；打开历史会话时把强度与风格两档拨回当年 |
| demo | `scripted-demo` 从 System Prompt 读档位（第一版从 user 提示词读，三档都读成了常规）；`seed:demo` 覆盖 3 档强度 × 3 档风格 = 9 种组合，卡带 48 → **56 盘** |
| tools | `e2e.mjs` +5 项（**换风格后契约指纹必须不变**，与追问强度相反），**125/125** |

**真问题**

- 三档不进契约指纹：契约回答「谁在问」，风格回答「改得多狠」。混进同一个指纹，「换了风格」会被界面解释成「换了面试官」，历史场次不可比（F65 / D53 / ADR-0017）。
- `bold` 档最容易被模型读成「可以自己润色」，档位说明第一句就写死「不新增任何事实」，并由 `newNumbersIn` 在代码里兜底。
- 测试桩两连坑（F66）：suggest 返回的是**单个对象**不是数组；判定给 `solid` 时改写阶段整段跳过，三档都拿不到建议。

**门禁与实测**：`npm run verify` exit 0（**60 个测试文件 / 620 条断言** + 冒烟 9 项 + 构建）；`npm run e2e:ui` **125/125** 且控制台 0 报错；`npm run shots` 24 张；`npm run seed:demo` 写 **56 盘**（extract 1 / jd-extract 1 / jd-merge 1 / jd-match 1 / probe 24 / answer 10 / verdict 5 / suggest 12 / counter 1），九组合两遍签名一致，默认组合 `79f7d89bfdc9`。

**下一步**：P11 的 C1 简历版本对比（改完再跑一遍，判定怎么变）。

## Session 30（2026-10-27）· P11 C1：简历版本对比（改完再跑一遍）

**目标**：用户 m07544 / m07596 定下的第二阶段第一项 —— 让「改完再跑一遍，判定怎么变」
从一句产品承诺变成界面上点得出来的事实。这一步同时补上了 P12「成长档案」的数据底座。

**产出**

| 层 | 落点 |
| --- | --- |
| shared | `packages/shared/src/compare.ts`（约 9.6 KB）：`DEFAULT_ALIGN_THRESHOLD = 0.34` / `bigramsOf` / `textSimilarity`（bigram Jaccard）/ `alignClaims`（全对打分 + 降序贪心一对一）/ `verdictShift`（复用 `WEAKNESS_RANK`）/ `compareRuns` / `compareHeadline` / `shiftDetail`；测试 +17 条 |
| server | schema **v10** 加 `session.parent_session_id`（故意不加外键）；`packages/server/src/compare.ts` 的 `compareSessions`（四档：本场不存在 / 第一版 / 上一版被删 / 正常对比）；`GET /api/sessions/:id/compare`；`POST /api/sessions` 收 `parentSessionId`（指不存在的上一场回 400）；两份报告新增「比上次」一节且**后续章节编号整体 +1**；测试 +11 条 |
| web | `api.ts` 的 `CompareView` 契约与 `fetchCompare`；`packages/web/src/compare.ts` 的 `compareFactsOf` / `shiftDetailOf`（四状态文案）；`CompareBar` 组件（有真的变好变差时默认摊开）；`RevisionBar` 的「改完再跑一遍」按钮；`App.tsx` 把 `handleRun` 重构成 `startRun`（入口多一个 `parentSessionId`），新增 `handleRerun`；测试 +6 条 |
| demo | `seed:demo` 每种档位组合改跑**两场**：第一场全采纳改写 → 第二场拿改完的简历再质询（父会话记第一场），两场都录卡带并互相比对，第二场「比上次」必须 `improved > 0` 且 `worsened === 0`；卡带 56 → **149 盘**，三档风格改写字数 361→386 / 361→465 / 361→483 |
| tools | `seed-demo` 命令行每组多打三行（改写多少字、第二场摘要、比上次的 headline）；`e2e.mjs` 在契约对账前插入 5 条断言，把「采纳 → 再跑一遍 → 出结论」走完整条链路，**132/132** |

**真问题**

- 两场之间「同一条主张」在数据里不是事实而是估计（F67）：会话内 id 每场重编、改写后原文锚点已不存在。
  处置是承认它是估计：做成纯函数、可测试、可调参，并把配不上的单独摆出来（新增 / 消失），
  报告只谈变好/没变/变差、不报相似度分数。
- `ClaimComparison.improved` / `worsened` 是**成对的数组**不是条数，测试第一版按数字断言直接红
  （`expected [ …(4) ] to be 4`）。这类「名字像计数、其实是列表」的字段值得在类型上更明确一点。
- 点测那条红得很有价值（F68）：界面上「这是第一版」写在面板副标题里，断言读的却是正文元素。
  改成读整栏之后一个断言同时看到状态与说明，而且以后往这一栏加字不会因为「字换了位置」假红。
- 合成脚本第二场不能手抄改后文本：改后文本随改写风格档位变，手抄必然有一档落空。
  改成用标记（「主导引入 Redis 缓存」这类）从改完的简历里**现取引文**，主张文字则与第一场一字不差——
  界面的版本对比按主张文本配对，改一个字那一条就从「变好」掉进「新增/消失」两堆。

**门禁与实测**：`npm run verify` exit 0（**63 个测试文件 / 659 条断言** + 冒烟 9 项 + 构建）；
`npm run e2e:ui` **132/132** 且控制台 0 报错；`npm run seed:demo` 写 **149 盘**
（extract 4 / jd-extract 1 / jd-merge 1 / jd-match 4 / probe 78 / answer 25 / verdict 20 / suggest 12 / counter 4），
九组合两遍签名一致，默认组合 `64aa0be85503`。

**提交**：`550156d` shared 相似度配对 · `29fe81d` schema v10 · `a4f3e5f` 版本对比接口 ·
`5b806f2` 报告「比上次」· `3acd413` web 契约与文案 · `3780200` 再跑一遍按钮与「比上次」栏 ·
`710b914` 点测存在条件 · `9fb6c63` 删除重入守卫 · `818e56f` 离线演示多跑一场 ·
`050addf` 示例简历两场回归 · `9035866` 点测端到端。

**下一步**：P11 的 C2 历史仪表盘。


## Session 31（2026-10-27）· P11 C2：历史仪表盘

**目标**：C1 把「两场」比清楚了，但历史栏跑到第三场就失效——一列场次看不出是在变好还是在打转。
C2 要在历史栏顶上加一句话结论，并把「哪些类别总被打回」摆出来。这一步也顺手把 P12 成长档案要用的
「同一份简历跑过几场」算出来了。

**产出**

| 层 | 落点 |
| --- | --- |
| shared | `packages/shared/src/overview.ts`：`TREND_POINTS = 5` / `SessionFacts`（`probes` 可为 `null`）/ `overviewOf` / `overviewHeadline` / `trendLine` / `meanOf` / `newestFirst`；判定分布复用 `verdictCounts`、类别短板复用 `categoryShortfalls`，自己一个字都不算；测试 +11 条 |
| server | `packages/server/src/overview.ts` 的 `overviewSessions(db, limit = OVERVIEW_WINDOW)`（`OVERVIEW_WINDOW = 200`，追问数取 `listProbes().length` 真实行数）；`GET /api/sessions/overview` **注册在 `/api/sessions/:id` 之前**（Hono 按注册顺序匹配）；测试 +6 条 |
| web | `api.ts` 的 `HistoryOverview` 契约与 `fetchOverview`；`packages/web/src/overview.ts`（`dayLabel` / `trendBars` / `categoryLines` / `sameResumeNote` / `overviewFactsOf`）；`OverviewBar` 组件（空库整块不渲染）；`IntakePanel` 历史块上方接线；`App.tsx` 与 `sessions` 一起刷新（两处分别取会出现「列表 3 场、统计说 2 场」）；测试 +9 条 |
| tools | `e2e.mjs` 加 4 条断言：界面 headline 与 `/api/sessions/overview` 的 headline **一字不差** / 接口场次数等于历史列表行数 / 柱子数等于 `min(trend.length, 5)` / 同一份简历跑过 2 场以上时出现那句提示；**136/136** |

**真问题**

- 「同一件事算两次」的失败不是崩溃，是两个都对但不一样（F69）。仪表盘完全可以自己 `reduce` 一遍判定分布，
  但哪天「欠证据算不算欠」这种口径一改，它就和报告分叉。处置是直接 import 现成实现，
  并且自己在 shared 里**不持有任何「哪个判定更差」的知识**（排序仍只在 `WEAKNESS_RANK` 一处）。
- 第一版把「空库」与「还没取到」混成一种状态（都返回 `null`），界面每一处都要写三元判断，
  刷新时还会闪一下「还没有跑过任何一场」（F70）。改成数据层永远给结论、界面层用 `facts.empty` 决定不渲染。
- 路由顺序是个静默陷阱：`/api/sessions/overview` 写在 `/api/sessions/:id` 后面会被当成会话 id，
  返回「会话不存在」，而且接口自身看不出错。测试里专门留了一条 `not 404` 的断言守着。
- 追问数的平均数不能把取不到的场次当 0：那会让还没跑完的场次把平均值往下拽。`meanOf` 只在非 `null` 上求平均。

**门禁与实测**：`npm run verify` exit 0（**66 个测试文件 / 685 条断言** + 冒烟 9 项 + 构建）；
`npm run e2e:ui` **136/136** 且控制台 0 报错；`npm run repro` 干净目录 **70.8 s**
（clone 33.3 s · install 15.0 s · verify 18.6 s · 跑完一场并下载报告 0.8 s），
因此 README / 技术文档 / `tools/repro` / 发布清单 / `task_plan` 五处的耗时表与「5 倍余量」一并改为 70.8 s 与「8 倍余量」。

**提交**：`7b6afe2` shared 聚合纯函数 · `858d1fb` 仪表盘接口 · `97f45a6` 界面历史栏 ·
`66020f0` 点测对账 · 后续 `docs` 一个提交（ADR-0019 + F69/F70 + D55 + 数字同步 + 技术文档重出）。

**下一步**：P11 的 C3 单文件 HTML 打包。
## Session 32（2026-10-27）· P11 C3：单文件 HTML 打包

**目标**：整场能打成一个文件发出去，收件人断网双击也能看。

- [x] `packages/server/src/bundle.ts`：`renderBundleHtml(view, {applied, compare, events})` + `bundleFileName`
- [x] 报告正文不重写，直接嵌 `renderReportHtml` 的输出；后接「附一、简历原文（含本版改动）」与「附二、这一场是怎么跑出来的」
- [x] `report-html.ts` 把 `STYLE` 与 `esc` 改为 export，两处共用同一套样式与转义
- [x] `GET /api/sessions/:id/bundle.html`，`content-disposition: attachment`
- [x] 界面头部第四颗按钮「打包分享」（`data-shot="bundle-html"`）
- [x] `packages/server/test/bundle.test.ts` 6 条 + e2e 4 条（真下载一次，检查里面没有外链）
- [x] ADR-0020 / F71 / F72 / D56 / 技术文档 3.6.14 / README / roadmap / 数字同步 / 截图 / PDF 重出

**关键判断**

- 单文件导出真正的敌人是外链，不是排版（F71）：收件人断网就白屏，而发件人永远看不见，
  所以把「输出里不许出现 `http://` / `https://`」写成断言，而不是写成文档里的一句话。
- 复用渲染器 ≠ 复用调用方的副作用（F72）：打包函数第一版去读 `view.session.revisedText`——
  一个不存在的字段，typecheck 当场报错；改成在内部 `applyRevisions` + `movedSpans` 重算，
  就回到「输入 `SessionView` + `applied`、输出一个字符串」的纯渲染位置。
- 时间线只摆八类关键事件，并把阶段键名翻成中文；`answers` 与 `budget` 不单列——它们的后果已经在追问与判定里。

**门禁与实测**：`npm run verify` exit 0（**67 个测试文件 / 691 条断言** + 冒烟 9 项 + 构建）；
`npm run e2e:ui` **140/140** 且控制台 0 报错；`npm run shots` 24 张重出；
技术文档 PDF **29 页 / 2071 KB**（上限 30 页）；示例场次打包 24 KB、http(s) 出现 0 处。

**提交**：`ea1051b` 打包函数与路由 · `869fb4e` 界面按钮 · `766e7c0` 点测下载与无外链 ·
`2761ae8` 时间线翻成人话 · 后续 `docs` 一个提交（ADR-0020 + F71/F72 + D56 + 3.6.14 + 数字同步 + 截图 + PDF）。

**下一步**：P12 成长档案（同一份简历跨场次的能力曲线）与一岗一版简历。
## Session 33（2026-10-27）· P12 ②：成长档案（一条主张改了几回）

**目标**：C1 只回答「这一版比上一版」，改到第三版就说不清了；这一轮要能顺着版本链看出每条主张改了几回、现在还站不住吗。

- [x] `packages/shared/src/growth.ts`：`growthOf(sessions)` + `growthHeadline` + `trailLine` + `growthNote`，12 条单测
- [x] `packages/server/src/growth.ts`：`growthChainOf(db, id)` 沿 `parent_session_id` 往上读，`GROWTH_MAX_VERSIONS = 12`，7 条接口测试
- [x] `GET /api/sessions/:id/growth`（排在 `/api/sessions/:id` 之前，否则 overview 那类固定路径会被当成会话 id）
- [x] 界面 `GrowthPanel.tsx` 覆盖层 + 头部入口 + 「比上次」栏的「看全部版本」，e2e 7 条
- [x] 顺手修掉一个真缺陷：连点两下删除会留下一条点不动的幽灵会话（历史刷新响应乱序）
- [x] ADR-0021 / F73 / F74 / D57 / 技术文档 3.6.15 / README / roadmap / 数字同步 / 截图 / PDF 重出

**关键判断**

- 轨迹在**相邻两版之间**配对再串成链，不跨版直接配对（F73）：第二版补了口径能稳稳配上（相似度约 0.5），
  第三版再改半句，累积改动让「第一版 vs 第三版」掉到 0.34 阈值之下，同一条主张被算成「消失 + 新增」两条。
  两个算法都对，但结论不一样，用户没法判断信哪个——所以只能从一开始就只留一个（与 F27/F63/F69 同族）。
- 链是读 `parent_session_id` 连的，而 v10 刻意没给这一列加外键（删上一版不该把这一版带走）。
  代价落在读侧：父会话被删之后沿链走会撞空，第一版把它当成「这是第一版」，界面就会说「你只有 1 版」——
  用户只会以为数据丢了。所以「断」必须是一个字段（`broken` / `brokenAt`），而不是一个默认值（F74）。
- `persistent` 写死四个条件（最新一版还在 && 出现过 ≥ 2 版 && 一次都没站住 && 有判定），
  少任何一条，面板上的「改了还在被打回」都会开始说谎。

**门禁与实测**：`npm run typecheck` 干净；`npm run verify` exit 0（**69 个测试文件 / 710 条断言** + 冒烟 9 项 + 构建）；
`npm run e2e:ui` **147/147** 且控制台 0 报错。

**提交**：`c1ed57d` 幽灵会话修复 · `663c82f` shared 轨迹 · `ac1577a` 服务端接口 · `ae54631` 界面覆盖层 ·
`e85e12d` 点测 · 后续 `docs` 一个提交（ADR-0021 + F73/F74 + D57 + 3.6.15 + 数字同步 + 截图 + PDF）。

**下一步**：P12 ③ 一岗一版简历。

## Session 34（P12 ③：一岗一版）

**做了什么**：按岗位出一版简历——只做「留下 / 去掉」，一个字都不改。

- shared：`packages/shared/src/tailor.ts`（`claimRanges` / `tailorHeadline` / `tailorResume`，三条分支：没有要求 → 返回原文；
  一条都对不上 → 拒绝筛并说明；正常 → 只去掉「有主张且主张全部对不上」的行）+ 13 条单测。
- server：`packages/server/src/tailor.ts`（`tailorFor`，jdId 校验、base 取原文或改完的、不落库每次现算）+
  `GET /api/sessions/:id/tailor?jd=` 与 `tailored.txt/.html/.doc?jd=` 三件套（`resume-export.ts` 加 tailored 选项）+ 9 条单测。
- web：`api.ts` 的 TailorView 契约与 `fetchTailor` + 三个导出 URL、`components/TailorBar.tsx` 新栏、
  `ResumePane.tsx` 多出第三种视图「这一版（按岗位筛）」（不画锚点）、`JdPane.tsx` 的「按这个岗位出一版」入口、`App.tsx` 接线。
- 点测：`tools/ui-e2e/e2e.mjs` 加 10 项（入口存在、条数与接口一致、去掉哪几条写在明面上、右栏正文与接口逐字相同、
  三个导出入口与 txt/Word/PDF 各验一次、筛过的 HTML 无外链、能切回原文）。

**为什么这么设计**：筛选是投影不是编辑——改写已有一条独立通道，筛选若也能改字，同一段文字就有两个作者（F75）；
「上游还没对照过」与「一条都对不上」必须分开表达（F76）。匹配口径复用要求对照的结论，
不自己再算一遍，避免两个都对但不一样的结果并存。

**门禁与实测**：`npm run verify` exit 0；`npm run e2e:ui` **157/157** 且控制台 0 报错
（实测：留下 2 条主张 / 去掉 3 条 / 留下 12 段 / 去掉 3 段，原文 465 字 → 这一版 319 字）。

## Session 35（P13：CI 与性能预算）

**做了什么**：把门禁从「本地一遍」扩成「换台机器一遍 + 够快一遍」。

- `tools/ui-e2e/e2e.mjs`：删掉两处写死的路径——卡带目录从模块位置反推仓库根（`fileURLToPath(new URL('../..', import.meta.url))`），
  浏览器改成候选列表 + `CROSSEXAM_BROWSER` 环境变量覆盖。
- 新建 `.github/workflows/ci.yml`：`gate`（ubuntu-latest：`npm ci` → `npm run verify` → `npm run seed:demo` 后
  `git diff --exit-code -- fixtures/llm` 的**卡带漂移门禁** → `npm run stats` 只打印）与 `browser`（windows-latest：`npm run build` → `npm run e2e:ui`）。
- 新建 `tools/perf/budget.mjs`（14 项上界：起服 / 健康检查 / 建档 / 整场回放 / 会话详情 / 报告 Markdown / 单文件打包的耗时与体积 /
  打包无外链 / 历史列表 / 前端 JS 与 CSS 的 gzip 体积），接入 `npm run budget`，并把 `verify` 改成五步——budget 排在 build 之后，因为量的是构建产物。

**为什么这么设计**：本地全绿不等于别处能跑（F77）；用来拦「变坏」的阈值只能按数量级定，按最近一次实测定会让冷热差变成随机红灯（F78）。
漂移门禁用「重跑 + `git diff`」而不是另写比对工具，是因为 seed 本身就是逐字节确定的，多一套比对就多一份会脱节的事。

**门禁与实测**：`npm run verify` exit 0 —— 71 个测试文件 / 732 条断言 + 冒烟 9 项 + 48 modules（CSS 30.46 kB / JS 355.23 kB，gzip 107.97 kB）
+ **性能预算 14 项全绿**（起服 285 ms、整场回放 93 ms、打包 22 KB、JS gzip 105 kB）；
`npm run seed:demo` 跑完 `git status --porcelain fixtures/llm` 为空，默认组合 `64aa0be85503`。

**复现计时刷新（同日重测）**：`npm run repro` EXIT 0，干净目录 **89.2 s**
（clone 34.6 s · install 27.8 s · verify 23.4 s · 起服跑完一场并下载报告 0.7 s）。比上一条基线（70.8 s）多出的部分
几乎全在 install（15.0 → 27.8 s，本地镜像当次偏慢）——install 与 clone 本来就随镜像和磁盘缓存波动，
所以文档记的是「最近一次实测值 + 34–121 s 区间」，不是精确到 0.1 秒的承诺。五处耗时表
（`README.md` / `docs/tech/04-reproducibility.md` / `tools/repro/README.md` / `docs/release-checklist.md` / `task_plan.md`）
与 `docs/video/script.md` 的核对表已同步；技术文档 PDF 重出为 **29 页 / 2119 KB**（上限 30，余量 1 页）。

## Session 36（P14：冻结交付与收尾）

**做了什么**：按用户 m15900 的指示（视频推迟、继续做 P14）走完 P14 里不依赖录制的部分——提前冻结、补 `LICENSE`、把演示视频拆成可检查的准备件。

- `LICENSE`：MIT，署名 `yaoyuy`（取自本仓库 git 提交者身份）；README 的「许可」一节从一句「MIT。」改成指向该文件。
  要用真名就只改 `LICENSE` 里 `Copyright (c) 2026 <署名>` 一处，别的文件不用动。
- 演示视频准备件两份：`docs/video/preflight.md`（录前 15 项 + EV 录屏参数 + 开拍顺序 + 录完核对 + 录砸了怎么办）与
  `docs/video/teleprompter.md`（提词卡，一屏一句，含每段照念旁白与动作提示）。视频本身**不代录**。
- `docs/release-checklist.md`：第 4 项补上这两份准备件；`LICENSE` 行标 ✅；新增第六节「功能冻结（2026-10-28 提前冻结）」——
  冻结对象与基线数字（330 余次提交 / 71 文件 732 断言 / 点测 157 项 / 复现 89.2 s / PDF 29 页 / Prompt 链 49 份）。
- `task_plan.md`（P14 行 + 决策 D60）与 `docs/roadmap-v2.md`（进度句 + P14 行）如实反映：冻结 ✅、终检 ✅、只剩视频。

**为什么这么设计**（记进 findings F79）：视频是五项提交物里唯一不能由命令生成的产物，它能被检查但不能被生成，
所以把「录一段成功的视频」尽量拆成一条条能确认的清单，失败时能定位到哪一节、哪条数字，而不是整段重来。

**门禁**：`npm run verify` EXIT 0（71 个测试文件 / 732 条断言 + 9 项真进程冒烟 + 构建 48 modules + 14 项性能预算）。
