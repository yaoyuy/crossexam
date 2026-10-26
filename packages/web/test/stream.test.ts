/**
 * 流式分片在前端怎么折叠成界面状态。
 *
 * 这里守两条容易悄悄坏掉的规矩：
 *   1. 分片是观感数据 —— 形状看不懂就丢掉，不能让半条坏事件把整场质询打成白屏；
 *   2. 只在 running 时露出来 —— 跑完以后屏幕上该是结论，不是半截草稿。
 */
import { describe, expect, it } from 'vitest';
import { asStreamChunk } from '../src/api.ts';
import { channelLabel } from '../src/labels.ts';
import {
  applyStreamChunk,
  initialSandbox,
  liveChannels,
  liveText,
  readableStreamText,
  sandboxReducer,
  STREAM_CAP,
  streamText,
  tailText,
} from '../src/state.ts';
import type { SandboxState, StreamBuffer } from '../src/state.ts';

function running(over: Partial<SandboxState> = {}): SandboxState {
  return { ...initialSandbox, phase: 'running', sessionId: 's1', ...over };
}

function buffer(channel: string, text: string, kind: 'reasoning' | 'text' = 'text'): StreamBuffer {
  return { channel, stage: channel.split(':')[0] ?? channel, kind, text };
}

describe('分片的形状校验', () => {
  it('认得对的，不认识的一律丢掉', () => {
    const good = { channel: 'answer:P1', stage: 'answer', kind: 'text', text: '本地 Chrome 量的' };
    expect(asStreamChunk(good)).toEqual(good);

    expect(asStreamChunk(null)).toBeNull();
    expect(asStreamChunk('一串字')).toBeNull();
    expect(asStreamChunk({ ...good, channel: '' })).toBeNull();
    expect(asStreamChunk({ ...good, stage: 3 })).toBeNull();
    expect(asStreamChunk({ ...good, kind: 'thinking' })).toBeNull();
    expect(asStreamChunk({ ...good, text: '' })).toBeNull();
    expect(asStreamChunk({ ...good, text: 42 })).toBeNull();
  });
});

describe('分片折叠成状态', () => {
  it('同一个 channel 越接越长，不同 channel 各归各位', () => {
    let state = running();
    state = applyStreamChunk(state, { channel: 'answer:P1', stage: 'answer', kind: 'text', text: '本' });
    state = applyStreamChunk(state, { channel: 'answer:P1', stage: 'answer', kind: 'text', text: '地' });
    state = applyStreamChunk(state, { channel: 'verdict:C1', stage: 'verdict', kind: 'text', text: '{' });

    expect(state.streams['answer:P1']?.text).toBe('本地');
    expect(state.streams['verdict:C1']?.text).toBe('{');
    expect(Object.keys(state.streams)).toEqual(['answer:P1', 'verdict:C1']);
  });

  it('超过上限只留尾巴，免得一场长回答把内存吃满', () => {
    let state = running();
    state = applyStreamChunk(state, { channel: 'answer:P1', stage: 'answer', kind: 'text', text: 'a'.repeat(STREAM_CAP) });
    state = applyStreamChunk(state, { channel: 'answer:P1', stage: 'answer', kind: 'text', text: '尾巴' });

    const text = state.streams['answer:P1']?.text ?? '';
    expect(text.startsWith('…')).toBe(true);
    expect(text.endsWith('尾巴')).toBe(true);
    expect(text).toHaveLength(STREAM_CAP + 1);
  });

  it('sse 的 stream 事件走进状态；形状不对就当没发生', () => {
    const start = running();
    const next = sandboxReducer(start, {
      type: 'sse',
      name: 'stream',
      data: { channel: 'probe:tech', stage: 'probe', kind: 'reasoning', text: '先问口径' },
    });
    expect(next.streams['probe:tech']?.text).toBe('先问口径');

    const broken = sandboxReducer(start, { type: 'sse', name: 'stream', data: '不是对象' });
    expect(broken).toEqual(start);
  });

  it('重置与重新开跑都会把上场的分片清干净', () => {
    const dirty = applyStreamChunk(running(), { channel: 'extract', stage: 'extract', kind: 'text', text: '残留' });
    expect(sandboxReducer(dirty, { type: 'reset' })).toEqual(initialSandbox);
    expect(sandboxReducer(dirty, { type: 'begin', sessionId: 's2' }).streams).toEqual({});
  });
});

