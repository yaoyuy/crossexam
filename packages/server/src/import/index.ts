import { docxToText } from './docx.ts';
import { pdfToText } from './pdf.ts';
import { ZipError } from './zip.ts';

/**
 * 简历导入的唯一入口。
 *
 * 三种文件走三条路：.pdf 交给 pdf.js（unpdf），.docx 自己拆 zip，
 * .txt/.md 按文本解码。老版 .doc（OLE 复合文档）**明确拒绝并给出出路**——
 * 能解析它的库要靠一份没有样本可测的二进制格式赌运气，而用户另存为 .docx
 * 只要两步。宁可说一句人话，也不要一个「有时候能用」的功能。
 */

export type ImportKind = 'pdf' | 'docx' | 'text';

export interface ImportedResume {
  kind: ImportKind;
  name: string;
  text: string;
  chars: number;
  notes: string[];
}

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
export const IMPORT_LIMIT_LABEL = '8 MB';
export const IMPORT_ACCEPT = '.pdf,.docx,.txt,.md,.markdown';

export type ImportErrorCode =
  | 'unsupported'
  | 'legacy-doc'
  | 'too-large'
  | 'empty'
  | 'pdf-no-text'
  | 'pdf-broken'
  | 'broken';

export class ImportError extends Error {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}

const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.text'];

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase();
}

export function importKindOf(fileName: string): ImportKind | null {
  const extension = extensionOf(fileName);
  if (extension === '.pdf') return 'pdf';
  if (extension === '.docx') return 'docx';
  if (TEXT_EXTENSIONS.includes(extension)) return 'text';
  return null;
}

/** 老版 Word 的 .doc 是 OLE 复合文档，开头是固定的 8 字节魔数。 */
export function looksLikeLegacyDoc(buffer: Uint8Array): boolean {
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (buffer.length < magic.length) return false;
  return magic.every((byte, index) => buffer[index] === byte);
}

/** 把任意来源的正文整理成「一段一行、不留多余空行」的形状。 */
export function normalizeImportedText(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[ \t]+$/, ''));
  const kept: string[] = [];
  for (const line of lines) {
    if (line.trim() === '' && (kept.length === 0 || kept[kept.length - 1] === '')) continue;
    kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
  return kept.join('\n');
}

function replacementRatio(text: string): number {
  if (text.length === 0) return 0;
  let bad = 0;
  for (const char of text) {
    if (char === '\uFFFD') bad += 1;
  }
  return bad / text.length;
}

/**
 * 文本文件先按 UTF-8 解；解出一堆替换字符就说明它不是 UTF-8
 * （国内的老简历常见 GBK），再用 gbk 试一次，选乱码少的那个。
 */
export function decodePlainText(buffer: Uint8Array): string {
  const fatalSafe = new TextDecoder('utf-8');
  const utf8 = fatalSafe.decode(buffer);
  if (replacementRatio(utf8) < 0.01) return utf8;
  try {
    const gbk = new TextDecoder('gbk').decode(buffer);
    return replacementRatio(gbk) < replacementRatio(utf8) ? gbk : utf8;
  } catch {
    return utf8;
  }
}

export interface ExtractOptions {
  name: string;
  bytes: Uint8Array;
  maxBytes?: number;
}

export async function extractResumeFromFile(options: ExtractOptions): Promise<ImportedResume> {
  const limit = options.maxBytes ?? MAX_IMPORT_BYTES;
  const bytes = options.bytes;
  if (bytes.byteLength === 0) {
    throw new ImportError('empty', '这个文件是空的。');
  }
  if (bytes.byteLength > limit) {
    throw new ImportError(
      'too-large',
      '这个文件有 ' +
        (bytes.byteLength / 1024 / 1024).toFixed(1) +
        ' MB，超过 ' +
        IMPORT_LIMIT_LABEL +
        ' 的上限。简历用不了这么大，换一份吧。',
    );
  }
  if (looksLikeLegacyDoc(bytes)) {
    throw new ImportError(
      'legacy-doc',
      '这是老版 Word 的 .doc 格式。用 Word 打开它，「另存为」选 .docx 再导入就行——我们不想为一个测不到的二进制格式赌运气。',
    );
  }

  const kind = importKindOf(options.name);
  const notes: string[] = [];
  let raw: string;

  if (kind === 'pdf') {
    try {
      raw = await pdfToText(bytes);
    } catch (error) {
      if (error instanceof Error && error.name === 'PdfImportError') {
        const code = (error as { code?: string }).code;
        throw new ImportError(code === 'pdf-no-text' ? 'pdf-no-text' : 'pdf-broken', error.message);
      }
      throw error;
    }
    notes.push('PDF 里的换行来自版面，段落结构可能不如 .docx 干净；导入后扫一眼再开始。');
  } else if (kind === 'docx') {
    try {
      raw = docxToText(bytes);
    } catch (error) {
      if (error instanceof ZipError) {
        throw new ImportError('broken', error.message);
      }
      throw error;
    }
  } else if (kind === 'text') {
    raw = decodePlainText(bytes);
  } else {
    throw new ImportError(
      'unsupported',
      '只支持 ' + IMPORT_ACCEPT.split(',').join(' / ') + '，这个文件不是其中任何一种。',
    );
  }

  const text = normalizeImportedText(raw);
  if (text.trim().length === 0) {
    throw new ImportError('empty', '这个文件里没有可用的文字。');
  }
  return { kind: kind ?? 'text', name: options.name, text, chars: text.length, notes };
}
