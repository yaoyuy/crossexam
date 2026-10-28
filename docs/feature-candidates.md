# 还可以加什么：候选功能清单

> 这是第 11 条要求的产物：把「还能加什么」摊开来让人挑，而不是我替你决定。
> 每一项都标了「解决谁的什么问题」和「大概要花多久」，按**性价比**排序，不是按好写排序。
>
> 这份清单随功能推进而更新：**已经落成的从下面移走**，附上落成阶段与 ADR；还没做的留在第二节。
> 已上线功能的用法见 [README](../README.md) 功能表。

## 一、已经落成的（原清单里的，做完就搬到这里）

| 编号 | 事项 | 落成阶段 | 证据 |
| --- | --- | --- | --- |
| A1 | 让求职者当场补一句真话（补充说明作为新证据重新判一次） | P10 A1 | [ADR-0013](adr/0013-supplement-is-an-insert.md) · `packages/shared/src/supplement.ts` |
| A2 | 追问强度档位：温和 / 常规 / 挑刺（只换预算不换人设） | P10 A2 | [ADR-0014](adr/0014-difficulty-changes-budget-only.md) · `packages/shared/src/difficulty.ts` |
| A3 | 报告按主张类别看短板 | P10 A3 | `packages/shared/src/shortfall.ts` |
| A4 | 反问环节「轮到你了」 | P10 A4 | [ADR-0015](adr/0015-counter-questions-are-grounded.md) · `packages/shared/src/counters.ts` |
| B1 | 改写风格档位：保守 / 常规 / 敢改（只调措辞收敛程度） | P11 B1 | [ADR-0017](adr/0017-rewrite-style-is-a-tone-knob.md) · `packages/shared/src/style.ts` |
| B2 | 逐条并排的改动对照 | P11 B2 | [ADR-0016](adr/0016-side-by-side-diff.md) · `packages/shared/src/revise.ts` |
| C1 | 简历版本对比：同一份简历改完再跑一遍 | P11 C1 | [ADR-0018](adr/0018-version-compare-pairs-by-text-similarity.md) · `packages/shared/src/compare.ts` |
| C2 | 历史仪表盘：一句话结论 + 趋势 + 欠证据类别 | P11 C2 | [ADR-0019](adr/0019-history-overview-is-aggregation-only.md) · `packages/shared/src/overview.ts` |
| C3 | 一场导出成可分享的单文件 HTML（无外链、断网可看） | P11 C3 | [ADR-0020](adr/0020-bundle-is-a-single-self-contained-file.md) · `packages/server/src/bundle.ts` |
| D1 | 行业模板库：一键凑齐 JD 与面试官（36 条原创模板） | P9 | [ADR-0011](adr/0011-job-templates.md) · `packages/shared/src/templates.ts` |
| E1 | 卡带漂移门禁搬进 CI（重跑 seed + 比对 git diff） | P13 | [ADR-0023](adr/0023-ci-gate-and-performance-budget.md) · `.github/workflows/ci.yml` |
| E2 | 性能预算断言（起服 / 整场回放 / 报告 / 打包的耗时与体积上界） | P13 | [ADR-0023](adr/0023-ci-gate-and-performance-budget.md) · `tools/perf/budget.mjs` |
| 新 | 多 JD 上传 + 岗位要求驱动追问（三个新阶段） | P8（大功能②） | [ADR-0012](adr/0012-jd-requirement-review.md) · `packages/shared/src/requirements.ts` |
| 新 | 成长档案：同一条主张在相邻两版之间连成轨迹 | P12 ② | [ADR-0021](adr/0021-claim-trails-chain-across-neighbouring-versions.md) · `packages/shared/src/growth.ts` |
| 新 | 一岗一版简历：按岗位只做「留下 / 去掉」，不改一个字 | P12 ③ | [ADR-0022](adr/0022-tailor-is-keep-or-drop-only.md) · `packages/shared/src/tailor.ts` |
| 新 | 岗位要求也能从文件导入（一次多份、标题取文件名，复用简历那条解析通道） | P14 补记（2026-10-28） | `packages/web/src/jds.ts` · [ADR-0007](adr/0007-resume-import.md) 同一条通道 |
| 新 | 新手教程 / 深浅两套配色 / 面试官工作室 / 零门槛启动器 / 导入 PDF 与 Word | P7 第 1–7 项 | [ADR-0007](adr/0007-resume-import.md) · ADR-0010 · `packages/web/src/help.ts` |

## 二、还没做的（按性价比排序）

下面这些是**截止功能冻结（2026-10-28）确实没有做**的，连同当时的判断一起留档。

### B3. 导出真 .docx 而不是 .doc（推荐 ★★）

**问题**：现在 Word 是 HTML 加 `.doc` 后缀，Word 打开会提示「格式与扩展名不一致」（能打开，但会弹一次警告）。
**怎么加**：自己拼 OOXML（`word/document.xml` 加最小 zip），不引第三方库。
**成本**：约 6–8 小时。**判断**：不做。提示那一下警告，比一个可能打不开的 docx 更安全。

### D2. 英文简历与英文追问（推荐 ★★）

**问题**：锚定逻辑本来与语言无关，但 `segment.ts` 的小节识别是中文关键词（「工作经历」「项目经验」）。
**怎么加**：加一套英文小节关键词 + 英文提示词。**成本**：约 4 小时。**判断**：不做，赛题是中文语境。

### E3. 无障碍与纯键盘操作（推荐 ★★）

**问题**：弹层有 `role=dialog`，但焦点没有陷阱、Esc 关不掉；全流程能点，键盘走不完。
**怎么加**：焦点循环 + Esc 关闭 + `aria-live` 播报直播进度。**成本**：约 3 小时。**判断**：不做，比赛时间不够，且它不改产品结论。

### 如果还有时间，我会先做这三件（来自技术文档 6.3）

| 优先级 | 事项 | 为什么是它 |
| --- | --- | --- |
| 1 | 让求职者 Agent 能说「我不会」，而不只是「简历里没写」 | 根治判定区分度：现在它只能引用简历，所以「无法回答」结构性稀少 |
| 2 | 支持英文简历 | 锚定逻辑已与语言无关，只需放宽 segment 的小节识别 |
| 3 | 把 shared 拆成 core + adapter | 消除 web 包抄一份文案的技术债（目前靠漂移测试看守） |

## 三、提交物本身（这些不是功能，但没有就交不上去）

| 项 | 状态 | 谁来做 |
| --- | --- | --- |
| 仓库地址填进 README 与 package.json | 待定（本人说彻底完成后再给） | **本人** |
| LICENSE | ✅ 已创建：MIT，`Copyright (c) 2026 yaoyuy`（要改真名只动这一行） | 已做 |
| 参赛组别确认 | ✅ 已确认：**B 组（普通本科）** | 已确认 |
| 赛事缴费 | ✅ 已完成 | 已完成 |
| 5–8 分钟演示视频（含 ≥2 分钟 AI 协同复现） | 🔶 脚本 + 提词卡 + 录前检查已备，**待录制** | 我准备 + 本人按键 |

## 当时（P11 之前）的建议顺序，与后来的实际选择

原建议是 **C1（简历版本对比）→ E1（CI 门禁）→ A1（补充事实）→ D1（行业模板）→ A3（按类别看短板）**。
实际执行里，P10 先做了 A3/A2/A1/A4（都是追问与判定的深化），P11 做了 B1/B2/C1/C2/C3，
P12 做了成长档案与一岗一版，P13 才补 E1/E2——顺序变了，理由只有一个：先让产品闭环成立，再让工程可验证。
