/**
 * 投料台的 JD 列表：界面预检的纯函数。
 *
 * 这一层不算权威——服务端会再查一遍并回 400——所以测试守的是两件事：
 * ① 预检的阈值必须与服务端 REQUIREMENT_LIMITS 同口径，不然会出现「界面放行、请求被拒」；
 * ② 编号 J1..Jn 在「还没跑」和「跑起来了」两种视图里必须一致，否则点要求跳原文会跳空。
 */
import { describe, expect, it } from 'vitest';
import { REQUIREMENT_LIMITS } from '@crossexam/shared/requirements.ts';
import {
  JD_TITLE_MAX,
  MAX_JD_CHARS,
  MAX_JDS,
  MIN_JD_CHARS,
  emptyDraftList,
  filledJds,
  firstLineOf,
  importJdFiles,
  jdDraftProblem,
  jdImportNote,
  jdPayload,
  jdTitleFromFileName,
  materialJds,
  normalizeJdText,
  previewJds,
} from '../src/jds.ts';

const LONG = 'x'.repeat(MIN_JD_CHARS);
const TOO_LONG = 'x'.repeat(MAX_JD_CHARS + 1);

describe('JD 列表的界面预检', () => {
  it('阈值与服务端同口径：界面放行的东西服务端不该拒', () => {
    expect(MAX_JDS).toBe(REQUIREMENT_LIMITS.maxJds);
    expect(MIN_JD_CHARS).toBe(REQUIREMENT_LIMITS.jdMinChars);
    expect(MAX_JD_CHARS).toBe(REQUIREMENT_LIMITS.jdMaxChars);
  });

  it('只有空白的一行不算一份 JD', () => {
    const filled = filledJds([{ title: '', text: '  ' }, { title: '后端', text: LONG }]);
    expect(filled).toHaveLength(1);
    expect(filled[0]!.title).toBe('后端');
  });

  it('交给服务端时只去标题两端的空格，正文原样不动', () => {
    const payload = jdPayload([{ title: '  后端工程师  ', text: '  第一行\n带缩进的正文  ' }]);
    expect(payload[0]!.title).toBe('后端工程师');
    expect(payload[0]!.text).toBe('  第一行\n带缩进的正文  ');
  });

  it('一份都没填时没有意见可提', () => {
    expect(jdDraftProblem(emptyDraftList())).toBeNull();
    expect(jdDraftProblem([])).toBeNull();
  });

  it('太短、太长、太多各自报一个能照着改的错', () => {
    const short = jdDraftProblem([{ title: '后端工程师', text: 'x'.repeat(MIN_JD_CHARS - 1) }]);
    expect(short).toContain('《后端工程师》');
    expect(short).toContain('至少 40 个字符');
    expect(jdDraftProblem([{ title: '', text: TOO_LONG }])).toContain('太长了');
    const many = Array.from({ length: MAX_JDS + 1 }, () => ({ title: '', text: LONG }));
    expect(jdDraftProblem(many)).toContain('最多 8 份 JD');
  });

  it('一次只说第一个问题，且按填写顺序检查', () => {
    const problems = jdDraftProblem([
      { title: '第一份', text: LONG },
      { title: '第二份', text: 'short' },
    ]);
    expect(problems).toContain('《第二份》');
  });

  it('标题取正文第一行有内容的那些字', () => {
    expect(firstLineOf('\n\n  高级后端工程师（Node.js）  \n其余正文')).toBe('高级后端工程师（Node.js）');
    expect(firstLineOf('   ')).toBe('');
  });

  it('还没开跑时的预览：编号 J1..Jn，标题留空就退到正文第一行', () => {
    const preview = previewJds([
      { title: '', text: '高级后端工程师\n负责订单系统' },
      { title: '数据平台', text: LONG },
    ]);
    expect(preview.map((jd) => jd.id)).toEqual(['J1', 'J2']);
    expect(preview.map((jd) => jd.ordinal)).toEqual([1, 2]);
    expect(preview[0]!.title).toBe('高级后端工程师');
    expect(preview[1]!.title).toBe('数据平台');
  });

  it('跑起来之后与服务端回的编号按下标对上，正文还是刚提交的那几份', () => {
    const merged = materialJds(
      [{ id: 'J1', ordinal: 1, title: '高级后端工程师' }, { id: 'J2', ordinal: 2, title: '数据平台' }],
      [{ title: '随手写的', text: 'A' }, { title: '', text: 'B' }],
    );
    expect(merged[0]!.id).toBe('J1');
    expect(merged[0]!.title).toBe('高级后端工程师');
    expect(merged.map((jd) => jd.text)).toEqual(['A', 'B']);
  });

  it('服务端一份都没回时不硬凑：退回空数组，右栏显示「还没有上传」', () => {
    expect(materialJds([], [{ title: '', text: LONG }])).toEqual([]);
  });
});

