/**
 * 阶段五：反推简历修改建议。
 *
 * 这一步是产品闭环的最后一环：压力测试的意义不在于"证明你不行"，
 * 而在于"告诉你这句话该怎么写"。
 *
 * 四道代码级闸门（都不是提示词里的请求，是拦得住的门）：
 *
 *   1. 只给需要改的主张出建议。判定"站得住"的直接跳过，不为改而改。
 *   2. before 必须是简历原文里定位得到的片段 —— 定位不到，这条建议用户根本没法应用。
 *   3. **after 里不允许出现简历原文没有的数字。** 这是"只能改表述、不能加事实"里
 *      最容易被模型破坏的一条：它很擅长顺手把"重构了订单系统"写成"重构后 QPS 提升 3 倍"。
 *      数字是最硬的编造物，所以这里对数字做指纹比对。
 *   4. after 不能等于 before，否则等于没改。
 */

import type { Anchor, Answer, Claim, Probe, ResumeOutline, RewriteStyle, Suggestion, Verdict, VerdictKind } from '@crossexam/shared';
import { DEFAULT_REWRITE_STYLE, VERDICT_LABEL, parseLlmOutput, resolveAnchor, suggestionDraftSchema } from '@crossexam/shared';
import type { LlmClient, LlmUsage } from '../llm/types.ts';
import { EMPTY_USAGE } from '../llm/types.ts';
import { buildSuggestPrompt, stageRequest, suggestSystem } from './prompts.ts';
import { isFatalLlmError } from './probe.ts';
import type { AnsweredProbe } from './verdict.ts';

/** 只有这些判定值得给出改写建议；站得住的不改 */
export const SUGGESTIBLE: readonly VerdictKind[] = ['overstated', 'unsupported', 'contradicts', 'unanswerable'];

export type SuggestStatus = 'suggested' | 'not-needed' | 'rejected';

export interface SuggestOutcome {
  claimId: string;
  status: SuggestStatus;
  suggestion: Suggestion | null;
  /** 没给出建议 / 建议被拦下时，给用户一个如实的理由 */
  reason: string | null;
}

export interface SuggestError {
  claimId: string;
  message: string;
}

export interface SuggestClaimsInput {
  client: LlmClient;
  claims: readonly Claim[];
  verdicts: readonly Verdict[];
  transcriptByClaim: Readonly<Record<string, readonly AnsweredProbe[]>>;
  resumeText: string;
  outline: ResumeOutline;
  /** 改写风格：只调措辞的收敛程度，事实边界由下面四道闸门兜底。不传按默认档 */
  style?: RewriteStyle;
}

export interface SuggestClaimsResult {
  outcomes: SuggestOutcome[];
  errors: SuggestError[];
  usage: LlmUsage;
}

const DIGIT = /[0-9]+(?:\.[0-9]+)?/g;

/** after 里出现、但简历原文里一次都没出现过的数字 */
export function newNumbersIn(after: string, resumeText: string): string[] {
  const known = new Set(resumeText.match(DIGIT) ?? []);
  const out: string[] = [];
  for (const hit of after.match(DIGIT) ?? []) {
    if (!known.has(hit) && out.indexOf(hit) < 0) out.push(hit);
  }
  return out;
}

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

async function suggestOne(
  input: SuggestClaimsInput,
  claim: Claim,
  verdict: Verdict,
  transcript: readonly AnsweredProbe[],
): Promise<{ outcome: SuggestOutcome; usage: LlmUsage }> {
  const probes: Probe[] = transcript.map((t) => t.probe);
  const answers = transcript.map((t) => t.answer).filter((a): a is Answer => a !== null);
  const request = stageRequest(
    'suggest',
    suggestSystem(input.style ?? DEFAULT_REWRITE_STYLE),
    buildSuggestPrompt({ claim, verdict, probes, answers }),
    'suggest:' + claim.id,
  );
  const result = await input.client.complete(request);
  const parsed = parseLlmOutput(suggestionDraftSchema, result.text);
  if (!parsed.ok) throw new Error('修改建议返回不符合约定格式：' + parsed.error);

  // 归属由调用方决定：模型自报的 claimId 一律不看（它可能编，也可能干脆不写）。
  const draft = parsed.value;
  const before = draft.before.trim();
  const after = draft.after.trim();

  const anchored = resolveAnchor(input.resumeText, { quote: before });
  if (!anchored.ok) {
    return {
      outcome: {
        claimId: claim.id,
        status: 'rejected',
        suggestion: null,
        reason: '建议里的「改前原文」在简历中定位不到，无法应用：' + before,
      },
      usage: result.usage ?? EMPTY_USAGE,
    };
  }

  const invented = newNumbersIn(after, input.resumeText);
  if (invented.length > 0) {
    return {
      outcome: {
        claimId: claim.id,
        status: 'rejected',
        suggestion: null,
        reason: '建议里出现了简历原文中不存在的数字，属于新增事实：' + invented.join('、'),
      },
      usage: result.usage ?? EMPTY_USAGE,
    };
  }

  if (after.length === 0 || after === before) {
    return {
      outcome: {
        claimId: claim.id,
        status: 'rejected',
        suggestion: null,
        reason: '建议改写后与原文相同，等于没改',
      },
      usage: result.usage ?? EMPTY_USAGE,
    };
  }

  const anchor: Anchor = anchored.anchor;
  return {
    outcome: {
      claimId: claim.id,
      status: 'suggested',
      suggestion: {
        claimId: claim.id,
        anchor,
        problem: draft.problem.trim(),
        before,
        after,
        why: draft.why.trim(),
      },
      reason: null,
    },
    usage: result.usage ?? EMPTY_USAGE,
  };
}

/** 逐条主张给出改写建议；已经有判定结果的按判定筛一遍 */
export async function suggestClaims(input: SuggestClaimsInput): Promise<SuggestClaimsResult> {
  const verdictByClaim = new Map<string, Verdict>();
  for (const v of input.verdicts) verdictByClaim.set(v.claimId, v);

  let usage = EMPTY_USAGE;
  const outcomes: SuggestOutcome[] = [];
  const errors: SuggestError[] = [];

  const targets: { claim: Claim; verdict: Verdict }[] = [];
  for (const claim of input.claims) {
    const verdict = verdictByClaim.get(claim.id);
    if (!verdict) {
      outcomes.push({ claimId: claim.id, status: 'not-needed', suggestion: null, reason: '这条主张没有判定结果，先不急着改' });
      continue;
    }
    if (SUGGESTIBLE.indexOf(verdict.kind) < 0) {
      outcomes.push({
        claimId: claim.id,
        status: 'not-needed',
        suggestion: null,
        reason: '判定为「' + VERDICT_LABEL[verdict.kind] + '」，不需要改写',
      });
      continue;
    }
    targets.push({ claim, verdict });
  }

  const settled = await Promise.all(
    targets.map(async (t) => {
      try {
        const done = await suggestOne(input, t.claim, t.verdict, input.transcriptByClaim[t.claim.id] ?? []);
        return { claimId: t.claim.id, done };
      } catch (err) {
        if (isFatalLlmError(err)) throw err;
        return { claimId: t.claim.id, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  for (const item of settled) {
    if ('error' in item && item.error !== undefined) {
      errors.push({ claimId: item.claimId, message: item.error });
      continue;
    }
    if (!('done' in item) || !item.done) continue;
    usage = addUsage(usage, item.done.usage);
    outcomes.push(item.done.outcome);
  }

  return { outcomes, errors, usage };
}
