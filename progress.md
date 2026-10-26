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

### 教训

「所有测试都绿」证明的是**被测的那条路径**对。这两个缺陷都长在测试与演示从不走的分支上：
一个需要「同一轮问两条」这种真实模型偶发、合成剧本从不出现的形状；
一个根本不在代码路径上（配置文件里的一行）。核代码的价值就在这类地方——它不是跑测试，而是问「哪条路径没人走」。

### 下一步

P5：技术文档 PDF、演示视频脚本（含 ≥2 分钟 AI 协同过程复现）、Prompt 链快照刷新、
发布清单（建远端仓库 + 逐项核对提交物）。
