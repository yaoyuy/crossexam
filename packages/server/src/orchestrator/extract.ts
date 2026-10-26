/**
 * 阶段一：从简历里抽取「可被追问的主张」。
 *
 * 这一步是整条流水线的入口，也是「证据锚定」创新点第一次真正生效的地方：
 * 模型返回的 start/end 一律不看，只拿它的 quote 回原文重新定位。定不到就**丢弃**，
 * 并把丢弃原因原样交给前端——那些被拦下来的主张是可以展示的产物，不是日志。
 *
 * 主张 id 用 C1、C2、C3 这样的序号，而不是随机 id：回放要求同样的输入得到同样的 id，
 * 否则卡带里的 claimId 对不上。随机数在这个项目里是缺陷，不是特性。
 */

import type { AnchorRejection, Claim, RejectedClaim, ResumeOutline } from '@crossexam/shared';
import { REJECTION_LABEL, claimListSchema, parseLlmOutput, resolveAnchor, segmentResume } from '@crossexam/shared';
import type { LlmClient, LlmUsage } from '../llm/types.ts';
import { EMPTY_USAGE } from '../llm/types.ts';
import { EXTRACT_SYSTEM, buildExtractPrompt, stageRequest } from './prompts.ts';

/** 一场沙盘追太多条主张没有意义：追问预算是有限的，摊薄了每条都不深 */
export const DEFAULT_MAX_CLAIMS = 12;

export interface ExtractClaimsInput {
  client: LlmClient;
  resumeText: string;
  jdText: string;
  /** 复用已切分好的大纲，省一次切分；不传则内部切 */
  outline?: ResumeOutline;
  maxClaims?: number;
}

export interface ExtractClaimsResult {
  claims: Claim[];
  /** 被锚定机制拦下的主张——前端要展示它们，这是"AI 没有乱问"的正面证据 */
  rejected: RejectedClaim[];
  /** 模型原始输出，解析失败时用于排查与回放留痕 */
  raw: string;
  usage: LlmUsage;
  digest: string;
}

export class ExtractError extends Error {
  readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = 'ExtractError';
    this.raw = raw;
  }
}

function claimId(index: number): string {
  return 'C' + String(index + 1);
}

/**
 * 抽取并锚定。
 * 校验顺序刻意如此：先整体过 zod（形状不对就整批失败，因为这说明提示词或模型出了系统性问题），
 * 再**逐条**做锚定（锚不到只丢这一条）。粒度不同的错误用不同的处理方式。
 */
export async function extractClaims(input: ExtractClaimsInput): Promise<ExtractClaimsResult> {
  const outline = input.outline ?? segmentResume(input.resumeText);
  const maxClaims = input.maxClaims ?? DEFAULT_MAX_CLAIMS;

  const request = stageRequest(
    'extract',
    EXTRACT_SYSTEM,
    buildExtractPrompt({ resumeText: input.resumeText, outline, jdText: input.jdText, maxClaims }),
  );
  const result = await input.client.complete(request);
  const parsed = parseLlmOutput(claimListSchema, result.text);
  if (!parsed.ok) {
    throw new ExtractError('主张抽取失败：' + parsed.error, parsed.raw);
  }

  const claims: Claim[] = [];
  const rejected: RejectedClaim[] = [];
  const seen = new Set<string>();
  let ordinal = 0;

  for (const draft of parsed.value.claims) {
    const key = draft.quote.trim();
    if (seen.has(key)) continue;
    seen.add(key);

    const anchored = resolveAnchor(input.resumeText, { quote: draft.quote, start: draft.start, end: draft.end });
    if (!anchored.ok) {
      rejected.push({
        text: draft.text,
        quote: draft.quote,
        reason: REJECTION_LABEL[anchored.reason as AnchorRejection] + '：「' + draft.quote + '」',
      });
      continue;
    }
    if (claims.length >= maxClaims) continue;

    claims.push({
      id: claimId(ordinal),
      text: draft.text,
      anchor: anchored.anchor,
      category: draft.category,
      weight: draft.weight,
    });
    ordinal += 1;
  }

  return {
    claims,
    rejected,
    raw: result.text,
    usage: result.usage ?? EMPTY_USAGE,
    digest: result.digest,
  };
}

/** 按追问价值排序，权重高的先上庭。稳定排序，同权重保持原顺序。 */
export function rankClaims(claims: readonly Claim[]): Claim[] {
  return claims
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (b.c.weight - a.c.weight) || (a.i - b.i))
    .map((x) => x.c);
}
