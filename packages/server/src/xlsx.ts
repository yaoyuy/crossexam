import { zipArchive } from "./zip.ts";
import type { ZipFile } from "./zip.ts";

/** crc32 与 zip 容器搬到了 zip.ts（docx 也走同一个写入器）；这里重新导出，测试与调用方不变 */
export { crc32 } from "./zip.ts";

/** 双引号字符：XML 属性里到处要用，用常量代替在一行里连着写三个转义引号 */
const DQ = '"';

/**
 * 极小的 .xlsx 写入器：够把一张台账写成 Excel 能打开的文件就行。
 *
 * 为什么自己写而不是装 exceljs / xlsx：项目对依赖的纪律是「十分钟复现不许被依赖毁掉」——
 * 少一个依赖就少一个复现失败点（老 .doc 的解析当初就是这么砍掉的，见 ADR-0007）。
 * 而这里要产出的东西很窄：几张只有表头和纯文本 / 数字的表，不要公式、样式与图表。
 * OOXML 能被打开的最小集合是固定的五份 XML 加一个 zip 容器；
 * import/zip.ts 里已经有一个只读解析器，写入这半边独立放在这里，两者互不依赖。
 *
 * 确定性：zip 头里的时间戳写死 1980-01-01，同一份输入两次导出逐字节相同——
 * 否则每次导出都会在版本库里留下一个「变了但其实没变」的文件。
 */

/** 一张表：表头、行、可选列宽（单位是字符数） */
export interface SheetSpec {
  name: string;
  columns: readonly string[];
  rows: readonly (readonly (string | number | null)[])[];
  widths?: readonly number[];
}

const NL = String.fromCharCode(10);
const XML_HEAD = "<?xml version=" + DQ + "1.0" + DQ + " encoding=" + DQ + "UTF-8" + DQ + " standalone=" + DQ + "yes" + DQ + "?>" + NL;
const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const STYLES_XML =
  XML_HEAD +
  "<styleSheet" + attr("xmlns", MAIN_NS) + ">" +
  "<fonts" + attr("count", "2") + ">" +
  "<font><sz" + attr("val", "11") + "/><name" + attr("val", "Calibri") + "/></font>" +
  "<font><b/><sz" + attr("val", "11") + "/><name" + attr("val", "Calibri") + "/></font>" +
  "</fonts>" +
  "<fills" + attr("count", "2") + ">" + "<fill><patternFill" + attr("patternType", "none") + "/></fill>" + "<fill><patternFill" + attr("patternType", "gray125") + "/></fill>" + "</fills>" +
  "<borders" + attr("count", "1") + "><border/></borders>" +
  "<cellStyleXfs" + attr("count", "1") + ">" + "<xf" + attr("numFmtId", "0") + attr("fontId", "0") + attr("fillId", "0") + attr("borderId", "0") + "/></cellStyleXfs>" +
  "<cellXfs" + attr("count", "2") + ">" + "<xf" + attr("numFmtId", "0") + attr("fontId", "0") + attr("fillId", "0") + attr("borderId", "0") + attr("xfId", "0") + "/>" + "<xf" + attr("numFmtId", "0") + attr("fontId", "1") + attr("fillId", "0") + attr("borderId", "0") + attr("xfId", "0") + attr("applyFont", "1") + "/></cellXfs>" +
  // cellStyles 这行是给读者看的：少了它 openpyxl 会警告「Workbook contains no default style」
  "<cellStyles" + attr("count", "1") + "><cellStyle" + attr("name", "Normal") + attr("xfId", "0") + attr("builtinId", "0") + "/></cellStyles>" +
  "</styleSheet>";
/** Excel 单元格正文上限约 32767 字符，超了会被判成损坏文件 */
const MAX_CELL_CHARS = 32000;
function escapeXml(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 && ch !== "\t" && ch !== "\n" && ch !== "\r") continue;
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === DQ) out += "&quot;";
    else if (ch === String.fromCharCode(39)) out += "&apos;";
    else out += ch;
  }
  return out;
}

function clip(text: string): string {
  return text.length <= MAX_CELL_CHARS ? text : text.slice(0, MAX_CELL_CHARS - 1) + "…";
}

function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function attr(name: string, value: string): string {
  return " " + name + "=" + DQ + escapeXml(value) + DQ;
}

function cellXml(column: number, row: number, value: string | number | null, style: number): string {
  if (value === null) return "";
  const ref = columnName(column) + String(row);
  const styleAttr = style === 0 ? "" : attr("s", String(style));
  if (typeof value === "number") {
    return Number.isFinite(value) ? "<c" + attr("r", ref) + styleAttr + "><v>" + String(value) + "</v></c>" : "";
  }
  const text = value.length === 0 ? "" : clip(escapeXml(value));
  return "<c" + attr("r", ref) + attr("t", "inlineStr") + styleAttr + "><is><t" + attr("xml:space", "preserve") + ">" + text + "</t></is></c>";
}

