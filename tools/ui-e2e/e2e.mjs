/**
 * CrossExam 界面点测：真的开一个无头浏览器，把界面上的每一项功能点一遍。
 *
 * 与 tools/smoke 的分工：smoke 只打 HTTP 接口（不碰界面），这个脚本只点界面。
 * 与 tools/ui-shots 的分工：那个负责出图给人看，这个负责断言，红了就退出码 1。
 *
 * 零依赖：只用 Node 自带的 fetch / WebSocket 与系统里的 Edge（或 Chrome）。
 */import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 8811;
const CDP_PORT = 9344;
const HELP = [
  '用法：node tools/ui-e2e/e2e.mjs [--out <目录>] [--help]',
  '',
  '真的开一个无头浏览器，把界面上的每一项功能点一遍，最后打印 PASS/FAIL；有失败则退出码 1。',
  '需要一个 Chromium 内核浏览器（Edge 或 Chrome）和一个空闲端口（默认 8811），约 1-2 分钟。',
  '它比冒烟测试慢，所以没有放进 npm run verify。',
].join(String.fromCharCode(10));

const argv = process.argv.slice(2);
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
if (argv.indexOf('--help') >= 0) {
  console.log(HELP);
  process.exit(0);
}

let serverProc = null;
let edgeProc = null;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const proc of [edgeProc, serverProc]) {
    try { if (proc !== null) proc.kill(); } catch (error) { /* 已经退出了 */ }
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
const OUT = flagValue('--out') || '.tmp/ui-e2e';
const PROFILE = '.tmp/edge-ui-e2e-' + String(Date.now());
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CUSTOM_RESUME = '王小明\n数据工程师 · 杭州\n- 主导搭建实时数仓，把延迟从 15 分钟降到 30 秒。\n- 熟悉 Flink / Kafka / ClickHouse，做过一次全链路压测。';

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok: Boolean(ok), detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  —— ' + detail : ''));
}

try {
  const r = await fetch('http://127.0.0.1:' + PORT + '/api/health');
  if (r.ok) { console.log('端口 ' + PORT + ' 已被占用，先关掉'); process.exit(1); }
} catch (e) { /* 期望端口是空的 */ }

