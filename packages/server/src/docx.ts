import { zipArchive } from "./zip.ts";
import type { ZipFile } from "./zip.ts";

/**
 * 极小的 .docx 写入器：够把简历与报告写成 Word 能直接打开、能继续编辑的文件就行。
 *
 * 为什么不再用「HTML 换 .doc 后缀」那一招：Word 确实能打开，但它打开的是网页——
 * 段落是 div、缩进靠 CSS，用户点进去改两个字就发现版式全靠浏览器那套；
 * 招聘方那边「另存为 .doc 其实是个 HTML」也容易被当成可疑附件。
 * 真正的 .docx 是一个 zip 容器加几份固定 XML，写入这半步和 .xlsx 一样窄，
 * 照旧自己写，不引依赖（ADR-0007 同一条纪律）。容器复用 zip.ts 的写入器。
 *
 * 只实现「段落 + 行内格式」这一层：标题、正文、项目符号、引用、加粗、灰色、删除线、高亮。
 * 不碰表格、编号列表、页眉页脚——文档要好看是 Word 的事，这里只要它打开就对。
 *
 * 确定性：zip 头时间戳写死 1980-01-01，同一份输入两次导出逐字节相同（与 writeXlsx 同口径）。
 */

export interface DocxRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  /** 十六进制颜色，不带井号，例如 "6b7280" */
  color?: string;
  /** 字号，单位 pt；不写就用 docDefaults 里的 10.5pt */
  size?: number;
  /** OOXML 的 w:highlight 取值：green / yellow / cyan / none ... */
  highlight?: string;
}

export type DocxKind = "title" | "subtitle" | "heading" | "body" | "bullet" | "quote";

export interface DocxParagraph {
  runs: readonly DocxRun[];
  kind?: DocxKind;
  /** 二级/三级标题的层级：只在 kind 为 heading 时有意义 */
  level?: 1 | 2 | 3;
}

const DQ = '"';
const NL = String.fromCharCode(10);
const XML_HEAD = "<?xml version=" + DQ + "1.0" + DQ + " encoding=" + DQ + "UTF-8" + DQ + " standalone=" + DQ + "yes" + DQ + "?>" + NL;
const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
/** 正文默认字体：西文 Calibri、中文微软雅黑。写进 docDefaults，行内再按需覆盖 */
const BODY_FONT = "Microsoft YaHei";
/** 正文默认字号，单位 pt */
const BODY_SIZE = 10.5;
const GRAY = "6b7280";

function attr(name: string, value: string): string {
  return " " + name + "=" + DQ + escapeXml(value) + DQ;
}

/** XML 里只有这五个字符必须转义；控制字符会让 Word 判定文件损坏，一并丢掉 */
function escapeXml(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 && ch !== "\t" && ch !== "\n" && ch !== "\r") continue;
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === DQ) out += "&quot;";
    else out += ch;
  }
  return out;
}

function runXml(run: DocxRun): string {
  const props: string[] = [];
  props.push("<w:rFonts" + attr("w:ascii", "Calibri") + attr("w:hAnsi", "Calibri") + attr("w:eastAsia", BODY_FONT) + "/>");
  if (run.bold === true) props.push("<w:b/>");
  if (run.italic === true) props.push("<w:i/>");
  if (run.strike === true) props.push("<w:strike/>");
  if (run.color !== undefined) props.push("<w:color" + attr("w:val", run.color) + "/>");
  if (run.highlight !== undefined) props.push("<w:highlight" + attr("w:val", run.highlight) + "/>");
  // 字号只在行内明确要求时才写：段落类的字号归样式管，否则样式形同虚设
  if (run.size !== undefined) {
    const half = Math.round(run.size * 2);
    props.push("<w:sz" + attr("w:val", String(half)) + "/>");
    props.push("<w:szCs" + attr("w:val", String(half)) + "/>");
  }
  const pieces = run.text.split(NL);
  const body: string[] = [];
  for (let index = 0; index < pieces.length; index += 1) {
    if (index > 0) body.push("<w:br/>");
    body.push("<w:t xml:space=" + DQ + "preserve" + DQ + ">" + escapeXml(pieces[index] ?? "") + "</w:t>");
  }
  return "<w:r><w:rPr>" + props.join("") + "</w:rPr>" + body.join("") + "</w:r>";
}

