# 提交清单（省赛）

> 这一页是给你（作品负责人）用的。每一项都写了**怎么判断做完了**，别只看勾。
> 更新于 2026-10-29：仓库已公开并推送完毕，剩下的事都在「七、还差什么」里。

---

## 一、三件必交

| # | 交付物 | 文件 / 位置 | 状态 |
| --- | --- | --- | --- |
| 1 | **代码仓库（公开）** | https://github.com/yaoyuy/crossexam | ✅ 已推送，无痕窗口可打开；CI 两个 job 全绿 |
| 2 | **演示视频** | `docs/video/crossexam-demo.mp4`（7 分 22 秒 / 1920×1080 / 30 fps / 45.7 MB / 有声有字幕） | ✅ 已在仓库里；45.7 MB 在常见平台限制（50 / 100 MB）之内，可直接上传 |
| 3 | **作品说明** | `README.md` + `docs/CrossExam-技术文档.pdf`（30 页） | ✅ 两者都在仓库里；README 已填真实 clone 地址 |

## 二、两件加分（不是硬性，但评委爱看）

| 交付物 | 位置 | 说明 |
| --- | --- | --- |
| Prompt 链快照 | `docs/prompt-chain/`（66 份，25.4 MB） | ✅ 已入库。赛题要「AI 协同过程」，这是最硬的证据 |
| 便携版 zip | `dist/portable/crossexam-portable-0.1.0-win-x64.zip`（36 MB） | ⬜ **不进仓库**（太大且可重建）。要发给评委就传 GitHub Release 或网盘，或让评委自己跑 `npm run portable:build` |

## 三、上传 GitHub：已经做完的四步（留档）

1. 建仓库 `yaoyuy/crossexam`（Public，没勾 README / .gitignore / license）。
2. `git remote add origin https://github.com/yaoyuy/crossexam.git`。
3. `git branch -M main` + `git push -u origin main`（认证走 Git Credential Manager，浏览器点一次「Confirm access」）。
4. `README.md` 的 `git clone <仓库地址>` 占位符已换成真地址，提交 `b3cfeb5`。

> 为什么必须先 push 再改：README 里一旦写了地址，地址就得真实存在，否则评委点进去是 404。

## 四、不要进仓库的东西（已经在 .gitignore 里，别手动加回去）

- `.env`（真实 API Key）、`data/`（本地 SQLite，含你的简历原文）、`*.db`
- `node_modules/`、`dist/`（构建产物与便携包 zip）、`.tmp/`（视频中间帧、临时脚本）
- 任何第三方商业字体、任何非宽松许可证的代码

## 五、上传前的最后一遍（5 分钟）

```bash
npm run verify        # 类型检查 + 765 条断言 + 9 项真进程冒烟 + 构建 + 14 项性能预算
npm run e2e:ui        # 178 项界面点测（可选，慢）
git status            # 必须只剩你有意要提交的文件
```

三条判断标准：

- `verify` 红了**不许** push（这是赛题「工程能力」那一栏的底子）。
- 仓库首页（README）里，从「10 分钟极速复现」往下数，**每一步都能自己照着走完**。
- 无痕窗口打开仓库 → 点 Code → Download ZIP → 解压 → 双击 `启动.cmd` → 能跑出一场质询。
  这一条走通，评委那关基本不会卡。（`启动.cmd` 已入库，第一次双击会自己装依赖、自己构建。）

## 六、评委最可能问的三件事（提前想好一句话）

1. **没有 API Key 能看什么？** —— 149 盘合成卡带按提示词指纹寻址，整场离线回放，缺哪盘就响亮报错，绝不静默降级。
2. **这跟普通简历工具差在哪？** —— 它不帮你写得好看，它在你投出去之前把每条主张拷问一遍：提问必须锚定原文、追问有预算、判定拿不出证据就降级。
3. **AI 写的怎么保证不是编的？** —— 三道闸：锚点（引文回原文重新定位）、schema（所有模型输出过 zod）、复算（判定由代码改写）。证据在 `docs/prompt-chain/` 与 `findings.md`。

## 七、还差什么（2026-10-29 盘点）

**只有你能做的（我做不了：没有你的 GitHub 账号与参赛平台账号）**

| # | 事项 | 在哪做 | 做完的标志 |
| --- | --- | --- | --- |
| 1 | 填仓库简介与 topics | 仓库首页右上 ⚙️ → Description / Topics | 简介一句话（如「多 Agent 对抗式面试沙盘，把简历放到火上烤一遍」），topics 填 `ai-agent` `resume` `interview` `typescript` `vibe-coding` |
| 2 | 把便携包传到 Release（可选，但很值） | 仓库 → Releases → Draft a new release，tag `v0.1.0`，把 36 MB 的 zip 拖进附件 | 评委不装 Node 也能跑 |
| 3 | 在参赛平台提交作品 | 大赛提交页 | 三个空各填一个链接：仓库地址、视频（仓库内路径或网盘）、技术文档 PDF |
| 4 | 视频如需单独上传 | 平台的上传框 | 若平台限 50 MB 以内，直接传 `crossexam-demo.mp4`（45.7 MB）即可 |

**AI 已做完、留档备查**

- 仓库 `64b9fec` 与远端一致，工作区干净；CI 门禁 + 界面点测两个 job 全绿。
- README 顶部加了 CI 徽章与 MIT 徽章（点进去就是真实的门禁记录）。
- 演示视频、Prompt 链、技术文档 PDF、便携包脚本、提交清单都在仓库里，且都有对应的 ADR / findings 记录。
