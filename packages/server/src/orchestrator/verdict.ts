/**
 * 阶段四：复盘判定。
 *
 * 这是整条流水线的结论层，也是"意图控制"最该被看见的地方：
 * 判定不是模型的自由心证，而是模型给出**候选判定 + 可定位的原文证据**之后，
 * 由代码再收敛一次。收敛规则全部是确定性的、可解释的、可以写进技术文档的：
 *
 *   1. 说"站得住"或"与原文矛盾"，就必须拿得出能定位到简历原文的证据。
 *      拿不出来 —— 无论模型多自信 —— 一律降级为"证据缺失"。
 *   2. 候选人对这条主张的所有追问都没给出有效回答 —— 无论模型怎么判 ——
 *      一律判"无法回答"。因为这时缺少信息的是我们，不是简历。
 *
 * 归一化后的 confidence 与降级理由都会留下来，前端可以如实展示
 * "模型原本判什么、为什么被改成什么"，这比一个漂亮的假结论有用得多。
 * probeIds 由代码从问答记录里取，不信模型自己数的那一串。
 */

import type { Anchor, Answer, Claim, Probe, ResumeOutline, Verdict, VerdictKind } from '@crossexam/shared';
import { VERDICT_LABEL, clamp, parseLlmOutput, resolveAnchor, verdictDraftSchema } from '@crossexam/shared';
import type { LlmClient, LlmUsage } from '../llm/types.ts';
import { EMPTY_USAGE } from '../llm/types.ts';
import { VERDICT_SYSTEM, buildVerdictPrompt, stageRequest } from './prompts.ts';
import { isFatalLlmError } from './probe.ts';

/** 一条追问连同它的回答（answer 为 null 表示当时没答上来 / 没拿到回答） */
export interface AnsweredProbe {
  probe: Probe;
  answer: Answer | null;
  answered: boolean;
}

export interface VerdictOutcome {
  verdict: Verdict;
  /** 是否被代码收敛过 */
  adjusted: boolean;
  adjustmentReason: string | null;
  /** 声称是证据、但定位不到原文的引文 */
  droppedEvidence: string[];
}

export interface VerdictError {
  claimId: string;
  message: string;
}

export interface VerdictClaimsInput {
  client: LlmClient;
  claims: readonly Claim[];
  /** 按主张分组的问答记录；没有追问过的主张给空数组 */
  transcriptByClaim: Readonly<Record<string, readonly AnsweredProbe[]>>;
  resumeText: string;
  outline: ResumeOutline;
}

export interface VerdictClaimsResult {
  outcomes: VerdictOutcome[];
  errors: VerdictError[];
  usage: LlmUsage;
}

export const NO_EVIDENCE_REASON = '模型拿不出可定位到简历原文的证据，按「证据缺失」处理';
export const ALL_UNANSWERED_REASON = '候选人对这条主张的追问没能落出口径，原文这一句不足以判为「站得住」，按「证据缺失」处理';

/** 需要证据支撑的判定：说好话和说坏话都得有原文 */
const NEEDS_EVIDENCE: readonly VerdictKind[] = ['solid', 'contradicts'];

export function enforceVerdict(input: {
  claimId: string;
  draft: { kind: VerdictKind; confidence: number; rationale: string };
  evidence: readonly Anchor[];
  transcript: readonly AnsweredProbe[];
}): { verdict: Verdict; adjusted: boolean; adjustmentReason: string | null } {
  const base: Verdict = {
    claimId: input.claimId,
    kind: input.draft.kind,
    confidence: clamp(input.draft.confidence, 0, 1),
    rationale: input.draft.rationale,
    evidence: [...input.evidence],
    probeIds: input.transcript.map((t) => t.probe.id),
  };

  const askedSomething = input.transcript.length > 0;
  const answeredNothing = askedSomething && input.transcript.every((t) => !t.answered);
  // 全部追问都没答上来时，唯一必须拦的是「站得住」：原文里的这句话在面试现场没能
  // 落出口径，不能因为简历写了就判它撑得住。其余判定以模型为准——它看得到每一轮
  // 问答，比一个「全体未答」的布尔更清楚该算证据缺失（简历写得太笼统）还是
  // 无法回答（候选人自己拿不出东西）。改判「无法回答」曾把模型判的证据缺失全部
  // 吃掉，界面上就会出现「理由说证据缺失、徽章写无法回答」。
  if (answeredNothing && base.kind === 'solid') {
    return {
      verdict: { ...base, kind: 'unsupported' },
      adjusted: true,
      adjustmentReason: ALL_UNANSWERED_REASON,
    };
  }

  if (NEEDS_EVIDENCE.indexOf(base.kind) >= 0 && base.evidence.length === 0) {
    return {
      verdict: { ...base, kind: 'unsupported' },
      adjusted: true,
      adjustmentReason: '模型判为「' + VERDICT_LABEL[base.kind] + '」但' + NO_EVIDENCE_REASON,
    };
  }

  return { verdict: base, adjusted: false, adjustmentReason: null };
}

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

async function verdictOne(
  input: VerdictClaimsInput,
  claim: Claim,
  transcript: readonly AnsweredProbe[],
): Promise<{ outcome: VerdictOutcome; usage: LlmUsage }> {
  const probes = transcript.map((t) => t.probe);
  const answers = transcript.map((t) => t.answer).filter((a): a is Answer => a !== null);
  const request = stageRequest(
    'verdict',
    VERDICT_SYSTEM,
    buildVerdictPrompt({ claim, probes, answers, resumeText: input.resumeText, outline: input.outline }),
    'verdict:' + claim.id,
  );
  const result = await input.client.complete(request);
  const parsed = parseLlmOutput(verdictDraftSchema, result.text);
  if (!parsed.ok) throw new Error('判定返回不符合约定格式：' + parsed.error);

  const evidence: Anchor[] = [];
  const dropped: string[] = [];
  for (const quote of parsed.value.evidenceQuotes ?? []) {
    const anchored = resolveAnchor(input.resumeText, { quote });
    if (anchored.ok) evidence.push(anchored.anchor);
    else dropped.push(quote);
  }

  const enforced = enforceVerdict({
    claimId: claim.id,
    draft: parsed.value,
    evidence,
    transcript,
  });
  return {
    outcome: {
      verdict: enforced.verdict,
      adjusted: enforced.adjusted,
      adjustmentReason: enforced.adjustmentReason,
      droppedEvidence: dropped,
    },
    usage: result.usage ?? EMPTY_USAGE,
  };
}

/** 逐条主张并发判定；失败分级与其他阶段一致 */
export async function verdictClaims(input: VerdictClaimsInput): Promise<VerdictClaimsResult> {
  interface Settled {
    claimId: string;
    done?: { outcome: VerdictOutcome; usage: LlmUsage };
    error?: string;
  }

  const settled: Settled[] = await Promise.all(
    input.claims.map(async (claim): Promise<Settled> => {
      const transcript = input.transcriptByClaim[claim.id] ?? [];
      try {
        const done = await verdictOne(input, claim, transcript);
        return { claimId: claim.id, done };
      } catch (err) {
        if (isFatalLlmError(err)) throw err;
        return { claimId: claim.id, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  let usage = EMPTY_USAGE;
  const outcomes: VerdictOutcome[] = [];
  const errors: VerdictError[] = [];
  for (const item of settled) {
    if (item.error !== undefined) {
      errors.push({ claimId: item.claimId, message: item.error });
      continue;
    }
    if (!item.done) continue;
    usage = addUsage(usage, item.done.usage);
    outcomes.push(item.done.outcome);
  }
  return { outcomes, errors, usage };
}
