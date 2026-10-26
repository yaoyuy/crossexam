import { describe, expect, it } from 'vitest';
import type { JobDescription, Requirement, RequirementMatch } from '../src/domain.ts';
import {
  REQUIREMENT_LIMITS,
  cleanKeywords,
  groundExtracted,
  jdDigest,
  jdIdOf,
  jdProblems,
  jdTitleOf,
  matchConclusion,
  matchOf,
  matchSummary,
  mergeExtracted,
  missingRequirements,
  normalizeJdText,
  requirementDigest,
  requirementKey,
  requirementLabel,
  requirementNotes,
} from '../src/requirements.ts';

const A_TEXT =
  '岗位职责：负责后端服务的设计与开发，保证线上稳定。任职要求：熟悉 Node.js 与 TypeScript 至少三年，能独立排查线上问题。有高并发经验者优先。';
const B_TEXT = '任职要求：熟练掌握 Node.js 与 TypeScript，有高并发调优经验。负责订单系统的稳定性建设与容量规划。';
const QUOTE_A = '熟悉 Node.js 与 TypeScript 至少三年';
const QUOTE_B = '熟练掌握 Node.js 与 TypeScript';

function jds(): JobDescription[] {
  return [
    { id: 'J1', ordinal: 1, title: '后端工程师', text: A_TEXT },
    { id: 'J2', ordinal: 2, title: '平台工程师', text: B_TEXT },
  ];
}

function extracted() {
  const list = jds();
  const first = list[0] as JobDescription;
  const second = list[1] as JobDescription;
  const a = groundExtracted(first, [
    { text: '三年以上 Node.js 与 TypeScript 经验', quote: QUOTE_A, kind: 'must', keywords: ['Node.js', 'TypeScript'] },
    { text: '能独立排查线上问题', quote: '能独立排查线上问题', kind: 'duty', keywords: ['线上排障'] },
  ]);
  const b = groundExtracted(second, [
    { text: '熟练掌握 Node.js 与 TypeScript', quote: QUOTE_B, kind: 'must', keywords: ['Node.js'] },
    { text: '有高并发调优经验', quote: '有高并发调优经验', kind: 'plus', keywords: [] },
  ]);
  return { items: [...a.items, ...b.items], rejected: [...a.rejected, ...b.rejected] };
}

