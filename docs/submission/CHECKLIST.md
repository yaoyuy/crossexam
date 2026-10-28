# 提交清单（省赛）

> 这一页是给你（作品负责人）用的：仓库已经整理到「只差你按顺序点几下」的状态。
> 每一项都写了**怎么判断做完了**，别只看勾。

---

## 一、三件必交

| # | 交付物 | 文件 / 位置 | 怎么算完成 |
| --- | --- | --- | --- |
| 1 | **代码仓库（公开）** | 整个 `D:\CZB` 推上 GitHub | 浏览器无痕窗口能打开仓库首页、能看到提交历史 |
| 2 | **演示视频** | `docs/video/crossexam-demo.mp4`（7 分 22 秒 / 1920×1080 / 30 fps / 45.7 MB / 有声） | 播放器能播完、有声音、有字幕；平台若有单文件大小限制就先压到 50 MB 以内再传 |
| 3 | **作品说明** | `README.md`（首页）+ `docs/CrossExam-技术文档.pdf`（30 页） | 评委只看 README 就知道怎么跑起来；PDF 能打开 |

## 二、两件加分（不是硬性，但评委爱看）

| 交付物 | 位置 | 说明 |
| --- | --- | --- |
| Prompt 链快照 | `docs/prompt-chain/`（66 份，25.4 MB） | 赛题要「AI 协同过程」，这是最硬的证据 |
| 便携版 zip | `dist/portable/crossexam-portable-0.1.0-win-x64.zip`（36 MB） | **不进仓库**（太大且可重建）；要发给评委就单独传网盘，或让评委跑 `npm run portable:build` 自己打 |

## 三、上传 GitHub：四步

> 仓库现在**没有远端**，也**没有装 gh 命令**，所以建仓库这一步只能你本人做（我没有你的 GitHub 账号）。

1. 打开 https://github.com/new ，仓库名填 `crossexam`，选 **Public**，
   **不要**勾「Add a README / .gitignore / license」——本地已经有这三个，勾了反而要处理冲突。
2. 建完页面会给你地址，形如 `https://github.com/<你的用户名>/crossexam.git`。
3. 在本机 `D:\CZB` 下依次执行（Git Bash 或 PowerShell 都行）：

```bash
git remote add origin https://github.com/<你的用户名>/crossexam.git
git branch -M main
git push -u origin main
```

4. **上传完必须改一处**：`README.md` 第 82 行还是占位符

```
git clone <仓库地址> crossexam
```

把它换成刚才那个真地址（例如 `git clone https://github.com/<用户名>/crossexam.git crossexam`），再提交一次：

```bash
git add README.md && git commit -m "docs: 填上公开仓库地址" && git push
```

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
  这一条走通，评委那关基本不会卡。

## 六、评委最可能问的三件事（提前想好一句话）

1. **没有 API Key 能看什么？** —— 149 盘合成卡带按提示词指纹寻址，整场离线回放，缺哪盘就响亮报错，绝不静默降级。
2. **这跟普通简历工具差在哪？** —— 它不帮你写得好看，它在你投出去之前把每条主张拷问一遍：提问必须锚定原文、追问有预算、判定拿不出证据就降级。
3. **AI 写的怎么保证不是编的？** —— 三道闸：锚点（引文回原文重新定位）、schema（所有模型输出过 zod）、复算（判定由代码改写）。证据在 `docs/prompt-chain/` 与 `findings.md`。
