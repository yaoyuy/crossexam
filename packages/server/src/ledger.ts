import {
  CLAIM_CATEGORY_LABEL,
  DIFFICULTY_LABEL,
  MATCH_LABEL,
  REQUIREMENT_KIND_LABEL,
  REWRITE_STYLE_LABEL,
  VERDICT_LABEL,
} from "@crossexam/shared";
import type { RequirementMatch } from "@crossexam/shared";
import type { SuggestOutcome } from "./orchestrator/suggest.ts";
import type { VerdictOutcome } from "./orchestrator/verdict.ts";
import type { SessionView } from "./pipeline.ts";
import type { SheetSpec } from "./xlsx.ts";

/**
 * 判定台账：把这一场沙盘里每一条判断连同依据一起摊成表。
 *
 * 为什么要有它：报告是给人读的，读着顺但不便于横向比对；用户真正要拿它做的事是**拿着台账去改简历**——
 * 按类别排序看哪一类最欠证据、按追问次数看哪一条被问得最狠、把「被拦下的」单独放一张表说明工具丢过什么。
 * 所以这里只做投影：数字全部来自库里已经算好的东西，不新增任何判定，也不重新解释一次口径（与 ADR-0019 同一条纪律）。
 *
 * 三张表之外的「被拦下的」是刻意留的：锚不到原文的主张、锚不到 JD 的要求、锚不到材料的反问，
 * 都是这套工具**做过的减法**，只在报告里用文字提一句是不够的，台账里必须能数出来。
 */

const MODE_LABEL: Record<string, string> = {
  live: "联网质询",
  record: "联网录制",
  replay: "离线回放",
  simulated: "离线回放",
};

const ANSWER_MODE_LABEL: Record<string, string> = {
  live: "用户亲自作答",
  simulated: "求职者 Agent 作答",
};

const YES = "是";
const NO = "否";

function detailOf(view: SessionView, claimId: string): VerdictOutcome | null {
  for (const item of view.verdicts) if (item.verdict.claimId === claimId) return item;
  return null;
}

function suggestionOf(view: SessionView, claimId: string): SuggestOutcome | null {
  for (const item of view.suggestions) if (item.claimId === claimId) return item;
  return null;
}

