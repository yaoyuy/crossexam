import { describe, expect, it } from 'vitest';
import { applyRevisions, movedSpans, pendingClaimIds, revisionOf, reviseDigest } from '../src/revise.ts';
import type { Revision } from '../src/revise.ts';
import type { Suggestion } from '../src/domain.ts';

const RESUME = ['张明 · 后端工程师', '把接口延迟从 2.4s 优化到 0.8s，QPS 从 800 提升到 5000。', '学习能力强，抗压能力强。'].join('\n');

function revision(claimId: string, quote: string, after: string): Revision {
  const start = RESUME.indexOf(quote);
  expect(start).toBeGreaterThan(-1);
  return { claimId, start, end: start + quote.length, before: quote, after };
}

describe('采纳改写：只认原文区间', () => {
  it('单条改写落在原文上', () => {
    const item = revision('C1', '学习能力强，抗压能力强。', '在 3 个线上故障里担任值班主力，其中 1 次把恢复时间压到 20 分钟以内。');
    const result = applyRevisions(RESUME, [item]);
    expect(result.skipped).toEqual([]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toContain('担任值班主力');
    expect(result.text).not.toContain('抗压能力强');
    // 其余内容一个字都不许动
    expect(result.text).toContain('把接口延迟从 2.4s 优化到 0.8s，QPS 从 800 提升到 5000。');
  });

  it('多条改写与传入顺序无关，结果逐字节相同', () => {
    const a = revision('C1', '学习能力强，抗压能力强。', '带过 2 个实习生，其中 1 人独立负责一个模块上线。');
    const b = revision('C2', 'QPS 从 800 提升到 5000', 'QPS 从 800 提升到 5000（压测口径：单机 4 核 8G）');
    const forward = applyRevisions(RESUME, [a, b]);
    const backward = applyRevisions(RESUME, [b, a]);
    expect(forward.text).toBe(backward.text);
    expect(forward.applied.map((item) => item.claimId)).toEqual(['C2', 'C1']);
  });

  it('区间重叠时只保留靠后的一条，另一条给出理由', () => {
    const whole = revision('C1', '学习能力强，抗压能力强。', '在 3 个线上故障里担任值班主力。');
    const part = revision('C2', '抗压能力强', '抗压：连续两个月支持大促值班');
    const result = applyRevisions(RESUME, [whole, part]);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]?.claimId).toBe('C1');
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.claimId).toBe('C2');
    expect(result.skipped[0]?.reason).toContain('同一段原文');
  });

  it('改前原文与简历对不上就拒绝，绝不错位硬改', () => {
    const start = RESUME.indexOf('抗压能力强');
    const stale: Revision = { claimId: 'C9', start, end: start + 5, before: '抗压能力差', after: '抗压能力一般' };
    const result = applyRevisions(RESUME, [stale]);
    expect(result.applied).toEqual([]);
    expect(result.text).toBe(RESUME);
    expect(result.skipped[0]?.reason).toContain('对不上');
  });

  it('区间越界、空改写、非整数位置一律拒绝', () => {
    const cases: Revision[] = [
      { claimId: 'X1', start: 0, end: RESUME.length + 5, before: 'x', after: 'y' },
      // 零宽区间只有在「改前为空串」时才算插入；这里改前非空，仍然拒绝
      { claimId: 'X2', start: 3, end: 3, before: 'x', after: 'y' },
      { claimId: 'X3', start: 0, end: 4, before: RESUME.slice(0, 4), after: '' },
      { claimId: 'X4', start: 1.5, end: 4, before: 'x', after: 'y' },
    ];
    const result = applyRevisions(RESUME, cases);
    expect(result.applied).toEqual([]);
    expect(result.text).toBe(RESUME);
    expect(result.skipped.map((item) => item.claimId)).toEqual(['X1', 'X2', 'X3', 'X4']);
  });

  it('插入型不覆盖原文，也不挡住落在同一位置上的替换', () => {
    const quote = '学习能力强，抗压能力强。';
    const at = RESUME.indexOf(quote);
    const insert: Revision = { claimId: 'C1', start: at, end: at, before: '', after: '日订单 30 万，峰值 QPS 5000。\n' };
    const replace: Revision = { claimId: 'C1', start: at, end: at + quote.length, before: quote, after: '在 3 个线上故障里担任值班主力。' };
    const result = applyRevisions(RESUME, [insert, replace]);
    // 两条都落地：凭空插入的一行 + 同一位置上被改写的原句
    expect(result.applied).toHaveLength(2);
    expect(result.skipped).toEqual([]);
    expect(result.text).toContain('日订单 30 万，峰值 QPS 5000。');
    expect(result.text).toContain('担任值班主力');
    expect(result.text).not.toContain(quote);
    // 原文只多了一行，没有别的位置被挪动
    expect(result.text.split('\n').length).toBe(RESUME.split('\n').length + 1);
  });

  it('「改前」展示的永远是原文逐字内容，不是模型给的那份', () => {
    // 拿全角标点差异演示：模型把「，」「。」写成半角，锚定阶段照样命中，
    // 但界面上「改前」那一行必须显示原文的全角版本。
    // 注意不能用空格差异演示——归一化保留单个空格，那种差异连锚定都过不了。
    const quote = '抗压能力强。';
    const start = RESUME.indexOf(quote);
    const sloppy: Revision = { claimId: 'C1', start, end: start + quote.length, before: '抗压能力强.', after: '在 3 个线上故障里担任值班主力.' };
    const result = applyRevisions(RESUME, [sloppy]);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]?.before).toBe('抗压能力强。');
  });
});

