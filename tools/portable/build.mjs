#!/usr/bin/env node
/**
 * 便携包：把「双击就能用」压缩成一个 zip。
 *
 * 为什么不是 exe（ADR-0028）：Electron 要下上百 MB、Tauri 要 Rust 工具链，两者都会毁掉
 * 「十分钟复现」，也违反 AGENTS.md 第 6 节。便携包换了个做法——不编译、不安装，
 * 只是把官方 node.exe 和已经构建好的产物放进同一个文件夹：
 *
 *   解压 → 双击「启动.cmd」→ 出现一个没有地址栏的窗口
 *
 * 打包里有什么（其余一律不放，包越小越不容易在评委机器上出意外）：
 *   node/node.exe        便携运行时，免安装、不写注册表
 *   packages/**          服务端与前端产物（.ts 由 Node 原生剥类型直接跑，ADR-0001）
 *   node_modules/**      四个纯 JS 依赖的闭包；没有一个是需要编译的原生模块
 *   fixtures/llm/**      录好的卡带，断网也能跑完整场
 *   tools/launcher/**    零门槛启动器（找 Edge/Chrome、开 --app 窗口）
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const outDir = join(root, 'dist', 'portable');
const stageName = 'crossexam-portable';
const stage = join(outDir, stageName);

/** 包里只留这四个依赖。多一个就要多问一次「它要不要编译、要不要联网」。 */
const RUNTIME_DEPS = ['@hono/node-server', 'hono', 'unpdf', 'zod'];

function fail(message) {
  console.error('  × ' + message);
  process.exit(1);
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}


if (process.platform !== 'win32') fail('便携包只打 Windows：里面放的是 node.exe');
if (!existsSync(join(root, 'packages', 'web', 'dist', 'index.html'))) {
  fail('还没有前端产物。先跑 npm run build 再打包。');
}
const nodeExe = process.execPath;
if (!/node(\.exe)?$/i.test(nodeExe)) fail('拿到的不是 node 可执行文件：' + nodeExe);

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

function copy(from, to) {
  cpSync(join(root, from), join(stage, to), { recursive: true });
}

// 1) 运行时
mkdirSync(join(stage, 'node'), { recursive: true });
cpSync(nodeExe, join(stage, 'node', 'node.exe'));

// 2) 代码与产物（测试文件不进包）
for (const pkg of ['server', 'shared']) {
  copy('packages/' + pkg + '/package.json', 'packages/' + pkg + '/package.json');
  copy('packages/' + pkg + '/src', 'packages/' + pkg + '/src');
}
copy('packages/web/dist', 'packages/web/dist');
copy('packages/web/package.json', 'packages/web/package.json');
copy('fixtures/llm', 'fixtures/llm');
copy('tools/launcher', 'tools/launcher');
if (existsSync(join(root, 'LICENSE'))) copy('LICENSE', 'LICENSE');

// 3) 依赖：四个纯 JS 包的闭包 + 工作区内的两个包（Node 解析 @crossexam/* 需要实体目录）
for (const dep of RUNTIME_DEPS) {
  const from = join(root, 'node_modules', dep);
  if (!existsSync(from)) fail('缺依赖 ' + dep + '，先 npm install');
  cpSync(from, join(stage, 'node_modules', dep), { recursive: true });
}
// 工作区包**不**放进 node_modules：Node 的类型剥离拒绝处理 node_modules 里的 .ts，
// 一旦放进去服务端就起不来。改用 tools/portable/register.mjs 在解析阶段把它们指回 packages/。
copy('tools/portable/register.mjs', 'tools/portable/register.mjs');
mkdirSync(join(stage, 'data'), { recursive: true });

// 4) 入口与说明（cmd 必须 CRLF，否则某些系统上会把行尾吃进命令里）
const cmd = [
  '@echo off',
  'chcp 65001 >nul',
  'title CrossExam 质询室',
  'cd /d "%~dp0"',
  'if not exist "node\\node.exe" (',
  '  echo. 便携包不完整：找不到 node\\node.exe，重新解压一次。',
  '  pause',
  '  exit /b 1',
  ')',
  'rem 把 @crossexam/* 指回 packages/：Node 的类型剥离不处理 node_modules 里的 .ts',
  'set NODE_OPTIONS=--import ./tools/portable/register.mjs',
  '"node\\node.exe" "tools\\launcher\\launch.mjs" %*',
  'if errorlevel 1 (',
  '  echo.',
  '  echo   出了点问题，原因在上面的输出里。按任意键关闭窗口。',
  '  pause >nul',
  ')',
].join('\r\n') + '\r\n';
writeFileSync(join(stage, '启动.cmd'), cmd, 'utf8');

const readme = [
  'CrossExam 质询室 · 便携版',
  '',
  '怎么用：双击「启动.cmd」。等一两秒会出现一个没有地址栏的窗口，那就是它。',
  '关掉那个窗口不会停服务；要停就关掉黑色的命令行窗口。',
  '',
  '不需要装 Node.js——包里自带 node\\node.exe。',
  '不需要联网、不需要 API Key：仓库里录好的卡带足以跑完整场，点「一键示例」就行。',
  '',
  '数据落在 data\\crossexam.db（SQLite 单文件）。想清空就把 data 文件夹删掉，下次启动会重建。',
  '想换端口：set CROSSEXAM_PORT=9000 后再双击（或在命令行里先 set 再运行 启动.cmd）。',
  '',
  '为什么不是一个 exe：见 docs/adr/0028-app-window-desktop.md。',
].join('\r\n') + '\r\n';
writeFileSync(join(stage, '使用说明.txt'), readme, 'utf8');

// 5) 打包（tar -a 在 Windows 上就是 zip，Compress-Archive 会慢十倍）
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const zipName = 'crossexam-portable-' + version + '-win-x64.zip';
const zipPath = join(outDir, zipName);
rmSync(zipPath, { force: true });
// 用 Windows 自带的 bsdtar：PATH 里的 tar 常常是 Git 附带的 GNU tar，会把 D: 当成远程主机名
const tarExe = existsSync('C:\\Windows\\System32\\tar.exe') ? 'C:\\Windows\\System32\\tar.exe' : 'tar';
execFileSync(tarExe, ['-a', '-c', '-f', zipName, stageName], { cwd: outDir, stdio: 'inherit' });

const bytes = statSync(zipPath).size;
const sha = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
console.log('');
console.log('  便携包已生成：' + relative(root, zipPath));
console.log('  体积        ' + mb(bytes));
console.log('  sha256      ' + sha);
console.log('  跑一遍校验  node tools/portable/verify.mjs');