/**
 * 测试用的"脚本化模型"：不发网络请求，按调用次序返回预先准备好的文本。
 *
 * 为什么值得单独存在：多 Agent 流水线的测试痛点是"每个 Agent 都要一份假数据"，
 * 用脚本化客户端之后，测试写的是"第 1 次调用返回什么"，而不是"怎么 mock fetch"。
 * 它同时也是离线演示的录制工具——record 模式包上它，就能在没有任何 API Key 的机器上
 * 生成一整套完整卡带。
 */

import type { LlmClient, LlmRequest, LlmStreamEvent } from '../src/llm/types.ts';

export type ScriptedHandler = (req: LlmRequest, index: number) => string | Error;

export interface ScriptedClient extends LlmClient {
  readonly calls: LlmRequest[];
  /** 每次调用的返回值，便于断言"到底调了几次、按什么顺序" */
  countPurpose(purpose: string): number;
}

const USAGE = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, reasoningTokens: 0 };

export function createScriptedClient(handler: ScriptedHandler): ScriptedClient {
  const calls: LlmRequest[] = [];
  function take(req: LlmRequest): string {
    calls.push(req);
    const out = handler(req, calls.length - 1);
    if (out instanceof Error) throw out;
    return out;
  }
  const client: LlmClient = {
    mode: 'live',
    async complete(req: LlmRequest) {
      const text = take(req);
      return { text, usage: USAGE, digest: 'scripted-' + String(calls.length), replayed: false, elapsedMs: 0 };
    },
    async *stream(req: LlmRequest): AsyncGenerator<LlmStreamEvent, void, void> {
      const text = take(req);
      yield { type: 'reasoning', text: '（脚本化思考）' };
      yield { type: 'delta', text };
      yield {
        type: 'done',
        result: { text, usage: USAGE, digest: 'scripted-' + String(calls.length), replayed: false, elapsedMs: 0 },
      };
    },
  };
  return Object.assign(client, {
    calls,
    countPurpose(purpose: string): number {
      return calls.filter((c) => c.purpose === purpose).length;
    },
  });
}

/** 按 purpose 返回固定 JSON 的便捷写法；找不到对应 purpose 就抛错，避免测试静默通过 */
export function jsonByPurpose(map: Record<string, string>): ScriptedHandler {
  return (req) => {
    const hit = map[req.purpose];
    if (hit === undefined) return new Error('脚本化模型没有为 purpose=' + req.purpose + ' 准备返回值');
    return hit;
  };
}
