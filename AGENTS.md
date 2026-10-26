# AGENTS.md — 工程约定

> 任何 AI 助手 / 协作者在动手前**先读这一页**。这里的规则优先于个人偏好。

## 1. 项目是什么

CrossExam（质询室）：多 Agent 对抗式面试沙盘。详见 [task_plan.md](task_plan.md)。

## 2. 提交规范（**参赛硬要求，最容易被忽视**）

赛题明文禁止「一次性 initial commit 包含全部功能」，要求
**每次提交对应一次 AI 核心对话或一个功能模块**。因此：

### 2.1 提交粒度
- 一个提交 = **一个可独立说明的改动**。宁可拆小，不可合大。
- 禁止 `git add -A && git commit` 式的大杂烩。
- 新增一个模块 → 一个提交；修正该模块的一个 Bug → **另一个**提交。
- 每次提交前，先问：**这个提交对应哪一次 AI 对话？** 答不上来就说明粒度不对。

### 2.2 提交信息格式（Conventional Commits）
```
<type>(<scope>): <中文简述>

<为什么这么改，而不是改了什么——改了什么是 diff 的事>
```
- type：`feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `perf`
- scope：包名，如 `server` / `web` / `shared` / `tools` / `docs`
- 中文简述，不超过 50 字。

### 2.3 署名规则
- **禁止**添加 `Co-Authored-By:` / `Generated-by:` / `Assisted-by:` 等 AI 署名尾注，
  也不要写 AI 服务商邮箱。GitHub 会把它们解析成账号并计入贡献者列表。
- 确有需要说明 AI 参与了某次改动，**写在提交正文的普通句子里**。
- AI 协同的正式证据是 `docs/prompt-chain/` 下的 Prompt 链快照，不是 commit trailer。

## 3. 安全边界

- **禁止**提交任何真实密钥。`.env` 已被 .gitignore 挡住；只提交 `.env.example`。
- 新增任何外发请求前，先确认目标域名，并保证 API Key 只从环境变量读取。
- 用户的简历内容属于个人隐私数据：只落本地 SQLite，**不上传任何第三方存储**。

## 4. 验证命令

```
npm run verify     # 类型检查 + 测试 + 真进程冒烟 + 构建（提交前必须全绿）
npm run dev        # 本地起服务
npm run smoke      # 只跑冒烟：起真实服务进程，走一遍关键 HTTP 路径
```
提交前必须跑 `npm run verify`。红了不许提交。

为什么门禁里有「真进程冒烟」：单元测试用的是同进程的 `app.request`，
它看不见进程边界上的坑（表没建、端口没监听、SSE 不结束）。
这类问题第一次跑冒烟才暴露过，所以从此写进门禁。

## 5. 文档同步

- 改了架构决策 → 追加 `docs/adr/` 一条 ADR（旧的不要改，只能新增）。
- 完成一个阶段 → 更新 `task_plan.md` 的阶段表 + 追加 `progress.md` 一条。
- 有任何新发现 → 写进 `findings.md`（编号 F<N> 递增）。
- **每个核心功能迭代结束后**，跑一次 `npm run export:prompt` 刷新
  `docs/prompt-chain/`，这是提交物 #2。

## 6. 本仓库不接受的事

- 引入需要本地编译的原生依赖（会毁掉「10 分钟复现」）→ 需要 ADR 才能破例。
- 让 LLM 的自由文本直接进入数据库 → 所有模型输出必须过 zod schema。
- 无锚点的提问（没有绑定简历原文区间的提问）→ 见 task_plan 创新点 1。
