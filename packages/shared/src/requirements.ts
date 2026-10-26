/**
 * 岗位要求（多 JD 驱动）的纯函数层。
 *
 * 这里刻意不放任何 LLM 调用：抽取、合并、对照三次模型调用都在服务端编排层，
 * 而这个文件回答的是「拿到模型输出之后，代码怎么把它变成可复现的结构」——定序、
 * 编 id、合并、校验、算摘要。同样的输入必须得到逐字节相同的结果，否则回放与
 * 契约指纹都会漂移。
 */

import type {
  Anchor,
  JobDescription,
  MatchStatus,
  Requirement,
  RequirementKind,
  RequirementMatch,
} from './domain.ts';
import { MATCH_LABEL, REQUIREMENT_KIND_LABEL } from './domain.ts';
import { resolveAnchor } from './anchor.ts';
import { shortHash, stableStringify } from './util.ts';

export const REQUIREMENT_LIMITS = {
  maxJds: 8,
  jdMinChars: 40,
  jdMaxChars: 6000,
  maxRequirementsPerJd: 12,
  maxRequirements: 30,
  minRequirementChars: 4,
  maxRequirementChars: 200,
} as const;

/** 页面上没填标题时的兜底名字。编号来自 JD 的顺序，不是随机数。 */
export function jdTitleOf(raw: string, ordinal: number): string {
  const title = raw.trim();
  if (title === '') return '岗位 ' + String(ordinal);
  return title.length > 40 ? title.slice(0, 40) : title;
}

export function jdIdOf(ordinal: number): string {
  return 'J' + String(ordinal);
}

/** 入库前把用户贴进来的 JD 规整一遍：统一换行、去掉行尾空白、掐首尾 */
export function normalizeJdText(text: string): string {
  return text
    .replace(/\r\n?/g, String.fromCharCode(10))
    .replace(/[ \t]+$/gm, '')
    .trim();
}

export function jdDigest(text: string): string {
  return shortHash(normalizeJdText(text), 16);
}

/**
 * 校验一批 JD。返回中文问题清单，空数组表示可以用。
 *
 * **空清单是合法的**：岗位要求是可选的输入——没有 JD 时退回「面试官按各自的经验追问」，
 * 这本来就是产品一直在做的事。把「至少要有一份」做成接口错误会让纯简历场次整条路走不通。
 * 「还没上传 JD」该不该提醒，是界面的事（上传入口上写清楚就够了），不是数据校验的事。
 */
export function jdProblems(jds: readonly { title: string; text: string }[]): string[] {
  const problems: string[] = [];
  if (jds.length > REQUIREMENT_LIMITS.maxJds) {
    problems.push('最多 ' + String(REQUIREMENT_LIMITS.maxJds) + ' 份 JD，收到 ' + String(jds.length) + ' 份。');
  }
  jds.forEach((jd, index) => {
    const text = normalizeJdText(jd.text);
    const at = '第 ' + String(index + 1) + ' 份 JD（' + jdTitleOf(jd.title, index + 1) + '）';
    if (text.length < REQUIREMENT_LIMITS.jdMinChars) {
      problems.push(at + '太短了：至少 ' + String(REQUIREMENT_LIMITS.jdMinChars) + ' 个字符，否则读不出要求。');
    }
    if (text.length > REQUIREMENT_LIMITS.jdMaxChars) {
      problems.push(at + '太长了：超过 ' + String(REQUIREMENT_LIMITS.jdMaxChars) + ' 个字符，请只留要求与职责部分。');
    }
  });
  return problems;
}

export interface ExtractedRequirement {
  /** 合并阶段模型只认这个键（J1#3），不认我们自己编的 R 编号 */
  key: string;
  jdId: string;
  kind: RequirementKind;
  text: string;
  quote: string;
  anchor: Anchor;
  keywords: string[];
}

export interface RejectedRequirement {
  key: string;
  jdId: string;
  quote: string;
  text: string;
  reason: string;
}

export function requirementKey(jdId: string, index: number): string {
  return jdId + '#' + String(index);
}

/** 模型返回的一条抽取草稿（结构上兼容 schemas.ts 的 jdRequirementDraftSchema） */
export interface RawRequirementDraft {
  text: string;
  quote: string;
  kind: RequirementKind;
  keywords?: readonly string[];
}

/**
 * 把一份 JD 的抽取草稿落到原文上。
 *
 * 锚不上的逐条记理由丢弃——与主张抽取同一个口径：宁可少一条要求，
 * 也不要一条点不回去的要求，否则「岗位要求原文」就成了模型自己写的。
 */
