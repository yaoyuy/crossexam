# ADR-0031：最低 Node 版本的门槛与默认监听地址

- 状态：已采纳（2026-11-08）
- 相关：ADR-0010（零安装启动器）、ADR-0030（便携包）、AGENTS.md 第 3 节（安全边界）

## 背景

评审在收口阶段做了两处事实核查，都推翻了仓库里写着的说法。

1. **最低 Node 版本写错了。** `README.md`、`package.json` 的 `engines` 与 `tools/launcher/src/plan.mjs`
   三处都写 `>=22.5`，但代码实际要求更高：`packages/server/src/store/db.ts` 用的是 `node:sqlite`，
   它从 **v22.13.0** 起才不需要 `--experimental-sqlite`；`package.json` 的脚本直接跑 `.ts`，
   而**原生类型剥离默认开启**要等到 **v22.18.0**。于是 Node 22.5–22.17 的评委可以过启动器的版本检查、
   然后在第一条 `import` 上崩掉——这是「十分钟复现」承诺里最伤人的一种失败：检查说没问题，跑起来就死。
2. **服务默认绑在全网卡上。** `packages/server/src/bin/serve.ts` 只传了 `port`，
   Node 因此监听 `::`（所有网卡），而启动横幅硬写 `127.0.0.1`。
   配合 `GET /api/sessions`（可枚举会话）与 `/resume.txt`（可取简历原文），
   这和 AGENTS.md 第 3 节、以及技术文档里「简历没离开这台机器」是矛盾的：同一局域网内谁都能读。

## 决策

1. 门槛统一为 **Node 22.18.0**：`package.json` 的 `engines.node`、`tools/launcher/src/plan.mjs` 的
   `NODE_MIN`、`README.md`、`启动.sh` 的提示文案一致；启动器在版本不达标时打印
   「检测到的 Node 版本：vX；本仓库要求：22.18.0 或更高」，不再只说“没装”。
2. 启动器新增 `nodeVersionProblem()`，并修掉 `nodeVersionOk(undefined)` 会抛 `TypeError` 的路径——
   版本拿不到时要给出提示而不是崩掉。
3. 服务**默认只绑 `127.0.0.1`**；需要被别的机器访问时显式设 `CROSSEXAM_HOST`。
   横幅打印**实际绑定地址**（`info.address`），被覆盖成 `0.0.0.0` 时明说「外部可访问」，不再圆谎。
4. 防线不靠自觉：`tools/launcher/test/plan.test.mjs` 保留「`22.5.0` 必须被判不达标」的反向用例，
   把这条下界钉在测试里。
5. `docs/adr/0010` 与 `0030` 里的历史数值**不回填**：ADR 是当时的决策记录，按 AGENTS.md 只增不改，
   这次的下界修正在本文件里记录。`packages/server/src/store/db.ts` 注释里的「22.5 起内置」保留，
   那是关于 `node:sqlite` 的事实陈述，不是门禁。

## 后果

- 在 Node 22.5–22.17 上，使用者会在**启动那一刻**看到人话提示，而不是在半分钟后看到 `ERR_UNKNOWN_BUILTIN_MODULE`。
- 默认配置下，简历与会话列表不再能被同网段的其他人读到；要开就得自己开，且横幅会告诉你现在是对外开放的。
- 代价：说明文档里凡是写「一条命令跑起来」的地方，都要跟着强调 Node 版本（`README.md` 与
  `tools/repro/README.md` 已改，复现耗时表也按实测重写为 99.3 s、区间标注 34–157 s）。
