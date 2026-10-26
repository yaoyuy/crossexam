/**
 * LLM 层的装配点。业务代码只 import 这里，不直接碰三个具体客户端。
 *
 * 默认模式是 replay 而不是 live，这是刻意的：
 * 复现指南要求"克隆下来就能跑"，任何需要联网才能启动的默认值
 * 都会把评委挡在门外。要真调模型，必须显式设置 CROSSEXAM_MODE。
 */

import { defaultCassetteDir } from './cassette.ts';
import { createLiveClient } from './live.ts';
import { createReplayClient } from './replay.ts';
import { withStageModels } from './routing.ts';
import { LlmError } from './types.ts';
import type { LiveOptions } from './live.ts';
import type { LlmClient, LlmMode } from './types.ts';

export const DEFAULT_MODE: LlmMode = 'replay';

export const MODE_LABEL: Record<LlmMode, string> = {
  replay: '离线回放（不联网）',
  record: '联网录制（写入卡带）',
  live: '真实调用（不留痕）',
};

/**
 * 思考可视化：把需要权衡的阶段交给会吐思考过程的模型。
 *
 * 默认只路由「判定」这一个阶段——它是唯一需要反复权衡证据强弱的环节，
 * 也最容易看出模型为什么这么判；追问一轮有十几次调用，全交给思考模型会把一场跑成几分钟。
 * 没有配置 CROSSEXAM_REASONING_MODEL 时**不做任何路由**，行为与从前逐字节相同。
 */
export const DEFAULT_REASONING_STAGES = ['verdict'];

export function reasoningRoutes(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const model = (env['CROSSEXAM_REASONING_MODEL'] ?? '').trim();
  if (model === '') return {};
  const raw = (env['CROSSEXAM_REASONING_STAGES'] ?? DEFAULT_REASONING_STAGES.join(',')).trim();
  const routes: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const stage = part.trim();
    if (stage !== '') routes[stage] = model;
  }
  return routes;
}

/** 一行说明路由结果，给启动横幅与 /api/health 用。 */
export function describeRoutes(routes: Record<string, string>): string {
  return Object.keys(routes)
    .map((stage) => stage + ' → ' + (routes[stage] as string))
    .join('、');
}

/** 读环境变量定模式。写错的值直接拒绝，不做"猜一个最接近的"这种事。 */
export function modeFromEnv(env: Record<string, string | undefined> = process.env): LlmMode {
  const raw = (env['CROSSEXAM_MODE'] ?? '').trim().toLowerCase();
  if (raw === '') return DEFAULT_MODE;
  if (raw === 'live' || raw === 'record' || raw === 'replay') return raw;
  throw new LlmError('not-configured', 'CROSSEXAM_MODE 只能是 live / record / replay，收到「' + raw + '」。');
}

export interface ClientOptions extends LiveOptions {
  mode?: LlmMode;
  /** 卡带目录：replay 从这里读，record 写到这里。 */
  cassetteDir?: string;
  /** 阶段 → 模型 的路由；不填就读 CROSSEXAM_REASONING_MODEL。 */
  stageModels?: Record<string, string>;
}

/**
 * 按模式造客户端。
 * record 模式下卡带目录与回放目录默认同一个——
 * 录完立刻就能在同一台机器上回放验证，少一个"录到哪去了"的坑。
 */
export function createLlmClient(opts: ClientOptions = {}): LlmClient {
  const mode = opts.mode ?? modeFromEnv();
  const dir = opts.cassetteDir ?? defaultCassetteDir();
  const base =
    mode === 'replay'
      ? createReplayClient(dir)
      : mode === 'record'
        ? createLiveClient({ ...opts, recordDir: opts.recordDir ?? dir })
        : createLiveClient(opts);
  return withStageModels(base, opts.stageModels ?? reasoningRoutes());
}

/** 给前端顶部横幅用的一句话说明：当前到底联没联网，不能靠猜。 */
export function describeClient(client: LlmClient, dir: string, routes: Record<string, string> = {}): string {
  const extra = describeRoutes(routes);
  return MODE_LABEL[client.mode] + ' · 卡带目录 ' + dir + (extra === '' ? '' : ' · 思考模型 ' + extra);
}

export { CASSETTE_VERSION, cassettePath, defaultCassetteDir, digestFor, listCassettes, readCassette, writeCassette } from './cassette.ts';
export { buildPayload, createLiveClient, endpointOf, parseSseData, readUsage, resolveLiveConfig } from './live.ts';
export { chunkText, createReplayClient, REPLAY_CHUNK_SIZE } from './replay.ts';
export { withStageModels } from './routing.ts';
export { EMPTY_USAGE, LlmError } from './types.ts';

export type { CassetteEntry, CassetteSummary } from './cassette.ts';
export type { LiveConfig, SseChunk } from './live.ts';
export type { LlmClient, LlmMessage, LlmMode, LlmRequest, LlmResult, LlmStreamEvent, LlmUsage } from './types.ts';
