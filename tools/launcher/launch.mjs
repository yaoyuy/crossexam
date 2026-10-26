#!/usr/bin/env node
/**
 * 零门槛启动器：给不写命令行的人用的一次性入口。
 *
 * 它做四件事，每件都只在「还没做过」时才做：
 *   1. 查 Node 版本；太低就把下载地址打出来，然后停下（不猜、不替你装）
 *   2. node_modules 不在就 npm install
 *   3. packages/web/dist 不在就 npm run build
 *   4. 起服务并把浏览器叫起来
 *
 * 为什么不是打包成 exe：那需要本地编译的原生依赖，会毁掉「十分钟复现」（AGENTS.md 第 6 节）。
 * 判断逻辑全在 src/plan.mjs（纯函数，有单测），这个文件只负责碰文件和起进程。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODE_HELP, SHORTCUT_NAME, browserOpenArgs, desktopShortcutDir, launcherSteps, makeShortcutScript, nodeVersionOk, reuseNote } from './src/plan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const args = new Set(process.argv.slice(2));

function say(line) {
  console.log(line === undefined ? '' : line);
}

function openBrowser(url) {
  // 自动化测试用：没有显示器、也不想被弹窗打扰的时候设成 1
  if (process.env['CROSSEXAM_LAUNCH_NO_BROWSER'] === '1') {
    say('  （跳过了打开浏览器：CROSSEXAM_LAUNCH_NO_BROWSER=1）');
    return;
  }
  const plan = browserOpenArgs(url);
  // windows 的 start 是 cmd 内建命令，起完立刻返回；ignore 掉输出避免多开一个黑窗
  spawn(plan.command, plan.args, { stdio: 'ignore', detached: true, shell: false }).unref();
}

function run(command, cmdArgs, label) {
  say('  → ' + label);
  const result = spawnSync(command, cmdArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    say('');
    say('这一步没有成功：' + label);
    say('可以把这句话原样发给我或者贴到 issue 里，里面有完整的报错。');
    process.exit(1);
  }
}

const shortcutOnly = args.has('--shortcut-only');
const desktop = shortcutOnly || args.has('--shortcut') || args.has('--desktop');

if (!nodeVersionOk(process.versions.node)) {
  say('');
  NODE_HELP.forEach(say);
  say('');
  say('当前版本：' + process.versions.node);
  process.exit(1);
}

const state = {
  hasDependencies: existsSync(join(root, 'node_modules')),
  hasWebBuild: existsSync(join(root, 'packages', 'web', 'dist', 'index.html')),
};
const steps = launcherSteps(state);

say('');
say('  CrossExam 质询室 — 第一次启动会慢一点，之后就快了');
say('  ------------------------------------------------');
steps.forEach((step, index) => say('  ' + String(index + 1) + '. ' + step.label));
say('');

if (!state.hasDependencies) {
  run('npm', ['install'], '安装依赖');
}
if (!state.hasWebBuild) {
  run('npm', ['run', 'build'], '构建界面');
}

if (desktop) {
  const home = process.env['USERPROFILE'] ?? process.env['HOME'] ?? '';
  const shortcutPath = join(desktopShortcutDir(home), SHORTCUT_NAME);
  const script = makeShortcutScript({
    shortcutPath,
    targetPath: join(root, '启动.cmd'),
    workDir: root,
  });
  const made = spawnSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'pipe' });
  const ok = made.status === 0 && String(made.stdout).includes('shortcut-ok');
  say(ok ? '  已在桌面放好快捷方式：' + shortcutPath : '  桌面快捷方式没建成，可以手动把 启动.cmd 拖到桌面。');
  if (shortcutOnly) process.exit(ok ? 0 : 1);
}

const port = process.env['CROSSEXAM_PORT'] ?? '8787';
const url = 'http://127.0.0.1:' + port;
say('  地址  ' + url);
say('  关闭  关掉这个窗口就是关掉服务');
say('');

// 已经有一个在跑就不重复起：直接开浏览器，让它复用同一份库
async function alreadyRunning() {
  try {
    const res = await fetch(url + '/api/health');
    return res.ok;
  } catch {
    return false;
  }
}

if (await alreadyRunning()) {
  say('  ' + reuseNote(port));
  openBrowser(url);
  process.exit(0);
}

const child = spawn(process.execPath, [join(root, 'packages', 'server', 'src', 'bin', 'serve.ts')], {
  cwd: root,
  stdio: 'inherit',
});

// 等健康检查过了再开浏览器，否则用户会看到一个「无法连接」的页面然后以为坏了
const deadline = Date.now() + 30000;
const timer = setInterval(async () => {
  try {
    const res = await fetch(url + '/api/health');
    if (res.ok) {
      clearInterval(timer);
      openBrowser(url);
      return;
    }
  } catch {
    // 还没起来
  }
  if (Date.now() > deadline) {
    clearInterval(timer);
    say('  服务起得比预期慢，可以直接在浏览器打开 ' + url);
  }
}, 400);

child.on('exit', (code) => {
  clearInterval(timer);
  process.exit(code ?? 0);
});
