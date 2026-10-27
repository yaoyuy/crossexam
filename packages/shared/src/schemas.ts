/**
 * LLM 输出的唯一入口（AGENTS.md 第 6 条：模型自由文本不得直接进入数据库）。
 *
 * 每个 schema 都对应一次真实的模型调用。模型返回什么都要先过这里，
 * 不过就带着原始文本一起报错——原始文本会被写进回放记录，用来复现这次失败。
 */

import { z } from 'zod';
import type { ClaimCategory, CounterKind, MatchStatus, RequirementKind, VerdictKind } from './domain.ts';

export const CLAIM_CATEGORY_VALUES = [
  'skill',
  'experience',
  'achievement',
  'metric',
  'ownership',
  'timeline',
  'other',
] as const;

export const VERDICT_KIND_VALUES = [
  'solid',
  'overstated',
  'unsupported',
  'contradicts',
  'unanswerable',
] as const;

export const REQUIREMENT_KIND_VALUES = ['must', 'plus', 'duty'] as const;

export const MATCH_STATUS_VALUES = ['hit', 'weak', 'missing'] as const;

export const COUNTER_KIND_VALUES = ['team', 'tech', 'growth', 'business', 'process'] as const;

type Expect<T extends true> = T;
/** 编译期断言：下面的枚举必须与 domain.ts 的联合类型逐字一致，改一边忘了另一边会直接编译失败 */
export type SchemaMatchesDomain = [
  Expect<ClaimCategory extends (typeof CLAIM_CATEGORY_VALUES)[number] ? true : false>,
  Expect<(typeof CLAIM_CATEGORY_VALUES)[number] extends ClaimCategory ? true : false>,
  Expect<VerdictKind extends (typeof VERDICT_KIND_VALUES)[number] ? true : false>,
  Expect<(typeof VERDICT_KIND_VALUES)[number] extends VerdictKind ? true : false>,
];

/** 同上：岗位要求的两组枚举也必须与 domain.ts 逐字一致 */
export type SchemaMatchesRequirements = [
  Expect<RequirementKind extends (typeof REQUIREMENT_KIND_VALUES)[number] ? true : false>,
  Expect<(typeof REQUIREMENT_KIND_VALUES)[number] extends RequirementKind ? true : false>,
  Expect<MatchStatus extends (typeof MATCH_STATUS_VALUES)[number] ? true : false>,
  Expect<(typeof MATCH_STATUS_VALUES)[number] extends MatchStatus ? true : false>,
];

/** 同上：反问的五类取向也必须与 domain.ts 逐字一致 */
export type SchemaMatchesCounters = [
  Expect<CounterKind extends (typeof COUNTER_KIND_VALUES)[number] ? true : false>,
  Expect<(typeof COUNTER_KIND_VALUES)[number] extends CounterKind ? true : false>,
];

/** 模型给出的锚点候选。start/end 允许给，但我们不会信——见 anchor.ts 的 resolveAnchor */
export const rawAnchorSchema = z.object({
  quote: z.string().min(1).max(400),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
});

export const claimDraftSchema = z.object({
  text: z.string().min(1).max(200),
  quote: z.string().min(1).max(400),
  category: z.enum(CLAIM_CATEGORY_VALUES),
  weight: z.number().min(0).max(1),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
});

export const claimListSchema = z.object({
  claims: z.array(claimDraftSchema).min(1).max(40),
});

export const probeDraftSchema = z.object({
  claimId: z.string().min(1),
  question: z.string().min(1).max(300),
  quote: z.string().min(1).max(400),
  rationale: z.string().max(300).optional(),
  /**
   * 双锚点：命中某条岗位要求时的要求编号与要求原文片段。
   * 两者都是可选的——纯简历场次不会有它们，模型也不该被迫编一个出来。
   */
  requirementId: z.string().min(1).max(24).optional(),
  jdQuote: z.string().min(1).max(400).optional(),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
});

export const probeListSchema = z.object({
  probes: z.array(probeDraftSchema).max(20),
});

export const answerDraftSchema = z.object({
  /** 答不上来就老实说 false，这是被鼓励的行为，不是失败 */
  answered: z.boolean(),
  text: z.string().max(1000),
  citedQuotes: z.array(z.string().min(1).max(400)).max(6).default([]),
});

export const verdictDraftSchema = z.object({
  kind: z.enum(VERDICT_KIND_VALUES),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(600),
  evidenceQuotes: z.array(z.string().min(1).max(400)).max(6).default([]),
});

export const verdictListSchema = z.object({
  verdicts: z.array(verdictDraftSchema).min(1).max(40),
});

/**
 * 模型不需要自报 claimId：修改建议是**一条主张一次调用**，归属由调用方决定。
 * 早先这里把 claimId 写成必填，而提示词里从来没让模型输出它——真实模型照提示词办事，
 * 于是线上每一条建议都被 zod 拦下（离线演示反而绿，因为合成卡带顺手写了 claimId）。
 * 现在改成可选：模型爱回就回，回了也不采信。
 */
export const suggestionDraftSchema = z.object({
  claimId: z.string().min(1).optional(),
  problem: z.string().min(1).max(300),
  /** 现在简历里的原话，必须逐字可回原文 */
  before: z.string().min(1).max(400),
  /** 建议改成什么。不允许引入简历里没有的新事实。 */
  after: z.string().min(1).max(400),
  why: z.string().min(1).max(300),
});