/**
 * 段落挂在哪个 Word 内置样式上。
 *
 * 为什么要挂样式而不是只写直接格式：不挂样式，Word 的导航窗格与目录认不出这是一份
 * 有结构的文档（它只看到 215 个一模一样的「正文」段落），用户在「标题 2」上改一次
 * 字号也影响不到任何东西——那样的 .docx 后缀是真的，结构是假的。
 * 样式 ID 沿用 OOXML 的内置名（Title / Subtitle / Heading1..3 / Quote），
 * Heading 各自的 outlineLvl 就是导航窗格认的那一级。
 */
function styleIdOf(paragraph: DocxParagraph): string | null {
  const kind = paragraph.kind ?? "body";
  if (kind === "title") return "Title";
  if (kind === "subtitle") return "Subtitle";
  if (kind === "heading") return "Heading" + String(paragraph.level ?? 2);
  if (kind === "quote") return "Quote";
  return null;
}

function paragraphXml(paragraph: DocxParagraph): string {
  const kind = paragraph.kind ?? "body";
  const props: string[] = [];
  const styleId = styleIdOf(paragraph);
  if (styleId !== null) props.push("<w:pStyle" + attr("w:val", styleId) + "/>");
  // 只有没有样式的段落才在这里写版式：标题类的间距与字号都归样式管
  if (kind === "bullet") props.push("<w:spacing" + attr("w:before", "40") + attr("w:after", "40") + attr("w:line", "280") + attr("w:lineRule", "auto") + "/><w:ind" + attr("w:left", "420") + attr("w:hanging", "220") + "/>");
  else if (kind === "body") props.push("<w:spacing" + attr("w:before", "0") + attr("w:after", "80") + attr("w:line", "280") + attr("w:lineRule", "auto") + "/>");
  const runs = paragraph.runs.map(runXml).join("");
  return "<w:p><w:pPr>" + props.join("") + "</w:pPr>" + runs + "</w:p>";
}

interface StyleSpec {
  bold?: boolean;
  size?: number;
  color?: string;
  /** 大纲级别：Word 的导航窗格与目录就是按这个认层级的 */
  outline?: number;
  before?: number;
  after?: number;
  indent?: number;
  keepNext?: boolean;
}

function styleXml(id: string, name: string, spec: StyleSpec = {}): string {
  const rPr: string[] = ["<w:rFonts" + attr("w:ascii", "Calibri") + attr("w:hAnsi", "Calibri") + attr("w:eastAsia", BODY_FONT) + "/>"];
  if (spec.bold === true) rPr.push("<w:b/>");
  if (spec.color !== undefined) rPr.push("<w:color" + attr("w:val", spec.color) + "/>");
  if (spec.size !== undefined) {
    const half = String(Math.round(spec.size * 2));
    rPr.push("<w:sz" + attr("w:val", half) + "/><w:szCs" + attr("w:val", half) + "/>");
  }
  const pPr: string[] = [];
  const spacing: string[] = [];
  if (spec.before !== undefined) spacing.push(attr("w:before", String(spec.before)));
  if (spec.after !== undefined) spacing.push(attr("w:after", String(spec.after)));
  spacing.push(attr("w:line", "280"), attr("w:lineRule", "auto"));
  pPr.push("<w:spacing" + spacing.join("") + "/>");
  if (spec.indent !== undefined) pPr.push("<w:ind" + attr("w:left", String(spec.indent)) + "/>");
  if (spec.keepNext === true) pPr.push("<w:keepNext/>");
  if (spec.outline !== undefined) pPr.push("<w:outlineLvl" + attr("w:val", String(spec.outline)) + "/>");
  return (
    "<w:style" + attr("w:type", "paragraph") + attr("w:styleId", id) + ">" +
    "<w:name" + attr("w:val", name) + "/>" +
    "<w:basedOn" + attr("w:val", "Normal") + "/>" +
    "<w:next" + attr("w:val", "Normal") + "/>" +
    "<w:pPr>" + pPr.join("") + "</w:pPr>" +
    "<w:rPr>" + rPr.join("") + "</w:rPr>" +
    "</w:style>"
  );
}