const env = Object.assign({}, process.env, {
  CROSSEXAM_MODE: 'replay',
  CROSSEXAM_PORT: String(PORT),
  CROSSEXAM_DB: '.tmp/e2e/db/e2e.db',
  CROSSEXAM_FIXTURES: 'D:/CZB/fixtures/llm',
});
serverProc = spawn(process.execPath, ['packages/server/src/bin/serve.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
serverProc.stdout.on('data', (b) => { serverLog += b.toString('utf8'); });
serverProc.stderr.on('data', (b) => { serverLog += b.toString('utf8'); });

let health = null;
for (let i = 0; i < 60; i += 1) {
  try { const r = await fetch('http://127.0.0.1:' + PORT + '/api/health'); if (r.ok) { health = await r.json(); break; } } catch (e) { /* 等 */ }
  await sleep(400);
}
check('服务以回放模式起来', health !== null && health.mode === 'replay', health === null ? serverLog.slice(-400) : JSON.stringify(health));

mkdirSync(OUT, { recursive: true });
edgeProc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + String(CDP_PORT), '--user-data-dir=' + PROFILE, 'about:blank'], { stdio: 'ignore' });
let version = null;
for (let i = 0; i < 80; i += 1) {
  try { const r = await fetch('http://127.0.0.1:' + String(CDP_PORT) + '/json/version'); if (r.ok) { version = await r.json(); break; } } catch (e) { /* 等 */ }
  await sleep(300);
}
check('无头浏览器开出调试端口', version !== null, version ? version['Browser'] : '超时');
const list = await (await fetch('http://127.0.0.1:' + String(CDP_PORT) + '/json/list')).json();
const pageTarget = list.find((t) => t.type === 'page');
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let nextId = 0;
const pending = new Map();
const events = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
  } else if (msg.method) { events.push(msg); }
});
// 每条 CDP 命令都要有个头。可见浏览器点测时遇到过 Page.captureScreenshot 永不返回：
// 连接还在、进程还在，脚本却永久卡住，除了按端口杀进程没有别的办法。
const CDP_TIMEOUT_MS = 20000;
const send = (method, params, timeoutMs) => new Promise((resolve, reject) => {
  const myId = nextId + 1;
  nextId = myId;
  const timer = setTimeout(() => {
    pending.delete(myId);
    reject(new Error('调试调用超时（' + String(timeoutMs || CDP_TIMEOUT_MS) + ' 毫秒）：' + method));
  }, timeoutMs || CDP_TIMEOUT_MS);
  pending.set(myId, {
    resolve: (value) => { clearTimeout(timer); resolve(value); },
    reject: (error) => { clearTimeout(timer); reject(error); },
  });
  ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
});
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('页面抛错：' + JSON.stringify((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
}
const bodyText = () => evalJs('document.body.innerText');
async function waitFor(fn, label, timeoutMs) {
  const t0 = Date.now();
  let last = '';
  for (;;) {
    try { last = await fn(); } catch (e) { last = ''; }
    if (last && last.length > 0) return last;
    if (Date.now() - t0 > timeoutMs) throw new Error('等 ' + label + ' 超时');
    await sleep(300);
  }
}
async function waitText(part, timeoutMs) {
  return waitFor(async () => { const t = await bodyText(); return t.indexOf(part) >= 0 ? t : ''; }, '文字 ' + part, timeoutMs);
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'));
}
async function clickText(label) {
  const expr = '(() => { const bs = Array.from(document.querySelectorAll("button")); const b = bs.find((x) => (x.textContent || "").trim() === ' + JSON.stringify(label) + '); if (!b) return "没找到：" + bs.map((x) => (x.textContent || "").trim()).join(" | "); b.click(); return "ok"; })()';
  const r = await evalJs(expr);
  if (r !== 'ok') throw new Error(String(r));
}
async function clickIncludes(label) {
  const expr = '(() => { const bs = Array.from(document.querySelectorAll("button")); const b = bs.find((x) => (x.textContent || "").indexOf(' + JSON.stringify(label) + ') >= 0); if (!b) return "没找到：" + bs.map((x) => (x.textContent || "").trim()).join(" | "); b.click(); return "ok"; })()';
  const r = await evalJs(expr);
  if (r !== 'ok') throw new Error(String(r));
}
async function setTextarea(index, text) {
  const expr = '(() => { const el = document.querySelectorAll("textarea")[' + String(index) + ']; if (!el) return -1; const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, "value").set; setter.call(el, ' + JSON.stringify(text) + '); el.dispatchEvent(new Event("input", { bubbles: true })); return el.value.length; })()';
  return evalJs(expr);
}
const countCards = () => evalJs('document.querySelectorAll(String.fromCharCode(91) + "data-shot=" + String.fromCharCode(34) + "claims" + String.fromCharCode(34) + String.fromCharCode(93) + " article").length');
async function sessions() {
  const raw = await (await fetch('http://127.0.0.1:' + PORT + '/api/sessions')).json();
  return Array.isArray(raw) ? raw : (raw.sessions || []);
}
async function waitSessions(count, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const list = await sessions();
    if (list.length >= count) return list;
    if (Date.now() - t0 > timeoutMs) return list;
    await sleep(300);
  }
}
async function waitSessionsBelow(count, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const list = await sessions();
    if (list.length <= count) return list;
    if (Date.now() - t0 > timeoutMs) return list;
    await sleep(300);
  }
}

await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
const first = await waitText('开始质询', 30000);
events.length = 0;
await sleep(400);
check('首屏渲染出投料台与三栏', first.indexOf('投料台') >= 0 && first.indexOf('意图契约') >= 0 && first.indexOf('主张与追问') >= 0, '');
check('空状态列了四条机制', first.indexOf('证据锚定') >= 0 && first.indexOf('追问预算') >= 0 && first.indexOf('意图契约') >= 0 && first.indexOf('可复现回放') >= 0, '');
const runDisabledEmpty = await evalJs('document.querySelector(String.fromCharCode(91) + "data-shot=" + String.fromCharCode(34) + "run" + String.fromCharCode(34) + String.fromCharCode(93) + "").disabled');
check('简历为空时「开始质询」是灰的', runDisabledEmpty === true, String(runDisabledEmpty));

