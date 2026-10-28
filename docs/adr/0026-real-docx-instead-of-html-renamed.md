# ADR-0026：导出的 Word 是真 .docx，不是改后缀的网页

- 状态：已采纳（2026-10-28）
- 相关：ADR-0006（报告导出：服务端出 HTML，PDF 交给浏览器）、ADR-0007（导入通道与依赖纪律）、ADR-0025（判定台账自写 .xlsx）、ADR-0020（单文件打包）

## 背景

在此之前，界面上写「导出 Word」的三颗按钮给的都是**同一份 HTML 换了个 `.doc` 后缀**（`application/msword`）。
Word 打得开，但打开的是网页：段落是 `div`、缩进靠 CSS、没有样式名。用户照着改两个字，
拿到的是「HTML 排版恰好长得像 Word」的东西；招聘方那边也容易当成可疑附件。
当初这么做的理由是对的（少一个依赖就少一个复现失败点，见 ADR-0006），但代价一直被记在候选清单里
（`docs/feature-candidates.md` 的 B3，当时的判断是「不做：提示那一下警告，比一个可能打不开的 docx 更安全」）。

现在条件变了：判定台账已经证明「最窄的 OOXML + 自写 zip」这条路可行（ADR-0025），
而 .docx 与 .xlsx 共用同一个容器机制。于是把 B3 做掉，并把判断反过来：**不引依赖不等于不做真格式**。

## 决策

1. **三条导出路由一律出真 .docx**：`report.docx` / `resume.docx` / `tailored.docx`，
   MIME `application/vnd.openxmlformats-officedocument.wordprocessingml.document`。
   旧的 `.doc` 路径不再生成（命中即 404，测试里的 404 循环已随之改）。
2. **自己写写入器，不引第三方库**：`packages/server/src/docx.ts` 只产出 Word 能打开的最小集合——
   `[Content_Types].xml` / `_rels/.rels` / `word/document.xml` / `word/_rels/document.xml.rels` / `word/styles.xml`，
   外加一个 zip 容器。与 ADR-0007 砍掉老 `.doc` 解析、ADR-0025 自写 `.xlsx` 是同一条纪律：
   这个项目里每多一个依赖，就多一个「评委机器上装不出来」的失败点。
3. **zip 写入器抽成独立模块**（`packages/server/src/zip.ts`，导出 `ZipFile` / `crc32` / `zipArchive`），
   `.xlsx` 与 `.docx` 共用它；时间戳写死 1980-01-01，**同一份内容两次导出逐字节相同**（同 ADR-0025）。
4. **段落挂 Word 内置样式，而不是只写直接格式**：`title→Title`、`subtitle→Subtitle`、`heading→Heading1/2/3`、
   `quote→Quote`，直接格式只留给样式表达不了的东西（项目符号缩进、行内小字）。
   字号与粗体交给 `styles.xml`：**run 只在明确要求时才写 `w:sz`**。
   理由是可被发现的结构：只写直接格式时，Word 的导航窗格与目录认不出任何一层标题（215 段全是「正文」），
   用户在「标题 2」上改字号毫无反应——那样的 .docx 后缀是真的、结构是假的。
5. **Markdown → 段落是一层保守的映射**（`markdownParagraphs`）：`#`/`##`/`###` → Heading1/2/3、
   `- ` → 项目符号、`> ` → 引用、表格行压成「首格：其余用 / 连接」的一行文字。
   它不试图还原版式——报告的结构在 Markdown 里已经表达完了，这一层只负责把它翻译成 Word 认识的元素。
6. **验收标准是「换一个不是自己写的读取器能认出结构」**：用 `python-docx` 打开并打印段落与样式名，
   报告标题必须报成 `Heading 1`、简历标题必须报成 `Title`。
   自己写的测试只能证明自洽，跨实现才算证明（F90）。
7. **三条导出共用同一份事实**：docx 只换呈现，判定、建议、取舍一律取 `SessionView` 与 `RevisedView` 里已有的东西，
   不重算、不新增口径（与 ADR-0025 决策 1 同一条）。

## 取舍

- **不做页眉页脚、分页符、图片、批注、目录域**：候选清单里曾有一条「导出 Word 带批注」，明确不做——
  这些是排版，不是内容；我们的责任是把事实写进一个 Word 能编辑的文件里。
- **写入器只写不读**：不解析用户改完再传回来的 .docx。那会把这条通道变成第二套导入解析。
- **报告仍是三种形态**（Markdown / 可打印 HTML / .docx）：docx 不替代 PDF，服务端依然不生成 PDF（ADR-0006 的结论不变）。
- **代价是代码变多**：多一个写入器（约 350 行）与它的测试，换来的是「Word 打开不再弹格式与扩展名不一致」，
  以及导航窗格、样式修改、大纲视图都真的能用。
