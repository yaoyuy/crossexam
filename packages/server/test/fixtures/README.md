# 导入夹具（合成内容）

这里的文件**不是任何真人的简历**，是为了让导入解析器有稳定的回归样本而合成的。
人物叫「李雷」，内容与仓库内置示例简历不同（更短，便于逐字断言）。

| 文件 | 类型 | 内容 | 怎么来的 |
| --- | --- | --- | --- |
| `resume.docx` | Word | 167 字的合成简历 | bundled python（`python-docx`）生成后复制进来 |
| `resume-edge.pdf` | PDF | 同一份内容的 PDF 版（165 字） | 先用 Edge 把一份 HTML 打印成 PDF，再用 unpdf 抽出文字核对 |

生成 docx 用的是 DSH 自带的 python（系统 python 3.10 没装 python-docx）：

```
D:\RJ\deepseek\DSH Desktop\resources\office-runtime\primary-runtime\dependencies\python\python.exe make_docx.py
```

生成 PDF 走的是浏览器打印（不要用 pymupdf 的 `china-s` 内置字体造，那种字体没有 ToUnicode，
unpdf 会报 `cMapUrl` 警告并读不出文字，不代表真实简历的样子）：

```
msedge.exe --headless --disable-gpu --no-first-run --no-pdf-header-footer \
  --user-data-dir=D:\CZB\.tmp\edge-fixture2 \
  --print-to-pdf=D:\CZB\.tmp\fixtures\resume-edge.pdf file:///D:/CZB/.tmp/fixtures/resume.html
```

改这两份夹具会让 `packages/server/test/import.test.ts` 里逐字断言的正文跟着变，改完记得同步期望值。