export function groundExtracted(
  jd: JobDescription,
  drafts: readonly RawRequirementDraft[],
  minQuoteLength = 4,
): { items: ExtractedRequirement[]; rejected: RejectedRequirement[] } {
  const items: ExtractedRequirement[] = [];
  const rejected: RejectedRequirement[] = [];
  let index = 0;
  for (const draft of drafts) {
    index += 1;
    const key = requirementKey(jd.id, index);
    const text = draft.text.trim();
    if (text.length < REQUIREMENT_LIMITS.minRequirementChars) {
      rejected.push({ key, jdId: jd.id, quote: draft.quote, text, reason: '这句话太短，不构成一条要求' });
      continue;
    }
    const anchored = resolveAnchor(jd.text, { quote: draft.quote }, minQuoteLength);
    if (!anchored.ok) {
      rejected.push({ key, jdId: jd.id, quote: draft.quote, text, reason: '这条要求锚不到 JD 原文' });
      continue;
    }
    items.push({
      key,
      jdId: jd.id,
      kind: draft.kind,
      text: text.length > REQUIREMENT_LIMITS.maxRequirementChars ? text.slice(0, REQUIREMENT_LIMITS.maxRequirementChars) : text,
      quote: anchored.anchor.quote,
      anchor: anchored.anchor,
      keywords: cleanKeywords(draft.keywords ?? []),
    });
  }
  return { items, rejected };
}

/** 关键词去重、去空、截断，最多 6 个——它只是给界面看的线索，不参与判定 */
export function cleanKeywords(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of raw) {
    const word = item.trim().slice(0, 24);
    if (word === '' || out.includes(word)) continue;
    out.push(word);
    if (out.length >= 6) break;
  }
  return out;
}

/** 合并阶段的一条分组草稿（结构上兼容 schemas.ts 的 jdGroupDraftSchema） */
export interface RawRequirementGroup {
  text: string;
  kind: RequirementKind;
  members: readonly string[];
  keywords?: readonly string[];
}

export interface MergeResult {
  requirements: Requirement[];
  notices: string[];
  /** 模型没提、由代码兜成独立要求的那几条 */
  orphanKeys: string[];
}

/**
 * 把多份 JD 抽出来的要求合并成一份清单。
 *
 * 三条硬规矩：
 * 1. **一条都不能丢**。模型漏掉的分组成员由代码兜成独立要求（orphanKeys 记下来），
 *    重复引用同一个成员只取第一次——丢要求比多一条重复要求严重得多。
 * 2. **id 按首次出现定序**（R1..Rn），来源按 JD 顺序，代表锚点取引文最长的那一份。
 * 3. 超出上限时截断并说明截掉了多少，不静默丢。
 */
export function mergeExtracted(
  jds: readonly JobDescription[],
  items: readonly ExtractedRequirement[],
  groups: readonly RawRequirementGroup[],
): MergeResult {
  const byKey = new Map<string, ExtractedRequirement>();
  for (const item of items) byKey.set(item.key, item);
  const jdOrder = new Map<string, number>();
  jds.forEach((jd, index) => jdOrder.set(jd.id, index));

  const notices: string[] = [];
  const used = new Set<string>();
  const built: Requirement[] = [];

  const build = (members: readonly ExtractedRequirement[], rawText: string, rawKind: RequirementKind, rawKeywords: readonly string[]): Requirement => {
    const ordered = [...members].sort((a, b) => jdIndex(a) - jdIndex(b) || a.key.localeCompare(b.key));
    const main = [...ordered].sort((a, b) => b.quote.length - a.quote.length || a.key.localeCompare(b.key))[0];
    const sourceIds: string[] = [];
    for (const item of ordered) if (!sourceIds.includes(item.jdId)) sourceIds.push(item.jdId);
    const keywords = cleanKeywords([...rawKeywords, ...ordered.flatMap((item) => item.keywords)]);
    const text = rawText.trim() === '' ? (main ? main.text : '') : rawText.trim();
    return {
      id: 'R' + String(built.length + 1),
      kind: rawKind,
      text: text.length > REQUIREMENT_LIMITS.maxRequirementChars ? text.slice(0, REQUIREMENT_LIMITS.maxRequirementChars) : text,
      keywords,
      anchor: main ? main.anchor : { start: 0, end: 0, quote: '', exact: false },
      jdId: main ? main.jdId : '',
      sources: sourceIds,
    };
  };
  function jdIndex(item: ExtractedRequirement): number {
    return jdOrder.get(item.jdId) ?? Number.MAX_SAFE_INTEGER;
  }

  for (const group of groups) {
    const members: ExtractedRequirement[] = [];
    for (const key of group.members) {
      const item = byKey.get(key);
      if (item === undefined || used.has(key)) continue;
      used.add(key);
      members.push(item);
    }
    if (members.length === 0) continue;
    built.push(build(members, group.text, group.kind, group.keywords ?? []));
  }

  const orphanKeys: string[] = [];
  for (const item of items) {
    if (used.has(item.key)) continue;
    used.add(item.key);
    orphanKeys.push(item.key);
    built.push(build([item], item.text, item.kind, item.keywords));
  }
  if (orphanKeys.length > 0) {
    notices.push('有 ' + String(orphanKeys.length) + ' 条要求没有并入任何一组，按独立要求处理');
  }

  if (built.length === 0) return { requirements: [], notices, orphanKeys };

  const kept = built.slice(0, REQUIREMENT_LIMITS.maxRequirements);
  if (kept.length < built.length) {
    notices.push('岗位要求超过 ' + String(REQUIREMENT_LIMITS.maxRequirements) + ' 条，只保留前 ' + String(kept.length) + ' 条');
  }
  return { requirements: kept, notices, orphanKeys };
}

