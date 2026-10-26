import { describe, expect, it } from 'vitest';
import {
  answerDraftSchema,
  claimListSchema,
  formatIssues,
  parseLlmOutput,
  probeListSchema,
  stripCodeFence,
  suggestionListSchema,
  verdictListSchema,
} from '../src/schemas.ts';

const FENCE = String.fromCharCode(96).repeat(3);

describe('parseLlmOutput', () => {
  it('接受合法的主张列表', () => {
    const raw = JSON.stringify({
      claims: [{ text: '主导重构订单系统', quote: '主导重构了订单系统', category: 'ownership', weight: 0.9 }],
    });
    const r = parseLlmOutput(claimListSchema, raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.claims[0]?.category).toBe('ownership');
  });

  it('分类不在枚举内即拒绝，错误里点名是哪个字段', () => {
    const raw = JSON.stringify({ claims: [{ text: 'x', quote: 'y', category: 'banana', weight: 1 }] });
    const r = parseLlmOutput(claimListSchema, raw);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('category');
  });

  it('权重越界即拒绝', () => {
    const raw = JSON.stringify({ claims: [{ text: 'x', quote: 'y', category: 'skill', weight: 1.5 }] });
    expect(parseLlmOutput(claimListSchema, raw).ok).toBe(false);
  });

  it('不是 JSON 时保留原始文本，方便写进回放记录', () => {
    const r = parseLlmOutput(claimListSchema, '我觉得这段经历挺强的');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('JSON');
    expect(r.raw).toBe('我觉得这段经历挺强的');
  });

  it('模型爱把 JSON 包在代码围栏里，这里要能剥掉', () => {
    const body = JSON.stringify({
      probes: [{ claimId: 'c1', question: '这个 2.4s 是怎么测出来的？', quote: '首屏从 2.4s 降到 0.8s' }],
    });
    const raw = FENCE + 'json' + String.fromCharCode(10) + body + String.fromCharCode(10) + FENCE;
    expect(parseLlmOutput(probeListSchema, raw).ok).toBe(true);
  });

  it('空追问列表是合法的——面试官可以认为这条主张无需追问', () => {
    expect(parseLlmOutput(probeListSchema, JSON.stringify({ probes: [] })).ok).toBe(true);
  });
});

describe('schema 细节', () => {
  it('作答只需 answered 与 text，引用默认为空数组', () => {
    const parsed = answerDraftSchema.parse({ answered: false, text: '简历里没写这个' });
    expect(parsed.citedQuotes).toEqual([]);
  });

  it('判定必须给出理由，不给理由的判定不可信', () => {
    expect(verdictListSchema.safeParse({ verdicts: [{ kind: 'solid', confidence: 0.5 }] }).success).toBe(false);
    expect(
      verdictListSchema.safeParse({ verdicts: [{ kind: 'solid', confidence: 0.5, rationale: '有两处原文互证' }] }).success,
    ).toBe(true);
  });

  it('修改建议必须同时给出 before 与 after，防止只提问题不给改法', () => {
    const full = suggestionListSchema.safeParse({
      suggestions: [{ claimId: 'c1', problem: '表述过度', before: '主导', after: '参与', why: '原文只说参与' }],
    });
    expect(full.success).toBe(true);
    const half = suggestionListSchema.safeParse({
      suggestions: [{ claimId: 'c1', problem: '表述过度', before: '主导' }],
    });
    expect(half.success).toBe(false);
  });
});

describe('stripCodeFence', () => {
  it('没有围栏时原样返回', () => {
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });
});

describe('formatIssues', () => {
  it('把 zod 错误压成一行可读说明', () => {
    const r = claimListSchema.safeParse({ claims: [] });
    if (r.success) throw new Error('空列表应被拒绝');
    expect(formatIssues(r.error)).toContain('claims');
  });
});
