/**
 * 把普通的 complete() 调用变成「边生成边外推」的流式调用。
 *
 * 为什么做成客户端包装，而不是改五个阶段的代码：
 * 五个阶段的并发结构各不相同（probe 按面试官并发、answer 按追问并发……），
 * 如果每个阶段自己写 for await，就要把并发、异常、用量累加各写五遍。
 * 包一层之后阶段代码一个字都不用动：它照旧 await complete()，
 * 而这一层负责把 inner.stream() 的分片按 channel 外推，并把 done 里的最终结果交回去。
 *
 * 三条纪律：
 * 1. 分片是**过程**，不进事件表、不落库：一次会话的落库事件是各阶段的结构化结果，
 *    把上千条分片都写进去只会让回放变慢、让日志变吵。
 * 2. 最终结果一律取自 done 事件，绝不用分片拼一个「看起来差不多」的文本——
 *    拼接可能缺尾，而下游还要过 zod 与锚定。
 * 3. 没有 done 就是坏调用，明确抛错，不返回半成品。
 */

import type { LlmClient, LlmRequest, LlmResult } from './types.ts';
import { LlmError } from './types.ts';

export interface StreamChunk {
  /** 路由标识：extract / probe:<面试官> / answer:<追问编号> / verdict:<主张编号> / suggest:<主张编号> */
  channel: string;
  /** 阶段名，等于这次请求的 purpose */
  stage: string;
  /** reasoning = 模型思考过程；text = 正式输出（本项目里是结构化 JSON） */
  kind: 'reasoning' | 'text';
  text: string;
}

export type StreamSink = (chunk: StreamChunk) => void | Promise<void>;

export function withStreaming(inner: LlmClient, sink: StreamSink): LlmClient {
  return {
    mode: inner.mode,
    async complete(req: LlmRequest): Promise<LlmResult> {
      const channel = req.channel ?? req.purpose;
      let done: LlmResult | null = null;
      for await (const event of inner.stream(req)) {
        if (event.type === 'done') {
          done = event.result;
          continue;
        }
        await sink({
          channel: channel,
          stage: req.purpose,
          kind: event.type === 'reasoning' ? 'reasoning' : 'text',
          text: event.text,
        });
      }
      if (done === null) {
        throw new LlmError('bad-request', '流式调用没有给出最终结果：' + req.purpose);
      }
      return done;
    },
    stream(req: LlmRequest) {
      return inner.stream(req);
    },
  };
}
