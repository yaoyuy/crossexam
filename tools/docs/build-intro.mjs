#!/usr/bin/env node
// 作品介绍文档构建：单份 Markdown → 单页 HTML → 无头 Edge 打印成 PDF。
//
// 为什么不复用 build-doc.mjs 而是单独一份：技术文档是「docs/tech/ 下多片按文件名拼」，
// 作品介绍是「评委要照着七条要求逐项打勾」的单份文档，它有自己的封面与页脚文字，
// 而且页数上限不同（技术文档 ≤30 页，平台对作品介绍只限 100MB 不限页）。
// 相同的是整条链路：零依赖、无头浏览器是系统自带的，评委能一条命令重跑。
//
// 用法：
//   node tools/docs/build-intro.mjs                # 生成 docs/submission/CrossExam-作品介绍.pdf
//   node tools/docs/build-intro.mjs --html-only    # 只出 HTML，便于排查排版
//   node tools/docs/build-intro.mjs --keep         # 保留中间产物（浏览器 profile）
//   node tools/docs/build-intro.mjs --allow-long   # 超过页数上限也照样成功

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderMarkdown } from './md2html.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const NL = '\n';

const SOURCE = join(ROOT, 'docs', 'submission', '作品介绍.md');
const BUILD_DIR = join(ROOT, '.tmp', 'intro');
const OUTPUT = join(ROOT, 'docs', 'submission', 'CrossExam-作品介绍.pdf');
const MAX_PAGES = 18;
const COVER_MARK = '<!-- cover-end -->';
const TOC_MARK = '<!-- toc-end -->';

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
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
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

const CSS = [
  '@page {',
  '  size: A4;',
  '  margin: 14mm 13mm 13mm 13mm;',
  '  @bottom-center { content: counter(page) " / " counter(pages); font-family: "Segoe UI", sans-serif; font-size: 8.5pt; color: #9aa3af; }',
  '  @bottom-right { content: "CrossExam 质询室 · 作品介绍"; font-family: "Segoe UI", sans-serif; font-size: 8pt; color: #cbd2d9; }',
  '}',
  '@page :first { @bottom-center { content: none; } @bottom-right { content: none; } }',
  '* { box-sizing: border-box; }',
  'html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
  'body {',
  '  margin: 0;',
  '  font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Segoe UI", sans-serif;',
  '  font-size: 9.6pt;',
  '  line-height: 1.42;',
  '  color: #1f2933;',
  '}',
  'h1, h2, h3, h4 { font-weight: 700; color: #0f1720; break-after: avoid; }',
  'h1 { font-size: 16.5pt; margin: 0 0 4mm; padding-bottom: 2.4mm; border-bottom: 2pt solid #c2410c; }',
  'h1.section { margin-top: 8mm; padding-top: 3mm; border-top: 0.6pt solid #e5e7eb; }',
  'h2 { font-size: 11.6pt; margin: 5mm 0 1.4mm; padding-left: 2.4mm; border-left: 3pt solid #c2410c; }',
  'h3 { font-size: 10.2pt; margin: 3.2mm 0 1.0mm; color: #7c2d12; }',
  'p { margin: 0 0 1.3mm; text-align: justify; }',
  'ul, ol { margin: 0 0 1.9mm; padding-left: 6mm; }',
  'li { margin: 0 0 0.7mm; }',
  'strong { color: #0f1720; }',
  'a { color: #b45309; text-decoration: none; }',
  'code { font-family: Consolas, "Cascadia Mono", monospace; font-size: 8.4pt; background: #f3f4f6; border: 0.4pt solid #e5e7eb; border-radius: 1.4mm; padding: 0 1mm; color: #7c2d12; }',
  'pre { background: #0f1720; color: #e5e7eb; border-radius: 2mm; padding: 1.8mm 2.4mm; margin: 0 0 2mm; break-inside: avoid; }',
  'pre code { background: none; border: 0; color: inherit; padding: 0; font-size: 7.9pt; line-height: 1.45; }',
  'table { width: 100%; border-collapse: collapse; margin: 0 0 1.6mm; font-size: 8.5pt; }',
  'tr { break-inside: avoid; }',
  'thead { display: table-header-group; }',
  'thead th { background: #fdf0e7; color: #7c2d12; text-align: left; font-weight: 700; }',
  'th, td { border: 0.4pt solid #dfe3e8; padding: 1mm 1.6mm; vertical-align: top; line-height: 1.42; }',
  'tbody tr:nth-child(even) { background: #fafbfc; }',
  'blockquote { margin: 0 0 1.8mm; padding: 1.5mm 2.2mm; background: #f8fafc; border-left: 2.6pt solid #94a3b8; color: #334155; }',
  'blockquote p:last-child { margin-bottom: 0; }',
  'hr { border: 0; border-top: 0.4pt solid #dfe3e8; margin: 5mm 0; }',
  'p.figure { margin: 2.6mm 0 1.4mm; text-align: center; break-inside: avoid; }',
  'p.figure img { max-width: 100%; border: 0.4pt solid #dfe3e8; border-radius: 1.6mm; }',
  'p.figure + p em { color: #64748b; font-size: 8.6pt; }',
  'p em { color: #475569; }',
  '.pagebreak { break-after: page; }',
  '.cover { padding-top: 14mm; }',
  '.toc { margin-top: 10mm; }',
  '.toc h2 { margin-top: 0; }',
  '.cover .kicker { font-size: 9pt; letter-spacing: 0.22em; color: #c2410c; font-weight: 700; margin-bottom: 6mm; }',
  '.cover h1 { font-size: 34pt; border: 0; padding: 0; margin: 0 0 2mm; line-height: 1.2; letter-spacing: 0.02em; }',
  '.cover h1 + p { font-size: 13pt; color: #334155; margin: 0 0 7mm; }',
  '.cover h2 { font-size: 0; margin: 0; padding: 0; border: 0; height: 3pt; background: linear-gradient(90deg, #c2410c, #fdba74); margin-bottom: 9mm; }',
  '.cover p { font-size: 9.8pt; color: #334155; margin: 0 0 1.4mm; }',
  '.cover blockquote { margin-top: 9mm; background: #fff7ed; border-left: 3pt solid #c2410c; color: #7c2d12; font-size: 10.6pt; line-height: 1.7; }',
].join(NL);

