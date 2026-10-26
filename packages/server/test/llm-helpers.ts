/** 测试公用夹具：让两个测试文件共用同一份构造逻辑，避免各写一份慢慢跑偏。 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CASSETTE_VERSION, digestFor } from '../src/llm/cassette.ts';
import { LlmError } from '../src/llm/types.ts';
import type { CassetteEntry } from '../src/llm/cassette.ts';
import type { LlmRequest, LlmUsage } from '../src/llm/types.ts';

export const USAGE: LlmUsage = {
  inputTokens: 120,
  outputTokens: 40,
  cacheReadTokens: 0,
  reasoningTokens: 8,
};

export function baseRequest(): LlmRequest {
  return {
    purpose: '抽取主张',
    system: '你是简历分析助手，只输出 JSON。',
    messages: [{ role: 'user', content: '简历正文：主导重构订单系统，首屏从 2.4s 降到 0.8s。' }],
    temperature: 0,
    json: true,
  };
}

export function entryFor(req: LlmRequest, text: string, chunks?: string[]): CassetteEntry {
  const response = chunks ? { text: text, usage: USAGE, chunks: chunks } : { text: text, usage: USAGE };
  return {
    version: CASSETTE_VERSION,
    digest: digestFor(req),
    purpose: req.purpose,
    model: 'demo-model',
    recordedAt: '2026-10-26T00:00:00.000Z',
    request: {
      system: req.system,
      messages: req.messages.map(function (m) {
        return { role: m.role, content: m.content };
      }),
      temperature: req.temperature ?? null,
      maxTokens: req.maxTokens ?? null,
      json: req.json ?? false,
    },
    response: response,
  };
}

/** 取一段代码抛出的 LlmError 错误码；没抛或抛了别的东西都会显式暴露出来。 */
export function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof LlmError ? err.code : 'not-llm-error:' + String(err);
  }
  return 'no-throw';
}

/** 把一次可能失败的异步调用收敛成 LlmError；抛出别的东西说明不是预期的失败路径。 */
export async function classifyLlmError(fn: () => Promise<unknown>): Promise<LlmError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof LlmError) return err;
    throw err;
  }
  throw new Error('预期这次调用会失败，但它成功了');
}

export function newTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'crossexam-'));
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
