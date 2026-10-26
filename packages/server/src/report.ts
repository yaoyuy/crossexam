/**
 * 把一盘沙盘渲染成一份 Markdown 报告。
 *
 * 为什么报告要在服务端生成而不是前端截图：它同时是
 *   - 用户能带走的东西（交给自己复盘）
 *   - 技术文档与演示视频的取景素材
 *   - 一份可 diff 的产物：报告变了，说明流水线真的变了
 * 所以它只读数据库里的事实，不做任何润色或补写。
 */

import { CLAIM_CATEGORY_LABEL, PERSONA_PRESETS, VERDICT_LABEL } from '@crossexam/shared';
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

  out.push('## 二、追问实录');
  out.push('');
  for (const claim of view.claims) {
    out.push('### ' + claim.id + ' ' + claim.text);
    out.push('');
    for (const line of probeLines(probesOf(view, claim.id))) out.push(line);
    out.push('');
  }

  out.push('## 三、简历修改建议');
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

  out.push('## 四、复现方式');
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
