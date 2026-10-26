import { describe, expect, it } from 'vitest';
import { outlineForPrompt, segmentResume } from '../src/segment.ts';

const RESUME = [
  '张三 | 前端开发工程师',
  '',
  '项目经历',
  '- 主导重构了订单系统，首屏从 2.4s 降到 0.8s',
  '1. 使用 React 与 TypeScript 搭建组件库',
  '自我评价',
  '责任心强，能扛事',
].join('\n');

describe('segmentResume', () => {
  it('每一段的区间切片都等于该段文本——这是后面所有锚点的坐标系', () => {
    const outline = segmentResume(RESUME);
    expect(outline.segments.length).toBeGreaterThan(0);
    for (const s of outline.segments) {
      expect(RESUME.slice(s.start, s.end)).toBe(s.text);
    }
  });

  it('识别小节标题，并把它之后的内容归到该小节', () => {
    const outline = segmentResume(RESUME);
    const byText = (t: string) => outline.segments.find((s) => s.text === t);
    expect(byText('项目经历')?.kind).toBe('header');
    expect(byText('项目经历')?.section).toBe('项目经历');
    expect(byText('- 主导重构了订单系统，首屏从 2.4s 降到 0.8s')?.section).toBe('项目经历');
    expect(byText('责任心强，能扛事')?.section).toBe('自我评价');
  });

  it('区分条目与段落：短横线与数字序号都算条目', () => {
    const outline = segmentResume(RESUME);
    const bullets = outline.segments.filter((s) => s.kind === 'bullet');
    expect(bullets.map((s) => s.text)).toEqual([
      '- 主导重构了订单系统，首屏从 2.4s 降到 0.8s',
      '1. 使用 React 与 TypeScript 搭建组件库',
    ]);
    expect(outline.segments.find((s) => s.text === '责任心强，能扛事')?.kind).toBe('paragraph');
  });

  it('标题前的内容不属于任何小节', () => {
    const outline = segmentResume(RESUME);
    expect(outline.segments[0]?.section).toBeNull();
  });

  it('兼容 CRLF：区间仍然对得上，且不会把回车带进文本', () => {
    const crlf = '项目经历\r\n- 做了某事\r\n';
    const outline = segmentResume(crlf);
    for (const s of outline.segments) {
      expect(crlf.slice(s.start, s.end)).toBe(s.text);
      expect(s.text).not.toContain('\r');
    }
    expect(outline.segments[1]?.text).toBe('- 做了某事');
  });

  it('小节区间覆盖到下一个标题之前', () => {
    const outline = segmentResume(RESUME);
    const proj = outline.sections.find((s) => s.title === '项目经历');
    const evalSection = outline.sections.find((s) => s.title === '自我评价');
    expect(proj).toBeDefined();
    expect(evalSection).toBeDefined();
    expect(proj!.end).toBe(evalSection!.start);
    expect(evalSection!.end).toBe(RESUME.length);
  });

  it('空文本不炸', () => {
    expect(segmentResume('').segments).toEqual([]);
  });
});

describe('outlineForPrompt', () => {
  it('渲染成带编号的清单，编号即模型引用时的定位手段', () => {
    const text = outlineForPrompt(segmentResume(RESUME));
    expect(text).toContain('#0 [段落]');
    expect(text).toContain('[小节] 项目经历');
    expect(text).toContain('[条目] - 主导重构了订单系统');
  });

  it('超长片段被截断，避免把整份简历塞进提示词', () => {
    const long = '这是一段非常长的内容'.repeat(50);
    const text = outlineForPrompt(segmentResume(long), 20);
    expect(text).toContain('…');
    expect(text.length).toBeLessThan(long.length);
  });
});
