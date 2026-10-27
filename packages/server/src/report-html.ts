/**
 * 把一盘沙盘渲染成一份可以直接打印的 HTML 报告。
 *
 * 与 report.ts 的关系：同一份事实（SessionView）的两种呈现。
 *   - Markdown 是能带走、能 diff、能进仓库的形态；
 *   - HTML 是能读、能交给浏览器打印成 PDF、也能被 Word 打开的形态。
 * 为什么不复用 tools/docs 那个 Markdown 渲染器：它属于工具目录、只服务技术文档，
 * 而这份报告需要锚点引用块、判定配色与打印样式。两边读的是同一个 SessionView，
 * 事实只有一个来源；多写一个薄呈现层，好过让服务端去依赖一个工具目录。
 */

import { CLAIM_CATEGORY_LABEL, MATCH_LABEL, PERSONA_PRESETS, REQUIREMENT_KIND_LABEL, VERDICT_LABEL, categoryLine, shortfallPlan } from '@crossexam/shared';
import type { Anchor, Verdict, VerdictKind } from '@crossexam/shared';
import type { ProbeRow } from './store/index.ts';
import type { SessionView } from './pipeline.ts';

const NL = String.fromCharCode(10);

/** 判定配色：打印成黑白也读得懂，因为有文字标签兜底 */
const VERDICT_COLOR: Record<VerdictKind, string> = {
  solid: '#0f766e',
  overstated: '#b45309',
  unsupported: '#6d28d9',
  contradicts: '#b91c1c',
  unanswerable: '#475569',
};

/** 岗位要求对照的配色：答得上 / 答得含糊 / 简历里没写。与判定用的是同一套语义色 */
const MATCH_COLOR: Record<string, string> = {
  hit: '#0f766e',
  weak: '#b45309',
  missing: '#6b7280',
};

const STYLE = [
  ':root { color-scheme: light; }',
  '* { box-sizing: border-box; }',
  'body { margin: 0; padding: 0; background: #ffffff; color: #1f2937;',
  '  font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif;',
  '  font-size: 14px; line-height: 1.7; }',
  '.page { max-width: 820px; margin: 0 auto; padding: 28px 30px 40px; }',
  'h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: 0.5px; }',
  '.tagline { margin: 0 0 18px; color: #6b7280; font-size: 13px; }',
  'h2 { font-size: 17px; margin: 30px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }',
  'h3 { font-size: 14.5px; margin: 18px 0 8px; }',
  'table.meta { width: 100%; border-collapse: collapse; font-size: 12.5px; }',
  'table.meta th { text-align: left; width: 108px; color: #6b7280; font-weight: 500; padding: 3px 8px 3px 0; vertical-align: top; }',
  'table.meta td { padding: 3px 0; word-break: break-all; }',
  '.claim { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; margin: 10px 0 16px; break-inside: avoid; }',
  '.claim-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 6px; }',
  '.id { font-family: Consolas, "Courier New", monospace; font-size: 12px; color: #6b7280; }',
  '.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; color: #ffffff; font-size: 12px; }',
  '.weight { color: #6b7280; font-size: 12px; }',
  '.text { font-weight: 600; margin: 6px 0; }',
  '.quote { border-left: 3px solid #d1d5db; padding: 4px 10px; margin: 6px 0; color: #374151; font-size: 13px; }',
  '.quote .label { color: #9ca3af; font-size: 11.5px; display: block; }',
  '.facts { margin: 8px 0 0; padding-left: 18px; font-size: 13px; }',
  '.facts li { margin: 2px 0; }',
  '.adjusted { background: #fffbeb; border-left: 3px solid #f59e0b; padding: 6px 10px; margin: 8px 0 0; font-size: 12.5px; }',
  '.probe { border-left: 2px solid #e5e7eb; padding: 2px 0 2px 12px; margin: 10px 0; break-inside: avoid; }',
  '.probe .who { color: #b45309; font-size: 12px; }',
  '.answer { background: #f9fafb; border-radius: 6px; padding: 6px 10px; margin-top: 5px; font-size: 13px; white-space: pre-wrap; }',
  '.advice { border: 1px solid #fed7aa; background: #fff7ed; border-radius: 8px; padding: 12px 14px; margin: 10px 0 16px; break-inside: avoid; }',
  '.req { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; margin: 10px 0 16px; break-inside: avoid; }',
  '.before { color: #9ca3af; text-decoration: line-through; }',
  '.after { color: #047857; font-weight: 600; }',
  '.notice { background: #f3f4f6; border-radius: 6px; padding: 8px 12px; font-size: 12.5px; }',
  '.footer { margin-top: 34px; padding-top: 12px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 11.5px; }',
  '@page { size: A4; margin: 16mm 15mm; }',
  '@media print { .page { max-width: none; padding: 0; } .claim, .probe, .advice { break-inside: avoid; } }',
].join(NL);

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function interviewerName(role: string): string {
  const preset = PERSONA_PRESETS[role as keyof typeof PERSONA_PRESETS];
  return preset === undefined ? role : preset.persona.name;
}

