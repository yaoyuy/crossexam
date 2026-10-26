/**
 * 阶段二：一轮并发追问。
 *
 * 这里有两道闸门，缺一不可：
 * 1. **预算闸门**（canProbe）：代码强制记账，模型看不到也突破不了。死循环在设计上不成立。
 * 2. **锚定闸门**（resolveAnchor）：提问必须携带能在简历里逐字找到的引文。
 *
 * 一个刻意的设计：面试官是**并发**发问的，但记账是**串行**的。
 * 并发的意义是演示时四路流式同时吐字；串行的意义是预算账本不依赖时序，
 * 于是同一盘卡带无论跑多少次，账本和主张判定都完全一致。
 *
 * 错误处理的分级也很刻意：卡带缺失、配置不全这类属于"环境坏了"，直接抛出，
 * 绝不退化成"这场没有追问"；单个面试官的网络抖动则只记在该面试官的 outcome 里，
 * 其他面试官照常发问。
 */

import type {
  Anchor,
  BudgetState,
  Claim,
  IntentContract,
  JobDescription,
  Probe,
  ProbeDraft,
  Requirement,
  RequirementNote,
  ResumeOutline,
} from '@crossexam/shared';
import { REJECTION_LABEL, canProbe, consumeProbe, openClaims, parseLlmOutput, probeListSchema, resolveAnchor } from '@crossexam/shared';
import type { LlmClient, LlmUsage } from '../llm/types.ts';
import { EMPTY_USAGE, LlmError } from '../llm/types.ts';
import { buildProbePrompt, probeSystem, stageRequest } from './prompts.ts';

/** 一个面试官一轮最多问几条。太多会让"追问"变成"问卷"，追不出深度。 */
export const MAX_PROBES_PER_TURN = 2;

/** 属于"环境坏了"的错误，必须冒泡，不能吞 */
const FATAL_CODES = ['cassette-missing', 'cassette-corrupt', 'cassette-version', 'not-configured'];

export function isFatalLlmError(err: unknown): boolean {
  return err instanceof LlmError && FATAL_CODES.indexOf(err.code) >= 0;
}

export interface RejectedProbe {
  claimId: string;
  question: string;
  /** 可直接展示给用户的中文原因 */
  reason: string;
}

export interface InterviewerOutcome {
  interviewerId: string;
  /** 这个面试官本轮提出的、通过校验的追问数 */
  asked: number;
  rejected: RejectedProbe[];
  usage: LlmUsage;
  /** 非空表示这位面试官本轮调用失败（已在其他面试官继续的前提下被单独记录） */
  error: string | null;
}

export interface ProbeRoundInput {
  client: LlmClient;
  contracts: readonly IntentContract[];
  /** 候选主张全集；内部只挑仍然开放的摆上桌 */
  claims: readonly Claim[];
  resumeText: string;
  outline: ResumeOutline;
  budget: BudgetState;
  /** 第几轮，从 1 开始 */
  round: number;
  /** 全场已问过的追问，用于提示词与去重 */
  history: readonly Probe[];
  maxProbesPerTurn?: number;
  /** 岗位要求与它们的来源 JD：追问要带双锚点时，靠它们把要求原文重新锚回 JD */
  jds?: readonly JobDescription[];
  requirements?: readonly Requirement[];
  requirementNotes?: readonly RequirementNote[];
}

export interface ProbeRoundResult {
  /** 本轮新产生并通过双重校验的追问，按面试官顺序排列（可复现的关键） */
  probes: Probe[];
  rejected: RejectedProbe[];
  outcomes: InterviewerOutcome[];
  /** 记账之后的账本；调用方必须用这个新账本继续 */
  budget: BudgetState;
}

interface RawOutcome {
  contract: IntentContract;
  drafts: ProbeDraft[];
  usage: LlmUsage;
  error: string | null;
}

/**
 * 追问带的「第二条锚」：要求编号 + 要求原文片段。
 * 代码不信模型给的坐标，一律拿 jdQuote 回**那份 JD 的原文**重新定位；
 * 定不到就不带这条锚（并写进 rationale 说明），绝不猜一个位置出来。
 */
function jdAnchorOf(
  input: ProbeRoundInput,
  draft: ProbeDraft,
): { requirementId: string; anchor: Anchor } | null {
  if (draft.requirementId === undefined || draft.jdQuote === undefined) return null;
  const requirement = (input.requirements ?? []).find((item) => item.id === draft.requirementId);
  if (requirement === undefined) return null;
  const jd = (input.jds ?? []).find((item) => item.id === requirement.jdId);
  if (jd === undefined) return null;
  const anchored = resolveAnchor(jd.text, { quote: draft.jdQuote });
  if (!anchored.ok) return null;
  return { requirementId: requirement.id, anchor: anchored.anchor };
}

function normalizeQuestion(q: string): string {
  return q.replace(/\s+/g, '').replace(/[？?！!。，,、]/g, '');
}

function notesFor(contract: IntentContract, state: BudgetState, claims: readonly Claim[]): Record<string, string> {
  const notes: Record<string, string> = {};
  for (const claim of claims) {
    const gate = canProbe(state, claim.id, contract.id);
    const claimState = state.claims[claim.id];
    const used = claimState ? (claimState.perInterviewer[contract.id] ?? 0) : 0;
    const quotaLeft = Math.max(0, state.config.maxProbesPerInterviewerPerClaim - used);
    const globalLeft = gate.allowed ? gate.remainingRounds : 0;
    notes[claim.id] =
      '你已经问过 ' + String(used) + ' 次，你还能问 ' + String(quotaLeft) + ' 次；这条主张全场还剩 ' + String(globalLeft) + ' 轮。';
  }
  return notes;
}

