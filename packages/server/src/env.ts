/**
 * .env 载入：把「照着 README 复制了 .env.example，结果没人读」这个坑堵掉。
 *
 * Node 20.12+ 自带 process.loadEnvFile，不需要 dotenv（少一个依赖，也少一处 10 分钟复现的失败点）。
 * 找不到文件不是错误——评委完全可以什么都不配，直接跑回放模式。
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** 载入 .env；返回实际载入的绝对路径，没找到或读不动就返回 null。 */
export function loadDotEnv(file = '.env'): string | null {
  const path = resolve(file);
  if (!existsSync(path)) return null;
  try {
    process.loadEnvFile(path);
    return path;
  } catch {
    return null;
  }
}