function verdictOf(view: SessionView, claimId: string): Verdict | null {
  for (const detail of view.verdicts) {
    if (detail.verdict.claimId === claimId) return detail.verdict;
  }
  return null;
}

function adjustmentNote(view: SessionView, claimId: string): string | null {
  for (const detail of view.verdicts) {
    if (detail.verdict.claimId !== claimId) continue;
    if (!detail.adjusted) return null;
    return detail.adjustmentReason ?? '模型的原始结论被代码降级';
  }
  return null;
}

function probesOf(view: SessionView, claimId: string): ProbeRow[] {
  return view.probes.filter((probe) => probe.claimId === claimId);
}

function claimTextOf(view: SessionView, claimId: string | null): string {
  if (claimId === null) return '';
  for (const claim of view.claims) {
    if (claim.id === claimId) return claim.text;
  }
  return '';
}

function jdTitleOfId(view: SessionView, jdId: string): string {
  for (const jd of view.jds) {
    if (jd.id === jdId) return jd.title;
  }
  return jdId;
}

function quote(label: string, anchor: Anchor): string {
  const hit = anchor.exact ? '逐字命中' : '归一化命中';
  return (
    '<div class="quote"><span class="label">' + esc(label) + '（字符 ' + String(anchor.start) +
    '-' + String(anchor.end) + ' · ' + hit + '）</span>' + esc(anchor.quote) + '</div>'
  );
}

function verdictBadge(kind: VerdictKind): string {
  return (
    '<span class="badge" style="background:' + VERDICT_COLOR[kind] + '">' + esc(VERDICT_LABEL[kind]) + '</span>'
  );
}

function metaRows(view: SessionView): string[] {
  const s = view.session;
  const rows: [string, string][] = [
    ['会话', s.id + '（' + s.createdAt + '）'],
    ['目标岗位', s.jobTitle],
    ['简历指纹', s.resumeHash],
    ['跑法', s.llmMode + '，模型调用 ' + String(view.llm.calls) + ' 次（其中离线回放 ' + String(view.llm.replayedCalls) + ' 次）'],
    ['Token', '输入 ' + String(view.llm.inputTokens) + ' / 输出 ' + String(view.llm.outputTokens) + ' / 缓存命中 ' + String(view.llm.cacheReadTokens) + ' / 推理 ' + String(view.llm.reasoningTokens)],
    ['追问预算', '已用 ' + String(s.budget.totalProbes) + ' 次，上限 ' + String(s.budget.config.maxTotalProbes) + ' 次；主张 ' + String(view.claims.length) + ' 条'],
    ['岗位要求', view.jds.length === 0 ? '未上传（面试官按各自的经验追问）' : String(view.jds.length) + ' 份 JD，抽出 ' + String(view.requirements.length) + ' 条要求（答得上 ' + String(view.requirementSummary.hit) + ' · 答得含糊 ' + String(view.requirementSummary.weak) + ' · 简历里没写 ' + String(view.requirementSummary.missing) + '）'],
  ];
  return rows.map((row) => '<tr><th>' + esc(row[0]) + '</th><td>' + esc(row[1]) + '</td></tr>');
}

