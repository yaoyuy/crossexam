/**
 * LLM 输出的唯一入口（AGENTS.md 第 6 条：模型自由文本不得直接进入数据库）。
 *
 * 每个 schema 都对应一次真实的模型调用。模型返回什么都要先过这里，
 * 不过就带着原始文本一起报错——原始文本会被写进回放记录，用来复现这次失败。
 */

import { z } from 'zod';
import type { ClaimCategory, VerdictKind } from './domain.ts';

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

type Expect<T extends true> = T;
/** 编译期断言：下面的枚举必须与 domain.ts 的联合类型逐字一致，改一边忘了另一边会直接编译失败 */
export type SchemaMatchesDomain = [
  Expect<ClaimCategory extends (typeof CLAIM_CATEGORY_VALUES)[number] ? true : false>,
  Expect<(typeof CLAIM_CATEGORY_VALUES)[number] extends ClaimCategory ? true : false>,
  Expect<VerdictKind extends (typeof VERDICT_KIND_VALUES)[number] ? true : false>,
  Expect<(typeof VERDICT_KIND_VALUES)[number] extends VerdictKind ? true : false>,
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

export const suggestionDraftSchema = z.object({
  claimId: z.string().min(1),
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

export type ClaimDraft = z.infer<typeof claimDraftSchema>;
export type ClaimList = z.infer<typeof claimListSchema>;
export type ProbeDraft = z.infer<typeof probeDraftSchema>;
export type ProbeList = z.infer<typeof probeListSchema>;
export type AnswerDraft = z.infer<typeof answerDraftSchema>;
export type VerdictDraft = z.infer<typeof verdictDraftSchema>;
export type VerdictList = z.infer<typeof verdictListSchema>;
export type SuggestionDraft = z.infer<typeof suggestionDraftSchema>;
export type SuggestionList = z.infer<typeof suggestionListSchema>;

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
