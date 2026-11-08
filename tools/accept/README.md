# tools/accept — 验收脚本

这三组脚本是 [docs/tech/05-evidence.md](../../docs/tech/05-evidence.md) 里**那 122 项验收证据的执行体**。
以前它们住在 `.tmp/`（被 gitignore 挡着），文档写着「122 项已验」，评委却一行都复不出来——
所以搬进仓库、去掉本机路径、把外部依赖变成「要么给，要么大声跳过」。

口径固定：**PASS + FAIL + SKIP = 该脚本的项数**。跳过会打印理由，绝不当成通过；
`CROSSEXAM_ACCEPT_STRICT=1` 时「有跳过」按失败处理（给 CI 用）。

## 三条命令（外加联网那条）

| 命令 | 项数 | 需要 Key | 需要浏览器 | 本机耗时 | 跑的是什么 |
| --- | --- | --- | --- | --- | --- |
| `npm run accept:api` | 78 | 不需要（离线回放） | 不需要 | 实测 1.6 s | 全接口矩阵：会话增删跑、SSE 事件表与续传、账本回放、报告六节、静态托管 |
| `npm run accept:report` | 12 | 不需要（离线回放） | 需要 | 实测 5.4 s | 报告三形态：`.md` / 可打印 HTML / 真 `.docx`，外加界面三个导出按钮的 href |
| `npm run accept` | 90 | 不需要 | 需要 | 实测 8.7 s | 上面两条串起来（离线能跑的全量） |
| `npm run accept:live` | 32 | **需要** | 需要 | 分钟级（真模型跑完整场） | 联网 + 真简历：PDF 导入、模型清单、整场 live 质询、采纳改写、导出与报告 |

`accept:api` 里有 5 项静态托管（`GET /` 是 HTML、首页含 CrossExam、前端路由回退、打包 js 可下载、
静态资源可下载）依赖 `packages/web/dist/`。没构建过就**跳过并说明**，`npm run build` 之后自动参与。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CROSSEXAM_ACCEPT_PORT` | 现找空端口 | 服务端口；不指定就不占固定端口，免得和同时在跑的东西抢 |
| `CROSSEXAM_ACCEPT_CDP_PORT` | 现找空端口 | 浏览器调试端口，同上 |
| `CROSSEXAM_ACCEPT_TMP` | 系统临时目录 | 产物目录：截图、导出的 HTML、临时 SQLite |
| `CROSSEXAM_ACCEPT_BROWSER` | 自动探测 | msedge / chrome 的绝对路径。**显式指定却指到不存在的文件时直接跳过**，不会偷偷换一个浏览器跑 |
| `CROSSEXAM_ACCEPT_STRICT` | 0 | =1 时「有跳过」按失败处理（退出码 1） |
| `LLM_API_KEY` | 无 | `accept:live` 用的密钥，只从这个变量读 |
| `LLM_BASE_URL` / `LLM_MODEL` | `https://api.deepseek.com/v1` / `deepseek-chat` | 同上 |
| `CROSSEXAM_ACCEPT_RESUME` | 无 | 一份**真实简历 PDF** 的路径（个人隐私数据，不进仓库）。没有它只跳过「真 PDF 导入」3 项，其余用内置示例材料照跑 |
| `TEST_REASONING` | 0 | =1 时多跑 1 项：判定阶段交给会思考的模型，验证思考分栏真的有内容 |

密钥只从环境变量读。旧版脚本会去翻本机的 DSH 会话日志把 Key 捞出来（`findKey()`），
那等于把密钥散播进一份要进仓库的脚本——已删除，`LLM_API_KEY` 只可能是你自己给的。

## 输出

- 逐项 `PASS / FAIL / SKIP` 一行，末尾 `PASS n / FAIL m / SKIP k（共 N 项）`；有 FAIL 时退出码 1。
- 失败项在末尾再列一遍，不用往上翻。
- 截图与导出产物落在 `CROSSEXAM_ACCEPT_TMP`（默认系统临时目录）下的
  `crossexam-accept-report-check/` 与 `crossexam-accept-live/`，脚本会把路径打印出来。
- 服务的 stdout/stderr 只在启动失败时贴出来（平时太长）。

## 离线跑法（评委 / CI）

```bash
npm run build          # accept:api 的 5 项静态托管需要前端产物
npm run accept         # 90 项，零 Key、不联网
CROSSEXAM_ACCEPT_STRICT=1 npm run accept   # 跳过也算失败
```

联网那组要有 Key 才能跑：

```bash
export LLM_API_KEY=sk-...
export CROSSEXAM_ACCEPT_RESUME="$HOME/简历.pdf"   # 可选
npm run accept:live
```

没有 Key 时 `npm run accept:live` 会打印 `SKIPPED：32 项整体跳过` 并退出 0——
这是「本机没配 Key」的正常状态，不是失败，也不会伪装成通过。
