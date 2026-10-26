/**
 * 真实调用客户端的测试：全程用假的 fetch，一个真实网络请求都不发。
 * 重点验证三件事——
 * 1. 请求体是不是我们以为的那个样子；
 * 2. SSE 解析有没有把思考过程与正文分清楚；
 * 3. record 模式落盘的卡带，能不能被回放客户端原样读回去。
 */

import { describe, expect, it } from 'vitest';
import { buildPayload, createLiveClient, endpointOf, listLiveModels, parseSseData, readUsage, resolveLiveConfig } from '../src/llm/live.ts';
import { digestFor, readCassette } from '../src/llm/cassette.ts';
import { LlmError } from '../src/llm/types.ts';
import { baseRequest, classifyLlmError, cleanup, newTempDir } from './llm-helpers.ts';
import type { LlmRequest } from '../src/llm/types.ts';

const CONFIG = { baseUrl: 'https://example.invalid/v1', apiKey: 'test-key', model: 'demo-model' };

interface Call {
  url: string;
  body: Record<string, unknown>;
  authorization: string | undefined;
}

function fakeFetch(reply: () => Response, calls: Call[]): typeof fetch {
  return (async function (input: RequestInfo | URL, init?: RequestInit) {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      authorization: headers['authorization'],
    });
    return reply();
  }) as unknown as typeof fetch;
}

