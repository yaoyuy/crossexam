/**
 * 验收脚本共用的底座。
 *
 * 为什么要有这一层：这三组验收原先住在 .tmp 里，路径写死在某一台机器上
 * （D:/CZB、某台电脑上的 Edge、桌面上的简历 PDF），只有作者本人跑得起来，
 * 评委复不出来——那等于没有证据。搬进仓库之后，凡是「随机器变化」的东西
 * 一律从环境变量读；读不到就**跳过并大声打印 SKIP**，绝不静默当通过。
 *
 * 脚本一律从仓库根启动服务（不认 cwd），这样在哪个目录调用都一致。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function env(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function envFlag(name) {
  const value = env(name).toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

/** 端口优先用显式指定的；没指定就现找一个空端口，免得与同时在跑的其它脚本抢。 */
export async function pickPort(preferred) {
  const parsed = Number.parseInt(preferred, 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) return parsed;
  return await new Promise((res, rej) => {
    const probe = createServer();
    probe.on('error', rej);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => res(port));
    });
  });
}

export async function portInUse(port) {
  try {
    const res = await fetch('http://127.0.0.1:' + String(port) + '/api/health');
    return res.ok;
  } catch {
    return false;
  }
}

/** 临时产物默认落在系统临时目录；本机的 .tmp/ 不参与，仓库保持干净。 */
export function makeTmpDir(name) {
  const base = env('CROSSEXAM_ACCEPT_TMP', tmpdir());
  const dir = join(base, 'crossexam-accept-' + name);
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* 上一次的进程还占着，下面 mkdir 会兜底 */ }
  mkdirSync(dir, { recursive: true });
  return dir;
}

// 浏览器不写死成一台机器的位置：CI 与本机装的不是同一个目录，也有人只装了 Chrome。
// 顺序：环境变量 → 三个常见安装位置 → 都找不到返回 null（调用方据此跳过浏览器相关的项）。
const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function findBrowser() {
  // 显式指定了浏览器却指到一个不存在的文件：这时候偷偷换一个浏览器跑，等于把
  // 「我验的是哪一份产物」搞模糊了；宁可让调用方跳过并大声打印。
  const override = env('CROSSEXAM_ACCEPT_BROWSER') || env('CROSSEXAM_BROWSER');
  if (override !== '') return existsSync(override) ? override : null;
  return BROWSER_CANDIDATES.find((path) => path !== '' && existsSync(path)) ?? null;
}

function killTree(child) {
  if (child === null || child === undefined || child.pid === undefined) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch { /* 已经退出了 */ }
}

/** 进程退出时兜底收尾，免得孤儿服务/浏览器占着端口把后面几轮验收拖垮。 */
export function installCleanup() {
  const children = [];
  const cleanup = () => { for (const child of children) killTree(child); };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  return { track: (child) => { children.push(child); return child; }, cleanup };
}

export class Recorder {
  constructor(title) {
    this.title = title;
    this.pass = 0;
    this.fail = 0;
    this.skips = 0;
    this.failures = [];
    this.skipped = [];
    // 注意：字段名不能叫 this.skip——那会盖掉原型上的 skip() 方法（踩过一次）。
    console.log('== ' + title + ' ==');
  }

  ok(label, cond, detail) {
    const text = detail === undefined || detail === '' ? '' : '  [' + String(detail) + ']';
    if (cond) { this.pass += 1; console.log('PASS  ' + label + text); }
    else { this.fail += 1; this.failures.push(label + text); console.log('FAIL  ' + label + text); }
    return Boolean(cond);
  }

  /** 跳过必须说清理由；skip 不算通过，也不算出错。 */
  skip(label, why) {
    this.skips += 1;
    this.skipped.push(label + ' :: ' + why);
    console.log('SKIP  ' + label + '  —— ' + why);
  }

  note(line) { console.log('      ' + line); }
  group(name) { console.log(''); console.log('-- ' + name + ' --'); }

  summary() {
    console.log('');
    console.log('PASS ' + this.pass + ' / FAIL ' + this.fail + ' / SKIP ' + this.skips + '（共 ' + (this.pass + this.fail + this.skips) + ' 项）');
    for (const item of this.failures) console.log('  FAIL ' + item);
    for (const item of this.skipped) console.log('  SKIP ' + item);
    if (this.fail !== 0) return 1;
    if (this.skips !== 0) return envFlag('CROSSEXAM_ACCEPT_STRICT') ? 1 : 0;
    return 0;
  }
}

/** 整脚本跳过：没有 Key / 没有浏览器 / 没有简历文件时走这里，退出码 0 但打印得足够响。 */
export function skipWhole(recorder, labels, why) {
  for (const label of labels) recorder.skip(label, why);
  console.log('');
  console.log('SKIPPED：' + labels.length + ' 项整体跳过（' + why + '）');
  if (envFlag('CROSSEXAM_ACCEPT_STRICT')) {
    console.log('CROSSEXAM_ACCEPT_STRICT=1，跳过按失败处理。');
    process.exit(1);
  }
  process.exit(0);
}

/**
 * 起一个真实服务进程。默认回放（零 Key）；联网由调用方显式传 mode='live'。
 * 返回的 log() 用于把服务端横幅贴进失败详情——启动失败时没有它只能干瞪眼。
 */
export async function startServer({ mode = 'replay', port, dbPath, extraEnv = {}, cleanup, healthTimeoutMs = 30000 }) {
  const env2 = { ...process.env, CROSSEXAM_PORT: String(port), CROSSEXAM_DB: dbPath, CROSSEXAM_MODE: mode, ...extraEnv };
  // cwd 固定仓库根：服务端用相对仓库根的路径找 fixtures，换目录调用不能改变这个前提。
  const child = spawn(process.execPath, [join(ROOT, 'packages/server/src/bin/serve.ts')], {
    cwd: ROOT,
    env: env2,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (cleanup !== undefined) cleanup.track(child);
  let log = '';
  child.stdout.on('data', (b) => { log += String(b); });
  child.stderr.on('data', (b) => { log += String(b); });
  const deadline = Date.now() + healthTimeoutMs;
  let health = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:' + String(port) + '/api/health');
      if (res.ok) { health = await res.json(); break; }
    } catch { /* 还没起来 */ }
    await sleep(200);
  }
  return { child, health, base: 'http://127.0.0.1:' + String(port), log: () => log.slice(-600) };
}

/** 前端产物不在 git 里（dist/ 被忽略），所以「静态托管」那几项只能构建过才验得到。 */
export function webBuilt() {
  return existsSync(join(ROOT, 'packages/web/dist/index.html'));
}
