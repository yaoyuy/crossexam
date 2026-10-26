import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chunkText, createReplayClient } from '../src/llm/replay.ts';
import { digestFor, writeCassette } from '../src/llm/cassette.ts';
import { baseRequest, classifyLlmError, cleanup, entryFor, newTempDir } from './llm-helpers.ts';

let dir = '';

beforeEach(function () {
  dir = newTempDir();
});

afterEach(function () {
  cleanup(dir);
});

describe('回放客户端', function () {
  it('命中卡带时返回记录内容，并声明自己没有联网', async function () {
    const req = baseRequest();
    writeCassette(dir, entryFor(req, '{"claims":[{"text":"主导重构订单系统"}]}'));
    const client = createReplayClient(dir);
    expect(client.mode).toBe('replay');

    const res = await client.complete(req);
    expect(res.replayed).toBe(true);
    expect(res.elapsedMs).toBe(0);
    expect(res.text).toContain('主导重构订单系统');
    expect(res.usage.outputTokens).toBe(40);
  });

  it('找不到记录就报错，并且说清是哪一条、怎么补录', async function () {
    const req = baseRequest();
    const client = createReplayClient(dir);
    const err = await classifyLlmError(function () { return client.complete(req); });
    expect(err.code).toBe('cassette-missing');
    expect(err.message).toContain(digestFor(req));
    expect(err.message).toContain('CROSSEXAM_MODE=record');
  });

  it('流式回放把全文切成分片，最后一段是终点事件', async function () {
    const req = baseRequest();
    const text = '{"claims":[{"text":"主导重构订单系统"},{"text":"首屏 2.4s 到 0.8s"}]}';
    writeCassette(dir, entryFor(req, text));
    const client = createReplayClient(dir);

    const deltas: string[] = [];
    let finished = false;
    for await (const ev of client.stream(req)) {
      if (ev.type === 'delta') deltas.push(ev.text);
      else if (ev.type === 'done') {
        finished = true;
        expect(ev.result.text).toBe(text);
      }
    }
    expect(finished).toBe(true);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join('')).toBe(text);
  });

  it('录下了思考过程也能回放，离线时思考可视化不会消失', async function () {
    const req = baseRequest();
    const entry = entryFor(req, '结论');
    entry.response.reasoning = '先看这条主张有没有可核实的证据。';
    writeCassette(dir, entry);
    const client = createReplayClient(dir);

    const reasoning: string[] = [];
    let resultReasoning: string | undefined;
    for await (const ev of client.stream(req)) {
      if (ev.type === 'reasoning') reasoning.push(ev.text);
      if (ev.type === 'done') resultReasoning = ev.result.reasoning;
    }
    expect(reasoning.join('')).toBe('先看这条主张有没有可核实的证据。');
    expect(resultReasoning).toBe('先看这条主张有没有可核实的证据。');
  });

  it('录下了分片就按原分片回放，节奏与当时一致', async function () {
    const req = baseRequest();
    writeCassette(dir, entryFor(req, '甲乙丙丁戊己庚辛', ['甲乙', '丙丁', '戊己庚辛']));
    const client = createReplayClient(dir);

    const deltas: string[] = [];
    for await (const ev of client.stream(req)) {
      if (ev.type === 'delta') deltas.push(ev.text);
    }
    expect(deltas).toEqual(['甲乙', '丙丁', '戊己庚辛']);
  });
});

describe('分片函数', function () {
  it('是纯函数：同样输入永远同样输出', function () {
    const text = '主导重构订单系统，首屏从 2.4s 降到 0.8s。服务 12 个业务线。';
    expect(chunkText(text)).toEqual(chunkText(text));
  });

  it('拼接后与原文逐字相同（含换行、标点与表情）', function () {
    const samples = [
      '',
      '短',
      '主导重构订单系统，首屏从 2.4s 降到 0.8s。',
      '第一行' + String.fromCharCode(10) + '第二行很长很长很长很长很长很长很长',
      'emoji 混排 🔥 也要能原样还原',
    ];
    for (const s of samples) {
      expect(chunkText(s).join('')).toBe(s);
    }
  });
});
