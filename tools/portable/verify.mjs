#!/usr/bin/env node
/**
 * 便携包校验：解压 → 双击那条命令 → 真的跑一场。
 *
 * 只证明「文件都在」是不够的：便携包最容易坏的地方是**运行时与产物的相对位置**
 * （node.exe 在哪、node_modules 能不能解析、packages/web/dist 找不找得到、卡带有没有跟着走）。
 * 所以这里把它当一个陌生人的机器来用：解压到别处、用包里的 node.exe 起服务、
 * 再走一遍「一键示例 + 跑一场」，全部用 HTTP 验证，不看源代码。
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const outDir = join(root, 'dist', 'portable');
const PORT = Number(process.env['CROSSEXAM_VERIFY_PORT'] ?? 8799);
const base = 'http://127.0.0.1:' + String(PORT);
const work = join(root, '.tmp', 'portable-check');

function fail(message) {
  console.error('  × ' + message);
  process.exit(1);
}

const zips = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith('.zip')) : [];
if (zips.length === 0) fail('dist/portable 下没有 zip，先跑 node tools/portable/build.mjs');
const zipName = zips.sort().pop();
const zipPath = join(outDir, zipName);

rmSync(work, { recursive: true, force: true });
execFileSync(existsSync('C:\\Windows\\System32\\tar.exe') ? 'C:\\Windows\\System32\\tar.exe' : 'tar', ['-x', '-f', zipPath, '-C', dirname(work)], { stdio: 'inherit' });
const stage = join(dirname(work), 'crossexam-portable');
if (!existsSync(join(stage, '启动.cmd'))) fail('解压后没有 启动.cmd');
if (!existsSync(join(stage, 'node', 'node.exe'))) fail('解压后没有 node/node.exe');

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log('  ' + (ok ? '✓' : '×') + ' ' + label + (detail === undefined ? '' : '  —— ' + detail));
}

console.log('');
console.log('  校验 ' + zipName);
console.log('  解压到 ' + stage);
console.log('');

// 包里的 node.exe 必须自己就能跑（评委机器上很可能一个 Node 都没有）
const bundled = execFileSync(join(stage, 'node', 'node.exe'), ['-e', 'console.log(process.versions.node)'], { encoding: 'utf8' }).trim();
check('包里的 node.exe 能独立运行', /^2\d\./.test(bundled), 'v' + bundled);

const child = spawn('cmd.exe', ['/c', join(stage, '启动.cmd')], {
  cwd: stage,
  env: { ...process.env, CROSSEXAM_PORT: String(PORT), CROSSEXAM_LAUNCH_NO_BROWSER: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (b) => { log += String(b); });
child.stderr.on('data', (b) => { log += String(b); });

async function waitHealth(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + '/api/health');
      if (res.ok) return await res.json();
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

async function stop() {
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // 已经退出了
  }
}

const health = await waitHealth(45000);
if (health === null) {
  await stop();
  console.log('');
  console.log(log.slice(-2000));
  fail('服务没起来（上面是启动日志）');
}
check('启动.cmd 把服务起来了', health.ok !== false, base);

const page = await fetch(base + '/');
const html = await page.text();
check('同一个端口就能打开界面', page.status === 200 && html.indexOf('<div id="root"') >= 0, String(html.length) + ' 字符');

const overview = await fetch(base + '/api/sessions/overview');
check('历史仪表盘接口可用', overview.ok, String(overview.status));

const created = await fetch(base + '/api/sessions', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ useDemo: true }),
});
const session = await created.json();
check('一键示例能建档', created.status === 201 && typeof session.id === 'string', String(session.id ?? ''));

// 关键一条：包里带着卡带，所以断网也能真的跑完一场，而不是「跑起来但只能看空界面」
// 三位面试官一起上：默认面板。只点一位（panel=tech）时那批卡带本来就没录全，
// 在开发机上同样会返回「找不到这一条记录」，那不是便携包的问题。
const run = await fetch(base + '/api/sessions/' + String(session.id) + '/run', { method: 'POST' });
const stream = await run.text();
check('不带 API Key 也能跑完一场（走包里的卡带）', run.ok && stream.indexOf('event: result') >= 0, String(stream.length) + ' 字节事件流');

const detail = await fetch(base + '/api/sessions/' + String(session.id)).then((r) => r.json());
const claimCount = (detail.claims ?? []).length;
check('跑完能读回主张', claimCount > 0, String(claimCount) + ' 条');

const report = await fetch(base + '/api/sessions/' + String(session.id) + '/report.md');
check('报告可导出', report.ok && (await report.text()).length > 500, String(report.status));

await stop();

const size = statSync(zipPath).size;
const passed = results.filter((r) => r.ok).length;
console.log('');
console.log('  ' + String(passed) + '/' + String(results.length) + ' 项通过 · 包体积 ' + (size / 1024 / 1024).toFixed(1) + ' MB');
if (passed !== results.length) {
  console.log('');
  console.log(log.slice(-2000));
  process.exit(1);
}