/** 判定分布压成一句话，与仪表盘和报告用的是同一批判定 */
function verdictLine(view: SessionView): string {
  const counts = new Map<string, number>();
  for (const item of view.verdicts) {
    const label = VERDICT_LABEL[item.verdict.kind];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (counts.size === 0) return "还没有判定";
  const parts: string[] = [];
  for (const [label, count] of counts) parts.push(label + " " + String(count) + " 条");
  return parts.join(" · ");
}

export function ledgerFileName(view: SessionView): string {
  return "crossexam-ledger-" + view.session.id + ".xlsx";
}

export function ledgerSheets(view: SessionView): SheetSpec[] {
  const meta: (string | number)[][] = [
    ["会话编号", view.session.id],
    ["岗位", view.session.jobTitle],
    ["简历指纹", view.session.resumeHash],
    ["回答方式", MODE_LABEL[view.session.llmMode] ?? view.session.llmMode],
    ["追问强度", DIFFICULTY_LABEL[view.difficulty]],
    ["改写风格", REWRITE_STYLE_LABEL[view.style]],
    ["追问轮次", view.rounds],
    ["主张条数", view.claims.length],
    ["追问条数", view.probes.length],
    ["判定分布", verdictLine(view)],
  ];

  const claimRows = view.claims.map((claim) => {
    const detail = detailOf(view, claim.id);
    const verdict = detail === null ? null : detail.verdict;
    const probes = view.probes.filter((probe) => probe.claimId === claim.id);
    const suggest = suggestionOf(view, claim.id);
    const suggestion = suggest === null ? null : suggest.suggestion;
    return [
      claim.id,
      CLAIM_CATEGORY_LABEL[claim.category],
      claim.text,
      claim.anchor.quote,
      verdict === null ? "未判定" : VERDICT_LABEL[verdict.kind],
      verdict === null ? "" : Math.round(verdict.confidence * 100) / 100,
      probes.length,
      verdict === null ? "" : verdict.rationale,
      detail !== null && detail.adjusted ? YES : NO,
      detail === null || detail.adjustmentReason === null ? "" : detail.adjustmentReason,
      suggestion === null ? "" : suggestion.before,
      suggestion === null ? "" : suggestion.after,
      suggestion !== null ? suggestion.why : suggest === null ? "" : suggest.reason ?? "",
    ];
  });

  const probeRows = view.probes.map((probe) => {
    const answer = probe.answer;
    const answered = answer !== null && answer.text.length > 0;
    return [
      probe.id,
      probe.claimId,
      probe.interviewerId,
      probe.round,
      probe.question,
      probe.rationale,
      probe.anchor.quote,
      probe.requirementId ?? "",
      probe.jdAnchor === null || probe.jdAnchor === undefined ? "" : probe.jdAnchor.quote,
      answer === null ? "" : answer.text,
      answer === null ? "" : ANSWER_MODE_LABEL[answer.mode] ?? answer.mode,
      answered ? YES : NO,
      answer === null ? "" : answer.citedAnchors.map((anchor) => anchor.quote).join(" / "),
      probe.verdict === null ? "" : VERDICT_LABEL[probe.verdict],
    ];
  });

  const matchOf = new Map<string, RequirementMatch>();
  for (const match of view.requirementMatches) matchOf.set(match.requirementId, match);
  const requirementRows = view.requirements.map((requirement) => {
    const match = matchOf.get(requirement.id);
    return [
      requirement.id,
      REQUIREMENT_KIND_LABEL[requirement.kind],
      requirement.text,
      requirement.anchor.quote,
      match === undefined ? "未对照" : MATCH_LABEL[match.status],
      match === undefined || match.claimId === null ? "" : match.claimId,
      match === undefined ? "" : match.reason,
      requirement.jdId,
      requirement.sources.join(" / "),
    ];
  });

  const rejectedRows: (string | number)[][] = [];
  for (const claim of view.rejectedClaims) rejectedRows.push(["主张", claim.text, claim.quote, claim.reason]);
  for (const requirement of view.requirementRejected) {
    rejectedRows.push(["岗位要求", requirement.text, requirement.quote, requirement.reason]);
  }
  for (const counter of view.counterRejected) rejectedRows.push(["反问", counter.text, "", counter.reason]);

  return [
    {
      name: "这一场",
      columns: ["项目", "内容"],
      widths: [16, 64],
      rows: meta,
    },
    {
      name: "判定台账",
      columns: [
        "主张编号",
        "类别",
        "主张",
        "原文引文",
        "判定",
        "把握",
        "追问次数",
        "判定理由",
        "被代码调整过",
        "调整原因",
        "建议改前",
        "建议改后",
        "建议理由",
      ],
      widths: [9, 10, 42, 30, 11, 7, 9, 40, 13, 30, 30, 30, 30],
      rows: claimRows,
    },
    {
      name: "追问明细",
      columns: [
        "追问编号",
        "主张",
        "面试官",
        "第几轮",
        "问题",
        "为什么问这个",
        "追问引文",
        "关联要求",
        "要求引文",
        "回答",
        "作答方式",
        "答上来了吗",
        "援引原文",
        "这一问的判定",
      ],
      widths: [9, 9, 12, 8, 40, 30, 24, 9, 24, 40, 15, 11, 30, 13],
      rows: probeRows,
    },
    {
      name: "岗位对照",
      columns: ["要求编号", "分量", "要求", "要求原文", "对照结果", "对应主张", "对照理由", "来自哪份 JD", "合并来源"],
      widths: [9, 10, 40, 30, 11, 9, 30, 11, 12],
      rows: requirementRows,
    },
    {
      name: "被拦下的",
      columns: ["类型", "内容", "引文", "为什么拦下"],
      widths: [11, 42, 30, 44],
      rows: rejectedRows,
    },
  ];
}