const STYLES_XML =
  XML_HEAD +
  "<w:styles" + attr("xmlns:w", W_NS) + ">" +
  "<w:docDefaults><w:rPrDefault><w:rPr>" +
  "<w:rFonts" + attr("w:ascii", "Calibri") + attr("w:hAnsi", "Calibri") + attr("w:eastAsia", BODY_FONT) + "/>" +
  "<w:sz" + attr("w:val", String(Math.round(BODY_SIZE * 2))) + "/>" +
  "<w:szCs" + attr("w:val", String(Math.round(BODY_SIZE * 2))) + "/>" +
  "</w:rPr></w:rPrDefault>" +
  "<w:pPrDefault><w:pPr><w:spacing" + attr("w:after", "80") + attr("w:line", "280") + attr("w:lineRule", "auto") + "/></w:pPr></w:pPrDefault>" +
  "</w:docDefaults>" +
  "<w:style" + attr("w:type", "paragraph") + attr("w:default", "1") + attr("w:styleId", "Normal") + "><w:name" + attr("w:val", "Normal") + "/></w:style>" +
  styleXml("Title", "Title", { bold: true, size: 16, before: 0, after: 80, keepNext: true }) +
  styleXml("Subtitle", "Subtitle", { size: 9.5, color: GRAY, before: 0, after: 240 }) +
  styleXml("Heading1", "heading 1", { bold: true, size: 14, before: 300, after: 120, keepNext: true, outline: 0 }) +
  styleXml("Heading2", "heading 2", { bold: true, size: 12, before: 260, after: 100, keepNext: true, outline: 1 }) +
  styleXml("Heading3", "heading 3", { bold: true, size: 11, before: 220, after: 80, keepNext: true, outline: 2 }) +
  styleXml("Quote", "Quote", { color: GRAY, before: 60, after: 60, indent: 420 }) +
  "</w:styles>";

