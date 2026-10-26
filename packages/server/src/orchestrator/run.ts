/**
 * 一次完整的质询沙盘。
 *
 * 这里是"多 Agent 对抗"真正的样子：抽取 → N 轮并发追问 → 作答 → 判定 → 反推建议。
 * 它被刻意写成一个纯函数式的编排层：不碰数据库、不碰 HTTP、不碰时间，
 * 只依赖注入进来的 LlmClient。于是同一份输入在 live / record / replay 三种模式下
 * 走的是**同一条代码路径**，差别只在客户端从哪儿拿文本。
 * 数据库与 SSE 由调用方接在 onEvent 上——回放时事件序列逐字节可比。
 *
 * 循环终止靠三重保险，缺一不可：
 *   1. round 上限（编排层的保险丝）
 *   2. 预算账本（每主张轮数、每面试官额度、全场总次数；这是真正的闸门）
 *   3. 一轮下来没有任何新追问就停（模型无话可说时不必空转）
 * 因此"死循环"不是被提示词求着别发生，而是在设计上不存在。
 */

import type {
  Answer,
  Claim,
  IntentContract,
  InterviewerRole,
  Probe,
  RejectedClaim,
  ResumeOutline,
  Suggestion,
  Verdict,
} from '@crossexam/shared';
import {
  DEFAULT_BUDGET,
  budgetSnapshot,
  buildContracts,
  initBudget,
  openClaims,
  probeableClaims,
  recordAnswer,
  segmentResume,
} from '@crossexam/shared';
import type { BudgetConfig, BudgetSnapshot, BudgetState } from '@crossexam/shared';
import type { LlmClient, LlmUsage } from '../llm/types.ts';
import { EMPTY_USAGE } from '../llm/types.ts';
import { DEFAULT_MAX_CLAIMS, extractClaims } from './extract.ts';
import type { RejectedProbe } from './probe.ts';
import { runProbeRound } from './probe.ts';
import { answerProbes } from './answer.ts';
import type { AnswerError, AnswerOutcome } from './answer.ts';
import { verdictClaims } from './verdict.ts';
import type { AnsweredProbe, VerdictError, VerdictOutcome } from './verdict.ts';
import { suggestClaims } from './suggest.ts';
import type { SuggestError, SuggestOutcome } from './suggest.ts';

export const DEFAULT_PANEL: readonly InterviewerRole[] = ['tech', 'hr', 'hiring_manager'];
export const DEFAULT_MAX_ROUNDS = 3;

export type RunEvent =
  | { type: 'stage'; stage: string; round: number | null }
  | { type: 'claims'; claims: Claim[]; rejected: RejectedClaim[] }
  | { type: 'probes'; round: number; probes: Probe[]; rejected: RejectedProbe[] }
  | { type: 'answers'; answers: AnswerOutcome[]; errors: AnswerError[] }
  | { type: 'budget'; totalProbes: number; open: string[]; closed: string[] }
  | { type: 'verdicts'; verdicts: VerdictOutcome[]; errors: VerdictError[] }
  | { type: 'suggestions'; suggestions: SuggestOutcome[]; errors: SuggestError[] }
  | { type: 'error'; fatal: boolean; message: string };

export interface RunSessionInput {
  client: LlmClient;
  resumeText: string;
  jdText?: string;
  panel?: readonly InterviewerRole[];
  /**
   * 直接给契约（自定义面试官走这条）。
   * 传了它就完全以它为准，panel 只作为「谁上场」的 id 视图被推导出来——
   * 两处各算一遍契约，迟早会出现「界面上是这一份、跑的是另一份」。
   */
  contracts?: readonly IntentContract[];
  budgetConfig?: BudgetConfig;
  maxRounds?: number;
  maxClaims?: number;
  maxProbesPerTurn?: number;
  /** 已切好的简历（前端预览过就传进来，避免重复切） */
  outline?: ResumeOutline;
  /** 每个事件都会同步回调一次：数据库写入与 SSE 推送都接在这里 */
  onEvent?: (event: RunEvent) => void | Promise<void>;
}

export interface RunSessionResult {
  resumeText: string;
  jdText: string;
  outline: ResumeOutline;
  panel: readonly InterviewerRole[];
  contracts: IntentContract[];
  claims: Claim[];
  rejectedClaims: RejectedClaim[];
  probes: Probe[];
  transcriptByClaim: Record<string, AnsweredProbe[]>;
  verdicts: Verdict[];
  verdictDetails: VerdictOutcome[];
  suggestions: Suggestion[];
  suggestionDetails: SuggestOutcome[];
  budget: BudgetSnapshot;
  /** 预算的原始状态：落库与续跑要的是它，快照只是给人看的视图 */
  budgetState: BudgetState;
  rounds: number;
  /** 如实记录"哪里没跑通"，不假装一切顺利 */
  notices: string[];
  usage: LlmUsage;
}

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

function closedClaims(budget: BudgetState): string[] {
  return Object.keys(budget.claims).filter((id) => budget.claims[id]?.closed === true);
}

