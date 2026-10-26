/**
 * fixture（"卡带"）读写。
 *
 * 指纹只由**提示词内容**决定，刻意不把模型名与用途算进去：
 * 换模型不该让整盘卡带失效，而"这次是谁问的"属于运行时元数据，
 * 记在文件里供人看即可，不该参与寻址。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { shortHash, stableStringify } from '@crossexam/shared';
import { LlmError } from './types.ts';
import type { LlmMessage, LlmRequest, LlmUsage } from './types.ts';

/** 卡带格式版本。结构变了就加一，旧卡带会被明确拒绝而不是被误读。 */
export const CASSETTE_VERSION = 1;

export interface CassetteRequestShape {
  system: string;
  messages: { role: string; content: string }[];
  temperature: number | null;
  maxTokens: number | null;
  json: boolean;
}

export interface CassetteEntry {
  version: number;
  digest: string;
  /** 用途标签，只为排查方便。 */
  purpose: string;
  model: string;
  recordedAt: string;
  request: CassetteRequestShape;
  response: {
    text: string;
    /** 录制时的思考过程，回放时按同样的方式推给前端。 */
    reasoning?: string;
    usage: LlmUsage;
    /** 录制流式响应时记下的分片，回放时用它复现同样的节奏。 */
    chunks?: string[];
  };
}

export function defaultCassetteDir(): string {
  const fromEnv = process.env['CROSSEXAM_FIXTURES'];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(process.cwd(), 'fixtures', 'llm');
}

function shapeOf(req: LlmRequest): CassetteRequestShape {
  return {
    system: req.system,
    messages: req.messages.map(function (m: LlmMessage) {
      return { role: m.role, content: m.content };
    }),
    temperature: req.temperature ?? null,
    maxTokens: req.maxTokens ?? null,
    json: req.json ?? false,
  };
}

/**
 * 指纹 = 提示词内容的 sha256 前 24 位。
 * 用 stableStringify 保证对象键顺序不影响结果，
 * 否则同一份提示词换个字段顺序就会变成另一盘卡带。
 */
export function digestFor(req: LlmRequest): string {
  return shortHash(stableStringify(shapeOf(req)), 24);
}

export function cassettePath(dir: string, digest: string): string {
  return join(dir, digest + '.json');
}

export function readCassette(dir: string, digest: string): CassetteEntry | null {
  const file = cassettePath(dir, digest);
  if (!existsSync(file)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new LlmError('cassette-corrupt', '卡带文件不是合法 JSON：' + file + '（' + String(err) + '）');
  }

  const entry = parsed as CassetteEntry;
  if (entry.version !== CASSETTE_VERSION) {
    throw new LlmError(
      'cassette-version',
      '卡带格式版本不符：文件是 v' + String(entry.version) + '，当前需要 v' + String(CASSETTE_VERSION) + '（' + file + '）',
    );
  }
  if (entry.digest !== digest) {
    throw new LlmError('cassette-corrupt', '卡带内容与文件名不一致：' + file);
  }
  if (typeof entry.response?.text !== 'string') {
    throw new LlmError('cassette-corrupt', '卡带缺少 response.text：' + file);
  }
  return entry;
}

export function writeCassette(dir: string, entry: CassetteEntry): string {
  mkdirSync(dir, { recursive: true });
  const file = cassettePath(dir, entry.digest);
  writeFileSync(file, JSON.stringify(entry, null, 2) + '\n', 'utf8');
  return file;
}

export interface CassetteSummary {
  digest: string;
  purpose: string;
  model: string;
  recordedAt: string;
}

/** 列出卡带目录里的全部记录。命令行工具与"离线可用性自检"都用它。 */
export function listCassettes(dir: string): CassetteSummary[] {
  if (!existsSync(dir)) return [];
  const out: CassetteSummary[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const digest = name.slice(0, -'.json'.length);
    try {
      const entry = readCassette(dir, digest);
      if (!entry) continue;
      out.push({ digest: entry.digest, purpose: entry.purpose, model: entry.model, recordedAt: entry.recordedAt });
    } catch {
      out.push({ digest: digest, purpose: '(无法读取)', model: '?', recordedAt: '?' });
    }
  }
  return out;
}
