/**
 * 流式适配层的单测。
 *
 * 这一层只有一条规矩值得反复钉：**最终结果一律取自 done 事件，不用分片拼**。
 * 分片是给人看的观感数据；拼接出来的文本不比 done 可信（重试、截断都会让它失真），
 * 而且一旦拿它当结果，五个阶段的解析就全部建立在一个更脆的输入上。
 */
import { describe, expect, it } from 'vitest';
import { withStreaming } from '../src/llm/streaming.ts';
import type { StreamChunk } from '../src/llm/streaming.ts';
import type { LlmClient, LlmRequest, LlmResult, LlmStreamEvent } from '../src/llm/types.ts';

function req(over: Partial<LlmRequest> = {}): LlmRequest {
  return { purpose: 'probe', system: 's', messages: [{ role: 'user', content: 'u' }], ...over };
}

const RESULT: LlmResult = {
  text: 'done 给的文本',
  usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, reasoningTokens: 0 },
  digest: 'd1',
  replayed: false,
  elapsedMs: 5,
};

function inner(events: LlmStreamEvent[]): LlmClient {
  return {
    mode: 'live',
    async complete(): Promise<LlmResult> {
      throw new Error('包了流式以后不该再走 complete');
    },
    async *stream(): AsyncGenerator<LlmStreamEvent, void, void> {
      for (const event of events) yield event;
    },
  };
}

describe('流式适配层', () => {
  it('分片按 channel 与 kind 送出去，返回的却是 done 的结果', async () => {
    const seen: StreamChunk[] = [];
    const client = withStreaming(
      inner([
        { type: 'reasoning', text: '先想一下测量口径' },
        { type: 'delta', text: '这段拼起来也不是答案' },
        { type: 'done', result: RESULT },
      ]),
      (chunk) => {
        seen.push(chunk);
      },
    );

    const result = await client.complete(req({ channel: 'probe:tech' }));

    expect(result.text).toBe('done 给的文本');
    expect(seen).toEqual([
      { channel: 'probe:tech', stage: 'probe', kind: 'reasoning', text: '先想一下测量口径' },
      { channel: 'probe:tech', stage: 'probe', kind: 'text', text: '这段拼起来也不是答案' },
    ]);
  });

  it('没给 channel 就退回阶段名，界面至少有地方可放', async () => {
    const seen: StreamChunk[] = [];
    const client = withStreaming(inner([{ type: 'delta', text: 'x' }, { type: 'done', result: RESULT }]), (chunk) => {
      seen.push(chunk);
    });
    await client.complete(req());
    expect(seen.map((chunk) => chunk.channel)).toEqual(['probe']);
  });

  it('没有 done 就是坏调用，明确报错而不是拿半截文本当结果', async () => {
    const client = withStreaming(inner([{ type: 'delta', text: '半截' }]), () => undefined);
    await expect(client.complete(req())).rejects.toMatchObject({ code: 'bad-request' });
  });

  it('异步 sink 会被逐片等待，顺序不会乱', async () => {
    const order: string[] = [];
    const client = withStreaming(
      inner([
        { type: 'delta', text: '一' },
        { type: 'delta', text: '二' },
        { type: 'done', result: RESULT },
      ]),
      async (chunk) => {
        await Promise.resolve();
        order.push(chunk.text);
      },
    );
    await client.complete(req({ channel: 'answer:P1' }));
    expect(order).toEqual(['一', '二']);
  });

  it('stream() 原样透传，不吞事件也不重发', async () => {
    const events: LlmStreamEvent[] = [
      { type: 'reasoning', text: 'r' },
      { type: 'delta', text: 'd' },
      { type: 'done', result: RESULT },
    ];
    const client = withStreaming(inner(events), () => undefined);
    const kinds: string[] = [];
    for await (const event of client.stream(req())) kinds.push(event.type);
    expect(kinds).toEqual(['reasoning', 'delta', 'done']);
  });
});