function claimSection(view: SessionView): string[] {
  const out: string[] = [];
  out.push('<h2>一、主张与判定</h2>');
  if (view.claims.length === 0) out.push('<p>（本次没有抽到可被追问的主张）</p>');
  for (const claim of view.claims) {
    const verdict = verdictOf(view, claim.id);
    const label = verdict === null ? '未判定' : VERDICT_LABEL[verdict.kind];
    out.push('<div class="claim">');
    out.push(
      '<div class="claim-head"><span class="id">' + esc(claim.id) + '</span>' +
        (verdict === null
          ? '<span class="badge" style="background:#9ca3af">' + esc(label) + '</span>'
          : verdictBadge(verdict.kind)) +
        '<span class="weight">' + esc(CLAIM_CATEGORY_LABEL[claim.category]) + ' · 权重 ' + claim.weight.toFixed(2) + '</span></div>',
    );
    out.push('<p class="text">' + esc(claim.text) + '</p>');
    out.push(quote('简历原文', claim.anchor));
    if (verdict !== null) {
      out.push('<ul class="facts">');
      out.push('<li>置信度：' + verdict.confidence.toFixed(2) + '</li>');
      out.push('<li>判定理由：' + esc(verdict.rationale) + '</li>');
      if (verdict.evidence.length === 0) {
        out.push('<li>证据：无（因此这条判定一定是代码收敛后的结果）</li>');
      } else {
        for (const anchor of verdict.evidence) {
          out.push('<li>证据：「' + esc(anchor.quote) + '」</li>');
        }
      }
      out.push('<li>依据的追问：' + (verdict.probeIds.length === 0 ? '无' : esc(verdict.probeIds.join('、'))) + '</li>');
      out.push('</ul>');
      const note = adjustmentNote(view, claim.id);
      if (note !== null) out.push('<div class="adjusted"><strong>代码收敛：</strong>' + esc(note) + '</div>');
    }
    out.push('<p class="weight">追问 ' + String(probesOf(view, claim.id).length) + ' 条</p>');
    out.push('</div>');
  }
  if (view.rejectedClaims.length > 0) {
    out.push('<h3>被锚定机制拦下的主张（没有进入质询）</h3>');
    out.push('<ul class="facts">');
    for (const rejected of view.rejectedClaims) {
      out.push('<li>「' + esc(rejected.quote) + '」—— ' + esc(rejected.reason) + '</li>');
    }
    out.push('</ul>');
  }
  for (const line of shortfallSection(view)) out.push(line);
  for (const line of supplementSection(view)) out.push(line);
  return out;
}

/**
 * 岗位要求对照（HTML 版）。
 *
 * 与 Markdown 报告同一份数据、同一个视角：这一节回答的是「这份 JD 的每条要求有没有被回答到」，
 * 而「主张与判定」回答的是「简历里这句话站不站得住」。
 * 缺的那几条只列在这里、不生成追问——那是回去补经历的事，不是追问能问出来的。
 */
/**
 * 按类别看短板（HTML 版）：与 Markdown 报告同一句话、同一份排序。
 */
function shortfallOf(view: SessionView): ReturnType<typeof shortfallPlan> {
  const claims = view.claims.map((claim) => {
    const verdict = verdictOf(view, claim.id);
    return {
      id: claim.id,
      text: claim.text,
      category: claim.category,
      verdict: verdict === null ? null : verdict.kind,
    };
  });
  return shortfallPlan(claims);
}

/**
 * 「你补的证据」（HTML 版）：与 Markdown 报告读同一份数据、同一个口径。
 */
function supplementSection(view: SessionView): string[] {
  if (view.supplements.length === 0) return [];
  const out: string[] = [];
  out.push('<h3>你补的证据（' + String(view.supplements.length) + ' 句）</h3>');
  out.push('<p>这几句是你自己写的事实，不是模型生成的。采纳之后它们会作为新的一行，加在对应主张那一行的下面。</p>');
  out.push('<ul class="facts">');
  for (const row of view.supplements) {
    const claim = view.claims.find((item) => item.id === row.claimId);
    out.push(
      '<li><span class="id">' + esc(row.claimId) + '</span>' +
        (claim === undefined ? '' : ' ' + esc(claim.text)) +
        '<br>你补的：' + esc(row.text) + '</li>',
    );
  }
  out.push('</ul>');
  return out;
}

