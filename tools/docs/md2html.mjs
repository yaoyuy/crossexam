/**
 * 极简 Markdown → HTML 渲染器（零依赖）。
 *
 * 为什么自己写而不引 marked/markdown-it：这份技术文档要能在评委机器上
 * 用一条命令重新生成，多一个依赖就多一个复现失败点；而技术文档用到的语法
 * 只有十来种，实现它们比维护依赖树便宜。
 *
 * 支持的语法：标题、段落、围栏代码、行内代码、粗体/斜体/删除线、链接、
 * 表格（含对齐）、有序/无序列表（含缩进嵌套）、引用块、分隔线、图片。
 * 不追求 CommonMark 兼容，够用、可读、可测即可。
 */

const BT = String.fromCharCode(96);

/** HTML 转义。文本节点与属性值都走这里，避免文档里出现裸 < 时把结构搞坏。 */
export function escapeHtml(input) {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 行内语法。先抠出行内代码，避免代码里的星号与下划线被当成强调。 */
export function renderInline(text) {
  const spans = [];
  let out = escapeHtml(text);
  const codePattern = new RegExp(BT + '([^' + BT + ']+)' + BT, 'g');
  out = out.replace(codePattern, (whole, code) => {
    spans.push(code);
    return String.fromCharCode(0) + String(spans.length - 1) + String.fromCharCode(0);
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(new RegExp(String.fromCharCode(0) + '([0-9]+)' + String.fromCharCode(0), 'g'), (whole, index) => {
    return '<code>' + spans[Number(index)] + '</code>';
  });
  return out;
}

const FENCE = /^(\x60{3,}|~{3,})\s*([A-Za-z0-9_+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const UL_ITEM = /^(\s*)[-*+]\s+(.*)$/;
const OL_ITEM = /^(\s*)([0-9]+)[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const IMAGE = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/;

function isTableStart(lines, index) {
  const head = lines[index];
  const sep = lines[index + 1];
  if (head === undefined || sep === undefined) return false;
  if (head.indexOf('|') < 0) return false;
  return TABLE_SEP.test(sep);
}

function splitRow(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  return text.split('|').map((cell) => cell.trim());
}

function alignments(sep) {
  return splitRow(sep).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });
}

function renderTable(lines, start) {
  const head = splitRow(lines[start]);
  const align = alignments(lines[start + 1]);
  const rows = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() !== '' && lines[i].indexOf('|') >= 0) {
    rows.push(splitRow(lines[i]));
    i += 1;
  }
  const cell = (tag, text, index) => {
    const style = align[index] ? ' style="text-align:' + align[index] + '"' : '';
    return '<' + tag + style + '>' + renderInline(text) + '</' + tag + '>';
  };
  const parts = ['<table>', '<thead><tr>'];
  head.forEach((text, index) => parts.push(cell('th', text, index)));
  parts.push('</tr></thead>', '<tbody>');
  for (const row of rows) {
    parts.push('<tr>');
    for (let index = 0; index < head.length; index += 1) parts.push(cell('td', row[index] ?? '', index));
    parts.push('</tr>');
  }
  parts.push('</tbody></table>');
  return { html: parts.join(''), next: i };
}

/** 列表：靠缩进判断嵌套，无序与有序各自成栈。 */
function renderList(lines, start) {
  const items = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      const next = lines[i + 1];
      const continues = next !== undefined && (UL_ITEM.test(next) || OL_ITEM.test(next));
      if (!continues) break;
      i += 1;
      continue;
    }
    const ul = UL_ITEM.exec(line);
    const ol = OL_ITEM.exec(line);
    if (ul === null && ol === null) break;
    const indent = (ul ?? ol)[1].length;
    const ordered = ol !== null;
    const text = ordered ? ol[3] : ul[2];
    items.push({ indent, ordered, text });
    i += 1;
  }

  // 栈里必须同时存标签与缩进：只存标签的话 `item.indent < 'ul'` 永远是 false，
  // 嵌套列表会被静默压平成同一层（这个 bug 由 md2html.test.mjs 的嵌套用例抓出来）。
  const html = [];
  const stack = [];
  const close = (frame) => html.push(frame.tag === 'ol' ? '</ol>' : '</ul>');
  const open = (tag) => html.push(tag === 'ol' ? '<ol>' : '<ul>');
  for (const item of items) {
    const tag = item.ordered ? 'ol' : 'ul';
    while (stack.length > 0 && item.indent < stack[stack.length - 1].indent) {
      close(stack.pop());
    }
    const top = stack[stack.length - 1];
    if (top === undefined || item.indent > top.indent) {
      stack.push({ tag, indent: item.indent });
      open(tag);
    } else if (top.tag !== tag) {
      close(stack.pop());
      stack.push({ tag, indent: item.indent });
      open(tag);
    }
    html.push('<li>' + renderInline(item.text) + '</li>');
  }
  while (stack.length > 0) close(stack.pop());
  return { html: html.join(''), next: i };
}

/**
 * 渲染整篇文档。
 * @param {string} markdown
 * @param {{ rewriteImage?: (src: string) => string }} options
 */
export function renderMarkdown(markdown, options = {}) {
  const rewriteImage = options.rewriteImage ?? ((src) => src);
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const marker = fence[1].slice(0, 3);
      const lang = fence[2];
      const body = [];
      i += 1;
      while (i < lines.length && lines[i].trim().startsWith(marker) === false) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      const cls = lang ? ' class="lang-' + escapeHtml(lang) + '"' : '';
      out.push('<pre><code' + cls + '>' + escapeHtml(body.join('\n')) + '</code></pre>');
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      const level = heading[1].length;
      out.push('<h' + level + '>' + renderInline(heading[2]) + '</h' + level + '>');
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      const table = renderTable(lines, i);
      out.push(table.html);
      i = table.next;
      continue;
    }

    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(QUOTE.exec(lines[i])[1]);
        i += 1;
      }
      out.push('<blockquote>' + renderMarkdown(body.join('\n'), options) + '</blockquote>');
      continue;
    }

    if (UL_ITEM.test(line) || OL_ITEM.test(line)) {
      const list = renderList(lines, i);
      out.push(list.html);
      i = list.next;
      continue;
    }

    const image = IMAGE.exec(line);
    if (image !== null) {
      out.push('<p class="figure"><img src="' + escapeHtml(rewriteImage(image[2])) + '" alt="' + escapeHtml(image[1]) + '"></p>');
      i += 1;
      continue;
    }

    const paragraph = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      if (next.trim() === '') break;
      if (FENCE.test(next) || HEADING.test(next) || HR.test(next) || QUOTE.test(next)) break;
      if (UL_ITEM.test(next) || OL_ITEM.test(next)) break;
      if (isTableStart(lines, i)) break;
      if (IMAGE.test(next)) break;
      paragraph.push(next);
      i += 1;
    }
    out.push('<p>' + renderInline(paragraph.join('\n')) + '</p>');
  }

  return out.join('\n');
}