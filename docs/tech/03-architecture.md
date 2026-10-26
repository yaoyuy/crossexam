# 第三章　架构设计

## 3.1 一条约束决定了整个架构：服务端不设构建步骤

赛题 25% 是「过程可复现性与演进链路」。对一份要交给评委复现的项目来说，**每一个「先做 A 才能做 B」的步骤都是一个失败点**：

| 常见步骤 | 失败方式 |
| --- | --- |
| 先装编译器 / 编译原生依赖 | Windows 上 node-gyp 失败、Python 版本不对 |
| 先 build 后端再 run | 忘了 build、build 产物过期、build 报 TS 错误 |
| 先装 Docker | 评委机器没装或没权限 |
| 先申请 API Key | 没有卡、没有额度、区域不支持 |
| 先建数据库 | 忘了迁移、路径没权限 |

本项目把上表里能消灭的全部消灭了，得到一个极短的复现路径：

```
git clone  →  npm install  →  npm run preview  →  打开浏览器  →  点两下
```

其中最关键的一条决策是 **ADR-0001：服务端不设构建步骤，直接用 Node 原生 TypeScript 运行**。

### 3.1.1 为什么这条能成立

Node 22.6+ 提供类型剥离（type stripping），可以直接运行 `.ts` 文件。但有一条众所周知的限制：
**类型剥离默认不作用于 node_modules 内的文件**。npm workspaces 的包在 `node_modules/` 下是符号链接，
因此理论上 `import '@crossexam/shared'` 会被当作「node_modules 内的模块」而拒绝剥离。

这个假设在 P1 阶段用一条最小验证钉死了（`.tmp/node-smoke.mjs`，纯 `node` 运行）：

| 验证项 | 结果 |
| --- | --- |
| `import '@crossexam/shared'` 拿到 46 个导出 | 成功 |
| 直接 import `replay.ts` / `cassette.ts` | 成功 |
| 跨包调用 `buildContracts(['tech','hr'], ...)` | 返回 2 条契约 |
| `chunkText` 分片后拼接 | 与原文逐字相等 |

原因是 Node 会先 realpath：符号链接解析后文件真实位置在 `node_modules` 之外，于是类型剥离正常生效。
**这条假设不是查文档查来的，是实测出来的**——这也是本文档反复强调的方法：凡是架构依赖的前提，都要有一条可复跑的最小验证。

### 3.1.2 代价与边界

| 代价 | 处置 |
| --- | --- |
| 不能用 TS 的装饰器 / enum 等需要转译的语法 | 代码里本来也不用 |
| 类型检查与运行分离（运行时不做类型检查） | `npm run typecheck` 单独跑 `tsc --noEmit`，纳入提交门禁 |
| 生产部署不适合 | 本项目是本地优先的桌面级工具，不做服务端部署 |
| 前端仍需构建 | 前端是浏览器代码，必须 Vite 构建；但只有一条 `npm run build` |

## 3.2 模块划分

```
D:\CZB
├── packages/
│   ├── shared/        领域模型与纯函数内核（零依赖、无 IO、100% 可单测）
│   │   ├── domain.ts      领域类型：Claim / Probe / Answer / Verdict / Suggestion
│   │   ├── anchor.ts      证据锚定：引文 → 字符区间
│   │   ├── segment.ts     简历确定性切分：小节 / 条目 / 段落
│   │   ├── budget.ts      追问预算账本（不可变）
│   │   ├── contract.ts    意图契约与确定性提示词渲染
│   │   ├── schemas.ts     模型输出的 zod 契约与解析
│   │   └── util.ts        确定性 id、稳定序列化、哈希
│   │
│   ├── server/        编排与 IO
│   │   ├── llm/           LLM 适配层：live / record / replay 三态 + 卡带 + 流式包装
│   │   ├── orchestrator/  五阶段：extract / probe / answer / verdict / suggest + run 编排
│   │   ├── store/         node:sqlite 建表、迁移与仓储
│   │   ├── http/          Hono 路由 + SSE + 静态托管
│   │   ├── pipeline.ts    编排 → 落库 → 视图 的一体化入口
│   │   ├── report.ts      Markdown 报告渲染
│   │   └── bin/serve.ts   服务入口
│   │
│   └── web/           Vite + React 19 + Tailwind v4
│       ├── api.ts         HTTP 契约与 SSE 解析
│       ├── state.ts       事件流折叠成界面状态的纯函数
│       ├── labels.ts      文案（与 shared 的漂移由测试看守）
│       └── components/    四栏界面
│
├── tools/
│   ├── dsh-export/    DSH 会话日志 → Prompt 链快照（提交物 #2 的生成器）
│   ├── smoke/         真进程冒烟（起服务、打接口、等 SSE 收尾）
│   ├── ui-shots/      无头浏览器截图器，兼作控制台报错门禁
│   ├── repro/         干净目录复现预演
│   └── docs/          Markdown → HTML → PDF 技术文档构建
│
├── fixtures/llm/      29 盘离线卡带（按提示词指纹寻址）
├── docs/              ADR / 技术文档 / 截图 / Prompt 链快照
└── data/              运行时 SQLite（已 gitignore，含用户简历隐私）
```