export async function runProbeRound(input: ProbeRoundInput): Promise<ProbeRoundResult> {
  const maxPerTurn = input.maxProbesPerTurn ?? MAX_PROBES_PER_TURN;
  const openIds = new Set(openClaims(input.budget));
  const open = input.claims.filter((c) => openIds.has(c.id));

  if (open.length === 0 || input.contracts.length === 0) {
    return { probes: [], rejected: [], outcomes: [], budget: input.budget };
  }

  // 一位面试官一次调用：并发发起，等待全部返回（含各自失败）。
  const settled = await Promise.all(
    input.contracts.map(async (contract): Promise<RawOutcome> => {
      const request = stageRequest(
        'probe',
        probeSystem(contract),
        buildProbePrompt({
          claims: open,
          notes: notesFor(contract, input.budget, open),
          resumeText: input.resumeText,
          outline: input.outline,
          asked: input.history.filter((p) => p.interviewerId === contract.id),
          round: input.round,
          maxProbes: maxPerTurn,
          // 只把「这一轮真的能问」的那些要求摆上桌：对不上开放主张的要求，
          // 摆出来只会诱导模型硬凑一条追问。
          requirements: (input.requirementNotes ?? []).filter(
            (note) => note.claimId !== null && openIds.has(note.claimId),
          ),
        }),
        'probe:' + contract.id,
      );
      try {
        const result = await input.client.complete(request);
        const parsed = parseLlmOutput(probeListSchema, result.text);
        if (!parsed.ok) {
          return { contract, drafts: [], usage: result.usage ?? EMPTY_USAGE, error: '返回内容不符合约定格式：' + parsed.error };
        }
        return { contract, drafts: parsed.value.probes, usage: result.usage ?? EMPTY_USAGE, error: null };
      } catch (err) {
        if (isFatalLlmError(err)) throw err;
        return {
          contract,
          drafts: [],
          usage: EMPTY_USAGE,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  // 校验与记账：串行，保证结果与并发时序无关。
  let budget = input.budget;
  const probes: Probe[] = [];
  const rejected: RejectedProbe[] = [];
  const outcomes: InterviewerOutcome[] = [];
  const seenQuestions = new Set<string>();
  for (const p of input.history) seenQuestions.add(normalizeQuestion(p.question));
  const lastProbeId = new Map<string, string>();
  for (const p of input.history) lastProbeId.set(p.claimId + '|' + p.interviewerId, p.id);
  const byId = new Map<string, Claim>();
  for (const c of input.claims) byId.set(c.id, c);
  let seq = input.history.length;

  for (const outcome of settled) {
    let asked = 0;
    const localRejected: RejectedProbe[] = [];

    for (const draft of outcome.drafts) {
      if (asked >= maxPerTurn) break;

      const claim = byId.get(draft.claimId);
      if (!claim) {
        localRejected.push({ claimId: draft.claimId, question: draft.question, reason: '引用了不存在的主张编号，已丢弃' });
        continue;
      }
      if (!openIds.has(claim.id)) {
        localRejected.push({ claimId: claim.id, question: draft.question, reason: '该主张已关停（连续答不上来或问满），不再追问' });
        continue;
      }

      const gate = canProbe(budget, claim.id, outcome.contract.id);
      if (!gate.allowed) {
        localRejected.push({ claimId: claim.id, question: draft.question, reason: '预算闸门拦截：' + gate.reason });
        continue;
      }

      const anchored = resolveAnchor(input.resumeText, { quote: draft.quote, start: draft.start, end: draft.end });
      if (!anchored.ok) {
        localRejected.push({
          claimId: claim.id,
          question: draft.question,
          reason: '锚定失败：' + REJECTION_LABEL[anchored.reason] + '（引文「' + draft.quote + '」）',
        });
        continue;
      }

      const key = normalizeQuestion(draft.question);
      if (seenQuestions.has(key)) {
        localRejected.push({ claimId: claim.id, question: draft.question, reason: '与已有的提问重复，已合并' });
        continue;
      }
      seenQuestions.add(key);

      // 第二条锚：只认「要求编号 + 能锚回该 JD 原文的引文」，锚不到就不带，
      // 并在 rationale 里说明这一次为什么没带上——静默丢掉一条锚比丢掉它更糟。
      const requirementAnchor = jdAnchorOf(input, draft);
      const rationale = draft.rationale ?? '';
      const chainKey = claim.id + '|' + outcome.contract.id;
      seq += 1;
      const probe: Probe = {
        id: 'P' + String(seq),
        claimId: claim.id,
        interviewerId: outcome.contract.id,
        round: input.round,
        question: draft.question,
        anchor: anchored.anchor,
        parentProbeId: lastProbeId.get(chainKey) ?? null,
        rationale:
          requirementAnchor === null && draft.requirementId !== undefined
            ? (rationale === '' ? '' : rationale + ' ') +
              '（这次本要带上岗位要求，但要求原文锚不回 JD，已按普通追问处理）'
            : rationale,
        requirementId: requirementAnchor === null ? null : requirementAnchor.requirementId,
        jdAnchor: requirementAnchor === null ? null : requirementAnchor.anchor,
      };
      lastProbeId.set(chainKey, probe.id);
      probes.push(probe);
      budget = consumeProbe(budget, claim.id, outcome.contract.id);
      asked += 1;
    }

    rejected.push(...localRejected);
    outcomes.push({
      interviewerId: outcome.contract.id,
      asked,
      rejected: localRejected,
      usage: outcome.usage,
      error: outcome.error,
    });
  }

  return { probes, rejected, outcomes, budget };
}
