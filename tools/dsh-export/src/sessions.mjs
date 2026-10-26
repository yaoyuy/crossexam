/**
 * 定位并列出 DSH 会话目录。
 *
 * 目录约定：%DSH_HOME%/sessions/<工作区标识>/<session-id>/session.v4.jsonl.zstd
 * 其中工作区标识是 cwd 把 [\\/:] 换成 '-' 再前后包 '--'（例：D:\\CZB -> --D-CZB--）。
 * 我们不靠这个约定去猜，而是解出会话自身记录的 cwd 来匹配——猜错了会静默漏掉会话。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { decompressFrames } from './zstd-frames.mjs';

export const SESSION_FILE = 'session.v4.jsonl.zstd';

/** 解析 DSH_HOME：显式传入 > 环境变量 > 平台默认位置 */
export function resolveDshHome(explicit, env) {
  const e = env || {};
  if (explicit) return path.resolve(explicit);
  if (e.DSH_HOME) return path.resolve(e.DSH_HOME);
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = e.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'dsh-desktop', 'harness');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'dsh-desktop', 'harness');
  }
  return path.join(home, '.config', 'dsh-desktop', 'harness');
}

/** cwd -> 会话目录名（仅用于诊断输出） */
export function dirNameForCwd(cwd) {
  return '--' + String(cwd).replace(/[\\/:]/g, '-') + '--';
}

function safeStat(p) {
  try { return fs.statSync(p); } catch { return null; }
}

/** 列出 sessions 根下所有会话文件（不递归 symlink，避免死循环） */
export function listSessionFiles(dshHome) {
  const base = path.join(dshHome, 'sessions');
  if (!safeStat(base)?.isDirectory()) return [];
  const out = [];
  for (const ws of fs.readdirSync(base)) {
    const wsDir = path.join(base, ws);
    if (!safeStat(wsDir)?.isDirectory()) continue;
    for (const sid of fs.readdirSync(wsDir)) {
      const file = path.join(wsDir, sid, SESSION_FILE);
      const st = safeStat(file);
      if (st?.isFile()) out.push({ workspaceKey: ws, sessionId: sid, file, sizeBytes: st.size, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

/** 解析 JSONL 文本为事件数组，坏行跳过并计数 */
export function parseEventLines(text) {
  const events = [];
  let badLines = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { badLines++; }
  }
  return { events, badLines };
}

/** 读取单个会话文件 -> { header, events } */
export function readSession(file) {
  const buf = fs.readFileSync(file);
  const { text, frameCount, failedFrames } = decompressFrames(buf);
  const { events, badLines } = parseEventLines(text);
  const header = events.find((e) => e.type === 'session') || null;
  return { header, events, stats: { frameCount, failedFrames, badLines, bytes: buf.length } };
}

/** 只读会话头（列目录时用，避免把大文件全解压） */
export function readSessionHeader(file) {
  const buf = fs.readFileSync(file);
  const firstMagic = buf.indexOf(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]));
  if (firstMagic < 0) return null;
  try {
    const text = decompressFrames(buf.subarray(firstMagic)).text;
    const firstLine = text.split('\n').find((l) => l.trim());
    if (!firstLine) return null;
    const obj = JSON.parse(firstLine);
    return obj.type === 'session' ? obj : null;
  } catch {
    return null;
  }
}