export const suggestionListSchema = z.object({
  suggestions: z.array(suggestionDraftSchema).max(40),
});

/**
 * 岗位要求的三个阶段各一次调用：逐份 JD 抽取 → 跨份合并 → 逐条与主张对照。
 *
 * 三份 schema 都是窄字段：模型多写的一律被丢掉，少写的才报错。
 * 合并阶段用的是 `J1#3` 这种键，而不是我们自己编的 R 编号——编号由代码定序，
 * 让模型来编，回放就对不上了。
 */
export const jdRequirementDraftSchema = z.object({
  text: z.string().min(4).max(200),
  quote: z.string().min(4).max(400),
  kind: z.enum(REQUIREMENT_KIND_VALUES),
  keywords: z.array(z.string().min(1).max(24)).max(6).default([]),
});

export const jdRequirementListSchema = z.object({
  requirements: z.array(jdRequirementDraftSchema).max(20),
});

export const jdGroupDraftSchema = z.object({
  text: z.string().min(4).max(200),
  kind: z.enum(REQUIREMENT_KIND_VALUES),
  members: z.array(z.string().min(1).max(24)).min(1).max(40),
  keywords: z.array(z.string().min(1).max(24)).max(6).default([]),
});

export const jdGroupListSchema = z.object({
  groups: z.array(jdGroupDraftSchema).max(40),
});

export const jdMatchDraftSchema = z.object({
  /** 这条对照说的是哪条要求。编号由代码定序（R1、R2…），模型只负责照着填 */
  requirementId: z.string().min(1).max(24),
  /** 命中的主张编号；没命中就老实给 null，不要硬凑一条 */
  claimId: z.string().min(1).max(24).nullable().default(null),
  status: z.enum(MATCH_STATUS_VALUES),
  reason: z.string().min(1).max(300),
});

export const jdMatchListSchema = z.object({
  matches: z.array(jdMatchDraftSchema).max(40),
});

/**
 * 反问环节的一条草稿。
 * sourceId 是「这句反问的依据出自哪儿」：简历主张编号（C1）或 JD 编号（J1）。
 * 指不出依据的当场丢弃——与追问同一个口径，见 counters.ts。
 */
export const counterDraftSchema = z.object({
  text: z.string().min(4).max(200),
  kind: z.enum(COUNTER_KIND_VALUES),
  reason: z.string().min(4).max(300),
  reply: z.string().min(2).max(400),
  /** 依据原文的逐字片段，代码拿它回原文重新定位，不信模型给的坐标 */
  quote: z.string().min(4).max(400),
  sourceId: z.string().min(1).max(24),
});

export const counterListSchema = z.object({
  counters: z.array(counterDraftSchema).max(10),
});

export type ClaimDraft = z.infer<typeof claimDraftSchema>;
export type ClaimList = z.infer<typeof claimListSchema>;
export type ProbeDraft = z.infer<typeof probeDraftSchema>;
export type ProbeList = z.infer<typeof probeListSchema>;
export type AnswerDraft = z.infer<typeof answerDraftSchema>;
export type VerdictDraft = z.infer<typeof verdictDraftSchema>;
export type VerdictList = z.infer<typeof verdictListSchema>;
export type SuggestionDraft = z.infer<typeof suggestionDraftSchema>;
export type SuggestionList = z.infer<typeof suggestionListSchema>;
export type JdRequirementDraft = z.infer<typeof jdRequirementDraftSchema>;
export type JdRequirementList = z.infer<typeof jdRequirementListSchema>;
export type JdGroupDraft = z.infer<typeof jdGroupDraftSchema>;
export type JdGroupList = z.infer<typeof jdGroupListSchema>;
export type JdMatchDraft = z.infer<typeof jdMatchDraftSchema>;
export type JdMatchList = z.infer<typeof jdMatchListSchema>;
export type CounterDraft = z.infer<typeof counterDraftSchema>;
export type CounterList = z.infer<typeof counterListSchema>;

/** 把 zod 的错误压成一行能写进日志的中文说明 */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => i.path.join('.') + ': ' + i.message)
    .join('; ');
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; raw: string };

/** 统一解析入口。失败时把原始文本一并带回，供回放记录留痕。 */
export function parseLlmOutput<T>(schema: z.ZodType<T>, raw: string): ParseResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(raw));
  } catch (e) {
    return { ok: false, error: '返回的不是合法 JSON：' + (e instanceof Error ? e.message : String(e)), raw };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { ok: false, error: formatIssues(parsed.error), raw };
  return { ok: true, value: parsed.data };
}

/** 模型很爱把 JSON 包在代码围栏里，这里做一次宽容剥离 */
export function stripCodeFence(raw: string): string {
  const fence = String.fromCharCode(96).repeat(3);
  let t = raw.trim();
  if (!t.startsWith(fence)) return t;
  t = t.slice(fence.length);
  const nl = t.indexOf(String.fromCharCode(10));
  if (nl >= 0) t = t.slice(nl + 1);
  const close = t.lastIndexOf(fence);
  if (close >= 0) t = t.slice(0, close);
  return t.trim();
}