### 3.2.1 划分原则：按「依赖方向」而不是按「技术层次」

| 包 | 允许依赖 | 禁止依赖 | 理由 |
| --- | --- | --- | --- |
| shared | 只有 Node 标准库（`node:crypto`） | 任何 IO、任何网络、任何数据库 | 纯函数才好测；937 行源码配 489 行测试 |
| server | shared + Hono + zod | 不依赖 web | 服务端不知道前端长什么样 |
| web | React + 自己的 api.ts | **不 import @crossexam/shared** | 见 3.4 |

shared 里唯一的 IO 痕迹是 `util.ts` 的 `node:crypto`（算哈希），
这一处恰好是 web 不能直接引 shared 的原因，也解释了为什么 web 要抄一份文案再用测试守住（3.4 节）。

## 3.3 LLM 适配层：一个接口，三种实现，一条卡带

### 3.3.1 接口

```ts
export type LlmMode = 'live' | 'record' | 'replay';

export interface LlmClient {
  readonly mode: LlmMode;
  complete(req: LlmRequest): Promise<LlmResult>;
  stream(req: LlmRequest): AsyncIterable<LlmStreamEvent>;
}
```

三个模式共用同一个请求结构，差别只在「结果从哪来」：

| 模式 | 结果来源 | 用途 |
| --- | --- | --- |
| live | 真实 HTTP 调用 | 联网跑，用户填了 Key 时 |
| record | 真实 HTTP 调用 + 落盘成卡带 | 录制演示素材 |
| replay | 从卡带读 | **默认模式**，评委零配置跑通全流程 |

### 3.3.2 卡带：用提示词指纹寻址

卡带（cassette）是一份 JSON 文件，文件名是提示词的指纹：

```ts
const digestFor = (req: LlmRequest) =>
  shortHash(stableStringify(shapeOf(req)), 24);

// shapeOf 只取这五项：
// { system, messages: [{role, content}], temperature, maxTokens, json }
```

**刻意不包含模型名与 purpose**。理由是换模型不该让整盘卡带失效——同一份提示词问出来的东西，
在演示意义上等价于同一段素材。这条决策也解释了为什么「加流式」不需要重录（channel 不在指纹里）。

回放客户端的失败方式是**响亮的**：

```
LlmError: 回放模式找不到这一条记录。用途「extract」的指纹是 b1206dc35699453a6dfbaa28，
请用 CROSSEXAM_MODE=record 联网跑一次把它录下来。
```

绝不静默降级到「跳过这一步」或「返回空结果」。这条选择在 `findings.md` F12 里有完整教训：
录制端第一版因为逐项容错，跑完 exit 0 但只写出 16/27 盘卡带，10 条回答全部缺失，stderr 干干净净。

### 3.3.3 记账包装：任何客户端都被套一层

```ts
withAccounting(inner, { db, sessionId, model })
```

它把每一次调用记进 `llm_call` 表：指纹、用途、模型、是否回放、四类 token、耗时。
界面顶部的「调用 29 次 · 回放 29 · token 23,533」就来自这里。
这层包装同时解决了两个问题：成本可见（live 模式知道花了多少）与**可复现性可见**（回放模式下「调用 N 次 / 回放 N 次」直接证明这一场没有联网）。

