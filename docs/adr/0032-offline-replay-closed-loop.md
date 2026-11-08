# ADR-0032：离线回放不再有死路——预检 + 大声的合成兜底

- 状态：已采纳（2026-11-08）
- 相关：ADR-0002（离线卡带与合成演示数据）、ADR-0015（回放按指纹寻址）、AGENTS.md 第 3 节（隐私）

## 背景

默认配置是离线回放（`DEFAULT_MODE='replay'`，`packages/server/src/llm/index.ts:17`），
卡带按提示词指纹寻址（`packages/server/src/llm/replay.ts`），仓库里 149 盘卡带全部由
`scripted-demo.ts` 生成、只对应**一份演示简历 + 一份模板 JD**。

评审实测的后果：在首页贴一份自己的简历、或者点 36 个模板里的任意一个，都会在几秒后拿到
`fatal: 回放模式找不到这一条记录…指纹 942a0548…`——浏览器把 `cassette-missing` 的开发者文案
（「请用 `CROSSEXAM_MODE=record` 联网跑一次把它录下来」）原样渲染给用户，
唯一的人话提示还只在「改完再跑一遍」之后才出现。也就是说：**首页最显眼的两个入口在默认模式下是死路，
而且失败信息是说给开发者听的**。这条同时打中评分表的「解题有效性」与「用户体验」。

## 决策

1. **开跑前先预检。** 新增只读端点 `POST /api/preflight` → `{ mode, coverable, reason }`：
   用与正式建档**同一份** `intakeOf` 校验与同一套指纹算法试算一遍，告诉界面「这一场能不能原样回放」。
   为保持与落库一致，预检必须复刻 `store/repo.ts` 里 `insertJds` 的数组下标 ordinal，
   否则 JD 之后 8 个阶段的指纹会全错（这是第一次实现时踩到的真坑）。
   `GET /api/health` 顺带声明 `preflight: true`，界面不必盲探。
2. **兜底，但必须大声。** `CROSSEXAM_REPLAY_FALLBACK=synth`（默认）时，命中不到卡带就按提示词
   **确定性合成**一份响应（逐字节可复现、必须过 zod、必须过契约③④ 闸门、`after` 不引入简历里没有的数字）；
   `strict` 保留原行为（抛 `cassette-missing`），`packages/server/test/llm-replay.test.ts` 的断言不变。
3. **绝不允许静默。** `GET /api/sessions/:id` **恒带** `synthetic: { count, stages }`（没有兜底时 count=0、
   stages=[]），并落一条 `kind='synthetic'` 事件；开场 notices 与 `report.md` 开头写同一句说明，
   界面横幅显示「本场含 N 处合成兜底数据」。合成的卡带 model 字段是 `scripted-synth`，**不冒充真实模型**。
4. **失败要么给人话，要么给出口。** run 的 JSON / SSE fatal / onError 三条路径统一
   `{ error: 人话, code, hint? }`；`cassette-missing` 的 hint 主句是
   「这台机器现在是离线回放模式（不联网）」+ 两个出口（改用演示简历 / 配一个 API Key 走真实模型），
   `CROSSEXAM_MODE=record` 这种开发者指令只留在 error 原文的括号里。
5. **合成默认不落盘。** 只有显式设 `CROSSEXAM_SYNTH_DIR` 才写出 `model='scripted-synth'` 的卡带——
   用户简历会因此进入提示词，写进仓库等于违反隐私红线。

## 已知边界

- 兜底判定的 verdict 一律 `unsupported`（只敢说「证据不足」，不替用户下判断），suggest 只做降档改写。
- 只有 run / onError 这条**主链路**带 `code`/`hint`；既有的 400/404 参数校验错仍是 `{error}`。
  暂不统一：那些错误用户改一下就没了，不需要动作按钮，统一反而要动几十处既有测试。
- 合成不是「真实模型的结果」，它只是让离线演示不中断；横幅与报告都明说这一点。

## 后果

- 自建简历在默认模式下**能跑完**：实测同一份自建简历离线跑完 200，claims 4 / probes 12 / rounds 2，
  `synthetic.count=31`、九个阶段全列、SSE 推 `event: synthetic` 且无 fatal；演示简历预检
  `coverable=true`（「5 条主张、10 条追问、5 条判定都能原样回放」），自建简历 `coverable=false` 并点名是哪几个阶段。
- `fixtures/llm` 149 → 149，未新增文件：兜底不写盘，评委拿到的仓库体积不变。
- 新增测试：`packages/server/test/llm-synth.test.ts`（12 例）、`test/llm-preflight.test.ts`（8 例）。
