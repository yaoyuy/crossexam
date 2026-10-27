# tools/docs — 技术文档构建

把 `docs/tech/*.md` 七份分片渲染成一份 PDF：**零依赖**，只用 Node 内置模块与系统自带的 Edge/Chrome。

```bash
npm run docs:pdf        # 生成 docs/CrossExam-技术文档.pdf（超 30 页直接失败）
npm run docs:html       # 只出 HTML，排查排版用
node tools/docs/build-doc.mjs --keep         # 保留中间产物与浏览器 profile
node tools/docs/build-doc.mjs --allow-long   # 超过 30 页也算成功（默认超了即失败）
node tools/docs/build-doc.mjs --out <path>   # 换输出路径
```

## 为什么自己写渲染器

这份文档的读者是评委，他们要在自己机器上一条命令重新生成它。pandoc 与 Python 的 markdown 包
都不是「npm install 就有」的东西（本机实测两者都没有），而无头浏览器是系统自带的。
多一个依赖就多一个复现失败点，所以 `md2html.mjs` 只实现技术文档真正用到的十来种语法：
标题、段落、围栏代码、行内代码、粗体/斜体/删除线、链接、表格（含对齐）、
列表（含缩进嵌套）、引用块、分隔线、独占一行的图片。不追求 CommonMark 兼容。

## 两步链路

| 步骤 | 做什么 | 在哪 |
| --- | --- | --- |
| 1 渲染 | `docs/tech/*.md` → 单页 HTML，图片路径改写成绝对 `file://` | `md2html.mjs` |
| 2 打印 | HTML → PDF，用无头浏览器 | `build-doc.mjs` |

封面单独渲染（`00-cover.md` 包进 `.cover`），其余每章用 `h1.section { break-before: page }` 另起一页。

## 页数上限

赛题要求技术文档 ≤ 30 页。构建时用正则从 PDF 里读 `/Count N` 数页数，超过就 `exit 1`。
当前 28 页（上限 30，余量 2 页）。改排版或加内容后务必重跑一次，别把超限的 PDF 提交上去。

章标题**不再强制另起一页**：`h1.section` 只留章间留白与一条细分隔线。强制分页会把每章末尾那半页空白也算进页数预算——31 页里有一整页是这么来的，去掉后同一份内容变成 28 页（见 findings F64）。

## 已知踩坑

- **旧版 `--headless` 才可靠地产出 PDF**：`--headless=new` 配 `--print-to-pdf` 会静默退出、什么都不写（exit 0 却没有文件）。
- `--user-data-dir` 与 `--print-to-pdf` 的路径**不能用引号包住** Windows 路径（引号会让 Edge 直接忽略），脚本改用 `spawn` 传数组参数绕开 shell。
- PDF 打印进程不退出是常态：脚本只等文件出现（`waitForFile`，30 s 上限），拿到文件就杀进程。
- 表格默认不禁止跨页断行（`break-inside: avoid` 会让长表整体挪到下一页、前一页留一大片空白），只禁止单行断开（`tr { break-inside: avoid }`），表头用 `thead { display: table-header-group }` 在每页重复。
- 浏览器 profile 目录删不掉（Windows EPERM）不影响结果，脚本里是 `try/catch` 吞掉的。

## 测试

```bash
npx vitest run tools/docs
```

`test/md2html.test.mjs` 16 条：转义、行内语法互不干扰、行内代码里的星号与尖括号、六级标题、
围栏代码（含「代码里的井号不是标题」）、表格对齐与补齐、列表嵌套与类型切换、引用块递归、
图片改写的回调、段落遇到块级语法断开、CRLF 与 LF 等价。

其中「列表缩进嵌套」这条抓出过一个真 bug：栈里原来只存标签名，判断写成 `item.indent < 'ul'`，
永远是 false，于是嵌套列表被静默压平成同一层。修法是栈里同时存标签与缩进。
