/**
 * 把时间线渲染成 Markdown —— 这是提交物 #2（Prompt 链）的最终形态。
 *
 * 渲染原则：
 * 1. 用户的原始提问**一字不改、不做截断**——这是意图控制策略的一手证据。
 * 2. AI 的回复与推理过程也保留（评委明确要「思考可视化」）。
 * 3. 工具调用不倾倒 JSON，而是抽出最有信息量的字段做摘要；其余标为已省略。
 * 4. 每一节都带时间戳，方便和演示视频对轴。
 */
import { truncateText } from './text.mjs';

const TICK = String.fromCharCode(96);
const FENCE = TICK + TICK + TICK;

function fmtTime(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
    p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function fmtClock(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function inline(s, max) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (max && t.length > max) return t.slice(0, max) + '…';
  return t;
}

/**
 * 把工具参数压成「够看懂、又不淹没正文」的几行。
 * 不同工具有不同的关键字段，逐个认脸比无脑 JSON.stringify 有用得多。
 */
export function summarizeToolArgs(name, rawArgs, maxChars) {
  const max = maxChars ?? 600;
  let obj = null;
  if (rawArgs) {
    try { obj = JSON.parse(rawArgs); } catch { obj = null; }
  }
  if (!obj || typeof obj !== 'object') {
    const t = truncateText(String(rawArgs || '').trim(), max);
    return t.truncated ? [t.text, '(参数非 JSON，已截断)'] : [t.text];
  }

  const lines = [];
  const push = (label, value, limit) => {
    if (value === undefined || value === null || value === '') return;
    lines.push('- ' + label + '：' + inline(value, limit || 160));
  };

  if (obj.description) push('说明', obj.description, 200);
  if (obj.command) push('命令', obj.command, 300);
  if (obj.script_path) push('脚本', obj.script_path);
  if (obj.file_path || obj.path) push('路径', obj.file_path || obj.path);
  if (obj.workdir) push('工作目录', obj.workdir);
  if (obj.pattern) push('模式', obj.pattern);
  if (Array.isArray(obj.queries)) push('查询', obj.queries.join(' | '), 300);
  if (obj.query) push('查询', obj.query, 200);
  if (obj.url) push('URL', obj.url, 200);
  if (obj.cd) push('进入目录', obj.cd);
  if (obj.to) push('收件人', obj.to);
  if (obj.content && !obj.code) {
    const c = truncateText(String(obj.content), 300);
    lines.push('- 正文：' + c.text.replace(/\n/g, ' ⏎ '));
  }
  if (obj.code) {
    const c = truncateText(String(obj.code), max);
    lines.push('- 代码：');
    lines.push(FENCE + 'js');
    lines.push(c.text);
    lines.push(FENCE);
  }

  // 没认出任何关键字段就退化成紧凑 JSON
  if (lines.length === 0) {
    const t = truncateText(JSON.stringify(obj, null, 2), max);
    lines.push(FENCE + 'json');
    lines.push(t.text);
    lines.push(FENCE);
  }

  // 顺带记录这次调用改动了哪些文件（如果有）
  const touched = [];
  for (const k of ['file_path', 'path', 'script_path', 'output', 'file']) {
    if (typeof obj[k] === 'string' && obj[k]) touched.push(obj[k]);
  }
  return lines;
}

function renderTool(entry, opts) {
  const out = [];
  const head = '**🔧 ' + TICK + entry.name + TICK + '**' + (entry.at ? ' <sub>' + fmtClock(entry.at) + '</sub>' : '');
  out.push(head);
  out.push('');
  const argLines = summarizeToolArgs(entry.name, entry.rawArgs, opts.maxArgChars);
  if (argLines.length) {
    out.push(argLines.join('\n'));
    out.push('');
  }
  if (entry.subCalls && entry.subCalls.length) {
    out.push('<details><summary>本次调用内部实际执行了 ' + entry.subCalls.length + ' 个子操作</summary>');
    out.push('');
    for (const s of entry.subCalls) {
      // 摘要本来就带列表符号，内联时要去掉，否则出现 "- tool — - 字段：值"
      const brief = summarizeToolArgs(s.name, s.rawArgs, 160)
        .map((x) => x.replace(/^[-*]\s+/, ''))
        .join(' · ')
        .replace(/\s+/g, ' ');
      out.push('- ' + (s.isError ? '❌ ' : '') + TICK + s.name + TICK + ' — ' + inline(brief, 200));
    }
    out.push('');
    out.push('</details>');
    out.push('');
  }
  if (entry.result) {
    const max = opts.maxResultChars;
    const shown = truncateText(entry.result.text, max);
    out.push('<details><summary>' + (entry.isError ? '❌ 执行失败' : '✅ 执行结果') +
      '（原始 ' + entry.result.fullLength + ' 字符' + (shown.truncated ? '，已折叠' : '') + '）</summary>');
    out.push('');
    out.push(FENCE + 'text');
    out.push(shown.text);
    out.push(FENCE);
    out.push('');
    out.push('</details>');
    out.push('');
  }
  return out.join('\n');
}

/**
 * @param {{ meta: object, turns: any[], usage: object }} session
 * @param {{ maxArgChars?: number, maxResultChars?: number, header?: string }} [opts]
 */
export function renderMarkdown(session, opts) {
  const o = opts || {};
  const meta = session.meta || {};
  const L = [];

  L.push('# ' + (meta.title || '未命名会话'));
  L.push('');
  if (o.header) { L.push('> ' + o.header); L.push(''); }
  L.push('| 项 | 值 |');
  L.push('| --- | --- |');
  L.push('| 会话 ID | ' + TICK + (meta.id || '-') + TICK + ' |');
  L.push('| 工作目录 | ' + TICK + (meta.cwd || '-') + TICK + ' |');
  L.push('| 模型 | ' + (meta.provider ? meta.provider + ' / ' : '') + (meta.model || '-') + ' |');
  L.push('| 起始时间 | ' + fmtTime(meta.createdAt) + ' |');
  L.push('| 结束时间 | ' + fmtTime(meta.updatedAt) + ' |');
  L.push('| 真人提问 | ' + (meta.humanMessageCount ?? 0) + ' 次 |');
  L.push('| 事件总数 | ' + (meta.eventCount ?? 0) + ' |');
  const u = session.usage || {};
  L.push('| Token | 输入 ' + (u.inputTokens || 0) + ' / 输出 ' + (u.outputTokens || 0) +
    ' / 缓存命中 ' + (u.cacheReadTokens || 0) + ' / 推理 ' + (u.reasoningTokens || 0) + ' |');
  L.push('');
  L.push('---');
  L.push('');

  for (const t of session.turns) {
    const hasContent = t.entries.some((e) => e.kind !== 'note');
    if (!hasContent) continue;
    L.push('## Turn ' + t.index + (t.startedAt ? '  <sub>' + fmtTime(t.startedAt) + '</sub>' : ''));
    L.push('');
    for (const e of t.entries) {
      if (e.kind === 'user') {
        L.push(e.isHuman ? '### 👤 用户提问' : '### ⚙️ 系统注入（' + e.sourceKind + '）');
        L.push('');
        L.push(e.text.trim());
        L.push('');
      } else if (e.kind === 'reasoning') {
        L.push('<details><summary>🧠 思考过程</summary>');
        L.push('');
        L.push(e.text.trim());
        L.push('');
        L.push('</details>');
        L.push('');
      } else if (e.kind === 'assistant') {
        L.push('### 🤖 AI 回复');
        L.push('');
        L.push(e.text.trim());
        L.push('');
      } else if (e.kind === 'tool') {
        L.push(renderTool(e, { maxArgChars: o.maxArgChars ?? 600, maxResultChars: o.maxResultChars ?? 1200 }));
        L.push('');
      } else if (e.kind === 'note') {
        L.push('> ' + e.text);
        L.push('');
      }
    }
    L.push('---');
    L.push('');
  }

  return L.join('\n');
}

/** 生成索引 Markdown */
export function renderIndex(entries) {
  const L = [];
  L.push('# Prompt 链快照索引');
  L.push('');
  L.push('本目录下的每一份 Markdown 都由 ' + TICK + 'npm run export:prompt' + TICK + ' 从 DSH 会话日志自动导出，');
  L.push('**不是事后补写的**——包含完整的用户提问原文、AI 回复、思考过程与工具调用。');
  L.push('');
  L.push('生成命令：');
  L.push('');
  L.push(FENCE + 'bash');
  L.push('npm run export:prompt');
  L.push(FENCE);
  L.push('');
  L.push('| 日期 | 会话 | 真人提问 | 文件 |');
  L.push('| --- | --- | --- | --- |');
  for (const e of entries) {
    L.push('| ' + (e.date || '-') + ' | ' + inline(e.title || '未命名', 40) + ' | ' +
      (e.humanMessageCount ?? 0) + ' | [' + e.fileName + '](./' + e.fileName + ') |');
  }
  L.push('');
  return L.join('\n');
}
