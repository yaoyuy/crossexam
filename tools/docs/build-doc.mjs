#!/usr/bin/env node
// 技术文档构建：Markdown 分片 → 单页 HTML → 无头 Edge 打印成 PDF。
//
// 为什么整条链路自己写、且不装任何依赖：这份文档的读者是评委，
// 他们要能在自己机器上一条命令重新生成它；pandoc 与 Python markdown 都不是
// 「npm install 就有」的东西（实测本机两者都没有），而无头浏览器是系统自带的。
//
// 用法：
//   node tools/docs/build-doc.mjs                  # 生成 docs/CrossExam-技术文档.pdf
//   node tools/docs/build-doc.mjs --html-only      # 只出 HTML，便于排查排版
//   node tools/docs/build-doc.mjs --keep           # 保留中间产物
//   node tools/docs/build-doc.mjs --allow-long     # 超过页数上限也照样成功（默认超了即失败）

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderMarkdown } from './md2html.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const NL = '\n';

const SOURCE_DIR = join(ROOT, 'docs', 'tech');
const BUILD_DIR = join(ROOT, '.tmp', 'doc');
const OUTPUT = join(ROOT, 'docs', 'CrossExam-技术文档.pdf');
const MAX_PAGES = 30;

function log(message) {
  process.stdout.write(message + NL);
}