### 3.3.4 流式包装：只在需要直播时才套

```ts
const base = input.onStream === undefined
  ? input.client
  : withStreaming(input.client, input.onStream);
```

五个阶段的编排代码完全不知道流式的存在（它们照旧 `await client.complete()`）。
好处是：JSON 路径（`?stream=0`）与 SSE 路径共用同一份编排逻辑，两条路径都被测试覆盖，且不会出现「流式版本和普通版本行为不一致」。

### 3.3.5 阶段路由：换模型是装配层的事

```ts
withStageModels(inner, { verdict: 'deepseek-reasoner' })
```

编排层只关心「问什么」，用哪个模型是装配层的事：`withStageModels` 按 `req.purpose` 在请求上带一个 `model` 字段，
五个阶段的代码一行都不用改。默认只把**判定**交给思考模型（`CROSSEXAM_REASONING_STAGES` 可改），
理由见 ADR-0005：判定才需要「停下来想」，而追问一轮要十几次调用。
`LlmRequest.model` 与 `channel` 一样**刻意不参与卡带指纹**，所以换模型不必重录任何一盘离线卡带。

## 3.4 前端形态：为什么 web 不 import shared

这是一个看起来违反直觉的决策（共享类型不是好事吗？），但有一条硬理由：

**shared 经 `util.ts` 依赖 `node:crypto`**，把它引进浏览器包会污染打包结果。
备选方案是把 shared 拆成一个零依赖的 core 包——这在架构上更干净，但会引入一次全仓库重构，
而本项目的时间预算要留给「意图控制」与「可复现性」。因此本项目选择：**类型与文案各抄一份，用测试守住漂移**。

### 3.4.1 漂移怎么守

| 会漂移的东西 | 守它的测试 | 断言方式 |
| --- | --- | --- |
| 五种判定的中文标签 | `packages/web/test/labels.test.ts` | `toBe`（同一个对象，不是相同内容） |
| 七种主张类别 | 同上 | 逐项对照 + 顺序不漏不重 |
| 五类人设的名字与简介 | 同上 | 逐字对照 `PERSONA_PRESETS[role].persona` |
| 高亮区间的切分逻辑 | `packages/web/test/highlight.test.ts` | 9 条边界用例 |
| 事件折叠成界面状态 | `packages/web/test/state.test.ts` | 同一串事件喂给直播路径与历史路径，断言结果完全一致 |

最后一条是整个前端设计里最关键的一条：

> **直播与历史共用同一个纯函数折叠器**（ADR-0003）。

直播是把 SSE 事件一条条喂进去，历史是把库里的事件按 seq 读出来再喂进去，
两条路径的结果必须逐字段相同（除了 `phase` 由来源决定）。
这条测试保证了一个常被忽略的产品承诺：**刷新页面之后看到的，和刚才实时看到的，是同一场**。

### 3.4.2 界面结构：四栏 + 一条时间线

| 栏 | 内容 | 对应评分项 |
| --- | --- | --- |
| 左：输入与过程 | 简历输入、节奏控制、意图契约、阶段时间线、实时输出、统计 | 意图控制（契约可摊开） |
| 中：主张与追问 | 每条主张一张卡片：原文引文、追问链、作答、判定、改写建议 | 实用价值（结论定位到字） |
| 右：简历原文 | 全文，锚点高亮，点击引文聚焦到具体字符区间 | 证据锚定（看得见的锚） |
| 顶：状态条 | 模式、调用次数、回放次数、token、事件数、追问数 | 可复现性（回放可见） |

## 3.5 存储：node:sqlite，零原生依赖

选 `node:sqlite`（Node 24 内置）而不是 better-sqlite3，理由只有一个：**不引入需要本地编译的原生依赖**。
这条约束写进了 `AGENTS.md` 第 6 节：破坏「10 分钟复现」的依赖需要 ADR 才能进。

### 3.5.1 三个必须知道的差异（实测，记在 findings F8）

