import { describe, expect, it } from 'vitest';
import { explainRunError } from '../src/components/Bits.tsx';
import { synthesizedCount } from '../src/api.ts';
import type { EventRow, SessionView } from '../src/api.ts';

/**
 * 这两件事都关系到「界面会不会骗人」：
 * explainRunError 决定报错是开发者文案还是人话；synthesizedCount 决定合成兜底条数
 * 是「写清楚了」还是「当成没有」。所以按硬断言写，不靠肉眼在浏览器里看。
 */
describe('把跑场错误折成人话', () => {
  const cassette = '回放模式找不到这一条记录。用途「purpose」的指纹是 digest，请用 CROSSEXAM_MODE=record 联网跑一次把它录下来。';

  it('认得出没录过卡带，并且把开发者原文留在技术细节里', () => {
    const explain = explainRunError({ message: cassette, fatal: true, code: 'cassette-missing' });
    expect(explain.title).toContain('卡带');
    expect(explain.title).not.toContain('digest');
    expect(explain.steps.length).toBeGreaterThan(0);
    // 原文不能丢：排障时还要靠它去 grep
    expect(explain.raw).toBe(cassette);
  });

  it('没有 code 的老服务端也认得出（靠文案）', () => {
    const explain = explainRunError({ message: cassette, fatal: true });
    expect(explain.title).toContain('卡带');
  });

  it('没配好模型时指向环境变量，而不是让人猜', () => {
    const explain = explainRunError({ message: 'LLM_API_KEY 还没有配置', fatal: true, code: 'not-configured' });
    expect(explain.title).toContain('还没有配好');
    expect(explain.steps.join(' ')).toContain('LLM_API_KEY');
  });

  it('连不上本地服务时给出「先起服务」这一步', () => {
    const explain = explainRunError({ message: 'Failed to fetch', fatal: true });
    expect(explain.title).toContain('连不上本地服务');
    expect(explain.steps.join(' ')).toContain('npm run dev');
  });

  it('认不出来的错误也分得开「这一场断了」与「某一处没做完」', () => {
    const fatal = explainRunError({ message: '内部错误 500', fatal: true });
    const partial = explainRunError({ message: '内部错误 500', fatal: false });
    expect(fatal.title).not.toBe(partial.title);
    expect(partial.steps.length).toBeGreaterThan(0);
  });
});

const row = (kind: string, payload: Record<string, unknown>): EventRow => ({ seq: 1, kind, payload, createdAt: '2026-11-08T00:00:00.000Z' });

/** 只喂 synthesizedCount 会读的那几个字段：SessionView 的其余部分与本节无关 */
const view = (over: Record<string, unknown>): SessionView => ({ events: [], notices: [], llm: {}, ...over }) as unknown as SessionView;

describe('合成兜底条数怎么读', () => {
  it('服务端给了结构化字段就照着念', () => {
    expect(synthesizedCount(view({ synthesized: 3, events: [row('synthetic', { count: 9 })] }))).toBe(3);
    expect(synthesizedCount(view({ llm: { synthesized: 4 } }))).toBe(4);
  });

  it('没有字段时从事件流里读（服务端把合成落成 kind=synthetic 的事件）', () => {
    expect(synthesizedCount(view({ events: [row('stage', {}), row('synthetic', { count: 10, stages: ['extract'] })] }))).toBe(10);
  });

  it('再没有就从公告那句人话里抠数字', () => {
    const note = '本次运行有 7 条响应没有录过卡带，由离线兜底按提示词确定性合成（阶段：extract）。';
    expect(synthesizedCount(view({ notices: [note] }))).toBe(7);
  });

  it('什么都没说就返回 null，不能替服务端保证「全是真实产出」', () => {
    expect(synthesizedCount(view({}))).toBeNull();
    expect(synthesizedCount(view({ synthesized: null, events: [row('synthetic', { count: 'x' })] }))).toBeNull();
  });
});