const typed = await setTextarea(0, CUSTOM_RESUME);
check('能在浏览器里自己打一份简历', typed === CUSTOM_RESUME.length, String(typed) + ' 字');
await waitText('字', 5000);
const runEnabled = await evalJs('document.querySelector(String.fromCharCode(91) + "data-shot=" + String.fromCharCode(34) + "run" + String.fromCharCode(34) + String.fromCharCode(93) + "").disabled');
check('够长了按钮就亮起来', runEnabled === false, String(runEnabled));
await shot('01-typed.png');
await clickText('开始质询');
const failedText = await waitText('回放模式找不到这一条记录', 40000);
check('自建简历在回放模式下给出响亮报错', failedText.indexOf('回放模式找不到这一条记录') >= 0, '');
check('报错里带了补救办法', failedText.indexOf('CROSSEXAM_MODE=record') >= 0, '');
const railSub = await evalJs('document.querySelector(String.fromCharCode(91) + "data-shot=" + String.fromCharCode(34) + "stage" + String.fromCharCode(34) + String.fromCharCode(93) + "").innerText');
check('过程面板显示「中断」', railSub.indexOf('中断') >= 0, railSub.slice(0, 40));
const cardsAfterFail = await countCards();
check('失败时不产出主张卡片', cardsAfterFail === 0, String(cardsAfterFail));
await shot('02-fatal.png');

await clickText('一键示例');
await sleep(300);
const demoLen = await evalJs('document.querySelectorAll("textarea")[0].value.length');
check('一键示例把 361 字示例简历填了进来', demoLen === 361, String(demoLen) + ' 字');
await waitText('合成素材', 5000);
const contractCountBefore = await evalJs('document.querySelectorAll(String.fromCharCode(91) + "data-shot=" + String.fromCharCode(34) + "contract-toggle" + String.fromCharCode(34) + String.fromCharCode(93) + "").length');
check('开跑前面板契约可见（三条）', contractCountBefore === 3, String(contractCountBefore) + ' 条');
await clickIncludes('压力面试官');
const contractCountAdded = await waitFor(async () => { const n = await evalJs('document.querySelectorAll(String.fromCharCode(91) + "data-shot=" + String.fromCharCode(34) + "contract-toggle" + String.fromCharCode(34) + String.fromCharCode(93) + "").length'); return n === 4 ? '4' : ''; }, '契约变四条', 8000);
check('加一位面试官，契约跟着多一条', contractCountAdded === '4', contractCountAdded);
await clickIncludes('压力面试官');
await waitFor(async () => { const n = await evalJs('document.querySelectorAll(String.fromCharCode(91) + "data-shot=" + String.fromCharCode(34) + "contract-toggle" + String.fromCharCode(34) + String.fromCharCode(93) + "").length'); return n === 3 ? '3' : ''; }, '契约回到三条', 8000);
await clickIncludes('HR 面试官');
await waitFor(async () => { const n = await evalJs('document.querySelectorAll(String.fromCharCode(91) + "data-shot=" + String.fromCharCode(34) + "contract-toggle" + String.fromCharCode(34) + String.fromCharCode(93) + "").length'); return n === 2 ? '2' : ''; }, '契约变两条', 8000);
await clickIncludes('HR 面试官');
await sleep(400);
check('面试官面板可以增减', true, '三位 → 四位 → 两位 → 三位');

