import { describe, expect, it } from 'vitest';
import { escapeHtml, renderInline, renderMarkdown } from '../md2html.mjs';

const BT = String.fromCharCode(96);

describe('escapeHtml', () => {
  it('把会破坏结构的四个字符转义', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});

describe('renderInline', () => {
  it('粗体、斜体、删除线、行内代码、链接各就各位', () => {
    expect(renderInline('**粗** 与 *斜* 与 ~~删~~ 与 ' + BT + 'code' + BT)).toBe(
      '<strong>粗</strong> 与 <em>斜</em> 与 <del>删</del> 与 <code>code</code>',
    );
    expect(renderInline('[说明](https://example.com)')).toBe('<a href="https://example.com">说明</a>');
  });

  it('行内代码里的星号与下划线不被当成强调', () => {
    const html = renderInline(BT + 'a * b ** c' + BT);
    expect(html).toBe('<code>a * b ** c</code>');
  });

  it('行内代码里的尖括号先转义再还原成代码', () => {
    expect(renderInline(BT + 'List<string>' + BT)).toBe('<code>List&lt;string&gt;</code>');
  });
});

describe('renderMarkdown 块级', () => {
  it('六级标题各自成标签', () => {
    expect(renderMarkdown('## 二级')).toBe('<h2>二级</h2>');
    expect(renderMarkdown('###### 六级')).toBe('<h6>六级</h6>');
  });

  it('围栏代码保留原文且按语言加 class', () => {
    const md = [BT + BT + BT + 'ts', 'const a = 1 < 2;', BT + BT + BT].join(String.fromCharCode(10));
    expect(renderMarkdown(md)).toBe('<pre><code class="lang-ts">const a = 1 &lt; 2;</code></pre>');
  });

  it('围栏代码里的井号不会被当成标题', () => {
    const md = [BT + BT + BT, '# 不是标题', BT + BT + BT].join(String.fromCharCode(10));
    expect(renderMarkdown(md)).not.toContain('<h1>');
  });

  it('表格按分隔行判对齐', () => {
    const md = ['| 左 | 中 | 右 |', '| :-- | :-: | --: |', '| 1 | 2 | 3 |'].join(String.fromCharCode(10));
    const html = renderMarkdown(md);
    expect(html).toContain('<th style="text-align:left">左</th>');
    expect(html).toContain('<th style="text-align:center">中</th>');
    expect(html).toContain('<th style="text-align:right">右</th>');
    expect(html).toContain('<tbody><tr><td style="text-align:left">1</td>');
  });

  it('表格列数不齐时用空单元格补齐', () => {
    const md = ['| a | b |', '| -- | -- |', '| 1 |'].join(String.fromCharCode(10));
    expect(renderMarkdown(md)).toContain('<td>1</td><td></td>');
  });

  it('无序与有序列表靠缩进嵌套', () => {
    const md = ['- 一', '  - 一之一', '- 二'].join(String.fromCharCode(10));
    expect(renderMarkdown(md)).toBe('<ul><li>一</li><ul><li>一之一</li></ul><li>二</li></ul>');
  });

  it('有序列表与无序列表切换时开关标签', () => {
    const md = ['1. 一', '2. 二'].join(String.fromCharCode(10));
    expect(renderMarkdown(md)).toBe('<ol><li>一</li><li>二</li></ol>');
  });

  it('引用块内部继续按 Markdown 渲染', () => {
    expect(renderMarkdown('> **要点**')).toBe('<blockquote><p><strong>要点</strong></p></blockquote>');
  });

  it('独占一行的图片包成 figure，并把路径交给 rewriteImage', () => {
    const html = renderMarkdown('![示意](docs/a.png)', { rewriteImage: (src) => 'file:///' + src });
    expect(html).toBe('<p class="figure"><img src="file:///docs/a.png" alt="示意"></p>');
  });

  it('段落遇到块级语法就断开', () => {
    const md = ['第一段', '## 标题', '第二段'].join(String.fromCharCode(10));
    expect(renderMarkdown(md)).toBe('<p>第一段</p>' + String.fromCharCode(10) + '<h2>标题</h2>' + String.fromCharCode(10) + '<p>第二段</p>');
  });

  it('分隔线渲染成 hr', () => {
    expect(renderMarkdown('---')).toBe('<hr>');
  });

  it('CRLF 与 LF 得到同一结果', () => {
    const lf = ['# 标题', '', '正文'].join(String.fromCharCode(10));
    const crlf = lf.split(String.fromCharCode(10)).join(String.fromCharCode(13, 10));
    expect(renderMarkdown(crlf)).toBe(renderMarkdown(lf));
  });
});