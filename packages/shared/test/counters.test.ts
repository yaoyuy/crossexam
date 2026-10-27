import { describe, expect, it } from 'vitest';
import { COUNTER_KIND_ORDER, COUNTER_LIMITS, counterId, groundCounters } from '../src/counters.ts';
import type { RawCounterDraft } from '../src/counters.ts';
import type { Claim, JobDescription } from '../src/domain.ts';

const NL = String.fromCharCode(10);
const RESUME = [
  '张明 · 后端工程师',
  '主导重构订单系统，首屏加载从 2.4s 降到 0.8s。',
  '独立完成 RBAC 权限模块，覆盖 12 个业务线。',
].join(NL);

const JD_TEXT = [
  '高级后端工程师（Node.js）',
  '负责交易与订单核心链路的架构设计与性能优化；',
  '与产品、前端紧密协作，推动需求高质量交付；',
  '有日订单百万级系统的性能优化经验。',
].join(NL);

const JDS: JobDescription[] = [{ id: 'J1', ordinal: 1, title: '高级后端工程师', text: JD_TEXT }];

const CLAIMS: Claim[] = [
  {
    id: 'C1',
    text: '主导重构订单系统',
    category: 'ownership',
    weight: 0.9,
    anchor: { quote: '主导重构订单系统', start: 16, end: 24, exact: true },
  },
  {
    id: 'C2',
    text: '独立完成 RBAC 权限模块',
    category: 'achievement',
    weight: 0.7,
    anchor: { quote: '独立完成 RBAC 权限模块', start: 40, end: 53, exact: true },
  },
];

function draft(over: Partial<RawCounterDraft> = {}): RawCounterDraft {
  return {
    text: '这个岗位的订单链路现在有多大流量？',
    kind: 'business',
    reason: '岗位要求里写了百万级性能优化经验',
    reply: '目前日均订单在百万级，大促会翻几倍。',
    quote: '有日订单百万级系统的性能优化经验',
    sourceId: 'J1',
    ...over,
  };
}

function run(drafts: readonly RawCounterDraft[], over: { jds?: JobDescription[]; claims?: Claim[]; maxCounters?: number } = {}) {
  return groundCounters({
    resumeText: RESUME,
    jds: over.jds ?? JDS,
    claims: over.claims ?? CLAIMS,
    drafts,
    maxCounters: over.maxCounters,
  });
}

describe('反问环节的锚定', () => {
  it('依据出自岗位要求：锚回 JD 原文，记下是哪份 JD', () => {
    const result = run([draft()]);
    expect(result.rejected).toEqual([]);
    const q = result.counters[0];
    expect(q?.id).toBe('Q1');
    expect(q?.ordinal).toBe(1);
    expect(q?.source).toBe('jd');
    expect(q?.jdId).toBe('J1');
    expect(q?.anchor.quote).toBe('有日订单百万级系统的性能优化经验');
    expect(q?.anchor.exact).toBe(true);
    expect(JD_TEXT.slice(q?.anchor.start ?? 0, q?.anchor.end ?? 0)).toBe(q?.anchor.quote);
  });

  it('依据出自简历主张：锚回简历原文，jdId 是 null', () => {
    const result = run([draft({ quote: '主导重构订单系统', sourceId: 'C1' })]);
    expect(result.rejected).toEqual([]);
    const q = result.counters[0];
    expect(q?.source).toBe('resume');
    expect(q?.jdId).toBe(null);
    expect(RESUME.slice(q?.anchor.start ?? 0, q?.anchor.end ?? 0)).toBe(q?.anchor.quote);
  });

  it('没有 JD 的场次也能生成：只锚简历主张', () => {
    const result = run([draft({ quote: '独立完成 RBAC 权限模块', sourceId: 'C2' })], { jds: [] });
    expect(result.counters).toHaveLength(1);
    expect(result.counters[0]?.source).toBe('resume');
  });

  it('依据指向不存在的编号：当场丢弃，理由里点名那个编号', () => {
    const result = run([draft({ sourceId: 'C9' })]);
    expect(result.counters).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('C9');
    expect(result.rejected[0]?.reason).toContain('不在这场材料里');
  });

  it('引文锚不上原文：丢弃，并说明「没有依据就不生成反问」', () => {
    const result = run([draft({ quote: '我们用的是 Rust 和 Kafka' })]);
    expect(result.counters).toEqual([]);
    expect(result.rejected[0]?.reason).toContain('依据岗位要求');
    expect(result.rejected[0]?.reason).toContain('没有依据就不生成反问');
  });

  it('太短的句子不构成反问', () => {
    const result = run([draft({ text: '在吗' })]);
    expect(result.rejected[0]?.reason).toContain('太短');
  });

  it('同一句话问两遍只留一条，且不算被丢弃', () => {
    const result = run([draft(), draft()]);
    expect(result.counters).toHaveLength(1);
    expect(result.rejected).toEqual([]);
  });

  it('id 连续不吃号：被丢弃的条目不留空号', () => {
    const bad = draft({ text: '这句的依据指错了地方，应该被丢掉', sourceId: 'J9' });
    const second = draft({ text: '团队现在的发布节奏是怎样的？', kind: 'process' });
    const third = draft({ text: '这个岗位会参与技术选型吗？', kind: 'tech' });
    const result = run([bad, second, third]);
    expect(result.counters.map((c) => c.id)).toEqual(['Q1', 'Q2']);
    expect(result.counters.map((c) => c.ordinal)).toEqual([1, 2]);
    expect(result.counters[1]?.text).toBe(third.text);
    expect(result.rejected).toHaveLength(1);
  });

  it('超过上限截断，并说明多出几条没要', () => {
    const drafts: RawCounterDraft[] = [];
    for (let i = 0; i < 5; i += 1) {
      drafts.push(draft({ text: '第 ' + String(i) + ' 个问题值不值得问？' }));
    }
    const result = run(drafts, { maxCounters: 3 });
    expect(result.counters).toHaveLength(3);
    expect(result.notices[0]).toContain('多出来的 2 条没要');
  });

  it('一条都没生成时说清楚是哪种情况', () => {
    expect(run([]).notices[0]).toContain('没有生成反问');
    const allBad = run([draft({ sourceId: 'J9' }), draft({ quote: '不存在的引用内容' })]);
    expect(allBad.notices[0]).toContain('都没能锚回材料');
  });

  it('同输入同输出（回放要求确定性）', () => {
    const a = run([draft(), draft({ text: '这个岗位会参与技术选型吗？', kind: 'tech' })]);
    const b = run([draft(), draft({ text: '这个岗位会参与技术选型吗？', kind: 'tech' })]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('上限与类别顺序是常量，不是各写一套', () => {
    expect(COUNTER_LIMITS.maxCounters).toBe(6);
    expect(counterId(0)).toBe('Q1');
    expect(COUNTER_KIND_ORDER).toEqual(['team', 'tech', 'growth', 'business', 'process']);
  });
});