/** 表名规则来自 Excel：31 字符上限，且不允许 : \\ / ? * [ ] 这几个字符 */
export function safeSheetName(raw: string, fallback: string): string {
  let name = raw.replace(/[:\\/?*\[\]]/g, " ").trim();
  if (name.length === 0) name = fallback;
  return name.length <= 31 ? name : name.slice(0, 31);
}

function sheetXml(sheet: SheetSpec): string {
  const cols: string[] = [];
  const widths = sheet.widths ?? [];
  for (let index = 0; index < sheet.columns.length; index += 1) {
    const width = widths[index];
    if (width === undefined) continue;
    const min = String(index + 1);
    cols.push("<col" + attr("min", min) + attr("max", min) + attr("width", String(width)) + attr("customWidth", "1") + "/>");
  }
  const rows: string[] = [];
  rows.push("<row" + attr("r", "1") + ">" + sheet.columns.map((label, index) => cellXml(index, 1, label, 1)).join("") + "</row>");
  for (let index = 0; index < sheet.rows.length; index += 1) {
    const line = sheet.rows[index] ?? [];
    rows.push("<row" + attr("r", String(index + 2)) + ">" + line.map((value, column) => cellXml(column, index + 2, value, 0)).join("") + "</row>");
  }
  return (
    XML_HEAD +
    "<worksheet" + attr("xmlns", MAIN_NS) + ">" +
    "<sheetViews><sheetView" + attr("workbookViewId", "0") + "><pane" + attr("ySplit", "1") + attr("topLeftCell", "A2") + attr("activePane", "bottomLeft") + attr("state", "frozen") + "/></sheetView></sheetViews>" +
    (cols.length === 0 ? "" : "<cols>" + cols.join("") + "</cols>") +
    "<sheetData>" + rows.join("") + "</sheetData>" +
    "</worksheet>"
  );
}

function contentTypesXml(count: number): string {
  const overrides: string[] = [];
  overrides.push("<Override" + attr("PartName", "/xl/workbook.xml") + attr("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml") + "/>");
  overrides.push("<Override" + attr("PartName", "/xl/styles.xml") + attr("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml") + "/>");
  for (let index = 0; index < count; index += 1) {
    overrides.push("<Override" + attr("PartName", "/xl/worksheets/sheet" + String(index + 1) + ".xml") + attr("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml") + "/>");
  }
  return (
    XML_HEAD +
    "<Types" + attr("xmlns", "http://schemas.openxmlformats.org/package/2006/content-types") + ">" +
    "<Default" + attr("Extension", "rels") + attr("ContentType", "application/vnd.openxmlformats-package.relationships+xml") + "/>" +
    "<Default" + attr("Extension", "xml") + attr("ContentType", "application/xml") + "/>" +
    overrides.join("") +
    "</Types>"
  );
}

function rootRelsXml(): string {
  return (
    XML_HEAD +
    "<Relationships" + attr("xmlns", RELS_NS) + ">" +
    "<Relationship" + attr("Id", "rId1") + attr("Type", DOC_REL + "/officeDocument") + attr("Target", "xl/workbook.xml") + "/>" +
    "</Relationships>"
  );
}

function workbookXml(names: readonly string[]): string {
  const sheets = names
    .map((name, index) => "<sheet" + attr("name", name) + attr("sheetId", String(index + 1)) + attr("r:id", "rId" + String(index + 1)) + "/>")
    .join("");
  return (
    XML_HEAD +
    "<workbook" + attr("xmlns", MAIN_NS) + attr("xmlns:r", DOC_REL) + ">" +
    "<sheets>" + sheets + "</sheets>" +
    "</workbook>"
  );
}

function workbookRelsXml(count: number): string {
  const rels: string[] = [];
  for (let index = 0; index < count; index += 1) {
    rels.push("<Relationship" + attr("Id", "rId" + String(index + 1)) + attr("Type", DOC_REL + "/worksheet") + attr("Target", "worksheets/sheet" + String(index + 1) + ".xml") + "/>");
  }
  rels.push("<Relationship" + attr("Id", "rId" + String(count + 1)) + attr("Type", DOC_REL + "/styles") + attr("Target", "styles.xml") + "/>");
  return XML_HEAD + "<Relationships" + attr("xmlns", RELS_NS) + ">" + rels.join("") + "</Relationships>";
}

export function writeXlsx(sheets: readonly SheetSpec[]): Buffer {
  if (sheets.length === 0) throw new Error("至少要有一张表");
  const names = sheets.map((sheet, index) => safeSheetName(sheet.name, "表" + String(index + 1)));
  const files: ZipFile[] = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml(sheets.length), "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRelsXml(), "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml(names), "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRelsXml(sheets.length), "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(STYLES_XML, "utf8") },
  ];
  for (let index = 0; index < sheets.length; index += 1) {
    const sheet = sheets[index];
    if (sheet === undefined) continue;
    files.push({ name: "xl/worksheets/sheet" + String(index + 1) + ".xml", data: Buffer.from(sheetXml(sheet), "utf8") });
  }
  return zipArchive(files);
}
