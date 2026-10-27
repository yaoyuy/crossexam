#!/usr/bin/env node
/**
 * 性能预算：把「够快」变成一条会红的命令。
 *
 * 为什么要有它：单元测试证明逻辑对、冒烟证明产品能跑，但两者都不阻止
 * 「某次改动让一场回放从 46 ms 变成 6 s」。这里给一组上界，超了就退出码 1；
 * 上界比实测宽一个数量级，所以它只拦「数量级变坏」，不拦正常波动——
 * 一台正在编译别的项目的机器不应该被判失败。
 *
 * 用法：
 *   npm run budget                    起临时服务量一遍（先跑过 npm run build）
 *   CROSSEXAM_BUDGET_PORT=8798 ...    换端口
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = process.env['CROSSEXAM_BUDGET_PORT'] ?? '8798';
const base = 'http://127.0.0.1:' + PORT;
const workDir = mkdtempSync(join(tmpdir(), 'crossexam-budget-'));

let child = null;
let serverLog = '';
const results = [];

function check(name, measured, budget, unit, ok) {
  results.push(ok === true);
  const mark = ok === true ? '  [ok]   ' : '  [FAIL] ';
  console.log(mark + name + '  ' + String(measured) + ' ' + unit + ' / 预算 ' + String(budget) + ' ' + unit);
}

function within(name, measured, budget) {
  check(name, Math.round(measured), budget, 'ms', measured <= budget);
}

async function timeIt(fn) {
  const started = performance.now();
  const value = await fn();
  return { ms: performance.now() - started, value };
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
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function main() {
  const env = Object.assign({}, process.env, {
    CROSSEXAM_MODE: 'replay',
    CROSSEXAM_PORT: PORT,
    CROSSEXAM_DB: join(workDir, 'budget.db'),
    CROSSEXAM_FIXTURES: join(ROOT, 'fixtures', 'llm'),
  });
  // 与点测同一个口径：抹掉 LLM_*，让「本机是否配了模型」不影响计时。
  for (const key of Object.keys(env)) {
    if (key.indexOf('LLM_') === 0) delete env[key];
  }

  const boot = await timeIt(async () => {
    child = spawn(process.execPath, ['packages/server/src/bin/serve.ts'], { env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => { serverLog += String(chunk); });
    child.stderr.on('data', (chunk) => { serverLog += String(chunk); });
    return waitForHealth(20000);
  });
  check('服务启动到能响应健康检查', Math.round(boot.ms), 5000, 'ms', boot.value === true);
  if (boot.value !== true) {
    console.log(serverLog.slice(-1200));
    return;
  }

  const health = await timeIt(async () => (await fetch(base + '/api/health')).json());
  within('健康检查往返', health.ms, 300);

  const created = await timeIt(async () => (await fetch(base + '/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ useDemo: true }),
  })).json());
  const id = created.value === null || created.value === undefined ? undefined : created.value.id;
  check('建档返回会话号', Math.round(created.ms), 1000, 'ms', typeof id === 'string');

  const run = await timeIt(async () => (await fetch(base + '/api/sessions/' + String(id) + '/run?stream=0', { method: 'POST' })).json());
  within('一场完整回放（九阶段全跑）', run.ms, 8000);
  // ?stream=0 回的是计数字段，不是明细；要证明「真的跑出了主张」得读一次会话详情。
  const detail = await timeIt(async () => (await fetch(base + '/api/sessions/' + String(id))).json());
  within('会话详情（含全部分支）往返', detail.ms, 500);
  const claims = detail.value === null || detail.value === undefined ? [] : detail.value.claims;
  check('这一场真的跑出了主张', Array.isArray(claims) ? claims.length : 0, 1, '条', Array.isArray(claims) && claims.length > 0);

  const report = await timeIt(async () => (await fetch(base + '/api/sessions/' + String(id) + '/report.md')).text());
  within('报告 Markdown 生成', report.ms, 1000);
  check('报告不是空壳', report.value.length, 2000, '字符', report.value.length > 2000);

  const bundle = await timeIt(async () => (await fetch(base + '/api/sessions/' + String(id) + '/bundle.html')).text());
  within('单文件打包生成', bundle.ms, 1500);
  check('打包体积', Math.round(bundle.value.length / 1024), 300, 'KB', bundle.value.length <= 300 * 1024);
  check('打包里没有外链', 0, 0, '处', !bundle.value.includes('http://') && !bundle.value.includes('https://'));

  const list = await timeIt(async () => (await fetch(base + '/api/sessions')).json());
  within('历史列表接口', list.ms, 300);

  // 构建产物的 gzip 体积：这是「十分钟复现」里唯一会随功能增长而变大的东西。
  try {
    const distDir = join(ROOT, 'packages/web/dist/assets');
    let js = 0;
    let css = 0;
    for (const name of readdirSync(distDir)) {
      if (name.endsWith('.js')) js = Math.max(js, gzipSync(readFileSync(join(distDir, name))).length);
      if (name.endsWith('.css')) css = Math.max(css, gzipSync(readFileSync(join(distDir, name))).length);
    }
    check('前端 JS（gzip，先 npm run build）', Math.round(js / 1024), 128, 'KB', js > 0 && js <= 128 * 1024);
    check('前端 CSS（gzip）', Math.round(css / 1024), 16, 'KB', css > 0 && css <= 16 * 1024);
  } catch {
    check('前端产物存在（先 npm run build）', 0, 1, '个目录', false);
  }
}

function finish() {
  if (child !== null) {
    child.kill();
    child = null;
  }
  try {
    rmSync(workDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // 临时目录清不掉不该让预算结果变红
  }
  const failed = results.filter((ok) => ok !== true).length;
  console.log('');
  console.log(failed === 0 ? '性能预算通过：' + String(results.length) + ' 项全绿' : '性能预算失败：' + String(failed) + ' / ' + String(results.length) + ' 项超了');
  process.exit(failed === 0 ? 0 : 1);
}

try {
  await main();
} catch (err) {
  check('预算脚本自身没有抛异常', 0, 0, '次', false);
  console.log(err instanceof Error ? err.message : String(err));
}
finish();
