/**
 * 岗位要求三阶段：逐份抽取 → 跨份归并 → 与主张逐条对照。
 *
 * 这一层只做两件事：把模型的话过 zod，再用**代码**决定编号与归属。
 * 于是「哪条要求来自哪份 JD」「哪条主张对上了哪条要求」都不是模型说了算——
 * 它是集合运算的结果，同一份输入永远得到同一张表。
 *
 * 三处失败都必须留下痕迹：
 *   1. 某份 JD 抽不出来 → 那一份跳过并记一条 notice，其余照常（坏一份不该毁一场）；
 *   2. 归并没走通 → 退回「每条要求各自独立」，一条都不合并，也一条都不丢；
 *   3. 对照没走通 / 模型指认了一条不存在的主张 → 记成 missing 并写明原因。
 * 全部照做的话，最坏情况仍然是一张完整可用的表，而不是一场空。
 */

import type {
  Claim,
  ExtractedRequirement,
  JobDescription,
  MergeResult,
  RejectedRequirement,
  Requirement,
  RequirementMatch,
  RequirementNote,
} from '@crossexam/shared';
import {
  REQUIREMENT_LIMITS,
  groundExtracted,
  jdGroupListSchema,
  jdMatchListSchema,
  jdRequirementListSchema,
  matchSummary,
  mergeExtracted,
  parseLlmOutput,
  requirementNotes,
} from '@crossexam/shared';
import type { MatchSummary } from '@crossexam/shared';
import type { LlmClient, LlmUsage } from '../llm/types.ts';
import { EMPTY_USAGE } from '../llm/types.ts';
import {
  JD_EXTRACT_SYSTEM,
  JD_MATCH_SYSTEM,
  JD_MERGE_SYSTEM,
  buildJdExtractPrompt,
  buildJdMatchPrompt,
  buildJdMergePrompt,
  stageRequest,
} from './prompts.ts';

function sumUsage(list: readonly LlmUsage[]): LlmUsage {
  const total: LlmUsage = { ...EMPTY_USAGE };
  for (const item of list) {
    total.inputTokens += item.inputTokens;
    total.outputTokens += item.outputTokens;
    total.cacheReadTokens += item.cacheReadTokens;
    total.reasoningTokens += item.reasoningTokens;
  }
  return total;
}

export interface ExtractRequirementsResult {
  items: ExtractedRequirement[];
  rejected: RejectedRequirement[];
  /** 抽不出要求的那几份 JD，逐条说清楚是哪一份、为什么 */
  notices: string[];
  usage: LlmUsage;
}

/**
 * 逐份 JD 并发抽取，逐份锚定。
 * 单份 JD 解析失败只影响那一份：一场沙盘不该因为一份写得很烂的 JD 而崩掉。
 */
export async function extractRequirements(input: {
  client: LlmClient;
  jds: readonly JobDescription[];
}): Promise<ExtractRequirementsResult> {
  const results = await Promise.all(
    input.jds.map(async (jd) => {
      const request = stageRequest(
        'jd-extract',
        JD_EXTRACT_SYSTEM,
        buildJdExtractPrompt({ jd, maxRequirements: REQUIREMENT_LIMITS.maxRequirementsPerJd }),
        'jd-extract:' + jd.id,
      );
      const response = await input.client.complete(request);
      const parsed = parseLlmOutput(jdRequirementListSchema, response.text);
      if (!parsed.ok) {
        return {
          jd,
          grounded: null,
          usage: response.usage ?? EMPTY_USAGE,
          notice:
            '第 ' + String(jd.ordinal) + ' 份 JD《' + jd.title + '》的岗位要求没抽出来：' + parsed.error,
        };
      }
      const grounded = groundExtracted(jd, parsed.value.requirements);
      return { jd, grounded, usage: response.usage ?? EMPTY_USAGE, notice: null as string | null };
    }),
  );

  const items: ExtractedRequirement[] = [];
  const rejected: RejectedRequirement[] = [];
  const notices: string[] = [];
  for (const result of results) {
    if (result.grounded === null) {
      if (result.notice !== null) notices.push(result.notice);
      continue;
    }
    for (const item of result.grounded.items) items.push(item);
    for (const item of result.grounded.rejected) rejected.push(item);
    if (result.grounded.rejected.length > 0) {
      notices.push(
        '第 ' +
          String(result.jd.ordinal) +
          ' 份 JD 有 ' +
          String(result.grounded.rejected.length) +
          ' 条要求锚不到原文，已丢弃',
      );
    }
  }
  return { items, rejected, notices, usage: sumUsage(results.map((r) => r.usage)) };
}

export interface MergeRequirementsResult {
  merged: MergeResult;
  notices: string[];
  usage: LlmUsage;
}

