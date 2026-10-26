/**
 * 阶段三：求职者 Agent 作答。
 *
 * 这个 Agent 存在的理由不是"代替用户"，而是**让离线演示成为可能**：
 * 没有 API Key 的评委也能看到一场完整的多 Agent 对抗。
 * 它的纪律写在提示词里，也写在代码里：
 *
 * - 只依据简历作答。简历没写就说"简历里没有写"，**答不上来是被鼓励的诚实行为**。
 *   如果它每次都答得漂亮，这场压力测试就没有意义了。
 * - 引用简历原文时，引文同样要过锚定。定不到的引文被丢弃并单独记录——
 *   我们不改写它的回答（面试里本来就允许口头解释细节），
 *   但**不允许它伪造一句"简历原文"**。
 *
 * 注意一个刻意的取舍：answer.answered 这个布尔值只在运行期使用（驱动预算账本里
 * "连续答不上来"的计数、写进事件日志），答案本身存的是它真正说的话。
 * 于是数据库里不会多一个需要迁移的列，而重放事件仍能还原当时的判断。
 */

import type { Anchor, Answer, Claim, Probe, ResumeOutline } from '@crossexam/shared';
import { parseLlmOutput, resolveAnchor } from '@crossexam/shared';
import { answerDraftSchema } from '@crossexam/shared';
import type { LlmClient, LlmUsage } from '../llm/types.ts';
import { EMPTY_USAGE } from '../llm/types.ts';
import { ANSWER_SYSTEM, buildAnswerPrompt, stageRequest } from './prompts.ts';
import { isFatalLlmError } from './probe.ts';

export interface AnswerOutcome {
  /** 落库用的答案；text 就是它真正说的话 */
  answer: Answer;
  /** 是否给出了有效信息。false = 老实说"简历里没有写" */
  answered: boolean;
  /** 声称引自简历、但在原文里定位失败的引文——候选人在"编原文"的证据 */
  droppedCitations: string[];
}

export interface AnswerProbesInput {
  client: LlmClient;
  probes: readonly Probe[];
  claims: readonly Claim[];
  resumeText: string;
  outline: ResumeOutline;
  /** 本批次之前已经问过的问题，用于保持口径一致 */
  history: readonly Probe[];
}

export interface AnswerError {
  probeId: string;
  message: string;
}

export interface AnswerProbesResult {
  outcomes: AnswerOutcome[];
  errors: AnswerError[];
  usage: LlmUsage;
}

export function emptyAnswer(probeId: string): Answer {
  return { probeId, text: '', mode: 'simulated', citedAnchors: [] };
}

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

/** 单条作答。解析失败按"非致命"处理，由调用方决定如何呈现。 */
async function answerOne(
  input: AnswerProbesInput,
  probe: Probe,
  claim: Claim,
): Promise<{ outcome: AnswerOutcome; usage: LlmUsage }> {
  const request = stageRequest(
    'answer',
    ANSWER_SYSTEM,
    buildAnswerPrompt({
      claim,
      probe,
      resumeText: input.resumeText,
      outline: input.outline,
      history: input.history.filter((p) => p.id !== probe.id),
    }),
    'answer:' + probe.id,
  );
  const result = await input.client.complete(request);
  const parsed = parseLlmOutput(answerDraftSchema, result.text);
  if (!parsed.ok) {
    throw new Error('作答返回不符合约定格式：' + parsed.error);
  }

  const cited: Anchor[] = [];
  const dropped: string[] = [];
  for (const quote of parsed.value.citedQuotes ?? []) {
    const anchored = resolveAnchor(input.resumeText, { quote });
    if (anchored.ok) cited.push(anchored.anchor);
    else dropped.push(quote);
  }

  const text = parsed.value.text.trim();
  const answered = parsed.value.answered && text.length > 0;
  return {
    outcome: {
      answer: { probeId: probe.id, text, mode: 'simulated', citedAnchors: cited },
      answered,
      droppedCitations: dropped,
    },
    usage: result.usage ?? EMPTY_USAGE,
  };
}

/**
 * 一批追问并发作答。
 * 失败分级沿用追问那一层：环境坏了（卡带/配置）直接抛；单条解析失败只记录，
 * 该追问保持"未作答"，不会被伪造成一次答不上来。
 */
export async function answerProbes(input: AnswerProbesInput): Promise<AnswerProbesResult> {
  const byId = new Map<string, Claim>();
  for (const c of input.claims) byId.set(c.id, c);

  let usage = EMPTY_USAGE;
  const outcomes: AnswerOutcome[] = [];
  const errors: AnswerError[] = [];

  interface Settled {
    probeId: string;
    done?: { outcome: AnswerOutcome; usage: LlmUsage };
    error?: string;
  }

  const settled: Settled[] = await Promise.all(
    input.probes.map(async (probe): Promise<Settled> => {
      const claim = byId.get(probe.claimId);
      if (!claim) return { probeId: probe.id, error: '追问引用了不存在的主张' };
      try {
        const done = await answerOne(input, probe, claim);
        return { probeId: probe.id, done };
      } catch (err) {
        if (isFatalLlmError(err)) throw err;
        return { probeId: probe.id, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  for (const item of settled) {
    if (item.error !== undefined) {
      errors.push({ probeId: item.probeId, message: item.error });
      continue;
    }
    if (!item.done) continue;
    usage = addUsage(usage, item.done.usage);
    outcomes.push(item.done.outcome);
  }

  return { outcomes, errors, usage };
}

/** 从作答结果里取出"这条主张这次答上了没有"，供预算账本使用 */
export function answeredFor(result: AnswerProbesResult, probeId: string): boolean {
  const hit = result.outcomes.find((o) => o.answer.probeId === probeId);
  return hit ? hit.answered : false;
}