export function requirementDigest(requirement: Requirement): string {
  return shortHash(stableStringify(requirement), 16);
}

/** 界面上一条要求的短名字：类别 + 掐短的要求正文 */
export function requirementLabel(requirement: Requirement, max = 40): string {
  const text = requirement.text.length > max ? requirement.text.slice(0, max) + '…' : requirement.text;
  return REQUIREMENT_KIND_LABEL[requirement.kind] + '｜' + text;
}

export interface MatchSummary {
  hit: number;
  weak: number;
  missing: number;
  total: number;
}

export function matchSummary(matches: readonly RequirementMatch[]): MatchSummary {
  let hit = 0;
  let weak = 0;
  let missing = 0;
  for (const match of matches) {
    if (match.status === 'hit') hit += 1;
    else if (match.status === 'weak') weak += 1;
    else missing += 1;
  }
  return { hit, weak, missing, total: matches.length };
}

export function matchOf(matches: readonly RequirementMatch[], requirementId: string): RequirementMatch | null {
  for (const match of matches) if (match.requirementId === requirementId) return match;
  return null;
}

/** 简历里没写的要求。这一栏**不生成追问**：没写过的经历，逼问没有意义。 */
export function missingRequirements(
  requirements: readonly Requirement[],
  matches: readonly RequirementMatch[],
): Requirement[] {
  return requirements.filter((requirement) => {
    const match = matchOf(matches, requirement.id);
    return match === null || match.status === 'missing';
  });
}

export function requirementKindsOf(requirements: readonly Requirement[]): RequirementKind[] {
  const out: RequirementKind[] = [];
  for (const requirement of requirements) if (!out.includes(requirement.kind)) out.push(requirement.kind);
  return out;
}

export interface RequirementNote {
  id: string;
  kind: RequirementKind;
  status: MatchStatus;
  /** 「硬性要求｜答得含糊」这种给人看的一句话 */
  label: string;
  claimId: string | null;
  jdId: string;
  jdTitle: string;
  /** 代码复述过的那句要求（进了提示词，面试官照着它加压） */
  text: string;
  /** 要写进提示词的岗位要求原文（已经锚定过） */
  jdQuote: string;
}

/**
 * 追问阶段要看到的「要求 → 主张」对照表。
 *
 * 只挑 hit / weak：missing 没有对应主张，拿它去逼问等于让面试官问一件
 * 简历里根本没有的事。claimIds 非空时再按主张过滤一层。
 */
export function requirementNotes(
  jds: readonly JobDescription[],
  requirements: readonly Requirement[],
  matches: readonly RequirementMatch[],
  claimIds?: readonly string[],
): RequirementNote[] {
  const titleOf = new Map<string, string>();
  for (const jd of jds) titleOf.set(jd.id, jd.title);
  const allowed = claimIds === undefined ? null : new Set(claimIds);
  const notes: RequirementNote[] = [];
  for (const requirement of requirements) {
    const match = matchOf(matches, requirement.id);
    if (match === null || match.status === 'missing') continue;
    if (match.claimId === null) continue;
    if (allowed !== null && !allowed.has(match.claimId)) continue;
    notes.push({
      id: requirement.id,
      kind: requirement.kind,
      status: match.status,
      label: REQUIREMENT_KIND_LABEL[requirement.kind] + '｜' + MATCH_LABEL[match.status],
      claimId: match.claimId,
      jdId: requirement.jdId,
      jdTitle: titleOf.get(requirement.jdId) ?? requirement.jdId,
      text: requirement.text,
      jdQuote: requirement.anchor.quote,
    });
  }
  return notes;
}

/** 给报告与界面的一句话结论 */
export function matchConclusion(summary: MatchSummary): string {
  if (summary.total === 0) return '还没有对照过岗位要求。';
  return (
    '岗位要求共 ' + String(summary.total) + ' 条：简历答得上 ' + String(summary.hit) + ' 条、答得含糊 ' +
    String(summary.weak) + ' 条、没写 ' + String(summary.missing) + ' 条。'
  );
}