describe('从文件导入岗位要求', () => {
  const FILE = (name: string, text: string) => ({ name, text });

  it('标题取文件名：去掉扩展名、太长截断、空名兜底', () => {
    expect(jdTitleFromFileName('字节跳动-后端开发工程师-JD.docx')).toBe('字节跳动-后端开发工程师-JD');
    expect(jdTitleFromFileName('x'.repeat(JD_TITLE_MAX + 6) + '.txt')).toBe('x'.repeat(JD_TITLE_MAX) + '…');
    expect(jdTitleFromFileName('')).toBe('导入的岗位');
    expect(jdTitleFromFileName('  .txt')).toBe('导入的岗位');
  });

  it('追加在已填的那几份后面，读不出文字的文件跳过并如实记账', () => {
    const result = importJdFiles(
      [{ title: '已有的', text: LONG }, { title: '', text: '   ' }],
      [FILE('后端工程师.txt', '第一行\n第二行'), FILE('扫描件.pdf', '  \n '), FILE('数据平台.md', 'A')],
    );
    expect(result.added).toBe(2);
    expect(result.skippedEmpty).toBe(1);
    expect(result.skippedLimit).toBe(0);
    expect(result.jds.map((jd) => jd.title)).toEqual(['已有的', '后端工程师', '数据平台']);
    expect(result.jds[1]!.text).toBe('第一行\n第二行');
  });

  it('最多八份：满了之后一份都不进，也不动已有的', () => {
    const full = Array.from({ length: MAX_JDS }, (_, i) => ({ title: 'J' + String(i + 1), text: LONG }));
    const result = importJdFiles(full, [FILE('多出来的.txt', 'A'), FILE('又一份.txt', 'B')]);
    expect(result.added).toBe(0);
    expect(result.skippedLimit).toBe(2);
    expect(result.jds).toHaveLength(MAX_JDS);
    expect(result.jds[0]!.title).toBe('J1');
  });

  it('CRLF 归一、两端空白去掉，但正文不截断（太长交给预检如实报出来）', () => {
    expect(normalizeJdText('  第一行\r\n第二行\r   ')).toBe('第一行\n第二行');
    const tooLong = importJdFiles([], [FILE('长.txt', 'x'.repeat(MAX_JD_CHARS + 5))]);
    expect(tooLong.jds[0]!.text.length).toBe(MAX_JD_CHARS + 5);
    expect(jdDraftProblem(tooLong.jds)).toContain('太长了');
  });

  it('一个文件都没读到文字时说的是「没读到」，不是「导入成功」', () => {
    expect(jdImportNote(importJdFiles([], [FILE('扫描件.pdf', '  ')]))).toContain('没有读到文字');
    expect(jdImportNote(importJdFiles([], [FILE('正常.txt', LONG)]))).toContain('已导入 1 份');
    const over = importJdFiles(
      Array.from({ length: MAX_JDS }, () => ({ title: '', text: LONG })),
      [FILE('多出来的.txt', 'A')],
    );
    const note = jdImportNote(over);
    expect(note).toContain('最多 8 份 JD');
    expect(note).not.toContain('已导入');
  });
});