| 差异 | 后果 | 处置 |
| --- | --- | --- |
| 外键约束按连接生效 | 漏发 PRAGMA 会安静留下孤儿数据 | `openDatabase` 里固定发 `PRAGMA foreign_keys = ON` |
| `prepare().all()` 返回 `unknown[]` | 每处用法都要断言 | 仓储层用一个私有辅助函数收口（断言会绕过类型检查，收口不会） |
| `PRAGMA user_version` 现成可用 | 不需要自建版本表 | 迁移直接用它做版本位 |

### 3.5.2 迁移：三条教训变成三条规则

| 规则 | 来源 |
| --- | --- |
| 连接即建表（readonly 除外） | F11：同进程测试全绿，真起服务第一次写入报 `no such table: session` |
| 迁移步骤冻结在自己时点，不引用当前 DDL | F24：v1→v2 若用当前 DDL，会一步建成 v3 表却把 user_version 写成 2 |
| 库版本比代码新时拒绝启动 | 防止老代码写新库，把数据写坏 |

当前 `SCHEMA_VERSION = 3`，表结构：

```
session(id, createdAt, updatedAt, llmMode, jobTitle, jdText, resumeText,
        resumeHash, status, budget_json, meta_json)
claim(session_id, id, ordinal, text, start, end, quote, exact, category,
      weight, status, verdict)          PRIMARY KEY (session_id, id)
probe(session_id, id, claim_id, interviewer_id, round, question, quote,
      start, end, parent_probe_id, rationale, answer_text, answer_mode,
      answer_cites_json, verdict)       PRIMARY KEY (session_id, id)
event(session_id, seq, kind, payload_json, createdAt)
llm_call(id, session_id, digest, purpose, model, replayed, usage_json, elapsedMs, createdAt)
```

复合主键（`session_id, id`）是 v2 迁移引入的。原因很具体：主张编号每场会话都从 `C1` 重新开始，
全局唯一主键会让同进程第二场会话直接撞 `UNIQUE constraint failed: claim.id`。

## 3.6 HTTP 层：一个端口，两种响应

| 接口 | 用途 |
| --- | --- |
| `GET /api/health` | 模式、跑法、模型、卡带目录，以及可选运行模式清单与「联网是否配好」 |
| `GET /api/models` | 联网模式下可用的模型清单（配不全时**一个网络包都不发**，直接返回缺哪个环境变量） |
| `GET /api/demo` | 内置示例简历与 JD |
| `POST /api/import` | 上传 PDF / Word / 文本，解析成简历正文（字节不存留；413 太大 / 415 格式不支持 / 422 解析不出文字） |
| `GET /api/contracts?panel=` | 意图契约全文 + 指纹（纯确定性，不调模型、不读库） |
| `GET /api/interviewers` | 面试官库：五位预设（只读）+ 自建的那些（带 id / version / digest / 渲染出的 System Prompt） |
| `POST /api/interviewers/draft` | 把一句话描述补成契约草稿（**不落库**）：`useModel:false` 走本地规则，模型失败自动退回本地并说明原因 |
| `POST /api/interviewers` | 保存自建面试官（预设不可改、不可删） |
| `DELETE /api/interviewers/:id` | 删掉一位自建面试官（预设返回 400，不存在返回 404） |
| `POST /api/sessions` | 建档（useDemo 或 resumeText，可指定 `mode`、`model`、`interviewers`：三者都随会话落库） |
| `POST /api/sessions/:id/run` | 跑沙盘：默认 SSE 直播，`?stream=0` 走 JSON |
| `GET /api/sessions/:id/events?from=` | 事件续传 |
| `GET /api/sessions/:id/report.md` | 下载 Markdown 报告 |
| `GET /api/sessions/:id/report.html?print=1` | 可打印 HTML 报告（`print=1` 时自动调 `window.print()`，PDF 由浏览器另存） |
| `GET /api/sessions/:id/report.doc` | Word 报告（同一份 HTML + `application/msword`） |
| `GET /api/stats?session=` | 调用账本统计 |

### 3.6.1 SSE 的收尾承诺

SSE 有三个终止事件，任何一个发生都意味着这一场结束了：

| 事件 | 含义 |
| --- | --- |
| `result` | 正常跑完，附小结 |
| `fatal` | 致命失败（例如回放模式缺卡带），附原因 |
| 连接关闭 | 客户端断开 |