describe('实况文本取用', () => {
  it('只在 running 时给值：跑完以后屏幕上是结论而不是半截草稿', () => {
    const live = applyStreamChunk(running(), { channel: 'answer:P1', stage: 'answer', kind: 'text', text: '正在写' });
    expect(streamText(live, 'answer:P1')).toBe('正在写');
    expect(streamText({ ...live, phase: 'done' }, 'answer:P1')).toBeNull();
    expect(streamText(live, 'answer:P9')).toBeNull();
    expect(streamText(live, 'extract')).toBeNull();
  });

  it('实况栏只收当前阶段那几路，最新的排最前，数量有上限', () => {
    let state = running({ activeStage: 'answer' });
    state = applyStreamChunk(state, { channel: 'answer:P1', stage: 'answer', kind: 'text', text: '一' });
    state = applyStreamChunk(state, { channel: 'answer:P2', stage: 'answer', kind: 'text', text: '二' });
    state = applyStreamChunk(state, { channel: 'answer:P3', stage: 'answer', kind: 'text', text: '三' });
    state = applyStreamChunk(state, { channel: 'verdict:C1', stage: 'verdict', kind: 'text', text: '别串台' });

    expect(liveChannels(state, 2).map((item) => item.channel)).toEqual(['answer:P3', 'answer:P2']);
    expect(liveChannels(state).map((item) => item.channel)).toEqual(['answer:P3', 'answer:P2', 'answer:P1']);
    expect(liveChannels({ ...state, phase: 'done' })).toEqual([]);
    expect(liveChannels({ ...state, activeStage: null })).toEqual([]);
  });

  it('尾巴截断：短的照旧，长的加省略号', () => {
    expect(tailText('短', 10)).toBe('短');
    expect(tailText('0123456789', 4)).toBe('…6789');
  });
});

describe('channel 在界面上的标题', () => {
  it('每个阶段的每一路都有中文名，认不出来就原样显示不猜', () => {
    expect(channelLabel('extract')).toBe('正在抽取主张');
    expect(channelLabel('probe:tech')).toBe('技术面试官 正在追问');
    expect(channelLabel('probe:hr')).toBe('HR 面试官 正在追问');
    expect(channelLabel('answer:P1')).toBe('求职者作答 P1');
    expect(channelLabel('verdict:C3')).toBe('判定 C3');
    expect(channelLabel('suggest:C3')).toBe('改写建议 C3');
    expect(channelLabel('probe')).toBe('probe');
    expect(channelLabel('未来阶段:x')).toBe('未来阶段:x');
  });

  it('buffer 的 stage 字段与 channel 前缀一致，实况栏才好按阶段筛', () => {
    expect(buffer('answer:P1', 'x').stage).toBe('answer');
    expect(buffer('extract', 'x').stage).toBe('extract');
  });
});
describe('把正在写的 JSON 还原成人话', () => {
  it('半截 JSON 也读得出来 —— 这正是「正在写」的样子', () => {
    expect(readableStreamText('{"answered":true,"text":"本地 Chrome 量的')).toBe('本地 Chrome 量的');
    expect(readableStreamText('[{"claimId":"C1","question":"这个 2.4s 是怎么测的？"}]')).toBe('这个 2.4s 是怎么测的？');
  });

  it('转义按 JSON 的规矩还原，不把 \n 原样摆在屏幕上', () => {
    const raw = '{"rationale":"第一行\\n第二行 \\"带引号\\""}';
    expect(readableStreamText(raw)).toBe('第一行\n第二行 "带引号"');
  });

  it('还没写到人话字段就先不显示，免得屏幕上是半个 JSON', () => {
    expect(readableStreamText('{"answered":false')).toBe('');
    expect(readableStreamText('{')).toBe('');
    expect(readableStreamText('')).toBe('');
  });

  it('字段有先后：抽取阶段先露主张本身，判定阶段先露理由', () => {
    const extract = '{"claims":[{"text":"主导重构订单系统","quote":"首屏加载从 2.4s 降到 0.8s"}]}';
    expect(readableStreamText(extract)).toBe('主导重构订单系统');
    const verdict = '{"kind":"overstated","confidence":0.7,"rationale":"口径前后不一致"}';
    expect(readableStreamText(verdict)).toBe('口径前后不一致');
  });

  it('不是 JSON 就原样返回（离线卡带里偶尔有整段散文）', () => {
    expect(readableStreamText('就是一段话')).toBe('就是一段话');
  });

  it('被上限截断过的分片（以省略号开头）也能读出人话', () => {
    expect(readableStreamText('…{"after":"刚上线时 QPS 是 800"}')).toBe('刚上线时 QPS 是 800');
  });

  it('liveText 把两件事串起来：要 running、也要有人话可说', () => {
    const live = applyStreamChunk(running(), {
      channel: 'answer:P1',
      stage: 'answer',
      kind: 'text',
      text: '{"answered":true,"text":"取的是 P75"}',
    });
    expect(liveText(live, 'answer:P1')).toBe('取的是 P75');
    expect(liveText({ ...live, phase: 'done' }, 'answer:P1')).toBeNull();

    const early = applyStreamChunk(running(), {
      channel: 'answer:P1',
      stage: 'answer',
      kind: 'text',
      text: '{"answered":true,',
    });
    expect(liveText(early, 'answer:P1')).toBeNull();
  });
});
