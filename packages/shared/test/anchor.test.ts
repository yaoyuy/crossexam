import { describe, expect, it } from 'vitest';
import { isGrounded, locateQuote, normalizeWithMap, resolveAnchor, spansOverlap } from '../src/anchor.ts';

const RESUME = [
  '张三 | 前端开发工程师',
  '项目经历',
  '- 主导重构了订单系统，把首屏时间从 2.4s 降到 0.8s',
  '- 熟练使用 React、TypeScript',
].join('\n');

describe('locateQuote', () => {
  it('逐字命中时 exact 为 true，且区间切片等于引用本身', () => {
    const hit = locateQuote(RESUME, '主导重构了订单系统');
    expect(hit).not.toBeNull();
    expect(hit?.exact).toBe(true);
    expect(RESUME.slice(hit!.start, hit!.end)).toBe('主导重构了订单系统');
  });

  it('全角顿号与半角逗号差异走归一化命中，exact 为 false 但仍能还原到原文坐标', () => {
    const hit = locateQuote(RESUME, '熟练使用 React,TypeScript');
    expect(hit).not.toBeNull();
    expect(hit?.exact).toBe(false);
    expect(RESUME.slice(hit!.start, hit!.end)).toBe('熟练使用 React、TypeScript');
  });

  it('原文里根本没有的内容返回 null——这是拦下幻觉提问的第一道闸', () => {
    expect(locateQuote(RESUME, '精通 Kubernetes 集群运维')).toBeNull();
  });
});

describe('normalizeWithMap', () => {
  it('映射表能把归一化下标还原回原文下标', () => {
    const { norm, map } = normalizeWithMap('A，B');
    expect(norm).toBe('a,b');
    expect(map).toEqual([0, 1, 2]);
  });

  it('折叠连续的空白字符', () => {
    const { norm } = normalizeWithMap('a    b');
    expect(norm).toBe('a b');
  });
});

describe('resolveAnchor', () => {
  it('模型给的 start/end 一律不采信，用 quote 回原文重新定位', () => {
    const r = resolveAnchor(RESUME, { quote: '主导重构了订单系统', start: 99999, end: 99999 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.anchor.start).toBe(RESUME.indexOf('主导重构了订单系统'));
    expect(r.anchor.end).toBe(r.anchor.start + '主导重构了订单系统'.length);
    expect(r.anchor.exact).toBe(true);
  });

  it('拒绝过短的引用', () => {
    const r = resolveAnchor(RESUME, { quote: '主导' });
    expect(r).toEqual({ ok: false, reason: 'too-short', quote: '主导' });
  });

  it('拒绝空引用', () => {
    const r = resolveAnchor(RESUME, {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('empty-quote');
  });

  it('拒绝原文中找不到的引用，并把疑似编造的那句话带回去给前端展示', () => {
    const r = resolveAnchor(RESUME, { quote: '带领 20 人团队交付千万级项目' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('quote-not-found');
    expect(r.quote).toBe('带领 20 人团队交付千万级项目');
  });
});

describe('isGrounded', () => {
  it('锚点指向的内容与原文一致时为 true', () => {
    const r = resolveAnchor(RESUME, { quote: '首屏时间从 2.4s 降到 0.8s' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(isGrounded(RESUME, r.anchor)).toBe(true);
  });

  it('简历被改过之后旧锚点失效', () => {
    const r = resolveAnchor(RESUME, { quote: '首屏时间从 2.4s 降到 0.8s' });
    if (!r.ok) throw new Error('fixture 锚点应能建立');
    expect(isGrounded(RESUME.replace('2.4s', '5.0s'), r.anchor)).toBe(false);
  });
});

describe('spansOverlap', () => {
  it('相邻但不重叠的区间不算重叠', () => {
    expect(spansOverlap({ start: 0, end: 5 }, { start: 5, end: 9 })).toBe(false);
    expect(spansOverlap({ start: 0, end: 6 }, { start: 5, end: 9 })).toBe(true);
  });
});