function shortfallSection(view: SessionView): string[] {
  const plan = shortfallOf(view);
  const out: string[] = [];
  out.push('<h3>按类别看短板</h3>');
  out.push('<p>' + esc(plan.headline) + '</p>');
  if (plan.total === 0) return out;
  out.push('<ul class="facts">');
  for (const item of plan.stats) out.push('<li>' + esc(categoryLine(item)) + '</li>');
  out.push('</ul>');
  if (plan.weakest.length === 0) {
    out.push('<p>没有需要补的主张。</p>');
    return out;
  }
  out.push('<p>最该先补的 ' + String(plan.weakest.length) + ' 处（同一程度按主张顺序）：</p>');
  out.push('<ul class="facts">');
  for (const item of plan.weakest) {
    const verdict = verdictOf(view, item.id);
    const badge =
      verdict === null
        ? '<span class="badge" style="background:#9ca3af">未判定</span>'
        : verdictBadge(verdict.kind);
    out.push(
      '<li><span class="id">' + esc(item.id) + '</span>' + badge +
        '<span class="weight">' + esc(CLAIM_CATEGORY_LABEL[item.category]) +
        ' · 追问 ' + String(probesOf(view, item.id).length) + ' 条</span>' +
        esc(item.text) + '</li>',
    );
  }
  out.push('</ul>');
  return out;
}

function requirementSection(view: SessionView): string[] {
  const out: string[] = [];
  out.push('<h2>二、岗位要求对照</h2>');
  if (view.jds.length === 0) {
    out.push('<p>（这场没有上传岗位要求，面试官按各自的经验追问）</p>');
    return out;
  }
  const summary = view.requirementSummary;
  out.push('<ul class="facts">');
  out.push('<li>JD：' + view.jds.map((jd) => esc(jd.title) + '（' + String(jd.text.length) + ' 字）').join('、') + '</li>');
  out.push('<li>对照结果：答得上 ' + String(summary.hit) + ' 条 / 答得含糊 ' + String(summary.weak) + ' 条 / 简历里没写 ' + String(summary.missing) + ' 条，共 ' + String(summary.total) + ' 条</li>');
  out.push('</ul>');
  for (const requirement of view.requirements) {
    const match = view.requirementMatches.find((item) => item.requirementId === requirement.id) ?? null;
    const kind = match === null ? 'missing' : match.status;
    out.push('<div class="req">');
    out.push(
      '<div class="claim-head"><span class="id">' + esc(requirement.id) + '</span>' +
        '<span class="badge" style="background:' + MATCH_COLOR[kind] + '">' +
        esc(REQUIREMENT_KIND_LABEL[requirement.kind] + ' · ' + (match === null ? '未对照' : MATCH_LABEL[match.status])) +
        '</span></div>',
    );
    out.push('<p class="text">' + esc(requirement.text) + '</p>');
    out.push(quote('要求原文 · ' + jdTitleOfId(view, requirement.jdId), requirement.anchor));
    if (match !== null) {
      out.push('<ul class="facts">');
      out.push('<li>为什么这么判：' + esc(match.reason) + '</li>');
      if (match.claimId !== null) {
        out.push('<li>对应主张：' + esc(match.claimId) + ' · ' + esc(claimTextOf(view, match.claimId)) + '</li>');
      }
      out.push('</ul>');
    }
    out.push('</div>');
  }
  if (view.requirementRejected.length > 0) {
    out.push('<h3>被丢掉的要求（锚不到 JD 原文，没有进入对照）</h3>');
    out.push('<ul class="facts">');
    for (const rejected of view.requirementRejected) {
      out.push('<li>「' + esc(rejected.text) + '」—— ' + esc(rejected.reason) + '</li>');
    }
    out.push('</ul>');
  }
  return out;
}

function transcriptSection(view: SessionView): string[] {
  const out: string[] = ['<h2>三、追问实录</h2>'];
  for (const claim of view.claims) {
    out.push('<h3>' + esc(claim.id) + ' ' + esc(claim.text) + '</h3>');
    const probes = probesOf(view, claim.id);
    if (probes.length === 0) {
      out.push('<p>（这条主张没有被追问）</p>');
      continue;
    }
    probes.forEach(function (probe, index) {
      const chain = probe.parentProbeId === null ? '' : '（承接 ' + esc(probe.parentProbeId) + '）';
      out.push('<div class="probe">');
      out.push(
        '<div class="who">' + String(index + 1) + '. ' + esc(interviewerName(probe.interviewerId)) + ' · 第 ' +
          String(probe.round) + ' 轮 ' + chain + '</div>',
      );
      out.push('<div>' + esc(probe.question) + '</div>');
      if (probe.rationale !== '') out.push('<div class="weight">为什么问这个：' + esc(probe.rationale) + '</div>');
      out.push(quote('这条提问的锚点', probe.anchor));
      if (probe.answer === null) {
        out.push('<div class="answer">回答：未作答</div>');
      } else {
        out.push('<div class="answer">回答（' + esc(probe.answer.mode) + '）：' + esc(probe.answer.text) + '</div>');
      }
      out.push('<div class="weight">追问自身的判定：' + esc(probe.verdict === null ? '未判定' : VERDICT_LABEL[probe.verdict]) + '</div>');
      out.push('</div>');
    });
  }
  return out;
}