await clickText('即时');
await clickText('开始质询');
const doneText = await waitText('置信度', 60000);
const cards = await countCards();
check('demo 场次跑完并渲染出主张卡片', cards === 5, String(cards) + ' 张');
await waitFor(async () => { const s = await sessions(); return s.length >= 2 ? 'ok' : ''; }, '两场会话', 20000);
const all = await sessions();
const demoSession = all.find((s) => s.status === 'done');
check('服务端把 demo 场次记成 done', demoSession !== undefined, JSON.stringify(all.map((s) => s.status)));
const view = await (await fetch('http://127.0.0.1:' + PORT + '/api/sessions/' + demoSession.id)).json();
const advised = view.suggestions.filter((s) => s.status === 'suggested');
check('服务端判定 5 条，其中 4 条给出改写建议', view.verdicts.length === 5 && advised.length === 4 && view.suggestions.length === 5, '判定 ' + String(view.verdicts.length) + ' / 建议 ' + String(advised.length) + '（outcome ' + String(view.suggestions.length) + '）');
const drawn = String(doneText).split('置信度').length - 1;
check('界面画出的判定条数与服务端一致', drawn === view.verdicts.length, '界面 ' + String(drawn) + ' / 服务端 ' + String(view.verdicts.length));
// 报告有三种形态：Markdown 便于携带、可打印 HTML（浏览器另存为 PDF）、Word 便于接着改。
// 三种都要真取一遍：只看按钮存在，等于没验证「点下去拿得到东西」。
const reportHrefs = await evalJs('(() => { const pick = (name) => { const a = document.querySelector(\'[data-shot="\' + name + \'"]\'); return a === null ? "" : a.getAttribute("href"); }; return { md: pick("report-md"), pdf: pick("report-pdf"), doc: pick("report-doc") }; })()');
const hrefOf = (key) => String((reportHrefs ?? {})[key] ?? '');
check('头部给出 Markdown / PDF / Word 三个导出入口',
  hrefOf('md').indexOf('/report.md') >= 0 && hrefOf('pdf').indexOf('/report.html?print=1') >= 0 && hrefOf('doc').indexOf('/report.doc') >= 0,
  JSON.stringify(reportHrefs));
const report = await fetch('http://127.0.0.1:' + PORT + hrefOf('md'));
const reportText = await report.text();
check('Markdown 报告可下载且确实是 Markdown', report.status === 200 && reportText.charAt(0) === '#', String(reportText.length) + ' 字符');
const reportHtml = await fetch('http://127.0.0.1:' + PORT + hrefOf('pdf'));
const reportHtmlText = await reportHtml.text();
check('PDF 入口给的是带打印脚本的可打印 HTML',
  reportHtml.status === 200 && reportHtmlText.indexOf('window.print()') >= 0 && reportHtmlText.indexOf('CrossExam 质询报告') >= 0,
  String(reportHtmlText.length) + ' 字符');
const reportDoc = await fetch('http://127.0.0.1:' + PORT + hrefOf('doc'));
const reportDocText = await reportDoc.text();
check('Word 入口给的是 application/msword 附件',
  reportDoc.status === 200 && String(reportDoc.headers.get('content-type')).indexOf('msword') >= 0 && String(reportDoc.headers.get('content-disposition')).indexOf('.doc') >= 0,
  String(reportDocText.length) + ' 字符');
const chips = await evalJs('document.querySelector("header").innerText');
check('头部遥测显示调用与回放次数', chips.indexOf('调用') >= 0 && chips.indexOf('回放') >= 0 && chips.indexOf('追问') >= 0, chips.replace(/\n/g, ' / ').slice(0, 120));
await shot('03-done.png');

const contractBadge = await evalJs('(() => { const b = document.querySelector(String.fromCharCode(91) + "data-shot=" + String.fromCharCode(34) + "contract-toggle" + String.fromCharCode(34) + String.fromCharCode(93) + ""); b.click(); return b.textContent; })()');
const badgeText = await waitFor(async () => { const t = await bodyText(); return t.indexOf('与运行时一致') >= 0 ? t : ''; }, '契约对账徽章', 8000);
check('跑完后契约能与运行时对账', badgeText.indexOf('与运行时一致') >= 0, String(contractBadge).slice(0, 30));
await evalJs('(() => { const b = document.querySelector(String.fromCharCode(91) + "data-shot=" + String.fromCharCode(34) + "contract-prompt" + String.fromCharCode(34) + String.fromCharCode(93) + ""); if (b) b.click(); return "ok"; })()');
const promptText = await waitFor(async () => { const t = await evalJs('(() => { const pre = document.querySelector(String.fromCharCode(91) + "data-shot=" + String.fromCharCode(34) + "contracts" + String.fromCharCode(34) + String.fromCharCode(93) + " pre"); return pre === null ? "" : pre.innerText; })()'); return t.length > 200 ? t : ''; }, 'System Prompt 正文', 8000);
check('能展开这位面试官实际拿到的 System Prompt', promptText.indexOf('## 追问预算') >= 0, String(promptText.length) + ' 字');

