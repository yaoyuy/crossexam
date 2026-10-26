import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decodePlainText,
  extractResumeFromFile,
  ImportError,
  importKindOf,
  IMPORT_ACCEPT,
  looksLikeLegacyDoc,
  MAX_IMPORT_BYTES,
  normalizeImportedText,
} from '../src/import/index.ts';

/** 夹具都是合成内容（李雷），不是任何真人的简历；来源见同目录 README.md。 */
function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL('./fixtures/' + name, import.meta.url)));
}

const DOCX_TEXT = [
  '李雷',
  '数据工程师 · 北京 · lilei@example.com',
  '项目经历',
  '2022.03 - 2024.06  某出行平台  实时数仓',
  '- 主导搭建实时数仓，端到端延迟从 15 分钟降到 40 秒。',
  '- 负责指标口径治理，覆盖 6 个业务域。',
  '技能',
  '- 熟悉 SQL / Python / Flink，了解 Kubernetes。',
].join('\n');

async function codeOf(name: string, bytes: Uint8Array, maxBytes?: number): Promise<string> {
  try {
    await extractResumeFromFile(maxBytes === undefined ? { name, bytes } : { name, bytes, maxBytes });
  } catch (error) {
    if (error instanceof ImportError) return error.code;
    throw error;
  }
  return 'no-error';
}

describe('扩展名与老版 Word 的识别', () => {
  it('按扩展名分派三种解析路径，大写也认', () => {
    expect(importKindOf('resume.pdf')).toBe('pdf');
    expect(importKindOf('RESUME.DOCX')).toBe('docx');
    expect(importKindOf('a.md')).toBe('text');
    expect(importKindOf('a.markdown')).toBe('text');
    expect(importKindOf('photo.png')).toBeNull();
    expect(importKindOf('no-extension')).toBeNull();
  });

  it('只认 OLE 复合文档那八个字节', () => {
    const magic = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
    expect(looksLikeLegacyDoc(magic)).toBe(true);
    expect(looksLikeLegacyDoc(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
  });
});

describe('Word（.docx）', () => {
  it('自己拆 zip 取正文，逐字对上', async () => {
    const result = await extractResumeFromFile({ name: 'resume.docx', bytes: fixture('resume.docx') });
    expect(result.kind).toBe('docx');
    expect(result.text).toBe(DOCX_TEXT);
    expect(result.chars).toBe(result.text.length);
    expect(result.notes).toEqual([]);
  });

  it('不是 zip 的 .docx 报「文件坏了」，而不是抛原始异常', async () => {
    const bytes = new TextEncoder().encode('这不是一个 zip 包');
    expect(await codeOf('resume.docx', bytes)).toBe('broken');
  });
});

describe('PDF（.pdf）', () => {
  it('取得出文字层的 PDF：正文能读，并且提醒排版换行', async () => {
    const result = await extractResumeFromFile({ name: 'resume-edge.pdf', bytes: fixture('resume-edge.pdf') });
    expect(result.kind).toBe('pdf');
    expect(result.text).toContain('李雷');
    expect(result.chars).toBeGreaterThan(100);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain('换行来自版面');
  });

  // 这份最小 PDF 是手写的：pdf.js 会先抱怨没有交叉引用表（stderr 里那句 Indexing all PDF objects），
  // 然后照样读出「一页、没有文字」——正好是扫描件在解析器眼里的样子。
  // 注意：unpdf 会把传进去的 Uint8Array 底层缓冲区转移走（pdf.js 的 worker 语义），
  // 同一个 buffer 第二次调用会变成「空文件」。夹具因此每次现造一份。
  it('没有文字层的 PDF（扫描件）给出改走 Word 的出路', async () => {
    const pdf = [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >> endobj',
      '4 0 obj << /Length 0 >> stream',
      'endstream endobj',
      'trailer << /Root 1 0 R >>',
      '%%EOF',
    ].join('\n');
    const make = (): Uint8Array => new TextEncoder().encode(pdf);
    expect(await codeOf('scan.pdf', make())).toBe('pdf-no-text');
    await expect(extractResumeFromFile({ name: 'scan.pdf', bytes: make() })).rejects.toThrow(/扫描件/);
  });

  it('彻底不是 PDF 的文件报「解析失败」', async () => {
    const bytes = new TextEncoder().encode('这不是一份 PDF');
    expect(await codeOf('broken.pdf', bytes)).toBe('pdf-broken');
  });
});

describe('文本与错误分支', () => {
  it('UTF-8 文本直接读，并折叠多余空行与行尾空白', async () => {
    const raw = '张三\n\n\n后端工程师   \n  \n负责订单系统\n\n';
    const result = await extractResumeFromFile({ name: 'resume.txt', bytes: new TextEncoder().encode(raw) });
    expect(result.kind).toBe('text');
    expect(result.text).toBe('张三\n\n后端工程师\n\n负责订单系统');
  });

  it('GBK 文本自动改用 gbk 解码（国内老简历常见）', () => {
    // 「简历」两个字的 GBK 编码
    const gbk = new Uint8Array([0xbc, 0xf2, 0xc0, 0xfa]);
    expect(decodePlainText(gbk)).toBe('简历');
    expect(decodePlainText(new TextEncoder().encode('简历'))).toBe('简历');
  });

  it('空文件、只有空白、不认识的扩展名、老版 .doc、超大文件各有自己的码', async () => {
    expect(await codeOf('a.txt', new Uint8Array([]))).toBe('empty');
    expect(await codeOf('a.txt', new TextEncoder().encode('   \n\n'))).toBe('empty');
    expect(await codeOf('photo.png', new TextEncoder().encode('文字'))).toBe('unsupported');
    expect(await codeOf('old.doc', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]))).toBe('legacy-doc');
    expect(await codeOf('big.txt', new TextEncoder().encode('x'.repeat(64)), 10)).toBe('too-large');
    expect(MAX_IMPORT_BYTES).toBe(8 * 1024 * 1024);
    expect(IMPORT_ACCEPT).toContain('.pdf');
  });

  it('整理规则可以被单独调用，且不认识的行尾空白不越界', () => {
    expect(normalizeImportedText('a\r\nb\r\n')).toBe('a\nb');
    expect(normalizeImportedText('\n\na\n')).toBe('a');
    expect(normalizeImportedText('')).toBe('');
  });
});
