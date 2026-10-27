/**
 * 把一盘沙盘渲染成一份 Markdown 报告。
 *
 * 为什么报告要在服务端生成而不是前端截图：它同时是
 *   - 用户能带走的东西（交给自己复盘）
 *   - 技术文档与演示视频的取景素材
 *   - 一份可 diff 的产物：报告变了，说明流水线真的变了
 * 所以它只读数据库里的事实，不做任何润色或补写。
 */

import { CLAIM_CATEGORY_LABEL, MATCH_LABEL, PERSONA_PRESETS, REQUIREMENT_KIND_LABEL, VERDICT_LABEL, categoryLine, shortfallPlan } from '@crossexam/shared';
import type { Anchor, Verdict, VerdictKind } from '@crossexam/shared';
import type { ProbeRow } from './store/index.ts';
import type { SessionView } from './pipeline.ts';

const NL = String.fromCharCode(10);

function interviewerName(role: string): string {
  const preset = PERSONA_PRESETS[role as keyof typeof PERSONA_PRESETS];
  return preset === undefined ? role : preset.persona.name;
}

function anchorLine(anchor: Anchor): string {
  const hit = anchor.exact ? '逐字命中' : '归一化命中（全半角或空白差异）';
  return '> 原文锚点：「' + anchor.quote + '」（字符 ' + String(anchor.start) + '-' + String(anchor.end) + '，' + hit + '）';
}