function adviceSection(view: SessionView): string[] {
  const out: string[] = ['<h2>四、简历修改建议</h2>'];
  const advice = view.suggestions.filter((item) => item.status === 'suggested' && item.suggestion !== null);
  if (advice.length === 0) out.push('<p>（没有被判定为需要改写的条目）</p>');
  for (const item of advice) {
    const suggestion = item.suggestion;
    if (suggestion === null) continue;
    const verdict = verdictOf(view, suggestion.claimId);
    out.push('<div class="advice">');
    out.push(
      '<div class="claim-head"><span class="id">' + esc(suggestion.claimId) + '</span>' +
        (verdict === null ? '' : verdictBadge(verdict.kind)) + '</div>',
    );
    out.push('<div><strong>问题：</strong>' + esc(suggestion.problem) + '</div>');
    out.push('<div class="before">原句：' + esc(suggestion.before) + '</div>');
    out.push('<div class="after">改成：' + esc(suggestion.after) + '</div>');
    out.push('<div class="weight">为什么：' + esc(suggestion.why) + '</div>');
    out.push('</div>');
  }
  return out;
}

function reproSection(view: SessionView): string[] {
  const s = view.session;
  return [
    '<h2>五、复现方式</h2>',
    '<ul class="facts">',
    '<li>本次跑法：' + esc(s.llmMode) + '</li>',
    '<li>事件条数：' + String(view.events.length) + '（全部落本地 SQLite，可按 seq 重放）</li>',
    '<li>相同输入 + 相同卡带 = 逐字节相同的报告；不一致说明代码变了，而不是模型心情变了</li>',
    '<li>离线复现：npm install &amp;&amp; npm run preview，打开后点「一键示例」再点「开始质询」，不需要任何 API Key</li>',
    '</ul>',
  ];
}

export interface ReportHtmlOptions {
  /** 打开就调起浏览器打印（另存为 PDF 一步到位），默认 false */
  print?: boolean;
}

export function renderReportHtml(view: SessionView, options: ReportHtmlOptions = {}): string {
  const out: string[] = [];
  out.push('<!doctype html>');
  out.push('<html lang="zh-CN"><head><meta charset="utf-8">');
  out.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  out.push('<title>CrossExam 质询报告 · ' + esc(view.session.jobTitle) + '</title>');
  out.push('<style>' + STYLE + '</style>');
  out.push('</head><body><div class="page">');
  out.push('<h1>CrossExam 质询报告</h1>');
  out.push('<p class="tagline">多 Agent 对抗式面试沙盘 · 提问锚定简历原文，追问有预算，判定可被代码改写</p>');
  out.push('<table class="meta">' + metaRows(view).join('') + '</table>');
  if (view.notices.length > 0) {
    out.push('<h2>零、过程说明（如实记录，不掩饰）</h2>');
    out.push('<div class="notice"><ul class="facts">');
    for (const notice of view.notices) out.push('<li>' + esc(notice) + '</li>');
    out.push('</ul></div>');
  }
  for (const block of claimSection(view)) out.push(block);
  for (const block of requirementSection(view)) out.push(block);
  for (const block of transcriptSection(view)) out.push(block);
  for (const block of adviceSection(view)) out.push(block);
  for (const block of reproSection(view)) out.push(block);
  out.push('<div class="footer">本报告由本地服务生成（简历与报告都没有离开这台机器）。报告是事实的转述：结论只来自数据库里的事件与判定，不做润色、不补写。</div>');
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

export function reportBaseName(view: SessionView): string {
  return 'crossexam-' + view.session.id + '-' + stampOf(view);
}

export function reportHtmlFileName(view: SessionView): string {
  return reportBaseName(view) + '.html';
}

/** Word 走的是「HTML + .doc 后缀」这条老路：Word 能打开，且不需要任何依赖 */
export function reportDocFileName(view: SessionView): string {
  return reportBaseName(view) + '.doc';
}