const CONTENT_TYPES_XML =
  XML_HEAD +
  "<Types" + attr("xmlns", "http://schemas.openxmlformats.org/package/2006/content-types") + ">" +
  "<Default" + attr("Extension", "rels") + attr("ContentType", "application/vnd.openxmlformats-package.relationships+xml") + "/>" +
  "<Default" + attr("Extension", "xml") + attr("ContentType", "application/xml") + "/>" +
  "<Override" + attr("PartName", "/word/document.xml") + attr("ContentType", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") + "/>" +
  "<Override" + attr("PartName", "/word/styles.xml") + attr("ContentType", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml") + "/>" +
  "</Types>";

const ROOT_RELS_XML =
  XML_HEAD +
  "<Relationships" + attr("xmlns", RELS_NS) + ">" +
  "<Relationship" + attr("Id", "rId1") + attr("Type", OFFICE_REL + "/officeDocument") + attr("Target", "word/document.xml") + "/>" +
  "</Relationships>";

const DOC_RELS_XML =
  XML_HEAD +
  "<Relationships" + attr("xmlns", RELS_NS) + ">" +
  "<Relationship" + attr("Id", "rId1") + attr("Type", OFFICE_REL + "/styles") + attr("Target", "styles.xml") + "/>" +
  "</Relationships>";

/** A4 纸，上下左右各 2cm（1134 twips ≈ 2cm），与导出的可打印 HTML 那份排版同量级 */
const SECTION_XML =
  "<w:sectPr>" +
  "<w:pgSz" + attr("w:w", "11906") + attr("w:h", "16838") + "/>" +
  "<w:pgMar" + attr("w:top", "1134") + attr("w:right", "1134") + attr("w:bottom", "1134") + attr("w:left", "1134") + "/>" +
  "</w:sectPr>";

export function writeDocx(paragraphs: readonly DocxParagraph[]): Buffer {
  const body = paragraphs.length === 0 ? "<w:p/>" : paragraphs.map(paragraphXml).join("");
  const documentXml =
    XML_HEAD +
    "<w:document" + attr("xmlns:w", W_NS) + "><w:body>" + body + SECTION_XML + "</w:body></w:document>";
  const files: ZipFile[] = [
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES_XML, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(ROOT_RELS_XML, "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(DOC_RELS_XML, "utf8") },
    { name: "word/styles.xml", data: Buffer.from(STYLES_XML, "utf8") },
  ];
  return zipArchive(files);
}

function textRun(text: string, extra: Omit<DocxRun, "text"> = {}): DocxRun {
  return { text, ...extra };
}

// 这几个辅助函数刻意不带字号与粗体：样式里已经写死了，行内再写一遍会把样式钉死，
// 用户在 Word 里改样式就没反应了。
export function titleParagraph(text: string): DocxParagraph {
  return { kind: "title", runs: [textRun(text)] };
}

export function subtitleParagraph(text: string): DocxParagraph {
  return { kind: "subtitle", runs: [textRun(text)] };
}

export function headingParagraph(text: string, level: 1 | 2 | 3 = 2): DocxParagraph {
  return { kind: "heading", level, runs: [textRun(text)] };
}

export function bodyParagraph(text: string): DocxParagraph {
  return { kind: "body", runs: [textRun(text)] };
}

export function bulletParagraph(text: string): DocxParagraph {
  return { kind: "bullet", runs: [textRun("• " + text)] };
}

export function quoteParagraph(text: string): DocxParagraph {
  return { kind: "quote", runs: [textRun(text)] };
}

export function noteParagraph(text: string, color = GRAY): DocxParagraph {
  return { kind: "body", runs: [textRun(text, { size: 9.5, color })] };
}

/** 行内 **加粗**：够用就好，不引 Markdown 解析器 */
function inlineRuns(text: string, extra: Omit<DocxRun, "text"> = {}): DocxRun[] {
  const out: DocxRun[] = [];
  const parts = text.split("**");
  for (let index = 0; index < parts.length; index += 1) {
    const piece = parts[index] ?? "";
    if (piece === "") continue;
    const bold = index % 2 === 1;
    out.push(bold ? textRun(piece, { ...extra, bold: true }) : textRun(piece, extra));
  }
  return out.length === 0 ? [textRun("", extra)] : out;
}

function isTableRule(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line);
}

function tableCells(line: string): string[] {
  const trimmed = line.replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

/**
 * 把报告用的 Markdown 转成段落：标题、项目符号、引用、表格行、正文。
 * 只认报告实际会产出的那几种形状，遇到不认识的行按正文处理——
 * 宁可多几行普通文字，也不要在这里做一套完整的 Markdown 语义。
 */
export function markdownParagraphs(markdown: string): DocxParagraph[] {
  const lines = markdown.split(/\r?\n/);
  const out: DocxParagraph[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = (lines[index] ?? "").trim();
    if (line === "") {
      index += 1;
      continue;
    }
    const head = /^(#{1,3})\s+(.*)$/.exec(line);
    if (head !== null) {
      out.push(headingParagraph((head[2] ?? "").trim(), (head[1] ?? "#").length as 1 | 2 | 3));
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      while (index < lines.length) {
        const item = (lines[index] ?? "").trim();
        if (!/^[-*]\s+/.test(item)) break;
        out.push({ kind: "bullet", runs: inlineRuns(item.replace(/^[-*]\s+/, "")) });
        index += 1;
      }
      continue;
    }
    if (/^>\s?/.test(line)) {
      while (index < lines.length) {
        const item = (lines[index] ?? "").trim();
        if (!/^>\s?/.test(item)) break;
        out.push(quoteParagraph(item.replace(/^>\s?/, "")));
        index += 1;
      }
      continue;
    }
    if (line.startsWith("|")) {
      while (index < lines.length) {
        const item = (lines[index] ?? "").trim();
        if (!item.startsWith("|")) break;
        index += 1;
        if (isTableRule(item)) continue;
        const cells = tableCells(item);
        const head0 = cells[0] ?? "";
        const rest = cells.slice(1).filter((cell) => cell !== "");
        out.push({ kind: "body", runs: [...inlineRuns(head0, { bold: true }), ...(rest.length === 0 ? [] : inlineRuns("：" + rest.join(" / ")))] });
      }
      continue;
    }
    const block: string[] = [];
    while (index < lines.length) {
      const item = (lines[index] ?? "").trim();
      if (item === "" || item.startsWith("|") || item.startsWith("#") || /^[-*]\s+/.test(item) || /^>\s?/.test(item)) break;
      block.push(item);
      index += 1;
    }
    out.push({ kind: "body", runs: inlineRuns(block.join(" ")) });
  }
  return out;
}