/**
 * 跨份归并。模型只给「哪些编号是一件事」，谁并进了谁、编号怎么排全部由代码算。
 * 归并失败不是致命错误：退回逐条独立，结果是「要求更多但一条不少」。
 */
export async function mergeRequirements(input: {
  client: LlmClient;
  jds: readonly JobDescription[];
  items: readonly ExtractedRequirement[];
}): Promise<MergeRequirementsResult> {
  const notices: string[] = [];
  if (input.items.length === 0) {
    return { merged: mergeExtracted(input.jds, input.items, []), notices, usage: EMPTY_USAGE };
  }
  const request = stageRequest(
    'jd-merge',
    JD_MERGE_SYSTEM,
    buildJdMergePrompt(input.items),
    'jd-merge',
  );
  const response = await input.client.complete(request);
  const usage = response.usage ?? EMPTY_USAGE;
  const parsed = parseLlmOutput(jdGroupListSchema, response.text);
  if (!parsed.ok) {
    notices.push('岗位要求归并没有走通（' + parsed.error + '），每一条要求各自独立处理');
    const merged = mergeExtracted(input.jds, input.items, []);
    return { merged, notices: notices.concat(merged.notices), usage };
  }
  const merged = mergeExtracted(input.jds, input.items, parsed.value.groups);
  return { merged, notices: notices.concat(merged.notices), usage };
}

export interface MatchRequirementsResult {
  matches: RequirementMatch[];
  summary: MatchSummary;
  notes: RequirementNote[];
  notices: string[];
  usage: LlmUsage;
}

/**
 * 逐条要求与主张对照。每一条要求都必须有一条结果：
 * 模型漏掉的、指认了不存在的主张的，都由代码补成 missing 并写明原因——
 * 静默漏一条，报告上就会少一个缺口，而缺口清单正是这个功能的价值所在。
 */
export async function matchRequirements(input: {
  client: LlmClient;
  jds: readonly JobDescription[];
  requirements: readonly Requirement[];
  claims: readonly Claim[];
}): Promise<MatchRequirementsResult> {
  const notices: string[] = [];
  if (input.requirements.length === 0) {
    return {
      matches: [],
      summary: matchSummary([]),
      notes: [],
      notices,
      usage: EMPTY_USAGE,
    };
  }
  const claimIds = new Set(input.claims.map((c) => c.id));
  const request = stageRequest(
    'jd-match',
    JD_MATCH_SYSTEM,
    buildJdMatchPrompt({ requirements: input.requirements, claims: input.claims }),
    'jd-match',
  );
  const response = await input.client.complete(request);
  const usage = response.usage ?? EMPTY_USAGE;
  const parsed = parseLlmOutput(jdMatchListSchema, response.text);
  const drafts = parsed.ok ? parsed.value.matches : [];
  if (!parsed.ok) notices.push('岗位要求对照没有走通（' + parsed.error + '），全部按下「简历里没写」处理');

  const byId = new Map<string, (typeof drafts)[number]>();
  let stray = 0;
  for (const draft of drafts) {
    if (!input.requirements.some((r) => r.id === draft.requirementId)) {
      stray += 1;
      continue;
    }
    if (!byId.has(draft.requirementId)) byId.set(draft.requirementId, draft);
  }
  if (stray > 0) {
    notices.push('有 ' + String(stray) + ' 条对照指向了不存在的要求编号，已忽略');
  }

  const matches: RequirementMatch[] = [];
  let unfounded = 0;
  for (const requirement of input.requirements) {
    const draft = byId.get(requirement.id);
    if (draft === undefined) {
      matches.push({
        requirementId: requirement.id,
        claimId: null,
        status: 'missing',
        reason: '这一条没有拿到对照结果，按简历里没写处理',
      });
      continue;
    }
    if (draft.status !== 'missing') {
      const claimId = draft.claimId ?? null;
      if (claimId === null || !claimIds.has(claimId)) {
        unfounded += 1;
        matches.push({
          requirementId: requirement.id,
          claimId: null,
          status: 'missing',
          reason: '对照说能对上，但指不出是哪条主张，按简历里没写处理',
        });
        continue;
      }
      matches.push({
        requirementId: requirement.id,
        claimId,
        status: draft.status,
        reason: draft.reason,
      });
      continue;
    }
    matches.push({ requirementId: requirement.id, claimId: null, status: 'missing', reason: draft.reason });
  }
  if (unfounded > 0) {
    notices.push('有 ' + String(unfounded) + ' 条对照指不出对应主张，已按下「简历里没写」处理');
  }

  return {
    matches,
    summary: matchSummary(matches),
    notes: requirementNotes(input.jds, input.requirements, matches),
    notices,
    usage,
  };
}