function renderMarkdownPart(text) {
  return renderMarkdown(text, {
    rewriteImage: (src) => pathToFileURL(resolve(ROOT, src)).href,
  });
}

function buildHtml(markdown) {
  const index = markdown.indexOf(COVER_MARK);
  if (index < 0) throw new Error('文档里找不到封面分隔标记：' + COVER_MARK);
  const tail = markdown.indexOf(TOC_MARK);
  if (tail < 0) throw new Error('文档里找不到目录分隔标记：' + TOC_MARK);
  const cover = renderMarkdownPart(markdown.slice(0, index));
  const toc = renderMarkdownPart(markdown.slice(index + COVER_MARK.length, tail));
  const body = renderMarkdownPart(markdown.slice(tail + TOC_MARK.length));
  return [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<title>CrossExam 质询室 · 作品介绍</title>',
    '<style>' + CSS + '</style>',
    '</head><body>',
    '<div class="cover">',
    '<div class="kicker">作品介绍文档 · 2026-11-08</div>',
    cover,
    '</div>',
    '<div class="toc">',
    toc,
    '</div>',
    '<div class="pagebreak"></div>',
    body.replace(/<h1>/g, '<h1 class="section">'),
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
  if (!existsSync(SOURCE)) throw new Error('找不到作品介绍源文件：' + SOURCE);
  const markdown = readFileSync(SOURCE, 'utf8');
  const html = buildHtml(markdown);

  mkdirSync(BUILD_DIR, { recursive: true });
  const htmlPath = join(BUILD_DIR, 'intro.html');
  writeFileSync(htmlPath, html, 'utf8');
  log('源文件      ' + SOURCE);
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
    log('页数超限    ' + String(pages) + ' > ' + String(MAX_PAGES) + ' 页');
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
