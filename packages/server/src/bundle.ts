/**
 * 把一整场质询打包成一个**不引用任何外部资源**的单文件 HTML。
 *
 * 与 report-html.ts 的关系：那份是「报告」，读者是评委/HR；这一份是「档案」，读者是收到文件的人。
 * 它除了报告正文，还带上时间线（每个阶段什么时候跑、跑了多久）、简历原文与改完的版本、
 * 以及这台的隐私口径——一个文件扔进微信里，对方双击就能看完整场，断网也一样。
 *
 * 为什么不用图片 base64：没有图片。整份文件只有内联样式与内联脚本，
 * 因此有一条硬规矩可以由代码守住：**输出里不许出现 http:// 或 https://**（见 findings F71）。
 */

import { applyRevisions, movedSpans } from '@crossexam/shared';
import type { Revision } from '@crossexam/shared';
import { renderReportHtml, STYLE } from './report-html.ts';
import type { CompareView } from './compare.ts';
import type { EventRow } from './store/index.ts';
import type { SessionView } from './pipeline.ts';

const NL = String.fromCharCode(10);

export interface BundleOptions {
  /** 已采纳的改写：给了才有「本版改动」一节 */
  applied?: readonly Revision[];
  /** 上一版对比：与报告同源，传 null 就整节不出现 */
  compare?: CompareView | null;
  /** 这场的事件流：时间线由它生成；不传就跳过时间线 */
  events?: readonly EventRow[];
}

/** 时间线里只摆「有意义的时刻」，逐条事件会变成几百行没人读的日志 */
const TIMELINE_KINDS = ['stage', 'claims', 'requirements', 'probes', 'verdicts', 'suggestions', 'counter', 'error'] as const;

const KIND_LABEL: Record<string, string> = {
  stage: '阶段开始',
  claims: '抽出主张',
  requirements: '岗位要求对照',
  probes: '一轮追问',
  answers: '一轮作答',
  budget: '预算记账',
  verdicts: '给出判定',
  suggestions: '反推改写',
  counter: '轮到你了',
  error: '出了问题',
};

/** 阶段名 → 人话。事件里存的是英文键名（编排层的标识符），打包出去要给人读 */
const STAGE_LABEL: Record<string, string> = {
  extract: '抽取主张',
  'jd-extract': '读岗位要求',
  'jd-merge': '归并同类要求',
  'jd-match': '要求对照简历',
  probe: '并发追问',
  answer: '求职者作答',
  verdict: '给出判定',
  suggest: '反推改写',
  counter: '轮到你反问',
};

const BUNDLE_CSS = [
  '.bundle-nav { position: sticky; top: 0; z-index: 5; background: rgba(255,255,255,0.96);',
  '  border-bottom: 1px solid #e5e7eb; margin: 0 -30px 18px; padding: 8px 30px; font-size: 12.5px; }',
  '.bundle-nav a { color: #0f766e; text-decoration: none; margin-right: 14px; }',
  '.bundle-nav a:hover { text-decoration: underline; }',
  '.privacy { background: #f0fdf4; border-left: 3px solid #0f766e; padding: 10px 14px; margin: 14px 0 4px;',
  '  font-size: 12.5px; color: #14532d; }',
  'ol.timeline { margin: 8px 0 0; padding-left: 20px; font-size: 12.5px; }',
  'ol.timeline li { margin: 3px 0; }',
  'ol.timeline .at { color: #9ca3af; font-family: Consolas, "Courier New", monospace; margin-right: 8px; }',
  'ol.timeline .what { color: #6b7280; }',
  'pre.text { white-space: pre-wrap; word-break: break-word; background: #f9fafb; border: 1px solid #e5e7eb;',
  '  border-radius: 8px; padding: 12px 14px; font-size: 13px; line-height: 1.75;',
  '  font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif; }',
  'pre.text mark { background: #dcfce7; color: #14532d; padding: 0 1px; border-radius: 2px; }',
  '@media print { .bundle-nav { display: none; } }',
].join(NL);

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 采纳过的区间在新文本里的坐标 → 给简历原文标绿。区间由 spans 给，不在这里重算 */
function highlightText(text: string, spans: readonly Revision[]): string {
  if (spans.length === 0) return esc(text);
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: string[] = [];
  let at = 0;
  for (const span of sorted) {
    if (span.start < at || span.end > text.length) continue;
    out.push(esc(text.slice(at, span.start)));
    out.push('<mark>' + esc(text.slice(span.start, span.end)) + '</mark>');
    at = span.end;
  }
  out.push(esc(text.slice(at)));
  return out.join('');
}

function clockOf(iso: string): string {
  const match = /T(\d{2}:\d{2}:\d{2})/.exec(iso);
  return match === null ? iso : String(match[1]);
}

