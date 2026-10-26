/** 小工具：ID 生成、稳定哈希与确定性序列化 */
import { createHash, randomUUID } from 'node:crypto';

/** 真人会话用的随机 id */
export function newId(prefix: string): string {
  return prefix + '_' + randomUUID().slice(0, 8);
}

/**
 * 回放（Replay）用的确定性 id 工厂：同一个调用顺序永远得到同一串 id。
 * 有了它，无 Key 离线重跑得到的记录能与线上那次逐字节一致。
 */
export function createIdFactory(): (prefix: string) => string {
  const counters = new Map<string, number>();
  return (prefix: string) => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return prefix + '_' + String(n).padStart(3, '0');
  };
}

export function shortHash(input: string, length = 12): string {
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}

/** 稳定序列化：对象键排序，保证同样内容永远得到同样哈希（fixture 文件名靠它） */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

export function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

/** 去掉对象里值为 undefined 的键，避免 JSON 里出现空洞 */
export function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
