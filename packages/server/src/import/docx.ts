import { looksLikeZip, readZipEntry, ZipError } from './zip.ts';

/**
 * .docx 取正文。
 *
 * .docx 是一个 zip，正文在 word/document.xml。我们不需要排版，只需要
 * 「一段一段的文字」——段落是简历里最小的结构单位，也是锚定机制要用的东西。
 *
 * 取文规则（尽量贴近人的读法，而不是 XML 的形状）：
 *   - <w:p> 一个段落一行；连续空段落折叠成一个空行（保住段落结构，不留噪声）
 *   - <w:t> 里的文字按出现顺序拼接；<w:tab/> 变制表符；<w:br/> 变换行
 *   - <w:instrText>（域代码，比如目录、页码）整段丢弃：它是给 Word 看的，不是给人读的
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: String.fromCharCode(39),
  nbsp: ' ',
};

export function decodeXmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/** 把一段 <w:p>…</w:p> 里的可读文字取出来。 */
export function paragraphText(xml: string): string {
  const withoutFields = xml.replace(/<w:instrText[\s\S]*?<\/w:instrText>/g, '');
  let out = '';
  const pattern = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutFields)) !== null) {
    if (match[0].startsWith('<w:tab')) {
      out += '\t';
    } else if (match[0].startsWith('<w:br')) {
      out += '\n';
    } else if (match[2] !== undefined) {
      out += decodeXmlEntities(match[2]);
    }
  }
  return out;
}

export function documentXmlToText(xml: string): string {
  const body = /<w:body[\s\S]*<\/w:body>/.exec(xml);
  const scope = body === null ? xml : body[0];
  const lines: string[] = [];
  const paragraphs = scope.split(/<\/w:p>/);
  for (const paragraph of paragraphs) {
    const text = paragraphText(paragraph).replace(/\r\n?/g, '\n');
    for (const piece of text.split('\n')) {
      lines.push(piece.replace(/\s+$/, ''));
    }
  }
  const collapsed: string[] = [];
  for (const line of lines) {
    if (line.trim() === '' && (collapsed.length === 0 || collapsed[collapsed.length - 1] === '')) {
      continue;
    }
    collapsed.push(line);
  }
  while (collapsed.length > 0 && collapsed[collapsed.length - 1] === '') collapsed.pop();
  return collapsed.join('\n');
}

export function docxToText(buffer: Uint8Array): string {
  if (!looksLikeZip(buffer)) {
    throw new ZipError('docx-not-zip', '这个 .docx 不是 zip 容器（文件可能已经损坏）');
  }
  const xmlBytes = readZipEntry(buffer, 'word/document.xml');
  if (xmlBytes === null) {
    throw new ZipError('docx-no-body', '这个 .docx 里找不到 word/document.xml（可能不是 Word 文档）');
  }
  const xml = new TextDecoder('utf-8').decode(xmlBytes);
  const text = documentXmlToText(xml);
  if (text.trim() === '') {
    throw new ZipError('docx-empty', '这份 Word 文档里没有可提取的文字');
  }
  return text;
}
