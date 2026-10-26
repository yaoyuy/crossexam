/**
 * 回放客户端：只读本地记录，绝不发出网络请求。
 *
 * 这是"无 Key 也能复现"的落点。它有一条硬规则——
 * **找不到记录就报错，绝不返回空结果或编一段文本**。
 * 静默降级会让"离线可跑"变成一句谎言：流程看着跑通了，
 * 实际每一环都在拿空气当输入。
 */

import { digestFor, readCassette } from './cassette.ts';
import { LlmError } from './types.ts';
import type { CassetteEntry } from './cassette.ts';
import type { LlmClient, LlmRequest, LlmStreamEvent } from './types.ts';

/** 回放分片的默认粒度，约等于一个短句。 */
export const REPLAY_CHUNK_SIZE = 24;

const BREAK_CHARS = ['\n', '。', '！', '？', '；', '，', '.', '!', '?', ';', ','];

/**
 * 把整段文本切成确定性分片。
 * 回放不该假装"耗时"，但前端仍然需要流式观感，
 * 所以分片规则必须是纯函数：同样的文本永远切出同样的分片。
 */
export function chunkText(text: string, size: number = REPLAY_CHUNK_SIZE): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  let buf: string[] = [];
  const softMin = Math.floor(size / 2);

  for (const ch of chars) {
    buf.push(ch);
    const atBreak = BREAK_CHARS.indexOf(ch) >= 0 && buf.length >= softMin;
    if (buf.length >= size || atBreak) {
      out.push(buf.join(''));
      buf = [];
    }
  }
  if (buf.length > 0) out.push(buf.join(''));
  return out;
}

function load(dir: string, req: LlmRequest): { entry: CassetteEntry; digest: string } {
  const digest = digestFor(req);
  const entry = readCassette(dir, digest);
  if (!entry) {
    throw new LlmError(
      'cassette-missing',
      '回放模式找不到这一条记录。用途「' +
        req.purpose +
        '」的指纹是 ' +
        digest +
        '，请用 CROSSEXAM_MODE=record 联网跑一次把它录下来。',
    );
  }
  return { entry: entry, digest: digest };
}

export function createReplayClient(dir: string): LlmClient {
  return {
    mode: 'replay',

    async complete(req: LlmRequest) {
      const loaded = load(dir, req);
      return {
        text: loaded.entry.response.text,
        usage: loaded.entry.response.usage,
        digest: loaded.digest,
        replayed: true,
        elapsedMs: 0,
      };
    },

    async *stream(req: LlmRequest): AsyncGenerator<LlmStreamEvent, void, void> {
      const loaded = load(dir, req);
      const recorded = loaded.entry.response.chunks;
      const chunks = recorded && recorded.length > 0 ? recorded : chunkText(loaded.entry.response.text);
      for (const chunk of chunks) {
        yield { type: 'delta', text: chunk };
      }
      yield {
        type: 'done',
        result: {
          text: loaded.entry.response.text,
          usage: loaded.entry.response.usage,
          digest: loaded.digest,
          replayed: true,
          elapsedMs: 0,
        },
      };
    },
  };
}
