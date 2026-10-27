import { describe, expect, it } from 'vitest';
import { initialSandbox, sandboxReducer } from '../src/state.ts';
import type { CounterQuestion, RunEvent } from '../src/api.ts';

const RESUME = [
  '项目经历',
  '主导重构订单系统，首屏从 2.4s 降到 0.8s，日订单量 30 万。',
].join(String.fromCharCode(10));

const QUOTE = '首屏从 2.4s 降到 0.8s';
const JD_QUOTE = '有日订单百万级系统的性能优化经验';

function counter(over: Partial<CounterQuestion> = {}): CounterQuestion {
  const at = RESUME.indexOf(QUOTE);
  return {
    id: 'Q1',
    ordinal: 1,
    text: '团队平时怎么排迭代？上线前会留多少缓冲？',
    kind: 'process',
    reason: '简历上写了三个项目都按期上线，排期方式值得问清楚。',
    reply: '两周一个迭代，上线前留两天缓冲。',
    source: 'resume',
    anchor: { quote: QUOTE, start: at, end: at + QUOTE.length, exact: true },
    jdId: null,
    ...over,
  };
}

function counterEvent(over: Partial<CounterQuestion> = {}): RunEvent {
  return { type: 'counter', counters: [counter(over)], rejected: [] };
}

/** 反问清单是最后一步的产物：整批替换，不追加 */
describe('反问落进界面状态', () => {
  it('跑完一场后反问清单出现在状态里，锚点逐字保留', () => {
    let state = sandboxReducer(initialSandbox, { type: 'begin', sessionId: 's1' });
    state = sandboxReducer(state, { type: 'event', event: counterEvent() });
    expect(state.counters).toHaveLength(1);
    expect(state.counters[0]?.kind).toBe('process');
    expect(state.counters[0]?.source).toBe('resume');
    expect(state.counters[0]?.anchor.quote).toBe(QUOTE);
    expect(state.counterRejected).toEqual([]);
  });

  it('依据来自岗位要求时带着 JD 编号，界面才知道该跳到哪份原文', () => {
    const jdAt = 12;
    const event: RunEvent = {
      type: 'counter',
      counters: [
        counter({
          source: 'jd',
          jdId: 'J1',
          anchor: { quote: JD_QUOTE, start: jdAt, end: jdAt + JD_QUOTE.length, exact: true },
        }),
      ],
      rejected: [{ text: '你们的监控体系是怎么搭的？', reason: '依据简历原话里没有这句话，没有依据就不生成反问。' }],
    };
    let state = sandboxReducer(initialSandbox, { type: 'begin', sessionId: 's1' });
    state = sandboxReducer(state, { type: 'event', event });
    expect(state.counters[0]?.jdId).toBe('J1');
    expect(state.counters[0]?.anchor.quote).toBe(JD_QUOTE);
    expect(state.counterRejected).toHaveLength(1);
    expect(state.counterRejected[0]?.reason).toContain('没有依据就不生成反问');
  });

  it('再跑一场时整批换掉，不是往后追加', () => {
    let state = sandboxReducer(initialSandbox, { type: 'begin', sessionId: 's1' });
    state = sandboxReducer(state, { type: 'event', event: counterEvent() });
    state = sandboxReducer(state, { type: 'event', event: counterEvent({ id: 'Q1', text: '你们团队怎么分工？' }) });
    expect(state.counters).toHaveLength(1);
    expect(state.counters[0]?.text).toBe('你们团队怎么分工？');
  });

  it('状态归零之后反问也清空，不会把上一场的句子带到新的一场', () => {
    let state = sandboxReducer(initialSandbox, { type: 'begin', sessionId: 's1' });
    state = sandboxReducer(state, { type: 'event', event: counterEvent() });
    expect(state.counters.map((item) => item.id)).toEqual(['Q1']);
    const replayed = sandboxReducer(initialSandbox, { type: 'load', state: { ...initialSandbox, sessionId: 's2' } });
    expect(replayed.counters).toEqual([]);
    expect(replayed.counterRejected).toEqual([]);
  });
});
