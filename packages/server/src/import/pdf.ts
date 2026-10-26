import { extractText, getDocumentProxy } from 'unpdf';

/**
 * .pdf 取正文。
 *
 * 这里没有自己写解析器，是**有意**的选择：PDF 的文字常常不是「文字」，
 * 而是一串按字形编号排的指令，真正的中文要靠字体里的 ToUnicode CMap 还原；
 * 再加上对象流、交叉引用流、连字与断行，自己写一个能用的版本要几百行，
 * 而且在「评委手上的那份简历」上翻车的概率最高。
 *
 * 所以用 unpdf（它打包的是 pdf.js 的 serverless 构建，纯 JS、无原生依赖、
 * 体积 2 MB 级），代价与理由记在 docs/adr/0007。
 */

export class PdfImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PdfImportError';
    this.code = code;
  }
}

export async function pdfToText(buffer: Uint8Array): Promise<string> {
  let text: string;
  let pages: number;
  try {
    const document = await getDocumentProxy(buffer);
    const result = await extractText(document, { mergePages: true });
    text = result.text;
    // mergePages: true 时 unpdf 直接给一段拼好的文字（类型层面保证是 string）
    pages = result.totalPages;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PdfImportError('pdf-broken', '这份 PDF 读不出来：' + detail);
  }

  if (text.trim().length === 0) {
    throw new PdfImportError(
      'pdf-no-text',
      '这份 PDF（' +
        String(pages) +
        ' 页）里没有文字层，像是扫描件或截图导出的。请改用 Word 版简历，或直接把文字粘进输入框。',
    );
  }
  return text;
}
