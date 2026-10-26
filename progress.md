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