describe('岗位要求的纯函数层', () => {
  it('JD 文本规整成统一换行并掐掉首尾空白', () => {
    expect(normalizeJdText('  第一行  \r\n第二行\t\r\n  ')).toBe('第一行' + String.fromCharCode(10) + '第二行');
  });

  it('没填标题时按顺序兜底，填了标题就截到 40 字', () => {
    expect(jdTitleOf('', 3)).toBe('岗位 3');
    expect(jdTitleOf('  后端工程师  ', 1)).toBe('后端工程师');
    expect(jdTitleOf('长'.repeat(60), 1).length).toBe(40);
    expect(jdIdOf(2)).toBe('J2');
    expect(requirementKey('J2', 3)).toBe('J2#3');
  });

  it('JD 的指纹只认规整后的正文', () => {
    const digest = jdDigest(A_TEXT);
    expect(digest).toHaveLength(16);
    expect(jdDigest('  ' + A_TEXT + '  ')).toBe(digest);
    expect(jdDigest(A_TEXT + '多一行')).not.toBe(digest);
  });

  it('JD 校验逐条说人话：太短、太长、太多都拦下来', () => {
    expect(jdProblems([{ title: 'a', text: A_TEXT }])).toEqual([]);
    // 空清单不是错误：没有 JD 就退回「面试官按各自的经验追问」
  expect(jdProblems([])).toEqual([]);
    const short = jdProblems([{ title: '', text: '太短' }]);
    expect(short[0]).toContain('第 1 份 JD');
    expect(short[0]).toContain(String(REQUIREMENT_LIMITS.jdMinChars));
    const long = jdProblems([{ title: '长', text: '长'.repeat(REQUIREMENT_LIMITS.jdMaxChars + 1) }]);
    expect(long[0]).toContain('太长了');
    const many = jdProblems(Array.from({ length: REQUIREMENT_LIMITS.maxJds + 1 }, () => ({ title: '', text: A_TEXT })));
    expect(many[0]).toContain('最多 8 份');
  });

  it('抽取结果锚不回原文的逐条丢掉并说明理由', () => {
    const first = jds()[0] as JobDescription;
    const result = groundExtracted(first, [
      { text: '三年以上经验', quote: QUOTE_A, kind: 'must' },
      { text: '模型编的一句要求', quote: '这句话 JD 里根本没有', kind: 'plus' },
      { text: '太短', quote: QUOTE_A, kind: 'duty' },
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.key).toBe('J1#1');
    expect(result.items[0]?.anchor.quote).toBe(QUOTE_A);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0]?.reason).toContain('锚不到');
    expect(result.rejected[1]?.reason).toContain('太短');
  });

  it('关键词去重去空并截到 6 个', () => {
    expect(cleanKeywords(['a', 'a', ' b ', '', 'c', 'd', 'e', 'f', 'g'])).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('合并：同一件事跨两份 JD 并成一条，来源按 JD 顺序', () => {
    const { items } = extracted();
    const merged = mergeExtracted(jds(), items, [
      { text: 'Node.js 与 TypeScript 经验', kind: 'must', members: ['J1#1', 'J2#1'], keywords: ['Node.js'] },
    ]);
    expect(merged.orphanKeys).toEqual(['J1#2', 'J2#2']);
    expect(merged.requirements.map((r) => r.id)).toEqual(['R1', 'R2', 'R3']);
    const first = merged.requirements[0] as Requirement;
    expect(first.kind).toBe('must');
    expect(first.sources).toEqual(['J1', 'J2']);
    expect(first.jdId).toBe('J1');
    expect(first.anchor.quote).toBe(QUOTE_A);
    expect(first.keywords).toContain('TypeScript');
    expect(merged.notices[0]).toContain('没有并入任何一组');
  });

  it('合并：模型漏掉的分组成员由代码兜成独立要求，一条都不丢', () => {
    const { items } = extracted();
    const merged = mergeExtracted(jds(), items, [{ text: 'x', kind: 'must', members: ['J1#1'] }]);
    expect(merged.requirements).toHaveLength(4);
    expect(merged.requirements.map((r) => r.text)).toContain('能独立排查线上问题');
  });

  it('合并：重复引用同一个成员只取第一次，凭空捏造的键直接忽略', () => {
    const { items } = extracted();
    const merged = mergeExtracted(jds(), items, [
      { text: 'A', kind: 'must', members: ['J1#1', 'J1#1'] },
      { text: 'B', kind: 'must', members: ['J1#1', 'J9#9'] },
    ]);
    expect(merged.requirements).toHaveLength(4);
    expect(merged.requirements[0]?.text).toBe('A');
  });

  it('合并：超过上限时截断并说明截了多少，不静默丢', () => {
    const first = jds()[0] as JobDescription;
    const drafts = Array.from({ length: REQUIREMENT_LIMITS.maxRequirements + 2 }, (_, i) => ({
      text: '要求编号 ' + String(i),
      quote: QUOTE_A,
      kind: 'must' as const,
    }));
    const grounded = groundExtracted(first, drafts);
    const merged = mergeExtracted([first], grounded.items, [{ text: '一条', kind: 'must', members: ['J1#1'] }]);
    expect(merged.requirements.length).toBe(REQUIREMENT_LIMITS.maxRequirements);
    expect(merged.notices.some((n) => n.includes('只保留前'))).toBe(true);
  });

  it('没有抽到任何要求时合并结果为空，而不是抛错', () => {
    const merged = mergeExtracted(jds(), [], []);
    expect(merged.requirements).toEqual([]);
    expect(merged.notices).toEqual([]);
  });

  it('摘要与结论按三种状态计数', () => {
    const matches: RequirementMatch[] = [
      { requirementId: 'R1', claimId: 'C1', status: 'hit', reason: '写了三年经验' },
      { requirementId: 'R2', claimId: 'C2', status: 'weak', reason: '只说了熟悉' },
      { requirementId: 'R3', claimId: null, status: 'missing', reason: '简历里没提高并发' },
    ];
    expect(matchSummary(matches)).toEqual({ hit: 1, weak: 1, missing: 1, total: 3 });
    expect(matchSummary([])).toEqual({ hit: 0, weak: 0, missing: 0, total: 0 });
    expect(matchOf(matches, 'R2')?.claimId).toBe('C2');
    expect(matchOf(matches, 'R9')).toBeNull();
    expect(matchConclusion(matchSummary(matches))).toContain('没写 1 条');
    expect(matchConclusion(matchSummary([]))).toContain('还没有对照过');
  });

  it('缺失清单一律不生成追问素材', () => {
    const { items } = extracted();
    const merged = mergeExtracted(jds(), items, []);
    const matches: RequirementMatch[] = merged.requirements.map((r, i) => ({
      requirementId: r.id,
      claimId: i === 0 ? 'C1' : null,
      status: i === 0 ? 'weak' : 'missing',
      reason: 'x',
    }));
    expect(missingRequirements(merged.requirements, matches).map((r) => r.id)).toEqual(['R2', 'R3', 'R4']);
    const notes = requirementNotes(jds(), merged.requirements, matches);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.claimId).toBe('C1');
    expect(notes[0]?.text).toContain('Node.js');
    expect(notes[0]?.jdQuote).toBe(QUOTE_A);
    expect(notes[0]?.jdTitle).toBe('后端工程师');
    expect(notes[0]?.label).toContain('答得含糊');
    expect(requirementNotes(jds(), merged.requirements, matches, ['C9'])).toEqual([]);
  });

  it('要求指纹稳定，短名字带上类别', () => {
    const { items } = extracted();
    const merged = mergeExtracted(jds(), items, []);
    const requirement = merged.requirements[0] as Requirement;
    expect(requirementDigest(requirement)).toHaveLength(16);
    expect(requirementDigest(requirement)).toBe(requirementDigest({ ...requirement }));
    expect(requirementLabel(requirement)).toContain('硬性要求｜');
    expect(requirementLabel(requirement, 4).length).toBeLessThan(20);
  });
});
