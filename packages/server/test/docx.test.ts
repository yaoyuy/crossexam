/**
 * 真 .docx 写入器（packages/server/src/docx.ts）。
 *
 * 为什么这一层值得单独测：导出的文件要拿 Word 打开，写错了就是「双击看到文件已损坏」，
 * 而且这种事在浏览器里永远不会暴露。所以断言落在容器结构上——zip 魔数、Word 要求的
 * 几份部件、正文 XML 里的文字与转义——而不是落在"能下载下来"。
 */

import { describe, expect, it } from 'vitest';
import { readZip, readZipEntry } from '../src/import/zip.ts';
import {
  bodyParagraph,
  headingParagraph,
  markdownParagraphs,
  titleParagraph,
  writeDocx,
} from '../src/docx.ts';

const NL = String.fromCharCode(10);

function textOf(buffer: Uint8Array, name: string): string {
  const entry = readZipEntry(buffer, name);
  expect(entry).not.toBeNull();
  return Buffer.from(entry ?? new Uint8Array()).toString('utf8');
}

describe('docx 写入器', () => {
  it('同一批段落写两遍逐字节相同', () => {
    const paragraphs = [titleParagraph('质询报告'), bodyParagraph('正文一句')];
    expect(writeDocx(paragraphs).equals(writeDocx(paragraphs))).toBe(true);
  });

  it('容器是 zip，且 Word 要的五份部件都在', () => {
    const buffer = writeDocx([bodyParagraph('你好')]);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
    const names = readZip(new Uint8Array(buffer)).map((entry) => entry.name).sort();
    expect(names).toEqual(
      ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml'].sort(),
    );
  });

  it('段落里的中英文都进了正文部件，段落数对得上', () => {
    const document = textOf(
      new Uint8Array(writeDocx([titleParagraph('质询报告'), bodyParagraph('张明 · 后端工程师')])),
      'word/document.xml',
    );
    expect(document).toContain('质询报告');
    expect(document).toContain('张明 · 后端工程师');
    expect((document.match(/<w:p>/g) ?? []).length).toBe(2);
  });

  it('XML 特殊字符被转义，不会把文件写坏', () => {
    const document = textOf(new Uint8Array(writeDocx([bodyParagraph('a < b & c > d')])), 'word/document.xml');
    expect(document).toContain('a &lt; b &amp; c &gt; d');
    expect(document).not.toContain('a < b');
  });

  it('一行都没有时也是一个能打开的 Word 文件', () => {
    const document = textOf(new Uint8Array(writeDocx([])), 'word/document.xml');
    expect(document).toContain('<w:body>');
    expect(document).toContain('<w:sectPr>');
  });

  it('Markdown 认得标题、项目符号、引用与表格行', () => {
    const paragraphs = markdownParagraphs(
      [
        '# 报告',
        '## 一、主张与判定',
        '### 小标题',
        '- 第一条',
        '> 一句引用',
        '| 主张 | 判定 |',
        '| --- | --- |',
        '| C1 | 站得住 |',
        '**加粗**的一句',
      ].join(NL),
    );
    // # 与 ## 都是 heading，靠 level 区分层级（Markdown 的 # 是章节，不是文档标题）
    expect(paragraphs.map((p) => p.kind)).toEqual([
      'heading',
      'heading',
      'heading',
      'bullet',
      'quote',
      'body',
      'body',
      'body',
    ]);
    expect(paragraphs[0]?.level).toBe(1);
    expect(paragraphs[1]?.level).toBe(2);
    expect(paragraphs[2]?.level).toBe(3);
    // Word 里没有等宽表格：一行压成一句，首格加粗 + 「：」+ 其余用 / 连接
    expect(paragraphs[5]?.runs.map((r) => r.text).join('')).toBe('主张：判定');
    expect(paragraphs[6]?.runs.map((r) => r.text).join('')).toBe('C1：站得住');
    const bold = paragraphs[7]?.runs ?? [];
    expect(bold.map((r) => r.text).join('')).toBe('加粗的一句');
    expect(bold[0]?.text).toBe('加粗');
    expect(bold[0]?.bold).toBe(true);
  });

  it('标题挂在 Word 内置样式上，导航窗格与目录才认得出结构', () => {
    const styleIds = ['Title', 'Subtitle', 'Heading1', 'Heading2', 'Heading3', 'Quote'];
    const styles = textOf(new Uint8Array(writeDocx([bodyParagraph('x')])), 'word/styles.xml');
    for (const id of styleIds) {
      expect(styles).toContain('w:styleId="' + id + '"');
    }
    // outlineLvl 就是 Word 导航窗格认的那一级
    expect(styles).toContain('<w:outlineLvl w:val="1"/>');

    const document = textOf(
      new Uint8Array(writeDocx([headingParagraph('一、主张与判定', 2), bodyParagraph('正文')])),
      'word/document.xml',
    );
    expect(document).toContain('<w:pStyle w:val="Heading2"/>');
    // 字号与粗体归样式管，行内不能再写一遍——否则用户在 Word 里改样式不会生效
    const heading = headingParagraph('一、主张与判定', 2);
    expect(heading.runs[0]?.size).toBeUndefined();
    expect(heading.runs[0]?.bold).toBeUndefined();
  });

  it('表格的分隔行被跳过，不留一行破折号', () => {
    const paragraphs = markdownParagraphs(['| A | B |', '| --- | --- |', '| 1 | 2 |'].join(NL));
    expect(paragraphs.length).toBe(2);
    expect(paragraphs.map((p) => p.runs.map((r) => r.text).join(''))).toEqual(['A：B', '1：2']);
  });
});
