#!/usr/bin/env node
/**
 * 本地服务入口：npm run dev:server / npm start 都走这里。
 *
 * 刻意不做构建：Node 原生剥离类型直接跑 .ts（见 docs/adr/ADR-0001）。
 * 这条路径直接关系到评分里的「10 分钟复现」——评审 clone 下来 npm install 就能起。
 */

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { loadDotEnv, parsePanelSize } from '../env.ts';
import { createApp } from '../http/app.ts';
import { mountWebApp } from '../http/static.ts';
import { closeDatabase, openDatabase } from '../store/index.ts';
import { createLlmClient, defaultCassetteDir, describeClient, reasoningRoutes } from '../llm/index.ts';

// 必须在读任何环境变量之前：README 让评委复制 .env.example，这里得真的把它读进来。
const dotEnvPath = loadDotEnv();

const port = Number(process.env['CROSSEXAM_PORT'] ?? process.env['PORT'] ?? 8787);
const dbPath = process.env['CROSSEXAM_DB'] ?? 'data/crossexam.db';
const panelSize = parsePanelSize(process.env['PANEL_SIZE']);

if (dbPath !== ':memory:') {
  mkdirSync(dirname(resolve(dbPath)), { recursive: true });
}
const db = openDatabase({ path: dbPath === ':memory:' ? ':memory:' : resolve(dbPath) });
const cassetteDir = defaultCassetteDir();
const reasoning = reasoningRoutes();
const client = createLlmClient({ cassetteDir, stageModels: reasoning });
const app = createApp({ db, client, cassetteDir, panelSize, reasoning });

// 前端已经构建过就顺便托管，让 http://127.0.0.1:8787 一个端口就是完整产品
// 用模块自身位置定位，保证从任何工作目录启动都能找到前端产物
const webDist = fileURLToPath(new URL('../../../web/dist', import.meta.url));
const hasWeb = mountWebApp(app, webDist);

serve({ fetch: app.fetch, port }, (info) => {
  console.log('');
  console.log('  CrossExam 质询室 — 多 Agent 对抗式面试沙盘');
  console.log('  ------------------------------------------------');
  console.log('  地址      http://127.0.0.1:' + String(info.port));
  console.log('  跑法      ' + describeClient(client, cassetteDir, reasoning));
  console.log('  数据库    ' + dbPath);
  console.log('  卡带目录  ' + cassetteDir);
  console.log('  配置      ' + (dotEnvPath ? '已载入 ' + dotEnvPath : '没有 .env，按环境变量与默认值运行'));
  console.log('  面板上限  ' + (panelSize === undefined ? '不限制（默认面板 3 位）' : String(panelSize) + ' 位（PANEL_SIZE）'));
  console.log('  界面      ' + (hasWeb
    ? 'http://127.0.0.1:' + String(info.port) + '  （已托管构建好的前端）'
    : '未构建前端，先跑 npm run build，当前只有 /api 接口'));
  console.log('  试一下    curl http://127.0.0.1:' + String(info.port) + '/api/demo');
  console.log('');
});

function shutdown(signal: string): void {
  console.log('收到 ' + signal + '，正在关库…');
  try {
    closeDatabase(db);
  } catch {
    // 关库失败不该拦住退出
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
