#!/usr/bin/env node
// 复现预演：把仓库当成评委第一次见到它的样子，重新走一遍「克隆 → 安装 → 门禁 → 起服 → 跑一场」。
//
// 为什么要有它：赛题 25% 是「过程可复现性与演进链路」，README 里写「10 分钟能跑起来」是一句承诺，
// 而承诺只有在**干净目录**里被真跑过才算证据。本机开发目录里躺着 node_modules、.env、
// 已经构建过的 dist、已经种好的卡带——这些东西恰好会掩盖最常见的复现失败。
//
// 它只读上游仓库（git clone），所有写入都在临时目录里，跑完删掉。

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = resolve(HERE, '..', '..');
const PORT = Number(process.env.CROSSEXAM_REPRO_PORT || 8795);
const BASE = 'http://127.0.0.1:' + PORT;
const BUDGET_SECONDS = 600; // 「10 分钟极速复现」这句承诺的量尺

function parseArgs(argv) {
  const opts = { repo: DEFAULT_REPO, dir: null, keep: false, quiet: false, skipInstall: false, timeoutMs: 900000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') { opts.repo = resolve(argv[++i]); }
    else if (arg === '--dir') { opts.dir = resolve(argv[++i]); }
    else if (arg === '--keep') { opts.keep = true; }
    else if (arg === '--quiet') { opts.quiet = true; }
    else if (arg === '--skip-install') { opts.skipInstall = true; }
    else if (arg === '--timeout-min') { opts.timeoutMs = Number(argv[++i]) * 60000; }
    else if (arg === '--help' || arg === '-h') {
      console.log([
        '用法：node tools/repro/repro-check.mjs [选项]',
        '',
        '  --repo <path>        被预演的仓库（默认本仓库）',
        '  --dir <path>         预演用的临时目录（默认系统临时目录）',
        '  --skip-install       跳过 npm install（调试脚本时用）',
        '  --timeout-min <n>    单步超时分钟数（默认 15）',
        '  --keep               保留临时目录，便于排查',
        '  --quiet              不转发子进程输出',
        '  --help               显示这段帮助',
      ].join(NL));
      process.exit(0);
    }
  }
  return opts;
}

const NL = String.fromCharCode(10);
const opts = parseArgs(process.argv.slice(2));
const steps = [];
let failed = null;

function say(line) { if (!opts.quiet) console.log(line); }
function nowMs() { return Date.now(); }
function stamp(ms) { return (ms / 1000).toFixed(1) + ' s'; }

