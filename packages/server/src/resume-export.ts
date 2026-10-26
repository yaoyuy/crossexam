/**
 * 把（可能已经改过的）简历导出成能直接投出去的文件。
 *
 * 为什么和 report-html.ts 分开：报告是「这一场质询的结论」，简历是「要发给 HR 的东西」。
 * 两者读者不同、样式不同，混在一份文档里会让简历带上满屏的判定徽章——那是给人看的，
 * 不是给招聘方看的。同一份事实（SessionView + 采纳记录），两个呈现层。
 *
 * 为什么不自己生成 PDF：见 ADR-0006。服务端要真出 PDF 就得带一个无头浏览器，
 * 那会把「10 分钟复现」变成赌评委机器上装了什么。这里给的是打印即得的 HTML：
 * 浏览器里 Ctrl+P 或点一次按钮，另存为 PDF；Word 走同一份 HTML 加 .doc 后缀。
 */

import type { Revision } from '@crossexam/shared';
import type { SessionView } from './pipeline.ts';
import type { RevisedView } from './revisions.ts';

const NL = String.fromCharCode(10);

const STYLE = [
  ':root { color-scheme: light; }',
  '* { box-sizing: border-box; }',
  'body { margin: 0; background: #ffffff; color: #111827; font-size: 13.5px; line-height: 1.75; font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif; }',
  '.page { max-width: 760px; margin: 0 auto; padding: 32px 34px 44px; }',
  'h1 { font-size: 21px; margin: 0 0 2px; letter-spacing: 0.5px; }',
  '.sub { color: #6b7280; font-size: 12.5px; margin: 0 0 18px; }',
  '.body { white-space: pre-wrap; word-break: break-word; }',
  'mark.rev { background: #dcfce7; color: inherit; padding: 0 1px; border-radius: 2px; }',
  '.changes { margin-top: 26px; border-top: 1px solid #e5e7eb; padding-top: 12px; font-size: 12.5px; }',
  '.changes h2 { font-size: 14px; margin: 0 0 8px; }',
  '.changes ol { margin: 0; padding-left: 20px; }',
  '.changes .before { color: #9ca3af; text-decoration: line-through; }',
  '.changes .after { color: #047857; }',
  '.changes .why { color: #6b7280; }',
  '@page { size: A4; margin: 18mm 16mm; }',
  '@media print { .page { max-width: none; padding: 0; } .changes { break-inside: avoid; } }',
].join(NL);

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 把文本按改动区间切段，改过的段落用 mark 标出来。
 * 区间来自 movedSpans（新文本坐标），越界的一律忽略——宁可少标，不可标错位置。
 */
function markedBody(text: string, spans: readonly Revision[]): string {
  const ordered = spans
    .filter((item) => item.start >= 0 && item.end <= text.length && item.end > item.start)
    .slice()
    .sort((a, b) => a.start - b.start);
  if (ordered.length === 0) return esc(text);
  const out: string[] = [];
  let cursor = 0;
  for (const span of ordered) {
    if (span.start < cursor) continue;
    out.push(esc(text.slice(cursor, span.start)));
    out.push('<mark class="rev">' + esc(text.slice(span.start, span.end)) + '</mark>');
    cursor = span.end;
  }
  out.push(esc(text.slice(cursor)));
  return out.join('');
}

function changeList(view: SessionView, revised: RevisedView): string[] {
  const out: string[] = ['<div class="changes">'];
  out.push('<h2>本版改了什么（' + String(revised.applied.length) + ' 处）</h2>');
  if (revised.applied.length === 0) out.push('<p>没有改动，这一份就是原文。</p>');
  else {
    out.push('<ol>');
    for (const item of revised.applied) {
      const claim = view.claims.find((row) => row.id === item.claimId);
      const why = claim === undefined || claim.suggestion === null ? '' : claim.suggestion.why;
      out.push(
        '<li><div class="before">' + esc(item.before) + '</div>' +
          '<div class="after">' + esc(item.after) + '</div>' +
          (why === '' ? '' : '<div class="why">为什么：' + esc(why) + '</div>') +
          '</li>',
      );
    }
    out.push('</ol>');
  }
  if (revised.pending.length > 0) {
    out.push(
      '<p class="why">还有 ' + String(revised.pending.length) + ' 条建议没有采纳（' +
        esc(revised.pending.join('、')) + '）：这份简历里保留了原话。</p>',
    );
  }
  for (const item of revised.skipped) {
    out.push('<p class="why">' + esc(item.claimId) + ' 没能改：' + esc(item.reason) + '</p>');
  }
  out.push('</div>');
  return out;
}

export interface ResumeHtmlOptions {
  /** 打开就调起浏览器打印（另存为 PDF 一步到位） */
  print?: boolean;
  /** 标出改过的段落，并在末尾附一份改动清单：给用户自己核对用的版本 */
  marks?: boolean;
}

/**
 * 渲染一份简历。revised 为 null 表示还没采纳过任何建议，导出的就是原文。
 */
export function renderResumeHtml(
  view: SessionView,
  revised: RevisedView | null,
  options: ResumeHtmlOptions = {},
): string {
  const text = revised === null ? view.session.resumeText : revised.text;
  const marks = options.marks === true && revised !== null;
  const title = view.session.jobTitle === '' ? '简历' : view.session.jobTitle;
  const out: string[] = [];
  out.push('<!doctype html>');
  out.push('<html lang="zh-CN"><head><meta charset="utf-8">');
  out.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  out.push('<title>' + esc(title) + ' · 简历</title>');
  out.push('<style>' + STYLE + '</style>');
  out.push('</head><body><div class="page">');
  out.push('<h1>' + esc(title) + '</h1>');
  out.push('<p class="sub">' + (revised === null
    ? '原文导出于 CrossExam 质询室'
    : '依据质询结果修订（' + String(revised.applied.length) + ' 处改动）') + '</p>');
  out.push('<div class="body">' + (marks ? markedBody(text, revised.spans) : esc(text)) + '</div>');
  if (marks && revised !== null) for (const block of changeList(view, revised)) out.push(block);
  out.push('</div>');
  if (options.print === true) {
    out.push('<script>window.addEventListener("load", function () { window.print(); });</script>');
  }
  out.push('</body></html>');
  return out.join(NL);
}

function stampOf(view: SessionView): string {
  return view.session.createdAt.replace(/[:.]/g, '-');
}

export function resumeBaseName(view: SessionView): string {
  return 'crossexam-resume-' + view.session.id + '-' + stampOf(view);
}

export function resumeHtmlFileName(view: SessionView): string {
  return resumeBaseName(view) + '.html';
}

/** Word 走「HTML + .doc 后缀」这条老路，与报告一致：Word 能打开，且不需要任何依赖 */
export function resumeDocFileName(view: SessionView): string {
  return resumeBaseName(view) + '.doc';
}

export function resumeTextFileName(view: SessionView): string {
  return resumeBaseName(view) + '.txt';
}
