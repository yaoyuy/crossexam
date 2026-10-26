/**
 * 阶段 → 模型 路由的测试：验证「思考可视化」只换模型、不换提示词、不换指纹。
 * 全用假 fetch 与脚本化客户端，一个真实请求都不发。
 */

import { describe, expect, it } from 'vitest';
import { createLiveClient, buildPayload, modelFor } from '../src/llm/live.ts';
import { describeRoutes, reasoningRoutes, withStageModels } from '../src/llm/index.ts';
import { digestFor, readCassette } from '../src/llm/cassette.ts';
import { createScriptedClient } from './scripted.ts';
import { baseRequest, cleanup, newTempDir } from './llm-helpers.ts';
import type { LlmRequest } from '../src/llm/types.ts';

function okResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('思考模型的路由配置', function () {
  it('默认只把判定交给思考模型', function () {
    expect(reasoningRoutes({ CROSSEXAM_REASONING_MODEL: 'deepseek-reasoner' })).toEqual({
      verdict: 'deepseek-reasoner',
    });
  });

  it('没配思考模型时一条路由都不给', function () {
    expect(reasoningRoutes({})).toEqual({});
    expect(reasoningRoutes({ CROSSEXAM_REASONING_MODEL: '   ' })).toEqual({});
  });

  it('可以用 CROSSEXAM_REASONING_STAGES 改路由阶段，空项与空格被丢掉', function () {
    const routes = reasoningRoutes({
      CROSSEXAM_REASONING_MODEL: 'deepseek-reasoner',
      CROSSEXAM_REASONING_STAGES: ' verdict , probe ,, ',
    });
    expect(routes).toEqual({ verdict: 'deepseek-reasoner', probe: 'deepseek-reasoner' });
  });

  it('一行说明里空路由是空串，有路由才列出来', function () {
    expect(describeRoutes({})).toBe('');
    expect(describeRoutes({ verdict: 'deepseek-reasoner' })).toBe('verdict → deepseek-reasoner');
  });
});

describe('阶段路由只动 hit 的那几条请求', function () {
  it('命中的请求带上模型，其余请求原样不动', async function () {
    const scripted = createScriptedClient(function () { return '{}'; });
    const client = withStageModels(scripted, { verdict: 'deepseek-reasoner' });
    await client.complete({ ...baseRequest(), purpose: 'verdict' } as LlmRequest);
    await client.complete({ ...baseRequest(), purpose: 'probe' } as LlmRequest);
    expect(scripted.calls[0]?.model).toBe('deepseek-reasoner');
    expect(scripted.calls[1]?.model).toBeUndefined();
  });

  it('空路由直接返回原客户端，不包一层', function () {
    const scripted = createScriptedClient(function () { return '{}'; });
    expect(withStageModels(scripted, {})).toBe(scripted);
  });
});

describe('模型名进请求、也进卡带', function () {
  it('buildPayload 认请求自带的模型，没有才用默认', function () {
    const req = { ...baseRequest(), model: 'deepseek-reasoner' } as LlmRequest;
    expect(buildPayload(req, 'deepseek-chat', false)['model']).toBe('deepseek-reasoner');
    expect(buildPayload(baseRequest() as LlmRequest, 'deepseek-chat', false)['model']).toBe('deepseek-chat');
    expect(modelFor({ ...baseRequest(), model: '  ' } as LlmRequest, 'deepseek-chat')).toBe('deepseek-chat');
  });

  it('record 模式落盘的卡带记的是真正用过的那个模型', async function () {
    const dir = newTempDir();
    try {
      const client = createLiveClient({
        baseUrl: 'https://example.invalid/v1',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        recordDir: dir,
        fetchImpl: (async function () {
          return okResponse({ choices: [{ message: { content: '{"kind":"solid"}' } }], usage: {} });
        }) as unknown as typeof fetch,
      });
      const req = { ...baseRequest(), purpose: 'verdict', model: 'deepseek-reasoner' } as LlmRequest;
      await client.complete(req);
      const entry = readCassette(dir, digestFor(req));
      expect(entry?.model).toBe('deepseek-reasoner');
      expect(entry?.purpose).toBe('verdict');
      // 模型名不进指纹：同一个请求换个模型，卡带仍然寻得到
      const plain = { ...baseRequest(), purpose: 'verdict' } as LlmRequest;
      expect(digestFor(plain)).toBe(digestFor(req));
    } finally {
      cleanup(dir);
    }
  });
});