// 跑一条命令，回显输出（--quiet 时只留最后几行），超时算失败。
function run(label, command, args, options = {}) {
  const started = nowMs();
  say('▶ ' + label);
  const result = spawnSync(command, args, {
    cwd: options.cwd || opts.workDir,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    timeout: opts.timeoutMs,
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = nowMs() - started;
  const out = ((result.stdout || '') + (result.stderr || '')).trim();
  const tail = out.split(NL).slice(-(options.tail || 6)).join(NL);
  if (out) say(tail.split(NL).map((l) => '    ' + l).join(NL));
  const ok = result.status === 0 && !result.error;
  steps.push({ label, ms, ok });
  if (!ok && !failed) {
    failed = { label, status: result.status, error: result.error ? String(result.error.message) : null, tail };
  }
  return { ok, ms, out };
}

function npmBin() { return process.platform === 'win32' ? 'npm.cmd' : 'npm'; }

async function getJson(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error('GET ' + path + ' → ' + res.status);
  return res.json();
}

async function waitForHealth(deadlineMs) {
  while (nowMs() < deadlineMs) {
    try {
      const health = await getJson('/api/health');
      if (health.ok) return health;
    } catch { /* 还没起来，继续等 */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('等不到服务就绪：' + BASE + '/api/health');
}

async function main() {
  opts.workDir = opts.dir || join(tmpdir(), 'crossexam-repro-' + Math.random().toString(36).slice(2, 8));
  if (existsSync(opts.workDir)) rmSync(opts.workDir, { recursive: true, force: true });
  mkdirSync(opts.workDir, { recursive: true });
  const cloneDir = join(opts.workDir, 'crossexam');
  const dbPath = join(opts.workDir, 'repro.db');

  console.log('复现预演');
  console.log('  上游仓库  ' + opts.repo);
  console.log('  干净目录  ' + cloneDir);
  console.log('  承诺上限  ' + BUDGET_SECONDS / 60 + ' 分钟（README 里的「10 分钟极速复现」）');
  console.log('');

  // 第 0 步：确认上游本身是干净的——脏工作区复现出来的不是评委拿到的东西。
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: opts.repo, encoding: 'utf8' }).stdout.trim();
  if (dirty) {
    console.log('✗ 上游仓库有未提交改动，预演的是「不存在的版本」：');
    console.log(dirty);
    process.exit(1);
  }

  const totalStarted = nowMs();
  run('git clone（只带上仓库里真正提交过的东西）', 'git', ['clone', '--quiet', opts.repo, cloneDir]);
  if (failed) throw new Error('克隆失败');
  opts.workDirRepo = cloneDir;

  if (!opts.skipInstall) {
    run('npm install（评委的第一步）', npmBin(), ['install', '--no-audit', '--no-fund'], { cwd: cloneDir, tail: 4 });
    if (failed) throw new Error('安装失败');
  }

  run('npm run verify（类型检查 + 测试 + 冒烟 + 构建）', npmBin(), ['run', 'verify'], { cwd: cloneDir, tail: 8 });
  if (failed) throw new Error('门禁没过');

  // 起服，用回放模式——评委没有 API Key 也走这条路径。
  const env = { CROSSEXAM_PORT: String(PORT), CROSSEXAM_DB: dbPath, CROSSEXAM_MODE: 'replay' };
  const server = spawn('node', ['packages/server/src/bin/serve.ts'], { cwd: cloneDir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  server.stdout.on('data', (chunk) => { serverLog += chunk; });
  server.stderr.on('data', (chunk) => { serverLog += chunk; });

  try {
    const started = nowMs();
    say('▶ 起服务并等它就绪（回放模式，不联网）');
    const health = await waitForHealth(nowMs() + 60000);
    say('    模式 ' + health.mode + ' · ' + health.runMode);

    const page = await fetch(BASE + '/');
    const html = await page.text();
    if (!page.ok || !html.includes('CrossExam')) throw new Error('首页不是构建好的界面');

    const created = await fetch(BASE + '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ useDemo: true }),
    });
    if (created.status !== 201) throw new Error('建档失败：' + created.status);
    const session = await created.json();

    const runRes = await fetch(BASE + '/api/sessions/' + session.id + '/run?stream=0', { method: 'POST' });
    if (!runRes.ok) throw new Error('跑沙盘失败：' + runRes.status + ' ' + (await runRes.text()).slice(0, 200));
    const summary = await runRes.json();

    const stats = await getJson('/api/stats?session=' + session.id);
    const report = await fetch(BASE + '/api/sessions/' + session.id + '/report.md');
    const reportText = await report.text();

    const ms = nowMs() - started;
    steps.push({ label: '起服 + 跑完一场质询（含报告下载）', ms, ok: true });

    console.log('');
    console.log('跑出来的东西：');
    console.log('  主张 ' + summary.claims + ' 条 · 追问 ' + summary.probes + ' 次 · 判定 ' + summary.verdicts + ' 条 · 改写建议 ' + summary.suggestions + ' 条');
    console.log('  轮数 ' + summary.rounds + ' · 被锚定机制拦下的主张 ' + summary.rejectedClaims + ' 条');
    console.log('  模型调用 ' + stats.calls + ' 次（回放 ' + stats.replayedCalls + '）· 输出 token ' + stats.outputTokens);
    console.log('  报告 ' + reportText.length + ' 字符 · 下载响应 ' + report.headers.get('content-type'));
    if (summary.claims < 3 || summary.probes < 3 || summary.verdicts < 3) throw new Error('跑完了，但产出少得不像一场完整质询');
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 500));
    if (!opts.keep) rmSync(opts.workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }

  const totalMs = nowMs() - totalStarted;
  console.log('');
  console.log('各步耗时：');
  for (const step of steps) console.log('  ' + step.label + '  ' + stamp(step.ms));
  console.log('  —— 合计 ' + stamp(totalMs) + '（上限 ' + BUDGET_SECONDS + ' s）');
  console.log('');
  if (totalMs <= BUDGET_SECONDS * 1000) {
    console.log('✓ 干净目录里 ' + stamp(totalMs) + ' 跑通完整流程，「10 分钟极速复现」这条承诺成立。');
  } else {
    console.log('✗ 干净目录里花了 ' + stamp(totalMs) + '，超过 10 分钟：要么优化步骤，要么改 README 的承诺。');
    process.exitCode = 1;
  }
  if (opts.keep) console.log('（--keep：临时目录保留在 ' + opts.workDir + '）');
}

main().catch((err) => {
  console.log('');
  console.log('✗ 复现预演失败：' + (err && err.message ? err.message : String(err)));
  if (failed) {
    console.log('  失败步骤：' + failed.label + '（退出码 ' + failed.status + '）');
    if (failed.tail) console.log(failed.tail.split(NL).map((l) => '    ' + l).join(NL));
  }
  if (opts.keep) console.log('  临时目录保留在 ' + opts.workDir);
  else console.log('  想留下现场排查，加 --keep 重跑一次。');
  process.exitCode = 1;
});
