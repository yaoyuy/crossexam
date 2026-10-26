/**
 * LLM 适配层的公共契约。
 *
 * 这一层的存在理由：项目必须能在**没有任何 API Key**的机器上跑通全流程。
 * 所以模型调用不是直接 fetch，而是先过一层可替换的接口——
 * live（真调）/ record（真调并落盘）/ replay（只读落盘记录）。
 * 评委按 README 复现时默认走 replay，一次网络请求都不发。
 */

export type LlmMode = 'live' | 'record' | 'replay';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  /** 人类可读的用途标签，只为人排查方便，**不参与** fixture 指纹计算。 */
  purpose: string;
  system: string;
  messages: readonly LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 要求模型只输出 JSON。具体结构由 shared/schemas.ts 校验，这里只管收。 */
  json?: boolean;
  /**
   * 这一路调用在界面上的路由标识（如 probe:tech、answer:P1）。
   * 只用于把流式分片送回对应的卡片，**不参与** fixture 指纹计算。
   */
  channel?: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
}

export const EMPTY_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
};

export interface LlmResult {
  text: string;
  /** 模型的思考过程（若提供方给了）。赛题 UX 维度点名要「思考可视化」，故单独留字段。 */
  reasoning?: string;
  usage: LlmUsage;
  /** fixture 指纹：同样的提示词必然得到同样的指纹，回放靠它对齐。 */
  digest: string;
  /** true 表示结果来自本地记录，没有发出网络请求。 */
  replayed: boolean;
  /** 真实调用经过的毫秒数；回放恒为 0，因为回放不该假装耗时。 */
  elapsedMs: number;
}

export type LlmStreamEvent =
  /** 思考过程增量：与正文分开推，前端可以把它渲染成折叠的「思考中」。 */
  | { type: 'reasoning'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; result: LlmResult };

export interface LlmClient {
  readonly mode: LlmMode;
  complete(req: LlmRequest): Promise<LlmResult>;
  stream(req: LlmRequest): AsyncGenerator<LlmStreamEvent, void, void>;
}

export type LlmErrorCode =
  | 'cassette-missing'
  | 'cassette-corrupt'
  | 'cassette-version'
  | 'http-error'
  | 'bad-request'
  | 'not-configured';

export class LlmError extends Error {
  readonly code: LlmErrorCode;

  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
  }
}