「一定会以成功或明确失败收尾」这条承诺由真进程冒烟守着（`tools/smoke/smoke.mjs` 会等 SSE 收尾并断言收到了 `result` 或 `fatal`）。

### 3.6.2 单端口托管前端

`mountWebApp(app, distDir)` 在 `/api/*` 之外挂静态托管 + SPA 回退。
这样评委只需要打开一个地址，不需要记两个端口，也不会有跨域问题。
服务入口用 `new URL('../../../web/dist', import.meta.url)` 定位前端产物，**因此从任何工作目录启动都能找到**。

### 3.6.3 报告导出：服务端出 HTML，PDF 交给浏览器

同一份 `SessionView` 有三种呈现：Markdown（`report.ts`，便于携带与 diff）、可打印 HTML（`report-html.ts`，便于阅读与打印）、
Word（`.doc` 后缀 + `application/msword`，便于接着改）。**服务端不生成 PDF**：那需要带一个无头浏览器或 PDF 库，
前者把「十分钟复现」变成赌评委机器上装了什么，后者违反零原生依赖。取舍详见 ADR-0006。

HTML 报告不引用任何外部资源，保存单文件即可离线打开；页脚写明「简历与报告都没有离开这台机器」。
打印脚本只在 `?print=1` 时注入——默认打开不会突然弹打印对话框（有测试守住）。

### 3.6.4 简历导入：解析成文本，但不留档

`POST /api/import` 只做一件事：把上传的字节变成简历正文，填进投料台的输入框，然后**字节就被丢掉**——
不写临时文件、不入库、不进日志。于是「简历没有离开这台机器」在导入这条路径上也成立（上传的字节连磁盘都不落）。

解析按格式分三条路，每条都尽量少欠依赖：PDF 用 `unpdf`（纯 JS，零原生编译），`.docx` 自己解 zip
（`node:zlib` 的 `inflateRawSync` 拆出 `word/document.xml`，不引 SDK），纯文本先按 UTF-8 解、出现替换字符再试 GBK
（中文简历的现实情况）。老版 `.doc` 是二进制复合文档，明确拒绝并提示另存为 `.docx`——**宁可给一句可执行的话，也不给一段看起来像正文的乱码**。
选型对比与三个反直觉的 PDF 行为见 ADR-0007、findings F39；导入器自己有 11 条单测，HTTP 分档另有 4 条。

### 3.6.5 运行模式与模型：逐场选，且随会话留档

三种模式（离线回放 / 联网直连 / 联网录制）在**页面里逐场选择**，选择结果写进会话行：`llmMode` 落模式，`meta.model` 落模型名。跑的时候按会话行建客户端——单一事实来源在库里，不需要内存里的映射表，翻回一周前的会话也能说清它当时是怎么跑出来的。

`GET /api/models` 只在显式选择联网后才被前端调用：先 `resolveLiveConfig`，缺 `LLM_BASE_URL` / `LLM_API_KEY` 就**一个网络包都不发**，直接把缺哪个变量告诉界面。拉不到清单不等于不能用——界面是 `input + datalist`，可以手填模型名；`/models` 返回什么也**不是可用性证据**（本机实测它只列出两款模型，而实际能调通四款）。见 D33、D34、F41。

### 3.6.6 自定义面试官：一句话补成契约，没有 Key 也能配

五位预设解决的是「计算机岗位」。可这个产品要能给任何行业用，就不能把面试官写死在代码里。
于是自建面试官的产物**不是一段自由文本，而是同一份 `IntentContract`**——它和预设共用渲染、共用指纹、共用约束条款，
所以第 2 章讲的「意图可解释、可版本化、可 diff」对自建面试官一样成立。

链路是三段，每段都留了不联网的出口：

1. **描述 → 草稿**（`POST /api/interviewers/draft`，不落库）。模型返回的 JSON 必须过 `interviewerDraftSchema`（名称 1–24 字、目标 8–200 字、手法 2–5 条…），
   过不了就不收。用户勾「只用本地规则」时走 `localDraftFromText`：纯规则、确定性、不联网，靠一张措辞表把话翻成手法
   （说了数字就追口径、说了「参与」就问边界、说了「好评」就问评选范围）。模型这条路失败时**自动退回本地并明说没走模型**，见 D36。