function timelineSection(events: readonly EventRow[]): string[] {
  const rows = events.filter((row) => (TIMELINE_KINDS as readonly string[]).includes(row.kind));
  if (rows.length === 0) return [];
  const out: string[] = ['<h2>附二、这一场是怎么跑出来的</h2>'];
  out.push('<p class="tagline">事件的原始记录，未做删改。每个阶段都有开始时刻与产物，'
    + '跑得慢的地方一眼能看出来。</p>');
  out.push('<ol class="timeline">');
  for (const row of rows) {
    const label = KIND_LABEL[row.kind] ?? row.kind;
    const detail = detailOf(row);
    out.push('<li><span class="at">' + esc(clockOf(row.createdAt)) + '</span>'
      + '<strong>' + esc(label) + '</strong>'
      + (detail === '' ? '' : '<span class="what"> · ' + esc(detail) + '</span>') + '</li>');
  }
  out.push('</ol>');
  return out;
}

/** 每种事件挑一句人话：数字比英文键名有用，但也不能把整包 payload 倒出来 */
function detailOf(row: EventRow): string {
  const payload = row.payload;
  if (row.kind === 'stage') {
    const raw = typeof payload['stage'] === 'string' ? String(payload['stage']) : '';
    const stage = STAGE_LABEL[raw] ?? raw;
    const round = typeof payload['round'] === 'number' ? Number(payload['round']) : null;
    return round === null ? stage : stage + '（第 ' + String(round) + ' 轮）';
  }
  if (row.kind === 'claims') {
    const claims = Array.isArray(payload['claims']) ? payload['claims'] : [];
    return String(claims.length) + ' 条主张';
  }
  if (row.kind === 'probes') {
    const probes = Array.isArray(payload['probes']) ? payload['probes'] : [];
    return String(probes.length) + ' 条追问';
  }
  if (row.kind === 'verdicts') {
    const verdicts = Array.isArray(payload['verdicts']) ? payload['verdicts'] : [];
    return String(verdicts.length) + ' 条判定';
  }
  if (row.kind === 'suggestions') {
    const items = Array.isArray(payload['suggestions']) ? payload['suggestions'] : [];
    return String(items.length) + ' 条改写建议';
  }
  if (row.kind === 'counter') {
    const items = Array.isArray(payload['counters']) ? payload['counters'] : [];
    return String(items.length) + ' 句反问';
  }
  if (row.kind === 'error') {
    return typeof payload['message'] === 'string' ? String(payload['message']) : '';
  }
  return '';
}

function resumeSection(view: SessionView, applied: readonly Revision[]): string[] {
  const out: string[] = ['<h2>附一、简历原文' + (applied.length > 0 ? '（含本版改动）' : '') + '</h2>'];
  if (applied.length === 0) {
    out.push('<pre class="text">' + esc(view.session.resumeText) + '</pre>');
    return out;
  }
  // 与 revisions.ts 的 toView 同一条路：先按原文重算，再把区间平移到新文本坐标。
  // 不读库里的 revised_resume：打包要能被独立调用，输入只有 SessionView 与 applied。
  const revised = applyRevisions(view.session.resumeText, applied);
  const spans = movedSpans(revised.applied);
  out.push('<p class="tagline">标绿的部分是这一版采纳过的改动，共 ' + String(applied.length) + ' 处；'
    + '没有标绿的原文一个字都没有动。</p>');
  out.push('<pre class="text">' + highlightText(revised.text, spans) + '</pre>');
  return out;
}

export function renderBundleHtml(view: SessionView, options: BundleOptions = {}): string {
  const applied = options.applied ?? [];
  const body = renderReportHtml(view, { applied, compare: options.compare ?? null });
  const out: string[] = [];
  // 报告正文整段嵌进来：两份 HTML 用的是同一套事实，重复渲染一遍只会长出两个版本（F63 同族）
  const headEnd = body.indexOf('</head>');
  out.push(body.slice(0, headEnd));
  out.push('<style>' + BUNDLE_CSS + '</style>');
  out.push('</head>');
  const bodyStart = body.indexOf('<body>');
  out.push(body.slice(bodyStart, body.indexOf('<div class="footer">')));
  out.push(...resumeSection(view, applied));
  out.push(...timelineSection(options.events ?? []));
  out.push('<div class="privacy"><strong>这个文件里有什么</strong>：这一场的简历原文、追问与作答、判定、改写建议、'
    + '以及上面那段事件记录。没有图片、没有外链、没有统计脚本，双击就能看，断网也能看。'
    + '分享前请自己确认里面有没有不想给别人看的经历。</div>');
  out.push('<div class="footer">CrossExam 质询室 · 单文件分享版 · 生成于 ' + esc(clockOf(view.session.createdAt))
    + ' 那一场。报告是事实的转述：结论只来自那次质询的记录，不做润色、不补写。</div>');
  out.push('</div></body></html>');
  return out.join(NL);
}

/** 打包文件名：与会话 id 和建档时刻绑定，同一个会话每次导出同名 */
export function bundleFileName(view: SessionView): string {
  return 'crossexam-bundle-' + view.session.id + '-'
    + view.session.createdAt.replace(/[:.]/g, '-') + '.html';
}

export { STYLE };
