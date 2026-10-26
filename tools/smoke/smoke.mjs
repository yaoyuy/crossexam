#!/usr/bin/env node
/**
 * 冒烟测试：起一个真实服务进程，然后走一遍 HTTP 关键路径。
 *
 * 为什么单元测试不够：那边的 app.request 是同一个进程里的函数调用，
 * 它证明不了「克隆下来到底能不能跑起来」。真实的坑（表没建、端口没监听、
 * 静态资源没挂、SSE 卡住不结束）全都出现在进程边界上，只有真起进程才看得见。
 *
 * 用法：
 *   npm run smoke                      起临时服务，跑完自动收摊
 *   CROSSEXAM_SMOKE_URL=... npm run smoke   打一个已经在跑的服务
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = process.env['CROSSEXAM_SMOKE_PORT'] ?? '8799';
const GIVEN = process.env['CROSSEXAM_SMOKE_URL'];
const base = GIVEN ?? 'http://127.0.0.1:' + PORT;
const workDir = mkdtempSync(join(tmpdir(), 'crossexam-smoke-'));

let child = null;
let serverLog = '';
const results = [];

function check(name, ok, detail) {
  results.push(ok === true);
  const mark = ok === true ? '  [ok]   ' : '  [FAIL] ';
  console.log(mark + name + (detail === undefined ? '' : '  ' + detail));
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + '/api/health');
      if (res.ok) return true;
    } catch {
      // 还没起来，继续等
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function json(path, init) {
  const res = await fetch(base + path, init);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { res, body };
}

async function main() {
  if (GIVEN === undefined) {
    child = spawn(process.execPath, ['packages/server/src/bin/serve.ts'], {
      env: { ...process.env, CROSSEXAM_PORT: PORT, CROSSEXAM_DB: join(workDir, 'smoke.db') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { serverLog += String(chunk); });
    child.stderr.on('data', (chunk) => { serverLog += String(chunk); });
    const up = await waitForHealth(20000);
    check('服务进程能起来并响应健康检查', up, base);
    if (!up) {
      console.log(serverLog.slice(0, 1200));
      return;
    }
  }

  const health = await json('/api/health');
  check('健康检查说明当前跑法', health.body?.mode !== undefined, String(health.body?.runMode ?? ''));

  const demo = await json('/api/demo');
  check('示例简历可取', typeof demo.body?.resume === 'string' && demo.body.resume.length > 100,
    String(demo.body?.title ?? ''));

  const created = await json('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ useDemo: true }),
  });
  const id = created.body?.id;
  check('一键建档返回会话号', created.res.status === 201 && typeof id === 'string', String(id ?? ''));

  const detail = await json('/api/sessions/' + String(id));
  check('会话详情能读回简历正文', typeof detail.body?.session?.resumeText === 'string');

  const report = await fetch(base + '/api/sessions/' + String(id) + '/report.md');
  const reportText = await report.text();
  check('报告可下载为 Markdown',
    report.status === 200 && String(report.headers.get('content-type')).includes('markdown') && reportText.length > 100);

  // 离线回放模式下没有卡带，正确行为是响亮地报错，而不是产出一盘空演示
  const sse = await fetch(base + '/api/sessions/' + String(id) + '/run?panel=tech', { method: 'POST' });
  const stream = await sse.text();
  const ended = stream.includes('event: result') || stream.includes('event: fatal');
  const explained = stream.includes('event: result') || stream.includes('找不到这一条记录');
  check('SSE 有事件且明确收尾（成功或说清失败原因）',
    sse.status === 200 && stream.includes('event: stage') && ended && explained,
    sse.headers.get('content-type') ?? '');

  const events = await json('/api/sessions/' + String(id) + '/events');
  const list = events.body?.events ?? [];
  const seqs = list.map((e) => e.seq);
  const contiguous = seqs.every((n, i) => n === i + 1);
  check('事件日志按 seq 连续', list.length > 0 && contiguous, String(list.length) + ' 条');

  const missing = await json('/api/definitely-not-here');
  check('没有的接口返回中文 404', missing.res.status === 404 && String(missing.body?.error ?? '').includes('没有这个接口'));
}

function finish() {
  if (child !== null) {
    child.kill();
    child = null;
  }
  try {
    rmSync(workDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // 临时目录清不掉不该让冒烟结果变红
  }
  const failed = results.filter((ok) => ok !== true).length;
  console.log('');
  console.log(failed === 0 ? '冒烟通过：' + String(results.length) + ' 项全绿' : '冒烟失败：' + String(failed) + ' / ' + String(results.length) + ' 项没通过');
  process.exit(failed === 0 ? 0 : 1);
}

try {
  await main();
} catch (err) {
  check('冒烟脚本自身没有抛异常', false, err instanceof Error ? err.message : String(err));
}
finish();