await clickText('清空');
await sleep(500);
const clearedLen = await evalJs('document.querySelectorAll("textarea")[0].value.length');
const clearedDisabled = await evalJs('document.querySelector(String.fromCharCode(91) + "data-shot=" + String.fromCharCode(34) + "run" + String.fromCharCode(34) + String.fromCharCode(93) + "").disabled');
const clearedCards = await countCards();
check('清空把简历与棋盘都收回空状态', clearedLen === 0 && clearedDisabled === true && clearedCards === 0, '简历 ' + String(clearedLen) + ' 字 / 灰 ' + String(clearedDisabled) + ' / 卡片 ' + String(clearedCards));

const historyText = await evalJs('document.querySelector(String.fromCharCode(91) + "data-shot=" + String.fromCharCode(34) + "intake" + String.fromCharCode(34) + String.fromCharCode(93) + "").innerText');
check('历史会话列出刚才两场', historyText.indexOf('高级后端工程师（Node.js） · 演示简历') >= 0 && historyText.indexOf('已完成') >= 0 && historyText.indexOf('失败') >= 0, historyText.replace(/\n/g, ' / ').slice(-160));
const clicked = await evalJs('(() => { const btns = Array.from(document.querySelectorAll(String.fromCharCode(91) + "data-shot=" + String.fromCharCode(34) + "intake" + String.fromCharCode(34) + String.fromCharCode(93) + " button")); const b = btns.find((x) => (x.textContent || "").indexOf("演示简历") >= 0); if (!b) return "没找到"; b.click(); return "ok"; })()');
check('点历史里的那一条能载回来', clicked === 'ok', String(clicked));
const loaded = await waitText('置信度', 15000);
const loadedCards = await countCards();
const resumeLen = await evalJs('(() => { const p = document.querySelector(String.fromCharCode(91) + "data-shot=" + String.fromCharCode(34) + "resume" + String.fromCharCode(34) + String.fromCharCode(93) + ""); return p === null ? -1 : p.innerText.length; })()');
check('载回来后棋盘与简历原文都回来了', loadedCards === 5 && resumeLen > 100, '卡片 ' + String(loadedCards) + ' / 原文 ' + String(resumeLen) + ' 字');
await shot('04-history-loaded.png');

const before = (await sessions()).length;
await evalJs('(() => { const bs = Array.from(document.querySelectorAll("button[title=" + String.fromCharCode(34) + "删除这一场" + String.fromCharCode(34) + "]")); bs[0].click(); return bs.length; })()');
const afterOne = await waitSessionsBelow(before - 1, 10000);
check('点 × 能删掉一场', afterOne.length === before - 1, String(before) + ' → ' + String(afterOne.length));
const delCount = () => evalJs('document.querySelectorAll("button[title=" + String.fromCharCode(34) + "删除这一场" + String.fromCharCode(34) + "]").length');
for (let i = 0; i < 6; i += 1) {
  const beforeRows = await delCount();
  if (beforeRows === 0) break;
  await evalJs('(() => { const bs = Array.from(document.querySelectorAll("button[title=" + String.fromCharCode(34) + "删除这一场" + String.fromCharCode(34) + "]")); if (bs.length > 0) bs[0].click(); return bs.length; })()');
  await waitFor(async () => { const n = await delCount(); return n < beforeRows ? 'ok' : ''; }, '列表少一行', 8000);
}
const finalList = await sessions();
check('可以把历史清空', finalList.length === 0, String(finalList.length) + ' 场');

const problems = [];
for (const e of events) {
  if (e.method === 'Runtime.exceptionThrown') problems.push('异常：' + JSON.stringify(e.params.exceptionDetails.text));
  if (e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'warning')) problems.push(e.params.type + '：' + e.params.args.map((a) => a.value || a.description || a.type).join(' '));
  if (e.method === 'Log.entryAdded' && (e.params.entry.level === 'error' || e.params.entry.level === 'warning')) problems.push('日志 ' + e.params.entry.level + '：' + e.params.entry.text);
  if (e.method === 'Network.responseReceived' && e.params.response.status >= 400) problems.push('HTTP ' + String(e.params.response.status) + '：' + e.params.response.url);
}
check('整轮下来浏览器控制台没有报错或警告', problems.length === 0, problems.slice(0, 4).join(' | '));

cleanup();
await sleep(600);
writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ results, serverLog: serverLog.slice(-1500) }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log('--- ' + String(results.length - failed.length) + '/' + String(results.length) + ' 项通过 ---');
process.exit(failed.length === 0 ? 0 : 1);
