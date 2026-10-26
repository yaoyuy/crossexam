# dsh-export

把 **DSH 会话日志**导出成 Markdown 形式的 Prompt 链快照。

## 为什么需要它

比赛要求提交「≥3 个核心功能迭代的完整 Prompt 链（提问 → AI 建议 → 如何引导修 Bug）」。
事后凭记忆补写既不可信、也一定会漏掉最有价值的部分——踩坑和纠偏的过程。

DSH 把每一次提问、回复、思考过程和工具调用都落在本地会话文件里，本工具直接读出来，
所以 `docs/prompt-chain/` 下的每一份快照都是**过程副产品**，而不是事后作文。

## 会话文件格式（踩坑记录）

位置：

```
%APPDATA%/dsh-desktop/harness/sessions/<工作区标识>/<session-id>/session.v4.jsonl.zstd
```

其中**工作区标识**由 cwd 把 `:\` 换成 `-` 再前后包 `--` 得到，例如 `D:\CZB` → `--D-CZB--`。
（本工具不靠这个规则猜，而是解出会话自身记录的 `cwd` 来匹配，避免静默漏掉会话。）

两个坑：

1. 文件是 **多帧拼接** 的 zstd（每追加一批事件压一帧）。`zlib.zstdDecompressSync` 只解第一帧，
   所以必须自己扫魔数 `28 B5 2F FD` 逐帧解压，见 `src/zstd-frames.mjs`。
2. `user/message` 里混着真人输入和系统注入（`runtime-context`、`skill-catalog`、
   `plugin:hindsight`、`time-context`、`agent-instructions` 等）。只有 `source.kind === "user"`
   才是真人提问，其余默认丢弃，见 `src/parse.mjs`。

## 用法

```bash
node tools/dsh-export/bin/dsh-export.mjs --list           # 先看看有哪些会话
node tools/dsh-export/bin/dsh-export.mjs                  # 导出当前工作目录的会话
node tools/dsh-export/bin/dsh-export.mjs --all            # 导出全部
node tools/dsh-export/bin/dsh-export.mjs --dry-run        # 跑完整流程但不写文件
node tools/dsh-export/bin/dsh-export.mjs --no-split       # 一个会话只写一个文件（本地翻阅用）
node tools/dsh-export/bin/dsh-export.mjs --max-chars-per-file 120000   # 改分页上限
```

仓库根目录另有快捷键：`npm run export:prompt`。

## 分页

一次开发过程聊下来，快照会长到上百万字符（本仓库 P4 那次是 330 万）。
网页端对超过 1 MB 的 Markdown **只给下载、不给渲染**，而这份快照的读者是评委，
所以导出器默认按体积分页（`--max-chars-per-file`，默认 400000 字符，约 470 KB）：

- 切页发生在**条目**边界——用户提问 / AI 回复 / 思考过程 / 一次工具调用，
  而不是只在轮次边界（单轮就可能超过一百万字符，只在轮次边界切仍然超限）。
- 每一页自带标题、元信息表与轮次头，单独打开也能读懂；跨页的同一条轮次会标 `（续）`。
- **内容一个字都没有删**，只多了一行分页说明。
- 单个条目本身就超过上限时，它独占一页——宁可这一页超标，也不把一条完整证据切成两半。
- 文件名：单页用原名 `xx.md`，多页是 `xx-1.md`、`xx-2.md`……
  改了上限或会话变短后，上次留下、这次不再需要的分片会被自动清理，不留孤儿文件。
- `docs/prompt-chain/README.md` 与 `index.json` 里会标出每个文件是第几部分、覆盖哪些 Turn。

分页逻辑在 `src/paginate.mjs`，测试在 `test/paginate.test.mjs`（含「不分页时输出与旧版逐字节相同」的回归）。

## 安全

导出物要提交到公开仓库，所以落盘前会统一扫描并替换疑似密钥
（OpenAI / Anthropic / GitHub / AWS / Bearer token / `KEY=value` 赋值形式），
命中会打印警告。见 `src/redact.mjs`。

**已知误报**：`test/redact.test.mjs` 里的假密钥会被同样脱敏，所以导出时固定报一条
`openai-key×1` 警告——这是预期行为，说明扫描器在跑，不必惊慌。

## 测试

```bash
npx vitest run tools/dsh-export
```

测试用 `zlib.zstdCompressSync` 造真实的多帧数据，不用手写字节。

分页与渲染层拆分的测试在 `test/paginate.test.mjs`、`test/render.test.mjs`。