export async function runSession(input: RunSessionInput): Promise<RunSessionResult> {
  const panel = input.panel ?? DEFAULT_PANEL;
  const budgetConfig = input.budgetConfig ?? DEFAULT_BUDGET;
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const jdText = input.jdText ?? '';
  const outline = input.outline ?? segmentResume(input.resumeText);
  const contracts: IntentContract[] =
    input.contracts !== undefined && input.contracts.length > 0
      ? [...input.contracts]
      : buildContracts(panel, budgetConfig, 1);
  // 谁上场以契约 id 为准：预算闸门按 id 记账，界面也按 id 渲染卡片，两边必须是同一份名单。
  const roster: readonly string[] = contracts.map((contract) => contract.id);
  const notices: string[] = [];

  let usage = EMPTY_USAGE;
  async function emit(event: RunEvent): Promise<void> {
    if (input.onEvent) await input.onEvent(event);
  }

  try {
    await emit({ type: 'stage', stage: 'extract', round: null });
    const extracted = await extractClaims({
      client: input.client,
      resumeText: input.resumeText,
      jdText,
      outline,
      maxClaims: input.maxClaims ?? DEFAULT_MAX_CLAIMS,
    });
    usage = addUsage(usage, extracted.usage);
    await emit({ type: 'claims', claims: extracted.claims, rejected: extracted.rejected });
    if (extracted.rejected.length > 0) {
      notices.push('有 ' + String(extracted.rejected.length) + ' 条主张因为锚不到简历原文被丢弃');
    }

    const claims = extracted.claims;
    if (claims.length === 0) {
      notices.push('没有抽到可被追问的主张，请检查简历内容是否够具体');
    }
    const transcriptByClaim: Record<string, AnsweredProbe[]> = {};
    for (const c of claims) transcriptByClaim[c.id] = [];

    let budget = initBudget(
      claims.map((c) => c.id),
      budgetConfig,
    );

    const history: Probe[] = [];
    let rounds = 0;

    while (rounds < maxRounds && probeableClaims(budget, roster).length > 0) {
      rounds += 1;
      const round = rounds;
      await emit({ type: 'stage', stage: 'probe', round });
      const probed = await runProbeRound({
        client: input.client,
        contracts,
        claims,
        resumeText: input.resumeText,
        outline,
        budget,
        round,
        history,
        maxProbesPerTurn: input.maxProbesPerTurn,
      });
      budget = probed.budget;
      for (const o of probed.outcomes) usage = addUsage(usage, o.usage);
      await emit({ type: 'probes', round, probes: probed.probes, rejected: probed.rejected });

      if (probed.probes.length === 0) {
        notices.push('第 ' + String(round) + ' 轮没有任何新的追问，质询到此结束');
        break;
      }

      await emit({ type: 'stage', stage: 'answer', round });
      const answered = await answerProbes({
        client: input.client,
        probes: probed.probes,
        claims,
        resumeText: input.resumeText,
        outline,
        history,
      });
      usage = addUsage(usage, answered.usage);
      await emit({ type: 'answers', answers: answered.outcomes, errors: answered.errors });
      if (answered.errors.length > 0) {
        notices.push('有 ' + String(answered.errors.length) + ' 条追问没有拿到回答，按未作答处理');
      }

      const outcomeByProbe = new Map<string, AnswerOutcome>();
      for (const o of answered.outcomes) outcomeByProbe.set(o.answer.probeId, o);

      for (const probe of probed.probes) {
        const hit = outcomeByProbe.get(probe.id);
        const answer: Answer | null = hit ? hit.answer : null;
        const bucket = transcriptByClaim[probe.claimId] ?? [];
        bucket.push({ probe, answer, answered: hit ? hit.answered : false });
        transcriptByClaim[probe.claimId] = bucket;
        budget = recordAnswer(budget, probe.claimId, hit ? hit.answered : false);
        history.push(probe);
      }

      await emit({
        type: 'budget',
        totalProbes: budget.totalProbes,
        open: openClaims(budget),
        closed: closedClaims(budget),
      });
    }

    await emit({ type: 'stage', stage: 'verdict', round: null });
    const judged = await verdictClaims({
      client: input.client,
      claims,
      transcriptByClaim,
      resumeText: input.resumeText,
      outline,
    });
    usage = addUsage(usage, judged.usage);
    await emit({ type: 'verdicts', verdicts: judged.outcomes, errors: judged.errors });
    if (judged.errors.length > 0) {
      notices.push('有 ' + String(judged.errors.length) + ' 条主张没能给出判定');
    }
    const verdicts = judged.outcomes.map((o) => o.verdict);

    await emit({ type: 'stage', stage: 'suggest', round: null });
    const advised = await suggestClaims({
      client: input.client,
      claims,
      verdicts,
      transcriptByClaim,
      resumeText: input.resumeText,
      outline,
    });
    usage = addUsage(usage, advised.usage);
    await emit({ type: 'suggestions', suggestions: advised.outcomes, errors: advised.errors });

    const suggestions: Suggestion[] = [];
    for (const o of advised.outcomes) {
      if (o.suggestion) suggestions.push(o.suggestion);
      else if (o.status === 'rejected' && o.reason) notices.push('一条修改建议被拦下：' + o.reason);
    }

    return {
      resumeText: input.resumeText,
      jdText,
      outline,
      panel: roster as readonly InterviewerRole[],
      contracts,
      claims,
      rejectedClaims: extracted.rejected,
      probes: history,
      transcriptByClaim,
      verdicts,
      verdictDetails: judged.outcomes,
      suggestions,
      suggestionDetails: advised.outcomes,
      budget: budgetSnapshot(budget),
      budgetState: budget,
      rounds,
      notices,
      usage,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await emit({ type: 'error', fatal: true, message });
    throw err;
  }
}