function parseArgs(argv) {
  const opts = { htmlOnly: false, keep: false, allowLong: false, out: OUTPUT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--html-only') opts.htmlOnly = true;
    else if (arg === '--keep') opts.keep = true;
    else if (arg === '--allow-long') opts.allowLong = true;
    else if (arg === '--out') { opts.out = resolve(argv[i + 1]); i += 1; }
    else if (arg === '--help' || arg === '-h') { log(readFileSync(join(HERE, 'README.md'), 'utf8')); process.exit(0); }
    else throw new Error('不认识的参数：' + arg);
  }
  return opts;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function browserCandidates() {
  const fromEnv = process.env['CROSSEXAM_BROWSER'];
  const list = [];
  if (fromEnv !== undefined && fromEnv.length > 0) list.push(fromEnv);
  if (process.platform === 'win32') {
    list.push(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    );
  } else if (process.platform === 'darwin') {
    list.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else {
    list.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  return list;
}

function findBrowser() {
  for (const candidate of browserCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** 分片按文件名排序拼接：00-封面、01-…，前缀即顺序。 */
function readSources() {
  if (!existsSync(SOURCE_DIR)) throw new Error('找不到文档源目录：' + SOURCE_DIR);
  const files = readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort();
  if (files.length === 0) throw new Error('文档源目录里没有 .md 文件：' + SOURCE_DIR);
  const parts = [];
  for (const name of files) {
    const text = readFileSync(join(SOURCE_DIR, name), 'utf8');
    parts.push({ name, text });
  }
  return parts;
}

const CSS = [
  '@page {',
  '  size: A4;',
  '  margin: 14mm 13mm 13mm 13mm;',
  '  @bottom-center { content: counter(page) " / " counter(pages); font-family: "Segoe UI", sans-serif; font-size: 8.5pt; color: #9aa3af; }',
  '  @bottom-right { content: "CrossExam 质询室 · 技术文档"; font-family: "Segoe UI", sans-serif; font-size: 8pt; color: #cbd2d9; }',
  '}',
  '@page :first { @bottom-center { content: none; } @bottom-right { content: none; } }',
  '* { box-sizing: border-box; }',
  'html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
  'body {',
  '  margin: 0;',
  '  font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Segoe UI", sans-serif;',
  '  font-size: 9.4pt;',
  '  line-height: 1.40;',
  '  color: #1f2933;',
  '}',
  'h1, h2, h3, h4 { font-weight: 700; color: #0f1720; break-after: avoid; }',
  'h1 { font-size: 16.5pt; margin: 0 0 4.5mm; padding-bottom: 2.4mm; border-bottom: 2pt solid #c2410c; }',
  'h1.section { break-before: page; }',
  'h2 { font-size: 11.8pt; margin: 3.0mm 0 1.2mm; padding-left: 2.4mm; border-left: 3pt solid #c2410c; }',
  'h3 { font-size: 10.2pt; margin: 2.4mm 0 1mm; color: #7c2d12; }',
  'h4 { font-size: 10pt; margin: 4mm 0 1.6mm; color: #334155; }',
  'p { margin: 0 0 1.3mm; text-align: justify; }',
  'ul, ol { margin: 0 0 1.7mm; padding-left: 6mm; }',
  'li { margin: 0 0 0.5mm; }',
  'li > ul, li > ol { margin: 1.2mm 0 0; }',
  'strong { color: #0f1720; }',
  'a { color: #b45309; text-decoration: none; }',
  'code { font-family: Consolas, "Cascadia Mono", monospace; font-size: 8.3pt; background: #f3f4f6; border: 0.4pt solid #e5e7eb; border-radius: 1.4mm; padding: 0 1mm; color: #7c2d12; }',
  'pre { background: #0f1720; color: #e5e7eb; border-radius: 2mm; padding: 1.8mm 2.4mm; margin: 0 0 1.8mm; break-inside: avoid; }',
  'pre code { background: none; border: 0; color: inherit; padding: 0; font-size: 7.9pt; line-height: 1.45; }',
  'table { width: 100%; border-collapse: collapse; margin: 0 0 1.6mm; font-size: 8.3pt; }',
  'tr { break-inside: avoid; }',
  'thead { display: table-header-group; }',
  'thead th { background: #fdf0e7; color: #7c2d12; text-align: left; font-weight: 700; }',
  'th, td { border: 0.4pt solid #dfe3e8; padding: 1mm 1.6mm; vertical-align: top; line-height: 1.42; }',
  'tbody tr:nth-child(even) { background: #fafbfc; }',
  'blockquote { margin: 0 0 2mm; padding: 1.8mm 2.4mm; background: #f8fafc; border-left: 2.6pt solid #94a3b8; color: #334155; }',
  'blockquote p:last-child { margin-bottom: 0; }',
  'hr { border: 0; border-top: 0.4pt solid #dfe3e8; margin: 5mm 0; }',
  'p.figure { margin: 2mm 0 4mm; text-align: center; break-inside: avoid; }',
  'p.figure img { max-width: 100%; border: 0.4pt solid #dfe3e8; border-radius: 1.6mm; }',
  '.cover { break-after: page; padding-top: 6mm; }',
  '.cover .kicker { font-size: 9.5pt; letter-spacing: 0.18em; color: #c2410c; font-weight: 700; margin-bottom: 5mm; }',
  '.cover h1 { font-size: 30pt; border: 0; padding: 0; margin: 0 0 3mm; line-height: 1.24; }',
  '.cover .subtitle { font-size: 13pt; color: #334155; margin: 0 0 8mm; line-height: 1.6; }',
  '.cover .rule { height: 3pt; background: linear-gradient(90deg, #c2410c, #fdba74); margin: 0 0 8mm; }',
  '.cover table { font-size: 9.4pt; }',
  '.cover .note { margin-top: 8mm; font-size: 9pt; color: #64748b; line-height: 1.8; }',
].join(NL);

function renderPart(part) {
  return renderMarkdown(part.text, {
    rewriteImage: (src) => pathToFileURL(resolve(ROOT, src)).href,
  });
}

/**
 * 封面单独渲染并套 .cover：它不参与「每章另起一页」的规则，
 * 而是自己占满第一页（.cover 的 break-after: page）。
 */
function buildHtml(sources) {
  const cover = renderPart(sources[0]);
  const rest = sources.slice(1).map(renderPart).join(NL + NL);
  const withBreaks = rest.replace(/<h1>/g, '<h1 class="section">');
  return [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<title>CrossExam 质询室 · 技术文档</title>',
    '<style>' + CSS + '</style>',
    '</head><body>',
    '<div class="cover">',
    cover,
    '</div>',
    withBreaks,
    '</body></html>',
  ].join(NL);
}

function countPdfPages(file) {
  const text = readFileSync(file).toString('latin1');
  let max = 0;
  const pattern = /\/Count\s+(\d+)/g;
  let hit = pattern.exec(text);
  while (hit !== null) {
    const value = Number(hit[1]);
    if (value > max) max = value;
    hit = pattern.exec(text);
  }
  return max;
}

function runBrowser(browser, htmlPath, pdfPath, profileDir) {
  return new Promise((done, fail) => {
    // 注意：只有旧版 --headless 会真的产出文件，--headless=new 会静默退出（findings F23）。
    const args = [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--user-data-dir=' + profileDir,
      '--print-to-pdf=' + pdfPath,
      '--no-pdf-header-footer',
      '--virtual-time-budget=8000',
      pathToFileURL(htmlPath).href,
    ];
    const child = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', fail);
    child.on('close', (code) => done({ code, stderr }));
  });
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file) && statSync(file).size > 2048) return true;
    await sleep(200);
  }
  return existsSync(file) && statSync(file).size > 2048;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sources = readSources();
  const markdown = sources.map((part) => part.text).join(NL + NL);
  const html = buildHtml(sources);

  mkdirSync(BUILD_DIR, { recursive: true });
  const htmlPath = join(BUILD_DIR, 'tech.html');
  writeFileSync(htmlPath, html, 'utf8');
  log('源文件      ' + sources.map((part) => part.name).join(' + '));
  log('Markdown    ' + String(markdown.length) + ' 字符');
  log('HTML        ' + htmlPath + '（' + String(html.length) + ' 字符）');

  if (opts.htmlOnly) {
    log('只出 HTML，未生成 PDF。');
    return 0;
  }

  const browser = findBrowser();
  if (browser === null) throw new Error('找不到 Edge/Chrome：用 CROSSEXAM_BROWSER 指定浏览器路径');
  log('浏览器      ' + browser);

  const pdfPath = opts.out;
  const profileDir = join(BUILD_DIR, 'edge-profile');
  rmSync(pdfPath, { force: true });
  const run = await runBrowser(browser, htmlPath, pdfPath, profileDir);
  const ok = await waitForFile(pdfPath, 30000);
  if (!ok) {
    log('浏览器 stderr：' + run.stderr.slice(0, 400));
    throw new Error('没有产出 PDF：' + pdfPath);
  }

  const pages = countPdfPages(pdfPath);
  const bytes = statSync(pdfPath).size;
  log('PDF         ' + pdfPath + '（' + String(pages) + ' 页，' + String(Math.round(bytes / 1024)) + ' KB）');

  if (!opts.keep) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // 浏览器进程可能还占着 profile 目录（Windows EPERM），删不掉不影响结果。
    }
  }

  if (pages > MAX_PAGES && !opts.allowLong) {
    log('页数超限    ' + String(pages) + ' > ' + String(MAX_PAGES) + ' 页（提交要求 ≤ ' + String(MAX_PAGES) + ' 页）');
    return 1;
  }
  log('页数        在 ' + String(MAX_PAGES) + ' 页上限之内');
  return 0;
}

main().then((code) => {
  process.exitCode = code;
}).catch((err) => {
  log('构建失败    ' + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});