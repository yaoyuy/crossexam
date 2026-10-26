#!/usr/bin/env node
/**
 * dsh-export —— 把 DSH 会话日志导出成 Markdown 形式的 Prompt 链快照。
 *
 * 为什么要自己写：参赛要求提交「≥3 个核心功能迭代的完整 Prompt 链」。
 * 事后回忆着补写就是造假，而且一定会漏掉「怎么引导修 Bug」这种最有价值的部分。
 * DSH 把每一次提问、回复、工具调用都落在本地会话文件里，直接读出来即可。
 *
 * 零第三方依赖（只用 node: 内置模块），保证评委 clone 完就能跑。
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveDshHome, listSessionFiles, readSession, readSessionHeader } from '../src/sessions.mjs';
import { buildTimeline, extractMeta } from '../src/parse.mjs';
import { renderMarkdown, renderIndex } from '../src/render.mjs';
import { redactSecrets } from '../src/redact.mjs';
import { safeFileName, humanBytes } from '../src/text.mjs';

const HELP = [
  '用法: node tools/dsh-export/bin/dsh-export.mjs [选项]',
  '',
  '选项:',
  '  --out <dir>              输出目录 (默认 docs/prompt-chain)',
  '  --dsh-home <dir>         DSH 数据目录 (默认自动探测 %APPDATA%/dsh-desktop/harness)',
  '  --cwd <path>             只导出该工作目录下的会话 (默认当前目录)',
  '  --all                    导出全部工作目录的会话',
  '  --session <id>           只导出指定会话 id，可重复',
  '  --max-arg-chars <n>      工具参数折叠阈值 (默认 600)',
  '  --max-result-chars <n>   工具结果折叠阈值 (默认 1200)',
  '  --keep-injected          保留系统注入消息 (调试用，默认丢弃)',
  '  --list                   只列出匹配到的会话，不写文件',
  '  --dry-run                跑完整流程但不写文件',
  '  --quiet                  只输出摘要',
  '  --help                   显示本帮助',
].join('\n');

function parseArgs(argv) {
  const o = {
    out: 'docs/prompt-chain', dshHome: null, cwd: process.cwd(), all: false,
    sessions: [], maxArgChars: 600, maxResultChars: 1200, keepInjected: false,
    list: false, dryRun: false, quiet: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--out') o.out = next();
    else if (a === '--dsh-home') o.dshHome = next();
    else if (a === '--cwd') o.cwd = path.resolve(next());
    else if (a === '--all') o.all = true;
    else if (a === '--session') o.sessions.push(next());
    else if (a === '--max-arg-chars') o.maxArgChars = Number(next());
    else if (a === '--max-result-chars') o.maxResultChars = Number(next());
    else if (a === '--keep-injected') o.keepInjected = true;
    else if (a === '--list') o.list = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error('未知参数: ' + a);
  }
  return o;
}

function normCwd(p) {
  if (!p) return '';
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

function dateOf(ms) {
  if (!ms) return '0000-00-00';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return 0; }

  const home = resolveDshHome(opts.dshHome, process.env);
  const all = listSessionFiles(home);
  if (all.length === 0) {
    console.error('在 ' + home + ' 下没找到任何会话；用 --dsh-home 指定 DSH 数据目录。');
    return 2;
  }

  // 先只解会话头，靠会话自己记录的 cwd 做筛选——比猜工作区目录名可靠
  const wanted = new Set(opts.sessions);
  const selected = [];
  for (const s of all) {
    if (wanted.size > 0 && !wanted.has(s.sessionId)) continue;
    const header = readSessionHeader(s.file);
    const headerCwd = header && header.cwd ? header.cwd : null;
    if (!opts.all && wanted.size === 0 && normCwd(headerCwd) !== normCwd(opts.cwd)) continue;
    selected.push({ ...s, headerCwd });
  }
  selected.sort((a, b) => a.mtimeMs - b.mtimeMs);

  if (opts.list) {
    for (const s of selected) {
      const shortId = s.sessionId.replace(/^session-/, '').slice(0, 8);
      console.log([dateOf(s.mtimeMs), shortId, humanBytes(s.sizeBytes), s.headerCwd || '?', s.file].join('  '));
    }
    console.log('\n共 ' + selected.length + ' 个会话（扫描了 ' + all.length + ' 个）。');
    return 0;
  }

  const outDir = path.resolve(opts.out);
  const entries = [];
  const usedNames = new Set();
  let secretHits = 0;

  for (const s of selected) {
    const { events } = readSession(s.file);
    const meta = extractMeta(events);
    const { turns, usage } = buildTimeline(events, { keepInjected: opts.keepInjected });
    const markdown = renderMarkdown({ meta, turns, usage }, {
      maxArgChars: opts.maxArgChars,
      maxResultChars: opts.maxResultChars,
    });

    const red = redactSecrets(markdown);
    secretHits += red.hits.length;
    if (red.hits.length && !opts.quiet) {
      console.warn('⚠ 会话 ' + (meta.id || s.sessionId) + ' 命中 ' + red.hits.length +
        ' 类疑似密钥，已在导出物中脱敏：' + red.hits.map((h) => h.kind + '×' + h.count).join(', '));
    }

    let base = dateOf(meta.createdAt || s.mtimeMs) + '-' + safeFileName(meta.title, 'session');
    if (usedNames.has(base)) base = base + '-' + s.sessionId.slice(0, 6);
    usedNames.add(base);
    const fileName = base + '.md';
    const outFile = path.join(outDir, fileName);

    if (!opts.dryRun) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outFile, red.text, 'utf8');
    }
    entries.push({
      fileName, sessionId: meta.id || s.sessionId, title: meta.title,
      date: dateOf(meta.createdAt || s.mtimeMs), cwd: meta.cwd,
      humanMessageCount: meta.humanMessageCount, eventCount: meta.eventCount,
      tokens: usage, bytes: Buffer.byteLength(red.text, 'utf8'),
    });
    if (!opts.quiet) console.log('导出 ' + fileName + '  (' + entries[entries.length - 1].bytes + ' B)');
  }

  if (!opts.dryRun && entries.length) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'README.md'), renderIndex(entries), 'utf8');
    fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(entries, null, 2), 'utf8');
  }

  const totalTokens = entries.reduce((acc, e) => acc + (e.tokens.outputTokens || 0), 0);
  console.log('\n共导出 ' + entries.length + ' 个会话，输出 ' + totalTokens + ' tokens。' +
    (secretHits ? ' 脱敏命中 ' + secretHits + ' 类。' : ''));
  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('导出失败: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