2. **草稿 → 库**（`POST /api/interviewers`）。落 `interviewer` 表（id + version + digest + 契约 JSON），是**全局库**而不是会话表。
3. **库 → 阵容 → 会话**。`POST /api/sessions` 的 `interviewers` 收 id 列表，解析出的 `panel` 写进 `meta.panel`。
   **契约一旦被某场会话引用就冻结在会话里**：后来在库里改了、删了，旧会话的复现与对账仍然成立。

有个坑值得记下来：`resolvePanel` 只能把预算的**三个**字段交给契约。`maxConsecutiveUnanswerable` 是编排层的关停策略，
不属于面试官契约；多给一个字段，同一场沙盘就会在「运行」与「对账」两处算出不同指纹，界面把没漂移的沙盘报成「契约漂移」（F42）。
预设不可改也不可删——它们的人设写在代码里，改预设等于悄悄改历史。上限 40 位，够用且防止界面被自己的库拖垮。
为什么不干脆让用户填一段 System Prompt 自由文本？因为那样就丢掉了可解释、可版本化、可对账、可约束这四件事。取舍详见 ADR-0008。

## 3.7 工程质量：门禁四道

`npm run verify` 是提交前必须全绿的一道门，它由四件事组成：

| 顺序 | 命令 | 证明什么 | 当前规模 |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 类型对（`tsc --noEmit`，含各包） | 全仓库 |
| 2 | `npm run test` | 逻辑对（vitest） | 38 个文件 / 404 条断言 / 3.8 s |
| 3 | `npm run smoke` | **产品能跑**（真起进程、真打 HTTP、真等 SSE） | 9 项 |
| 4 | `npm run build` | 前端能构建 | vite，32 modules（JS 298.51 kB / gzip 93.28 kB） |

第 3 道是`findings.md` F11 的直接产物：同进程的 `app.request()` 测试全绿，真起服务却第一次写入就报没有表。
**单元测试证明的是「函数逻辑对」，冒烟证明的是「产品能跑」，这两句话之间隔着一个进程边界，而事故恰好长在边界上。**

除 verify 之外还有三个可选门禁，都做成了命令：

| 命令 | 作用 | 什么时候跑 |
| --- | --- | --- |
| `npm run shots` | 无头浏览器点一遍全流程，出 16 张截图，**控制台有报错即失败** | 改了界面之后 |
| `npm run repro` | 干净目录 clone → install → verify → 起服跑一场，逐步计时 | 改复现路径之后 |
| `npm run seed:demo` | 重新生成 29 盘离线卡带并自检 | 改了提示词之后 |

### 3.7.1 代码规模与测试密度

| 模块 | 源码行 | 测试行 | 说明 |
| --- | --- | --- | --- |
| packages/shared/src | 1264 | 638 | 纯函数，测试密度最高 |
| packages/server/src | 6741 | 3905 | 编排 + IO + 导入解析 + 面试官库 + 报告三种形态，含脚本化模型夹具 |
| packages/web/src | 4046 | 1094 | 折叠器、文案与主题变量（只计 .ts/.tsx，index.css 另 311 行） |
| tools/ | 2832 | 490 | 导出器 / 冒烟 / 截图 / 界面点测 / 复现 / 文档构建（只计 .mjs，测试目录另计） |
| **合计** | **14883** | **6127** | 测试/源码 ≈ 0.41 |

仓库里 **0 个 TODO / FIXME / HACK、0 处 `as any`、0 处 `@ts-ignore`**（全仓库 grep 实测）。
console.log 只出现在两个 CLI 入口（serve.ts 与 seed-demo.ts）。

## 3.8 本章要点

- 服务端零构建是整条复现路径的地基，它成立的前提是被实测验证过的，不是查文档查来的。
- 模块按依赖方向切：shared 无 IO、server 不知前端、web 不引 shared（用测试守漂移）。
- LLM 适配层一个接口三种实现，卡带用提示词指纹寻址，缺卡带时响亮报错而不是静默降级。
- 直播与历史共用同一个折叠器，保证「刷新后看到的和刚才看到的是同一场」。
- 门禁四道，其中真进程冒烟是不可替代的那一道。