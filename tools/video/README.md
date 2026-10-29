# tools/video — 演示视频是怎么录出来的

成片：`docs/video/crossexam-demo.mp4`，7 分 22 秒 / 1920×1080 / 30 fps / 45.7 MB。
这一页说明它是**脚本录出来的**，不是人手录屏再剪辑——每一段都能重跑。

## 为什么要有这一套

赛题要「过程可复现」。演示视频如果只有一支成品，评审查不了它是怎么来的。
这里的做法是：录屏、配音、烧字幕全部落成脚本，数字直接取自 `npm run verify` 与 `npm run smoke` 的真实输出。

## 管线

```
服务端（离线回放模式）
      │
      ├─ record.mjs   b1–b5：真点击、真滚动（CDP Input.dispatchMouseEvent + rAF 缓动）
      │               → frames/<beat>/f000001.jpg + meta.json（每帧的毫秒时间戳）
      ├─ record2.mjs  b6–b11：静态证据页（pages.mjs 生成），渐进滚动
      │
narrate.mjs  ── Edge TTS 逐句合成（整段长文本会被掐断）→ audio/<beat>.mp3
      │
build.mjs    ── 按帧时间戳生成 concat 清单 → ffmpeg 出每段 mp4（30 fps、字幕由 drawtext 烧进画面）
      │
assemble.mjs ── 拼接 11 段、加淡入淡出 → docs/video/crossexam-demo.mp4
```

- `cdp.mjs`：零依赖 CDP 封装（起 headless Edge/Chrome、导航、截图、求值）。
- `cap.mjs`：`Page.captureScreenshot` 循环抓帧，实测 **17 fps**；`Page.startScreencast` 只有 ~10 fps 且不均匀。
- `lines.mjs`：11 段旁白与字幕（章节名、一句话字幕、旁白原文）。
- `pages.mjs`：把真实材料（`anchor.ts` 的代码、`findings.md` 的错误行、`verify.log`/`smoke.log` 的输出）渲染成深色证据页。

## 跑之前要准备

1. **ffmpeg**：系统 PATH 里有就行；没有的话
   `npm i --prefix .tmp/vtools @ffmpeg-installer/win32-x64`，
   然后把脚本顶部的 `FF` 常量指到 `.tmp/vtools/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe`。
2. **配音**：`npm i --prefix .tmp/vtools msedge-tts`（沙盒里跑，不进 `package.json`，因为评委不需要它）。
3. **服务端**：`CROSSEXAM_PORT=8801 CROSSEXAM_DB=.tmp/video/video.db node packages/server/src/bin/serve.ts`。
   b1 要录首访体验，**必须先删库**——有历史会话时新手向导不会弹。
4. 录制机的绝对路径写在脚本顶部（`D:/CZB/...`），换机器改这一处常量即可。

## 三条踩过的坑（改脚本前先看）

1. concat 清单里的路径会被拼到**清单所在目录**后面，写绝对路径会变成 `captions/D:/...` 打不开；
   清单放帧目录、只写文件名。
2. `drawtext` 的选项用冒号分隔，路径里的盘符会被截断（`fontfile=C:/...` 被切成 `fontfile=C`），
   要写 `C\\:/Windows/...`；**报错信息是 `Both text and text file provided`，完全不指向真因**。
3. 帧序列比旁白短时，末帧会被冻住十几秒；`record.mjs` 里的 `fill()` 用很慢的小幅往返把时间补足。