describe('改写在新文本里的位置', () => {
  it('前面的改写会让后面的位置平移', () => {
    const long = revision('C1', '学习能力强，抗压能力强。', '在 3 个线上故障里担任值班主力，其中 1 次把恢复时间压到 20 分钟以内。');
    const result = applyRevisions(RESUME, [long]);
    const spans = movedSpans(result.applied);
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span === undefined ? '' : result.text.slice(span.start, span.end)).toBe(long.after);
  });

  it('两条改写的位置都能在新文本里对上', () => {
    const a = revision('C1', '把接口延迟从 2.4s 优化到 0.8s', '把核心接口 P99 延迟从 2.4s 压到 0.8s');
    const b = revision('C2', '学习能力强，抗压能力强。', '带过 2 个实习生。');
    const result = applyRevisions(RESUME, [a, b]);
    for (const span of movedSpans(result.applied)) {
      expect(result.text.slice(span.start, span.end)).toBe(span.after);
    }
  });
});

describe('建议 → 改写', () => {
  it('直接取建议里的锚点与改前改后', () => {
    const start = RESUME.indexOf('抗压能力强');
    const suggestion: Suggestion = {
      claimId: 'C1',
      anchor: { start, end: start + 5, quote: '抗压能力强', exact: true },
      problem: '无法验证',
      before: '抗压能力强',
      after: '连续两个月支持大促值班。',
      why: '要场景',
    };
    const item = revisionOf('C1', suggestion);
    expect(item).toEqual({ claimId: 'C1', start, end: start + 5, before: '抗压能力强', after: '连续两个月支持大促值班。' });
  });

  it('指纹随文本变化，且同样文本永远同样指纹', () => {
    const one = applyRevisions(RESUME, [revision('C1', '抗压能力强', '连续两个月支持大促值班。')]);
    const two = applyRevisions(RESUME, [revision('C1', '抗压能力强', '连续两个月支持大促值班。')]);
    expect(reviseDigest(one.text)).toBe(reviseDigest(two.text));
    expect(reviseDigest(one.text)).not.toBe(reviseDigest(RESUME));
    expect(reviseDigest(RESUME)).toHaveLength(16);
  });

  it('没采纳的条目列得出来', () => {
    expect(pendingClaimIds(['C1', 'C2', 'C3'], ['C2'])).toEqual(['C1', 'C3']);
  });
});
