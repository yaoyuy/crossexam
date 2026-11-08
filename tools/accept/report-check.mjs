/**
 * 验收：报告导出三种形态（.md / 可打印 HTML / .docx）在真进程与真浏览器里成立。
 *
 * 为什么必须真浏览器：导出按钮是 <a href>，「接口返回了正确的文件」不等于「界面挂对了」，
 * 这类断链只有点一遍才看得见（见 AGENTS.md 第 4 节）。没有浏览器时这 4 项显式 SKIP，
 * 不会静默当通过——沉默的通过等于没有证据。
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Recorder, env, findBrowser, installCleanup, makeTmpDir, pickPort, sleep, startServer } from './lib/accept.mjs';
import { launchBrowser } from './lib/cdp.mjs';

const NL = String.fromCharCode(10);
const rec = new Recorder('报告验收：.md / 可打印 HTML / .docx 三种形态');
const cleanup = installCleanup();
const TMP = makeTmpDir('report-check');
const PORT = await pickPort(env('CROSSEXAM_ACCEPT_PORT'));
const CDP_PORT = await pickPort(env('CROSSEXAM_ACCEPT_CDP_PORT'));
const BROWSER = findBrowser();
const EXPECTED = 12;

let server = null;
let fatal = '';
let browserPass = 0;

async function core() {
  server = await startServer({ mode: 'replay', port: PORT, dbPath: join(TMP, 'report.db'), cleanup });
  rec.ok('服务按回放模式起来', server.health?.mode === 'replay', server.health?.mode ?? server.log());
  if (server.health === null) throw new Error('服务没起来：' + server.log());

  const made = await fetch(server.base + '/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ useDemo: true }),
  });
  const session = await made.json();
  rec.ok('示例会话建好', made.status === 201 && typeof session.id === 'string', session.id);

  const run = await fetch(server.base + '/api/sessions/' + session.id + '/run?stream=0', { method: 'POST' });
  const summary = await run.json();
  rec.ok('离线跑完一场', run.status === 200 && summary.claims === 5, 'claims=' + String(summary.claims));

  const md = await fetch(server.base + '/api/sessions/' + session.id + '/report.md');
  const mdText = await md.text();
  rec.ok('Markdown 报告可下载', (md.headers.get('content-type') ?? '').includes('text/markdown') && mdText.includes('一、主张与判定'));

  const html = await fetch(server.base + '/api/sessions/' + session.id + '/report.html?print=1');
  const htmlText = await html.text();
  const htmlPath = join(TMP, 'report.html');
  writeFileSync(htmlPath, htmlText, 'utf8');
  rec.ok('HTML 报告是完整文档', htmlText.startsWith('<!doctype html>') && htmlText.includes('</html>'));
  rec.ok('HTML 报告带打印脚本', htmlText.includes('window.print()'));
  rec.ok('HTML 报告含判定中文与追问原文', htmlText.includes('站得住') && htmlText.includes('从 2.4s 降到 0.8s'));

  // Word：老版本导出的是 .doc（application/msword），现在导出真 .docx。
  // 只对 content-type 会成为「说好的 Word 其实打不开」的漏网之鱼，所以再验一下 zip 魔数。
  const doc = await fetch(server.base + '/api/sessions/' + session.id + '/report.docx');
  const docBuf = Buffer.from(await doc.arrayBuffer());
  const isZip = docBuf[0] === 0x50 && docBuf[1] === 0x4b;
  rec.ok('Word 报告是真的 .docx（类型 + 附件名 + zip 头）',
    (doc.headers.get('content-type') ?? '').includes('wordprocessingml') &&
    (doc.headers.get('content-disposition') ?? '').includes('.docx') && isZip,
    String(docBuf.length) + ' B / ct=' + String((doc.headers.get('content-type') ?? '').split(';')[0]));
  rec.note('报告落临时目录（可打开核对排版）：' + htmlPath);
  return session;
}

async function withBrowser(session) {
  if (BROWSER === null) {
    rec.skip('浏览器能把这份 HTML 打成 PDF', '没找到浏览器（可用 CROSSEXAM_ACCEPT_BROWSER 指定）');
    rec.skip('界面上的 Markdown 按钮指到 report.md', '没找到浏览器');
    rec.skip('界面上的 PDF 按钮指到 report.html?print=1', '没找到浏览器');
    rec.skip('界面上的 Word 按钮指到 report.docx', '没找到浏览器');
    return;
  }
  rec.group('真浏览器（' + BROWSER + '）');

  // 1) 用浏览器自带的打印把 HTML 打成 PDF：验证「打印视图」真的是一份能出纸的文档。
  const pdfPath = join(TMP, 'report.pdf');
  const printer = spawn(BROWSER, [
    '--headless', '--disable-gpu', '--no-first-run', '--no-pdf-header-footer',
    '--user-data-dir=' + join(TMP, 'browser-pdf'),
    '--print-to-pdf=' + pdfPath,
    pathToFileURL(join(TMP, 'report.html')).href,
  ], { stdio: 'ignore' });
  cleanup.track(printer);
  await new Promise((resolve) => printer.on('exit', resolve));
  let pdfBuf = Buffer.alloc(0);
  for (let i = 0; i < 40; i += 1) {
    if (existsSync(pdfPath) && readFileSync(pdfPath).length > 2000) { pdfBuf = readFileSync(pdfPath); break; }
    await sleep(500);
  }
  const pages = Number((/\/Count\s+(\d+)/.exec(pdfBuf.toString('latin1')) ?? [])[1] ?? 0);
  rec.ok('浏览器能把这份 HTML 打成 PDF', pdfBuf.length > 2000 && pages >= 2, String(pdfBuf.length) + ' B / ' + String(pages) + ' 页');

  // 2) 真界面：点开示例、跑一场，再看三个导出按钮的 href 指向哪。
  const browser = await launchBrowser(BROWSER, { cdpPort: CDP_PORT, profileDir: join(TMP, 'browser-cdp'), cleanup });
  if (browser === null) {
    rec.skip('界面上的 Markdown 按钮指到 report.md', '浏览器起来了但 CDP 没接上');
    rec.skip('界面上的 PDF 按钮指到 report.html?print=1', '浏览器起来了但 CDP 没接上');
    rec.skip('界面上的 Word 按钮指到 report.docx', '浏览器起来了但 CDP 没接上');
    return;
  }
  try {
    await browser.send('Page.navigate', { url: server.base + '/' });
    // 首页改版后投料台不在首屏：先在首页点「一键示例」，它会填好材料并跳到投料台。
    await browser.waitFor(() => browser.evalJs('document.body.innerText.includes("一键示例")'), '首页出来');
    // 示例材料是异步拉来的：拉回来之前点「一键示例」只会提示一句「稍等一下」，材料并不会填上。
    // 所以这里反复点（首页按钮 → 投料台自带的一键示例），直到「开始质询」真的可用为止。
    let lastState = '';
    try {
      await browser.waitFor(async () => {
        lastState = String(await browser.evalJs(
          '(function(){var r=document.querySelector("[data-shot=run]");if(r&&r.disabled===false)return "ready";' +
          'var h=document.querySelector("[data-shot=home-demo]");if(h&&h.disabled===false){h.click();return "clicked-home";}' +
          'var u=document.querySelector("[data-shot=use-demo]");if(u&&u.disabled===false){u.click();return "clicked-use";}' +
          'return "waiting run="+(r?String(r.disabled):"none")+" home="+(h?"yes":"none")+" use="+(u?"yes":"none");})()',
        ));
        return lastState === 'ready';
      }, '示例载入且「开始质询」可用', 60000);
    } catch (err) {
      console.log('最后状态：' + lastState);
      console.log('界面文本：' + NL + String(await browser.evalJs('document.body.innerText.slice(0, 900)')));
      console.log('控制台：' + NL + browser.consoleIssues.slice(0, 6).join(NL));
      throw err;
    }
    await browser.evalJs('document.querySelector("[data-shot=run]").click()');
    const hrefs = await browser.waitFor(async () => {
      const value = await browser.evalJs(
        'JSON.stringify({md:(document.querySelector("[data-shot=report-md]")||{}).getAttribute?document.querySelector("[data-shot=report-md]").getAttribute("href"):null,' +
        'pdf:document.querySelector("[data-shot=report-pdf]")?document.querySelector("[data-shot=report-pdf]").getAttribute("href"):null,' +
        'docx:document.querySelector("[data-shot=report-docx]")?document.querySelector("[data-shot=report-docx]").getAttribute("href"):null})',
      );
      const parsed = JSON.parse(value);
      return parsed.md !== null && parsed.pdf !== null && parsed.docx !== null ? parsed : null;
    }, '三个导出按钮出现', 120000).catch(async (err) => {
      const text = await browser.evalJs('document.body.innerText.slice(0, 1500)');
      console.log('等不到按钮时的界面文本：' + NL + String(text));
      throw err;
    });
    rec.ok('界面上的 Markdown 按钮指到 report.md', hrefs.md.endsWith('/report.md'), hrefs.md);
    rec.ok('界面上的 PDF 按钮指到 report.html?print=1', hrefs.pdf.endsWith('/report.html?print=1'), hrefs.pdf);
    rec.ok('界面上的 Word 按钮指到 report.docx', hrefs.docx.endsWith('/report.docx'), hrefs.docx);
    for (const line of browser.consoleIssues.slice(0, 3)) rec.note('控制台：' + line);
    await browser.shot(TMP, 'report-ui.png');
    rec.note('界面截图：' + join(TMP, 'report-ui.png'));
  } finally {
    await browser.close();
  }
}

try {
  const session = await core();
  await withBrowser(session);
} catch (err) {
  fatal = err instanceof Error ? err.message : String(err);
}

if (server !== null && server.child.exitCode === null) { server.child.kill(); await sleep(300); }
const code = rec.summary();
if (fatal !== '') console.log(NL + '中途出错（未跑完 ' + String(Math.max(0, EXPECTED - (rec.pass + rec.fail + rec.skips))) + ' 项）：' + fatal);
if (fatal !== '' && code === 0) process.exit(1);
process.exit(code);