function evidenceLines(evidence: readonly Anchor[]): string[] {
  if (evidence.length === 0) return ['- 证据：无（因此该判定一定是降级后的结果）'];
  return evidence.map((anchor) => '- 证据：「' + anchor.quote + '」');
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

/**
 * 岗位要求对照。
 *
 * 这一节与「主张与判定」是两种视角：那边看的是简历里的一句话站不站得住，
 * 这边看的是这份 JD 的每条要求有没有被回答到。缺的那几条**不生成追问**，
 * 只列在这里——因为「简历里没写」不是可以靠追问解决的事，那是回去补经历的事。
 */
/**
 * 按类别看短板：同一份判定的另一种摆法。
 *
 * 排序与定义只写在 shared/shortfall.ts 里，两个渲染器都不许自己再排一遍——
 * 不然「报告里说最该补 C3、界面上排第一的是 C5」这种矛盾迟早出现。
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

function shortfallLines(view: SessionView): string[] {
  const plan = shortfallOf(view);
  const out: string[] = [];
  out.push('### 按类别看短板');
  out.push('');
  out.push(plan.headline);
  out.push('');
  if (plan.total === 0) return out;
  for (const item of plan.stats) out.push('- ' + categoryLine(item));
  out.push('');
  if (plan.weakest.length === 0) {
    out.push('没有需要补的主张。');
    out.push('');
    return out;
  }
  out.push('最该先补的 ' + String(plan.weakest.length) + ' 处（同一程度按主张顺序，不另行排序）：');
  out.push('');
  for (const item of plan.weakest) {
    const verdict = verdictOf(view, item.id);
    const kind = verdict === null ? '未判定' : VERDICT_LABEL[verdict.kind];
    out.push(
      '- ' + item.id + ' · ' + kind + ' · ' + CLAIM_CATEGORY_LABEL[item.category] + '：' + item.text +
        '（追问 ' + String(probesOf(view, item.id).length) + ' 条）',
    );
  }
  out.push('');
  return out;
}
/**
 * 「你补的证据」：用户当场写下的那几句真话。
 *
 * 单独列出来而不是并进上面那份名单，是因为来源不同：上面每一条都是模型判的，
 * 这几条是人写的。报告要能一眼看出哪些结论来自沙盘、哪些事实来自本人。
 * 一句都没有时整节不出现（没补过就没这回事）。
 */
function supplementLines(view: SessionView): string[] {
  if (view.supplements.length === 0) return [];
  const out: string[] = [];
  out.push('### 你补的证据（' + String(view.supplements.length) + ' 句）');
  out.push('');
  out.push('这几句是你自己写的事实，不是模型生成的。简历原文没有被改动——采纳之后它们会作为新的一行，加在对应主张那一行的下面。');
  out.push('');
  for (const row of view.supplements) {
    const claim = view.claims.find((item) => item.id === row.claimId);
    out.push('- ' + row.claimId + (claim === undefined ? '' : ' · ' + claim.text));
    out.push('  > 你补的：' + row.text);
  }
  out.push('');
  return out;
}
function requirementLines(view: SessionView): string[] {
  const out: string[] = [];
  out.push('## 二、岗位要求对照');
  out.push('');
  if (view.jds.length === 0) {
    out.push('（这场没有上传岗位要求，面试官按各自的经验追问）');
    out.push('');
    return out;
  }
  out.push('- 岗位要求来源：' + String(view.jds.length) + ' 份 JD —— ' + view.jds.map((jd) => jd.title + '（' + String(jd.text.length) + ' 字）').join('、'));
  const summary = view.requirementSummary;
  out.push('- 对照结果：答得上 ' + String(summary.hit) + ' 条 / 答得含糊 ' + String(summary.weak) + ' 条 / 简历里没写 ' + String(summary.missing) + ' 条，共 ' + String(summary.total) + ' 条');
  out.push('');
  for (const requirement of view.requirements) {
    const match = view.requirementMatches.find((item) => item.requirementId === requirement.id) ?? null;
    const status = match === null ? '未对照' : MATCH_LABEL[match.status];
    out.push('### ' + requirement.id + ' · ' + REQUIREMENT_KIND_LABEL[requirement.kind] + ' · ' + status);
    out.push('');
    out.push('要求：' + requirement.text);
    out.push('');
    out.push('> 要求原文：「' + requirement.anchor.quote + '」（来自《' + jdTitleOfId(view, requirement.jdId) + '》，字符 ' + String(requirement.anchor.start) + '-' + String(requirement.anchor.end) + '）');
    out.push('');
    if (match !== null) {
      out.push('- 为什么这么判：' + match.reason);
      if (match.claimId !== null) {
        out.push('- 对应主张：' + match.claimId + ' · ' + claimTextOf(view, match.claimId));
      }
    }
    out.push('');
  }
  if (view.requirementRejected.length > 0) {
    out.push('### 被丢掉的要求（锚不到 JD 原文，没有进入对照）');
    out.push('');
    for (const rejected of view.requirementRejected) {
      out.push('- 「' + rejected.text + '」→ ' + rejected.reason);
    }
    out.push('');
  }
  return out;
}

function probeLines(probes: readonly ProbeRow[]): string[] {
  if (probes.length === 0) return ['（这条主张没有被追问）'];
  const out: string[] = [];
  probes.forEach(function (probe, index) {
    const chain = probe.parentProbeId === null ? '' : '（承接上一条追问）';
    out.push(String(index + 1) + '. [' + interviewerName(probe.interviewerId) + '] ' + probe.question + chain);
    if (probe.rationale !== '') out.push('   - 为什么问这个：' + probe.rationale);
    out.push('   - ' + anchorLine(probe.anchor).replace('> ', ''));
    const answer = probe.answer;
    if (answer === null) out.push('   - 回答：**未作答**');
    else out.push('   - 回答（' + answer.mode + '）：' + answer.text);
    out.push('   - 追问自身的判定：' + (probe.verdict === null ? '未判定' : VERDICT_LABEL[probe.verdict as VerdictKind]));
  });
  return out;
}

export function renderReport(view: SessionView): string {
  const s = view.session;
  const out: string[] = [];
  const used = s.budget.totalProbes;
  const cap = s.budget.config.maxTotalProbes;

  out.push('# CrossExam 质询报告');
  out.push('');
  out.push('- 会话：' + s.id + '（' + s.createdAt + '）');
  out.push('- 目标岗位：' + s.jobTitle);
  out.push('- 简历指纹：' + s.resumeHash);
  out.push('- 跑法：' + s.llmMode + '，模型调用 ' + String(view.llm.calls) + ' 次（其中离线回放 ' + String(view.llm.replayedCalls) + ' 次）');
  out.push(
    '- Token：输入 ' + String(view.llm.inputTokens) + ' / 输出 ' + String(view.llm.outputTokens) +
      ' / 缓存命中 ' + String(view.llm.cacheReadTokens) + ' / 推理 ' + String(view.llm.reasoningTokens),
  );
  out.push('- 追问预算：已用 ' + String(used) + ' 次，上限 ' + String(cap) + ' 次；主张 ' + String(view.claims.length) + ' 条');
  out.push('');

  if (view.notices.length > 0) {
    out.push('## 零、过程说明（如实记录，不掩饰）');
    out.push('');
    for (const notice of view.notices) out.push('- ' + notice);
    out.push('');
  }

  out.push('## 一、主张与判定');
  out.push('');
  if (view.claims.length === 0) out.push('（本次没有抽到可被追问的主张）');
  for (const claim of view.claims) {
    const verdict = verdictOf(view, claim.id);
    const label = verdict === null ? '未判定' : VERDICT_LABEL[verdict.kind];
    out.push('### ' + claim.id + ' · ' + label + ' · ' + CLAIM_CATEGORY_LABEL[claim.category] + ' · 权重 ' + claim.weight.toFixed(2));
    out.push('');
    out.push('主张：' + claim.text);
    out.push('');
    out.push(anchorLine(claim.anchor));
    out.push('');
    if (verdict !== null) {
      out.push('- 置信度：' + verdict.confidence.toFixed(2));
      out.push('- 判定理由：' + verdict.rationale);
      for (const line of evidenceLines(verdict.evidence)) out.push(line);
      out.push('- 依据的追问：' + (verdict.probeIds.length === 0 ? '无' : verdict.probeIds.join('、')));
      const note = adjustmentNote(view, claim.id);
      if (note !== null) out.push('- **代码收敛**：' + note);
    }
    out.push('- 追问 ' + String(probesOf(view, claim.id).length) + ' 条');
    out.push('');
  }

  if (view.rejectedClaims.length > 0) {
    out.push('### 被锚定机制拦下的主张（没有进入质询）');
    out.push('');
    for (const rejected of view.rejectedClaims) {
      out.push('- 「' + rejected.quote + '」→ ' + rejected.reason);
    }
    out.push('');
  }

  for (const line of shortfallLines(view)) out.push(line);

  for (const line of supplementLines(view)) out.push(line);

  for (const line of requirementLines(view)) out.push(line);

  out.push('## 三、追问实录');
  out.push('');
  for (const claim of view.claims) {
    out.push('### ' + claim.id + ' ' + claim.text);
    out.push('');
    for (const line of probeLines(probesOf(view, claim.id))) out.push(line);
    out.push('');
  }

  out.push('## 四、简历修改建议');
  out.push('');
  const advice = view.suggestions.filter((item) => item.status === 'suggested' && item.suggestion !== null);
  if (advice.length === 0) out.push('（没有被判定为需要改写的条目）');
  for (const item of advice) {
    const suggestion = item.suggestion;
    if (suggestion === null) continue;
    const label = verdictOf(view, suggestion.claimId);
    out.push('### ' + suggestion.claimId + '（当前判定：' + (label === null ? '未判定' : VERDICT_LABEL[label.kind]) + '）');
    out.push('');
    out.push('- 问题：' + suggestion.problem);
    out.push('- 原句：' + suggestion.before);
    out.push('- 改成：' + suggestion.after);
    out.push('- 为什么：' + suggestion.why);
    out.push('');
  }

  out.push('## 五、复现方式');
  out.push('');
  out.push('- 本次跑法：' + s.llmMode);
  out.push('- 事件条数：' + String(view.events.length) + '（全部落本地 SQLite，可按 seq 重放）');
  out.push('- 相同输入 + 相同卡带 = 逐字节相同的报告；不一致说明代码变了，而不是模型"心情变了"');
  out.push('');
  return out.join(NL);
}

export function reportFileName(view: SessionView): string {
  const stamp = view.session.createdAt.replace(/[:.]/g, '-');
  return 'crossexam-' + view.session.id + '-' + stamp + '.md';
}