function jsonResponse(payload: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status: status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(payloads: unknown[]): Response {
  const lines: string[] = [];
  for (const p of payloads) lines.push('data: ' + JSON.stringify(p) + String.fromCharCode(10));
  lines.push('data: [DONE]' + String.fromCharCode(10));
  return new Response(lines.join(String.fromCharCode(10)), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function delta(content?: string, reasoning?: string): unknown {
  const d: Record<string, unknown> = {};
  if (content !== undefined) d['content'] = content;
  if (reasoning !== undefined) d['reasoning_content'] = reasoning;
  return { choices: [{ index: 0, delta: d }] };
}

describe('真实调用的配置', function () {
  it('缺配置时点名缺了哪几个环境变量，并提示可以改走回放', function () {
    const saved = {
      base: process.env['LLM_BASE_URL'],
      key: process.env['LLM_API_KEY'],
      model: process.env['LLM_MODEL'],
    };
    delete process.env['LLM_BASE_URL'];
    delete process.env['LLM_API_KEY'];
    delete process.env['LLM_MODEL'];
    try {
      let caught: unknown;
      try {
        resolveLiveConfig({});
      } catch (e) {
        caught = e;
      }
      expect(caught instanceof LlmError).toBe(true);
      const llmErr = caught as LlmError;
      expect(llmErr.code).toBe('not-configured');
      expect(llmErr.message).toContain('LLM_BASE_URL');
      expect(llmErr.message).toContain('LLM_API_KEY');
      expect(llmErr.message).toContain('LLM_MODEL');
      expect(llmErr.message).toContain('replay');
    } finally {
      if (saved.base !== undefined) process.env['LLM_BASE_URL'] = saved.base;
      if (saved.key !== undefined) process.env['LLM_API_KEY'] = saved.key;
      if (saved.model !== undefined) process.env['LLM_MODEL'] = saved.model;
    }
  });

  it('baseUrl 末尾有无斜杠、是否已带路径，都能算出同一个端点', function () {
    expect(endpointOf('https://a.example/v1')).toBe('https://a.example/v1/chat/completions');
    expect(endpointOf('https://a.example/v1/')).toBe('https://a.example/v1/chat/completions');
    expect(endpointOf('https://a.example/v1/chat/completions')).toBe('https://a.example/v1/chat/completions');
  });
});

describe('请求体与用量解析', function () {
  it('系统提示词永远排在第一条，且严格模式与 JSON 模式各自落到正确字段', function () {
    const req = baseRequest();
    const payload = buildPayload(req, 'demo-model', true);
    const messages = payload['messages'] as { role: string; content: string }[];
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toBe(req.system);
    expect(messages[1]?.role).toBe('user');
    expect(payload['response_format']).toEqual({ type: 'json_object' });
    expect(payload['stream']).toBe(true);
    expect(payload['stream_options']).toEqual({ include_usage: true });
    expect(payload['temperature']).toBe(0);
  });

  it('非流式不加 stream_options，免得多花一次往返', function () {
    const payload = buildPayload(baseRequest(), 'demo-model', false);
    expect(payload['stream']).toBe(false);
    expect(payload['stream_options']).toBeUndefined();
  });

  it('缓存命中与思考 token 的两种字段名都认', function () {
    const deepseek = readUsage({ prompt_tokens: 10, completion_tokens: 4, prompt_cache_hit_tokens: 7 });
    expect(deepseek.cacheReadTokens).toBe(7);
    const openai = readUsage({
      prompt_tokens: 10,
      completion_tokens: 4,
      prompt_tokens_details: { cached_tokens: 3 },
      completion_tokens_details: { reasoning_tokens: 9 },
    });
    expect(openai.cacheReadTokens).toBe(3);
    expect(openai.reasoningTokens).toBe(9);
    expect(readUsage(null).inputTokens).toBe(0);
  });

  it('SSE 里没用的行直接忽略，不会污染结果', function () {
    expect(parseSseData('')).toBeNull();
    expect(parseSseData('[DONE]')).toBeNull();
    expect(parseSseData('{ 坏 JSON')).toBeNull();
    expect(parseSseData(JSON.stringify({ choices: [] }))).toBeNull();
  });
});

describe('非流式调用', function () {
  it('取出正文并把用量带回来，请求头里带上 key', async function () {
    const calls: Call[] = [];
    const client = createLiveClient({
      ...CONFIG,
      fetchImpl: fakeFetch(function () {
        return jsonResponse({
          choices: [{ message: { content: '{"claims":[]}', reasoning_content: '先想一下。' } }],
          usage: { prompt_tokens: 11, completion_tokens: 5, prompt_cache_hit_tokens: 2 },
        });
      }, calls),
    });

    const req = baseRequest();
    const result = await client.complete(req);
    expect(result.text).toBe('{"claims":[]}');
    expect(result.reasoning).toBe('先想一下。');
    expect(result.usage.inputTokens).toBe(11);
    expect(result.replayed).toBe(false);
    expect(result.digest).toBe(digestFor(req));
    expect(calls[0]?.authorization).toBe('Bearer test-key');
    expect(calls[0]?.url).toBe('https://example.invalid/v1/chat/completions');
    expect(client.mode).toBe('live');
  });

  it('接口报错时把状态码与响应体片段一起抛出来，方便定位', async function () {
    const calls: Call[] = [];
    const client = createLiveClient({
      ...CONFIG,
      fetchImpl: fakeFetch(function () {
        return jsonResponse({ error: { message: 'model not found' } }, 400);
      }, calls),
    });
    const err = await classifyLlmError(function () { return client.complete(baseRequest()); });
    expect(err.code).toBe('bad-request');
    expect(err.message).toContain('400');
    expect(err.message).toContain('model not found');
  });
});

describe('流式调用', function () {
  it('思考过程与正文分开推，最后的 done 事件带全文与用量', async function () {
    const calls: Call[] = [];
    const client = createLiveClient({
      ...CONFIG,
      fetchImpl: fakeFetch(function () {
        return sseResponse([
          delta(undefined, '先看'),
          delta(undefined, '证据。'),
          delta('{"claims":'),
          delta('[]}'),
          { choices: [], usage: { prompt_tokens: 20, completion_tokens: 6 } },
        ]);
      }, calls),
    });

    const reasoning: string[] = [];
    const deltas: string[] = [];
    let doneText = '';
    let doneUsage = 0;
    for await (const ev of client.stream(baseRequest())) {
      if (ev.type === 'reasoning') reasoning.push(ev.text);
      else if (ev.type === 'delta') deltas.push(ev.text);
      else {
        doneText = ev.result.text;
        doneUsage = ev.result.usage.outputTokens;
      }
    }
    expect(reasoning.join('')).toBe('先看证据。');
    expect(deltas.join('')).toBe('{"claims":[]}');
    expect(doneText).toBe('{"claims":[]}');
    expect(doneUsage).toBe(6);
    expect(calls[0]?.body['stream']).toBe(true);
  });
});

describe('录制模式', function () {
  it('录下的卡带能被回放客户端原样读回去，分片与思考过程都不丢', async function () {
    const dir = newTempDir();
    try {
      const calls: Call[] = [];
      const client = createLiveClient({
        ...CONFIG,
        recordDir: dir,
        clock: function () { return new Date('2026-10-26T00:00:00.000Z'); },
        fetchImpl: fakeFetch(function () {
          return sseResponse([
            delta(undefined, '先定位原文。'),
            delta('主导'),
            delta('重构'),
            { choices: [], usage: { prompt_tokens: 20, completion_tokens: 6 } },
          ]);
        }, calls),
      });

      const req: LlmRequest = baseRequest();
      expect(client.mode).toBe('record');
      const collected: string[] = [];
      for await (const ev of client.stream(req)) {
        if (ev.type === 'delta') collected.push(ev.text);
      }

      const entry = readCassette(dir, digestFor(req));
      expect(entry).not.toBeNull();
      expect(entry?.response.text).toBe('主导重构');
      expect(entry?.response.reasoning).toBe('先定位原文。');
      expect(entry?.response.chunks).toEqual(['主导', '重构']);
      expect(entry?.recordedAt).toBe('2026-10-26T00:00:00.000Z');
      expect(collected.join('')).toBe(entry?.response.text);

      // 再换回放客户端读同一盘卡带：录与放必须严丝合缝。
      const { createReplayClient } = await import('../src/llm/replay.ts');
      const replayed: string[] = [];
      for await (const ev of createReplayClient(dir).stream(req)) {
        if (ev.type === 'delta') replayed.push(ev.text);
      }
      expect(replayed).toEqual(['主导', '重构']);
    } finally {
      cleanup(dir);
    }
  });
});

/**
 * 模型清单是给界面铺下拉框的，因此它有两条不能破的规矩：
 *   1. 配置不全时**一个网络包都不发**（默认路径是离线回放，打开页面不该产生联网行为）；
 *   2. 端点没有 /models 不算致命错误——允许用户手填模型名。
 */
describe('模型清单', function () {
  it('没配好就不发请求，直接说清缺哪个环境变量', async function () {
    const calls: Call[] = [];
    // 显式传空串：无论这台机器有没有 LLM_* 环境变量，这条断言都成立。
    const listed = await listLiveModels({
      baseUrl: '',
      apiKey: '',
      model: '',
      fetchImpl: fakeFetch(function () { return jsonResponse({ data: [] }); }, calls),
    });
    expect(listed.ready).toBe(false);
    expect(calls).toEqual([]);
    expect(listed.error).toContain('LLM_BASE_URL');
    expect(listed.error).toContain('LLM_API_KEY');
  });

  it('配上就按 /models 拉一次，认 data[].id、去重、去掉空白', async function () {
    const calls: Call[] = [];
    const listed = await listLiveModels({
      ...CONFIG,
      fetchImpl: fakeFetch(function () {
        return jsonResponse({
          data: [{ id: 'deepseek-chat' }, { id: 'deepseek-chat' }, { id: ' deepseek-reasoner ' }, { id: '' }, {}],
        });
      }, calls),
    });
    expect(listed.ready).toBe(true);
    expect(listed.models).toEqual(['deepseek-chat', 'deepseek-reasoner']);
    expect(listed.defaultModel).toBe('demo-model');
    expect(listed.error).toBeNull();
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe('https://example.invalid/v1/models');
    expect(calls[0]?.authorization).toBe('Bearer test-key');
  });

  it('端点不认 /models 时不算致命：仍然 ready，但把状态说出来让人手填', async function () {
    const calls: Call[] = [];
    const listed = await listLiveModels({
      ...CONFIG,
      fetchImpl: fakeFetch(function () { return jsonResponse({ error: 'no such route' }, 404); }, calls),
    });
    expect(listed.ready).toBe(true);
    expect(listed.models).toEqual([]);
    expect(listed.error).toContain('404');
  });
});
