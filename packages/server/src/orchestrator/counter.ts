/**
 * 阶段七：反问环节（沙盘跑完之后，轮到求职者提问）。
 *
 * 一次调用出全部内容——与 jd-merge / jd-match 同一个理由：卡带只多一盘。
 * 模型只负责「想问题」，编号 Q1..Qn 与锚定全部由 shared/counters.ts 决定，
 * 于是同一个输入在回放里必然得到同一批编号。
 *
 * 定位是**锦上添花**：解析失败只记 notice 并把这一节留空，不让整场沙盘白跑。
 * 但客户端本身的错误照旧冒泡——卡带缺失必须响，那是可复现性契约的一部分。
 */

import type {
  Claim,
  CounterQuestion,
  JobDescription,
  RejectedCounter,
  Requirement,
  VerdictKind,
} from '@crossexam/shared';
import { counterListSchema, groundCounters, parseLlmOutput } from '@crossexam/shared';
import type { LlmClient, LlmUsage } from '../llm/types.ts';
import { EMPTY_USAGE } from '../llm/types.ts';
import { COUNTER_SYSTEM, buildCounterPrompt, stageRequest } from './prompts.ts';

export interface CounterRoundInput {
  client: LlmClient;
  resumeText: string;
  jds: readonly JobDescription[];
  requirements: readonly Requirement[];
  claims: readonly Claim[];
  /** 主张 id → 判定；标了判定的主张不会被拿来反问 */
  verdicts?: ReadonlyMap<string, VerdictKind>;
  maxCounters?: number;
}

export interface CounterRoundResult {
  counters: CounterQuestion[];
  rejected: RejectedCounter[];
  notices: string[];
  raw: string;
  usage: LlmUsage;
  digest: string;
}

export async function counterRound(input: CounterRoundInput): Promise<CounterRoundResult> {
  const base = { counters: [] as CounterQuestion[], rejected: [] as RejectedCounter[], raw: '', usage: EMPTY_USAGE, digest: '' };
  if (input.claims.length === 0 && input.jds.length === 0) {
    // 没有材料就没有依据。这时候连一次调用都不发，省一盘卡带。
    return { ...base, notices: ['这场没有可依据的材料（没有 JD，也没有抽出主张），没有生成反问'] };
  }
  const request = stageRequest(
    'counter',
    COUNTER_SYSTEM,
    buildCounterPrompt({
      jds: input.jds,
      requirements: input.requirements,
      claims: input.claims,
      verdicts: input.verdicts,
    }),
  );
  const result = await input.client.complete(request);
  const parsed = parseLlmOutput(counterListSchema, result.text);
  if (!parsed.ok) {
    return {
      ...base,
      raw: result.text,
      usage: result.usage ?? EMPTY_USAGE,
      digest: result.digest,
      notices: ['反问环节没有走通（' + parsed.error + '），这一节留空'],
    };
  }
  const grounded = groundCounters({
    resumeText: input.resumeText,
    jds: input.jds,
    claims: input.claims,
    drafts: parsed.value.counters,
    maxCounters: input.maxCounters,
  });
  return {
    counters: grounded.counters,
    rejected: grounded.rejected,
    notices: grounded.notices,
    raw: result.text,
    usage: result.usage ?? EMPTY_USAGE,
    digest: result.digest,
  };
}
