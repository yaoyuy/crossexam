/**
 * 反问环节：把「你有什么想问我们的吗」也做成有依据的产物。
 *
 * 三条硬规矩（与追问同源）：
 * 1. **没有材料就没有反问**。每一句反问都要指出依据出自哪份 JD 的哪句话，
 *    或者简历里的哪条主张；指不出来的当场丢弃并记中文理由。
 * 2. id 按模型返回顺序编 Q1..Qn，被丢弃的条目不吃号——回放要求同样的输入得到同样的 id。
 *    随机数在这个项目里是缺陷，不是特性（同 extract.ts）。
 * 3. 条数上限小（默认 6）：反问是「你想了解什么」，不是把简历再问一遍。
 */

import type {
  Anchor,
  Claim,
  CounterKind,
  CounterQuestion,
  CounterSource,
  JobDescription,
  RejectedCounter,
} from './domain.ts';
import { COUNTER_SOURCE_LABEL } from './domain.ts';
import { resolveAnchor } from './anchor.ts';

export const COUNTER_LIMITS = {
  minChars: 4,
  maxChars: 200,
  maxReasonChars: 300,
  maxReplyChars: 400,
  maxCounters: 6,
  maxDrafts: 10,
} as const;

/** 界面与报告都按这个顺序分组，避免两处各排一套 */
export const COUNTER_KIND_ORDER: readonly CounterKind[] = ['team', 'tech', 'growth', 'business', 'process'];

/** 模型返回的一条反问草稿（结构上兼容 schemas.ts 的 counterDraftSchema） */
export interface RawCounterDraft {
  text: string;
  kind: CounterKind;
  reason: string;
  reply: string;
  quote: string;
  sourceId: string;
}

export interface GroundCountersInput {
  resumeText: string;
  jds: readonly JobDescription[];
  claims: readonly Claim[];
  drafts: readonly RawCounterDraft[];
  maxCounters?: number;
  /** 引文最短长度；比这更短的「依据」不可能是真引文 */
  minQuoteLength?: number;
}

export interface GroundCountersResult {
  counters: CounterQuestion[];
  rejected: RejectedCounter[];
  notices: string[];
}

export function counterId(index: number): string {
  return 'Q' + String(index + 1);
}

/** 回原文定位。定不到就是 null，没有第二种「大概在这里」的说法 */
function groundOne(sourceText: string, quote: string, minQuoteLength: number): Anchor | null {
  const anchored = resolveAnchor(sourceText, { quote: quote }, minQuoteLength);
  return anchored.ok ? anchored.anchor : null;
}

/**
 * 把一批反问草稿落到材料上。
 *
 * 顺序刻意如此：先看这句反问值不值得留（太短、重复），再判依据指向谁，
 * 最后才回原文定位。任何一步不过就只丢这一条，并把中文理由交给前端展示——
 * 被拦下来的反问和 rejectedClaims 一样，是可以展示的产物。
 */
export function groundCounters(input: GroundCountersInput): GroundCountersResult {
  const maxCounters = input.maxCounters ?? COUNTER_LIMITS.maxCounters;
  const minQuoteLength = input.minQuoteLength ?? 4;
  const jdById = new Map<string, JobDescription>();
  for (const jd of input.jds) jdById.set(jd.id, jd);
  const claimIds = new Set<string>();
  for (const claim of input.claims) claimIds.add(claim.id);

  const grounded: CounterQuestion[] = [];
  const rejected: RejectedCounter[] = [];
  const notices: string[] = [];
  const seen = new Set<string>();

  for (const draft of input.drafts) {
    const text = draft.text.trim();
    if (text.length < COUNTER_LIMITS.minChars) {
      rejected.push({ text, reason: '这句话太短，不构成一句反问' });
      continue;
    }
    // 同一句话问两遍没有意义：第二条静默丢掉，不进 rejected（它不是坏数据，只是重复）
    if (seen.has(text)) continue;
    const sourceId = draft.sourceId.trim();
    const jd = jdById.get(sourceId);
    const source: CounterSource = jd === undefined ? 'resume' : 'jd';
    if (jd === undefined && !claimIds.has(sourceId)) {
      rejected.push({ text, reason: '这句反问指的依据（' + sourceId + '）不在这场材料里' });
      continue;
    }
    const sourceText = jd === undefined ? input.resumeText : jd.text;
    const anchored = groundOne(sourceText, draft.quote, minQuoteLength);
    if (anchored === null) {
      rejected.push({
        text,
        reason: COUNTER_SOURCE_LABEL[source] + '里没有这句话，没有依据就不生成反问：「' + draft.quote.trim() + '」',
      });
      continue;
    }
    seen.add(text);
    grounded.push({
      id: '',
      ordinal: 0,
      text,
      kind: draft.kind,
      reason: draft.reason.trim().slice(0, COUNTER_LIMITS.maxReasonChars),
      reply: draft.reply.trim().slice(0, COUNTER_LIMITS.maxReplyChars),
      source,
      anchor: anchored,
      jdId: jd === undefined ? null : jd.id,
    });
  }

  if (grounded.length > maxCounters) {
    notices.push(
      '反问超过 ' + String(maxCounters) + ' 条，多出来的 ' + String(grounded.length - maxCounters) + ' 条没要。',
    );
  }
  // id 在截断之后编：被截掉的条目不留空号，Q1..Qn 始终连续
  const counters: CounterQuestion[] = [];
  grounded.slice(0, maxCounters).forEach((item, index) => {
    counters.push({ ...item, id: counterId(index), ordinal: index + 1 });
  });

  if (counters.length === 0) {
    if (input.drafts.length === 0) notices.push('这一场没有生成反问。');
    else if (rejected.length > 0) notices.push('生成出来的 ' + String(rejected.length) + ' 句反问都没能锚回材料，已全部丢弃。');
  }
  return { counters, rejected, notices };
}