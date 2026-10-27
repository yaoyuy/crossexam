/**
 * CrossExam 界面点测：真的开一个无头浏览器，把界面上的每一项功能点一遍。
 *
 * 与 tools/smoke 的分工：smoke 只打 HTTP 接口（不碰界面），这个脚本只点界面。
 * 与 tools/ui-shots 的分工：那个负责出图给人看，这个负责断言，红了就退出码 1。
 *
 * 零依赖：只用 Node 自带的 fetch / WebSocket 与系统里的 Edge（或 Chrome）。
 */import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
// Windows 上 proc.kill() 只结束启动器，Edge 的进程树还活着。残留的浏览器会继续占着 CDP
// 端口，下一轮就悄悄连到它——而它的 profile 里「教程看过了」之类的状态会让断言假失败
// （真的踩过：9344 端口上挂着两个旧浏览器，于是「首次打开自动弹教程」必然失败）。
function killTree(proc) {
  if (proc === null || proc.pid === undefined) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    else proc.kill('SIGKILL');
  } catch (error) { /* 已经退出了 */ }
}
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  killTree(edgeProc);
  killTree(serverProc);
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
// 点测不该受本机是否配了模型影响：显式抹掉 LLM_*，让「还没配置联网」这条分支稳定可复现。
for (const key of Object.keys(env)) {
  if (key.indexOf('LLM_') === 0) delete env[key];
}
// 测试库必须每轮清空。自定义面试官存在一张**全局**表里，跨轮残留会让「这一轮多了一位」
// 这类断言失真：第一轮 76/76，第二轮就变成 74/76，而代码一行没改。
rmSync('.tmp/e2e/db', { recursive: true, force: true });
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
// 起浏览器之前必须确认调试端口是空的：占用它的大概率是上一轮没杀干净的浏览器，
// 连上去就等于拿别人的 profile 做断言（教程状态、历史会话都不是这一轮的）。
let cdpBusy = false;
try { const busy = await fetch('http://127.0.0.1:' + String(CDP_PORT) + '/json/version'); cdpBusy = busy.ok; } catch (e) { /* 期望是空的 */ }
if (cdpBusy) {
  console.log('调试端口 ' + String(CDP_PORT) + ' 已被占用：多半是上一轮留下的浏览器进程。');
  console.log('先清掉再重跑：taskkill /F /IM msedge.exe');
  process.exit(1);
}
edgeProc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + String(CDP_PORT), '--user-data-dir=' + PROFILE, 'about:blank'], { stdio: 'ignore' });
let version = null;
for (let i = 0; i < 80; i += 1) {
  try { const r = await fetch('http://127.0.0.1:' + String(CDP_PORT) + '/json/version'); if (r.ok) { version = await r.json(); break; } } catch (e) { /* 等 */ }
  await sleep(300);
}
check('无头浏览器开出调试端口', version !== null, version ? version['Browser'] : '超时');
const list = await (await fetch('http://127.0.0.1:' + String(CDP_PORT) + '/json/list')).json();
const pageTarget = list.find((t) => t.type === 'page' && t.url === 'about:blank');
if (pageTarget === undefined) {
  const stranger = list.find((t) => t.type === 'page');
  console.log('调试端口上没有刚启动的空窗口' + (stranger === undefined ? '' : '（当前页面：' + String(stranger.url) + '）') + '。');
  process.exit(1);
}
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let nextId = 0;
const pending = new Map();
const events = [];
// 记一下每个请求的方法：光看 404 的 URL 分不清是 GET 还是 DELETE，
// 排查「谁在请求一个已经不存在的会话」时这一条信息就是全部差别。
const requestMethods = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Network.requestWillBeSent' && msg.params !== undefined) {
    requestMethods.set(msg.params.requestId, msg.params.request.method);
  }
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
// 收尾要真的把浏览器关掉：proc.kill() 在 Windows 上只结束启动器，Edge 的浏览器进程会
// 活下来并继续占着调试端口，下一轮就可能连到它（它的 profile 里已经有 localStorage，
// 教程状态、历史会话都不是这一次运行的了）。CDP 的 Browser.close 才是「关掉这个浏览器」
// 的正解，taskkill /T /F 只当兜底。
async function closeBrowser(port) {
  try {
    const response = await fetch('http://127.0.0.1:' + String(port) + '/json/version');
    if (!response.ok) return false;
    const info = await response.json();
    if (typeof info.webSocketDebuggerUrl !== 'string') return false;
    const socket = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((done) => {
      const timer = setTimeout(done, 5000);
      socket.addEventListener('open', () => { clearTimeout(timer); done(); });
      socket.addEventListener('error', () => { clearTimeout(timer); done(); });
    });
    socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await sleep(800);
    try { socket.close(); } catch (error) { /* 已经关了 */ }
    return true;
  } catch (error) {
    return false;
  }
}

// 关完再确认一次：端口还占着就明确说出来，绝不让下一轮静默连到别人。
async function warnIfPortBusy(port) {
  try {
    const response = await fetch('http://127.0.0.1:' + String(port) + '/json/version');
    if (response.ok) {
      console.log('警告：调试端口 ' + String(port) + ' 仍被占用，残留的浏览器会干扰下一轮。');
      console.log('  找占用者：Get-NetTCPConnection -LocalPort ' + String(port) + ' -State Listen');
    }
  } catch (error) { /* 端口是空的，正常 */ }
}
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
// 把锚点换算成界面上的「第 12–28 字」：口径与 packages/web/src/highlight.ts:102 的 describeRange 一致，
// 断言里就不要再手写数字了（数字一改，测试跟着错）。
function describeRangeOf(claim) {
  if (claim === undefined || claim === null || claim.anchor === null || claim.anchor === undefined) return "";
  return "第 " + String(claim.anchor.start + 1) + "\u2013" + String(claim.anchor.end) + " 字";
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
/** 按 data-shot 填一个输入框：JD 列表里的行会增删，靠下标找 textarea 不稳 */
async function setShot(name, text) {
  const expr = '(() => { const el = document.querySelector(\'[data-shot="\' + ' + JSON.stringify(name) + ' + \'"]\'); if (el === null) return -1; const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, "value").set; setter.call(el, ' + JSON.stringify(text) + '); el.dispatchEvent(new Event("input", { bubbles: true })); return el.value.length; })()';
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

// 整段点测包在 try 里：任何一步抛错（等待超时、页面抛错）都要先把浏览器关掉、把端口让出来。
// 否则进程留在调试端口上，下一轮会直接连到它——它的 localStorage 里已经有「教程看过了」，
// 断言会从「产品坏了」变成「连错浏览器了」，最难查的那一类假失败。
try {
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

// 新手教程：这份浏览器 profile 是本次新建的，所以第一次打开必然自动弹一次。
// 按内容断言，而不是只断言「有个弹层」——教程的价值就在那几句话里。
const firstHelp = await bodyText();
check('第一次打开自动弹出新手教程', firstHelp.indexOf('新手教程') >= 0 && firstHelp.indexOf('四步用起来') >= 0, '');
check('教程里讲了三种模式的区别', firstHelp.indexOf('离线回放') >= 0 && firstHelp.indexOf('联网录制') >= 0 && firstHelp.indexOf('联网直连') >= 0, '');
check('教程里写明隐私口径（只在联网时才发给模型服务商）', firstHelp.indexOf('模型服务商') >= 0 && firstHelp.indexOf('SQLite') >= 0, '');
await evalJs("document.querySelector('[data-shot=\"help-close\"]').click()");
await sleep(250);
const helpGone = await evalJs("document.querySelector('[data-shot=\"help\"]') === null");
check('点「知道了，开始用」教程收起', helpGone === true, String(helpGone));

// 配色：默认深色，点一下变浅色并记住选择。颜色全靠 CSS 变量，
// 所以这里断言的是 html 上的 data-theme 与存储，而不是去比对某个元素的颜色值。
const themeBefore = await evalJs('document.documentElement.dataset.theme');
await evalJs("document.querySelector('[data-shot=\"theme\"]').click()");
await sleep(200);
const themeAfter = await evalJs('document.documentElement.dataset.theme');
const themeStored = await evalJs("localStorage.getItem('crossexam.theme')");
check('配色能在深色与浅色之间切换，并记住选择', themeBefore === 'dark' && themeAfter === 'light' && themeStored === 'light', String(themeBefore) + ' → ' + String(themeAfter) + ' / 存了 ' + String(themeStored));
await evalJs("document.querySelector('[data-shot=\"theme\"]').click()");
await sleep(200);
const themeBack = await evalJs('document.documentElement.dataset.theme');
check('再点一下切回深色', themeBack === 'dark', String(themeBack));

// 简历导入：在页面里现造一个文本文件塞进 input，把「上传 → 解析 → 填进输入框」整条链路点一遍。
// 用页面内的 DataTransfer 造文件，避免为了一次点测去依赖 CDP 的 DOM.setFileInputFiles。
const IMPORT_TEXT = '导入的自建简历\n数据工程师 · 成都\n- 负责过 12 个业务线的报表。';
const importScript = [
  '(function () {',
  '  var input = document.querySelector("[data-shot=import-file]");',
  '  if (input === null) return "no-input";',
  '  var dt = new DataTransfer();',
  '  dt.items.add(new File([' + JSON.stringify(IMPORT_TEXT) + '], "resume-import.txt", { type: "text/plain" }));',
  '  input.files = dt.files;',
  '  input.dispatchEvent(new Event("change", { bubbles: true }));',
  '  return "ok";',
  '})()',
].join('\n');
const importState = await evalJs(importScript);
let importedValue = '';
for (let i = 0; i < 25; i += 1) {
  importedValue = await evalJs('document.querySelectorAll("textarea")[0].value');
  if (importedValue.length > 0) break;
  await sleep(200);
}
const importNote = await evalJs('(document.querySelector("[data-shot=import-note]") || { textContent: "" }).textContent');
check('从文件导入简历：解析后直接填进输入框', importState === 'ok' && importedValue === IMPORT_TEXT, String(importState) + ' / ' + String(importedValue.length) + ' 字');
check('导入结果写明文件类型与字数', importNote.indexOf('解析出') >= 0 && importNote.indexOf('文本') >= 0, importNote.slice(0, 60));

// 运行模式与模型：默认离线回放（不联网），切到联网才出现模型输入框，并向后端要一次清单。
const modeChips = await evalJs('(() => { const pick = (n) => document.querySelector("[data-shot=" + n + "]") !== null; return [pick("mode-replay"), pick("mode-live"), pick("mode-record")].join(","); })()');
check('投料台给出三种运行模式', modeChips === 'true,true,true', String(modeChips));
const replayNote = await evalJs('(document.querySelector("[data-shot=mode-note]") || { textContent: "" }).textContent');
const modelHidden = await evalJs('document.querySelector("[data-shot=model-input]") === null');
check('默认离线回放：写明不联网，也不显示模型输入框', replayNote.indexOf('不联网') >= 0 && modelHidden === true, replayNote.slice(0, 40) + ' / ' + String(modelHidden));
await evalJs('document.querySelector("[data-shot=mode-live]").click()');
let liveNote = '';
for (let i = 0; i < 30; i += 1) {
  liveNote = await evalJs('(document.querySelector("[data-shot=mode-note]") || { textContent: "" }).textContent');
  const hasInput = await evalJs('document.querySelector("[data-shot=model-input]") !== null');
  // 中途会先显示「正在向后端要模型清单…」，要等它换成结论再断言，否则断言的是那句过程提示。
  if (hasInput === true && liveNote.length > 0 && liveNote.indexOf('正在向后端要') < 0) break;
  await sleep(200);
}
check('切到联网后出现模型输入框并给出结论', liveNote.length > 0, liveNote.slice(0, 50));
check('没配置联网时明说缺哪个环境变量，而不是静默失败', liveNote.indexOf('LLM_') >= 0, liveNote.slice(0, 60));
await evalJs('document.querySelector("[data-shot=mode-replay]").click()');
await sleep(300);
const backNote = await evalJs('(document.querySelector("[data-shot=mode-note]") || { textContent: "" }).textContent');
const modelHiddenAgain = await evalJs('document.querySelector("[data-shot=model-input]") === null');
check('切回离线回放后模型输入框收起', backNote.indexOf('不联网') >= 0 && modelHiddenAgain === true, backNote.slice(0, 30));

// 追问强度：三档只有预算不同，但预算写进了契约、也写进了提示词指纹。
// 这条场景要证明的是「换档 = 换契约」，不是「换了个界面装饰」：
// 展开的契约卡片里的数字与指纹都必须跟着变——不然卡带就不用按档位分开录，那才是产品在骗人。
const diffChips = await evalJs('(() => { const pick = (n) => document.querySelector("[data-shot=" + n + "]") !== null; return [pick("difficulty-gentle"), pick("difficulty-normal"), pick("difficulty-hard")].join(","); })()');
check('投料台给出三档追问强度', diffChips === 'true,true,true', String(diffChips));
const noteOf = () => evalJs('(document.querySelector("[data-shot=difficulty-note]") || { textContent: "" }).textContent');
const normalNote = await noteOf();
check('默认是常规档，并把这一档的预算说成人话', normalNote.indexOf('最多 3 轮') >= 0, normalNote.slice(0, 50));
// 契约卡片的正文在按钮的父节点里，指纹与预算都在展开后的 dl 里。
const cardText = () => evalJs('(function () { var b = document.querySelector("[data-shot=contract-toggle]"); return b === null ? "" : String(b.parentElement.innerText); })()');
const digestOf = (text) => { const hit = /指纹 ([0-9a-f]{8})/.exec(String(text)); return hit === null ? '' : hit[1]; };
const budgetOf = (text) => {
  const hit = /每主张最多 ([0-9]+) 轮追问 · 每人每主张最多 ([0-9]+) 次 · 全场最多 ([0-9]+) 次/.exec(String(text));
  return hit === null ? '' : hit[1] + '/' + hit[2] + '/' + hit[3];
};
await evalJs('(function () { var b = document.querySelector("[data-shot=contract-toggle]"); if (b !== null) b.click(); return "ok"; })()');
await sleep(300);
const cardBefore = await cardText();
check('展开契约能看到这一档的预算与指纹', budgetOf(cardBefore) === '3/2/60' && digestOf(cardBefore).length === 8, budgetOf(cardBefore) + ' / ' + digestOf(cardBefore));
await evalJs('document.querySelector("[data-shot=difficulty-hard]").click()');
const hardCard = await waitFor(async () => { const text = await cardText(); return budgetOf(text) === '4/2/80' ? text : ''; }, '契约跟着换档', 8000);
const hardNote = await noteOf();
check('切到挑刺档：契约里的预算从 3/2/60 变成 4/2/80', budgetOf(hardCard) === '4/2/80' && hardNote.indexOf('最多 4 轮') >= 0, budgetOf(hardCard) + ' / ' + hardNote.slice(0, 20));
check('换档真的换了指纹（所以卡带要按档位分开录）', digestOf(hardCard).length === 8 && digestOf(hardCard) !== digestOf(cardBefore), digestOf(cardBefore) + ' → ' + digestOf(hardCard));
await evalJs('document.querySelector("[data-shot=difficulty-gentle]").click()');
const gentleCard = await waitFor(async () => { const text = await cardText(); return budgetOf(text) === '2/1/40' ? text : ''; }, '温和档的契约', 8000);
check('温和档连「每人每主张几次」都更小（1 次）', budgetOf(gentleCard) === '2/1/40', budgetOf(gentleCard));
await evalJs('document.querySelector("[data-shot=difficulty-normal]").click()');
const backCard = await waitFor(async () => { const text = await cardText(); return budgetOf(text) === '3/2/60' ? text : ''; }, '回到常规档', 8000);
check('切回常规档：预算与指纹都回到原样', budgetOf(backCard) === '3/2/60' && digestOf(backCard) === digestOf(cardBefore), budgetOf(backCard) + ' / ' + digestOf(backCard));
await evalJs('(function () { var b = document.querySelector("[data-shot=contract-toggle]"); if (b !== null) b.click(); return "ok"; })()');
await sleep(200);

// 改写风格：三档只调「改得多狠」，所以它**不该**动契约指纹——
// 这一条正是与追问强度的对照实验：那边换档指纹必须变，这边换档指纹必须不变。
const styleChips = await evalJs('(() => { const pick = (n) => document.querySelector("[data-shot=" + n + "]") !== null; return [pick("style-conservative"), pick("style-normal"), pick("style-bold")].join(","); })()');
check('投料台给出三档改写风格', styleChips === 'true,true,true', String(styleChips));
const styleNoteOf = () => evalJs('(document.querySelector("[data-shot=style-note]") || { textContent: "" }).textContent');
const normalStyleNote = await styleNoteOf();
check('默认常规档，并把这一档的改法说成人话', normalStyleNote.indexOf('该收敛的收敛') >= 0, normalStyleNote.slice(0, 40));
await evalJs('document.querySelector("[data-shot=style-bold]").click()');
await sleep(300);
const boldStyleNote = await styleNoteOf();
check('切到敢改档，说明换成另一句话', boldStyleNote.indexOf('不新增任何事实') >= 0, boldStyleNote.slice(0, 40));
await evalJs('(function () { var b = document.querySelector("[data-shot=contract-toggle]"); if (b !== null) b.click(); return "ok"; })()');
await sleep(300);
const styleCard = await cardText();
check('换改写风格不改契约指纹（与追问强度相反，它不属于契约）', digestOf(styleCard) === digestOf(backCard), digestOf(backCard) + ' → ' + digestOf(styleCard));
await evalJs('(function () { var b = document.querySelector("[data-shot=contract-toggle]"); if (b !== null) b.click(); return "ok"; })()');
await evalJs('document.querySelector("[data-shot=style-normal]").click()');
await sleep(300);

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

// 面试官工作室：这是「所有专业都能用」那条要求最直接的验收点。
// 走「只用本地规则」这条路，因为它不联网、确定性强，而且正好证明没有 API Key 也能配出面试官。
const studioOpened = await evalJs('(() => { const b = document.querySelector("[data-shot=open-studio]"); if (b === null) return "no-button"; b.click(); return "ok"; })()');
check('投料台有「配置面试官」入口', studioOpened === 'ok', String(studioOpened));
const studioVisible = await waitFor(async () => { const t = await bodyText(); return t.indexOf('面试官工作室') >= 0 ? t : ''; }, '工作室弹层', 8000);
check('工作室打开后讲清它与内置面试官的关系', studioVisible.indexOf('共用同一套契约结构') >= 0, '');
// 点了以后要等 React 把 state 刷进 DOM：点完立刻读 value 读到的是空串，
// 断言就变成在测「React 有多快」而不是在测「例子填进来了没有」。
const seedClicked = await evalJs('(() => { const b = document.querySelector("[data-shot=" + JSON.stringify("studio-seed-医护") + "]"); if (b === null) return "no-seed"; b.click(); return "ok"; })()');
const seedPicked = await waitFor(async () => {
  const value = await evalJs('(() => { const e = document.querySelector("[data-shot=studio-desc]"); return e === null ? "" : e.value; })()');
  return value.length > 0 ? value : '';
}, '医护例子填进描述框', 8000);
// 断言的是「例子真的是一份完整的岗位描述」，不是「按钮被点到了」：
// 按例子正文里的关键词认（种子标签叫「医护」，正文写的是「临床护士」）。
check('工作室提供非计算机行业的现成例子（医护）', seedClicked === 'ok' && seedPicked.indexOf('临床护士') >= 0, String(seedClicked) + ' / ' + seedPicked.slice(0, 30));
await evalJs('document.querySelector("[data-shot=studio-local]").click()');
const draftReady = await waitFor(async () => {
  const name = await evalJs('document.querySelector("[data-shot=studio-name]").value');
  return name.length > 0 ? name : '';
}, '本地规则生成草稿', 15000);
check('不用联网也能把一句话补成结构化契约', draftReady.indexOf('面试官') >= 0, String(draftReady));
const draftFields = await evalJs('(() => { const pick = (n) => { const e = document.querySelector("[data-shot=" + n + "]"); return e === null ? "" : e.value; }; return { goal: pick("studio-goal"), blurb: pick("studio-blurb"), tactics: Array.from(document.querySelectorAll("[data-shot^=studio-tactic-]")).map((e) => e.value).filter((v) => v.length > 0).length }; })()');
check('草稿把目标、简介与追问手法都填上了', String(draftFields.goal).length >= 8 && String(draftFields.blurb).length >= 4 && draftFields.tactics >= 2, JSON.stringify(draftFields).slice(0, 120));
const promptShown = await evalJs('(() => { const b = document.querySelector("[data-shot=studio-prompt-toggle]"); if (b === null) return "no-toggle"; b.click(); return "ok"; })()');
const promptBody = await waitFor(async () => { const t = await evalJs('(() => { const pre = document.querySelector("[data-shot=studio-prompt]"); return pre === null ? "" : pre.innerText; })()'); return t.length > 200 ? t : ''; }, '工作室里的 System Prompt', 8000);
check('能看到这份自定义契约渲染出的 System Prompt', promptShown === 'ok' && promptBody.indexOf('## 追问预算') >= 0, String(promptBody.length) + ' 字');
const saved = await evalJs('(() => { const b = document.querySelector("[data-shot=studio-save]"); if (b === null) return "no-save"; if (b.disabled) return "disabled"; b.click(); return "ok"; })()');
const savedNote = await waitFor(async () => { const t = await evalJs('(document.querySelector("[data-shot=studio-note]") || { textContent: "" }).textContent'); return t.indexOf('已保存') >= 0 ? t : ''; }, '保存成功提示', 15000);
check('自定义面试官能存进库', saved === 'ok' && savedNote.length > 0, savedNote.slice(0, 60));
await evalJs('document.querySelector("[data-shot=studio-close]").click()');
await sleep(400);
const customChip = await waitFor(async () => { const n = await evalJs('document.querySelectorAll("[data-shot^=role-custom-]").length'); return n > 0 ? String(n) : ''; }, '面板出现自建面试官', 8000);
check('存下来的自定义面试官出现在面板里', customChip !== '', customChip + ' 位');
const customToggled = await evalJs('(() => { const b = document.querySelector("[data-shot^=role-custom-]"); if (b === null) return "no-chip"; b.click(); return "ok"; })()');
const contractFive = await waitFor(async () => { const n = await evalJs('document.querySelectorAll("[data-shot=contract-toggle]").length'); return n === 4 ? '4' : ''; }, '自定义面试官的契约', 8000);
check('自建面试官进面板后契约跟着多一条', customToggled === 'ok' && contractFive === '4', contractFive);
await evalJs('(() => { const b = document.querySelector("[data-shot^=role-custom-]"); if (b !== null) b.click(); return "ok"; })()');
await sleep(400);

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
// 「等到出现」不等于「等到到齐」：waitText 抓的是第一次出现「置信度」的那一刻，
// 那时 5 条判定可能才到了 4 条。要按最终画面数，就得等它涨到服务端的条数。
const drawn = await waitFor(async () => {
  const text = await evalJs('document.body.innerText');
  const n = String(text).split('置信度').length - 1;
  return n >= view.verdicts.length ? String(n) : '';
}, '判定条数到齐', 20000);
check('界面画出的判定条数与服务端一致', drawn === String(view.verdicts.length), '界面 ' + String(drawn) + ' / 服务端 ' + String(view.verdicts.length));
// 每条判定都要写清「为什么这样判」：判据是固定文案，模型的解释只是措辞。
const whyLines = await evalJs('(document.body.innerText.match(/为什么这样判：/g) || []).length');
check('每条判定都写了判定口径', whyLines === view.verdicts.length, String(whyLines) + ' 条 / 判定 ' + String(view.verdicts.length) + ' 条');
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

// P8：多 JD 驱动之后，一条追问可能同时挂两处锚（简历原文 + 岗位要求原文）。
// 这一段必须落在「清空」之前：那时 demo 场次还开着，要求与对照都还在。
const reqPaneText = await evalJs('(() => { const el = document.querySelector("[data-shot=requirements]"); return el === null ? "" : el.innerText; })()');
check('中栏多出「岗位要求对照」这一栏', reqPaneText.indexOf('岗位要求对照') >= 0 && view.requirements.length > 0, String(view.requirements.length) + ' 条要求');
const reqCards = await evalJs('Array.from(document.querySelectorAll("[data-shot]")).filter((e) => /^req-[A-Z][0-9]+$/.test(String(e.getAttribute("data-shot")))).length');
const reqReasons = await evalJs('(document.body.innerText.match(/为什么这么判：/g) || []).length');
check('每条要求一张卡，且都写了为什么这么判', reqCards === view.requirements.length && reqReasons === view.requirements.length, String(reqCards) + ' 张 / ' + String(reqReasons) + ' 条理由');
const reqGroups = await evalJs('document.querySelectorAll("[data-shot^=req-group-]").length');
check('对照结果按「答得上 / 答得含糊 / 简历里没写」分组', reqGroups >= 1 && reqGroups <= 3, String(reqGroups) + ' 组');
const anchoredProbes = view.probes.filter((probe) => probe.requirementId != null && probe.jdAnchor != null);
const jdAnchorTags = await evalJs('document.querySelectorAll("[data-shot^=jd-anchor-]").length');
check('照着岗位要求追问的那几条，在卡片上标出了要求原文', anchoredProbes.length > 0 && jdAnchorTags === anchoredProbes.length, String(jdAnchorTags) + ' 处 / 服务端 ' + String(anchoredProbes.length) + ' 处');
const jdPaneBrief = await evalJs('(() => { const el = document.querySelector("[data-shot=jd]"); return el === null ? "" : el.innerText; })()');
check('右栏并排画出岗位要求原文与抽出的要求条数', jdPaneBrief.indexOf('岗位要求原文') >= 0 && jdPaneBrief.indexOf('条要求') >= 0, jdPaneBrief.split('\n').join(' / ').slice(0, 70));
const firstReq = view.requirements[0];
// 表达式要在 Node 这侧拼好再送进页面：firstReq 是 Node 的变量，页面里没有它
const quoteBtn = 'req-quote-' + firstReq.id;
const quoteClicked = await evalJs('(() => { const b = document.querySelector("[data-shot=" + ' + JSON.stringify(quoteBtn) + ' + "]"); if (b === null) return "no-button"; b.click(); return "ok"; })()');
const jdFocused = await waitFor(async () => { const t = await evalJs('(() => { const el = document.querySelector("[data-shot=jd]"); return el === null ? "" : el.innerText; })()'); return t.indexOf('聚焦') >= 0 ? t : ''; }, '岗位要求原文聚焦', 8000);
const jdMarkText = await evalJs('(() => { const m = document.querySelector("[data-shot=jd] mark.anchor-hit"); return m === null ? "" : m.innerText; })()');
const wantRange = '第 ' + String(firstReq.anchor.start + 1) + '\u2013' + String(firstReq.anchor.end) + ' 字';
check('点要求能跳到 JD 原文那一段并把它标出来',
  quoteClicked === 'ok' && jdFocused.indexOf(wantRange) >= 0 && String(jdMarkText).split(/\s+/).join('') === String(firstReq.anchor.quote).split(/\s+/).join(''),
  wantRange + ' / ' + String(jdMarkText).length + ' 字');

// P10 · A3：按类别看短板。同一份判定的另一种摆法——界面要能直接读出结论与最该补的几处，
// 而且条数必须与服务端算出来的一致（报告与界面共用 shared/shortfall.ts，不许各排一遍）。
const shortfallPane = await evalJs('(() => { const el = document.querySelector("[data-shot=shortfall]"); return el === null ? "" : el.innerText; })()');
check('过程面板多出「按类别看短板」并给出结论',
  shortfallPane.indexOf('按类别看短板') >= 0 && shortfallPane.indexOf('欠证据') >= 0,
  shortfallPane.split('\n').join(' / ').slice(0, 80));
const shortfallCats = await evalJs('document.querySelectorAll("[data-shot^=shortfall-cat-]").length');
const judgedCats = new Set(view.claims.filter((claim) => claim.verdict !== null).map((claim) => claim.category)).size;
check('按类别分组，组数等于判定过的类别数',
  shortfallCats === judgedCats,
  String(shortfallCats) + ' 组 / 服务端 ' + String(judgedCats) + ' 个类别');
const weakClaims = view.claims.filter((claim) => claim.verdict !== null && claim.verdict !== 'solid');
const weakButtons = await evalJs('Array.from(document.querySelectorAll("[data-shot]")).filter((e) => /^shortfall-C[0-9]+$/.test(String(e.getAttribute("data-shot")))).length');
check('最该补的名单条数等于服务端算出的短板数（上限 3）',
  weakClaims.length > 0 && weakButtons === Math.min(weakClaims.length, 3),
  String(weakButtons) + ' 条 / 服务端 ' + String(weakClaims.length) + ' 条短板');
// 名单只有前 3 条，服务端顺序里的第一条短板未必在榜上（它可能正是被上限挡掉的那条）——
// 所以要先从页面上取一个真实存在的按钮，再据此查回主张与它应该聚焦的区间。
const firstWeakShot = await evalJs('(() => { const b = Array.from(document.querySelectorAll("[data-shot]")).find((e) => /^shortfall-C[0-9]+$/.test(String(e.getAttribute("data-shot")))); return b === null ? "" : String(b.getAttribute("data-shot")); })()');
const firstWeak = view.claims.filter((claim) => 'shortfall-' + claim.id === firstWeakShot)[0];
const weakRange = describeRangeOf(firstWeak);
check('名单上的第一条能在主张里找回原文区间', firstWeak !== undefined && weakRange.length > 0, firstWeakShot + ' → ' + weakRange);
const clickWeak = '(() => { const b = document.querySelector("[data-shot=' + firstWeakShot + ']"); if (b !== null) b.click(); })()';
await evalJs(clickWeak);
const resumeFocused = await waitFor(async () => { const t = await evalJs('document.querySelector("[data-shot=resume]").innerText'); return t.indexOf('聚焦') >= 0 ? t : ''; }, '简历聚焦到短板主张', 8000);
check('点短板名单里的主张，右栏简历跳到它的原文位置',
  resumeFocused.indexOf('聚焦') >= 0 && resumeFocused.indexOf(weakRange) >= 0,
  resumeFocused.split('\n').slice(0, 2).join(' / ').slice(0, 70));


// P10 · A4：轮到你了。反问是「锦上添花」的一节——有材料才生成，每句都必须带原文依据，
// 而且必须写清楚回答是沙盘模拟的，不是真 HR 在答。
const counterPane = await evalJs('(() => { const el = document.querySelector("[data-shot=counters]"); return el === null ? "" : el.innerText; })()');
check('中栏多出「轮到你了（可以反问）」这一栏', counterPane.indexOf('轮到你了') >= 0 && view.counters.length > 0, String(view.counters.length) + ' 句');
const counterCards = await evalJs('document.querySelectorAll("[data-shot^=counter-quote-]").length');
check('每句反问一张卡：带依据原文、写明为什么值得问，并说清回答是模拟的',
  counterCards === view.counters.length && counterPane.indexOf('沙盘模拟') >= 0 && counterPane.indexOf('为什么值得问') >= 0,
  String(counterCards) + ' 句 / 服务端 ' + String(view.counters.length) + ' 句');
const jdSourced = view.counters.filter((item) => item.source === 'jd');
const resumeSourced = view.counters.filter((item) => item.source === 'resume');
check('两种依据都标出来源，一条都不含糊',
  jdSourced.length + resumeSourced.length === view.counters.length &&
    (jdSourced.length === 0 || counterPane.indexOf('依据岗位要求') >= 0) &&
    (resumeSourced.length === 0 || counterPane.indexOf('依据简历原话') >= 0),
  String(jdSourced.length) + ' 句来自岗位要求 / ' + String(resumeSourced.length) + ' 句来自简历原话');
const rejectedBlock = await evalJs('document.querySelector("[data-shot=counter-rejected]") === null ? "no" : "yes"');
check('锚不回材料的句子不进正文，只在下面说明为什么被丢掉',
  (view.counterRejected.length === 0) === (rejectedBlock === 'no'),
  String(view.counterRejected.length) + ' 句被丢掉 / 界面 ' + rejectedBlock);
// 点引文要跳回那句依据所在的那一份原文（简历或 JD，取决于这句反问的依据来自哪里）
const resumeCounter = resumeSourced[0] ?? view.counters[0];
const counterShot = 'counter-quote-' + resumeCounter.id;
await evalJs('(() => { const b = document.querySelector("[data-shot=" + ' + JSON.stringify(counterShot) + ' + "]"); if (b !== null) b.click(); })()');
const counterRange = describeRangeOf(resumeCounter);
const counterPaneShot = resumeCounter.source === 'jd' ? 'jd' : 'resume';
const counterFocus = await waitFor(async () => { const t = await evalJs('document.querySelector("[data-shot=" + ' + JSON.stringify(counterPaneShot) + ' + "]").innerText'); return t.indexOf(counterRange) >= 0 ? t : ''; }, '原文聚焦到反问的依据', 8000);
check('点反问的引文，那一侧的原文跳到它的依据那一段', counterFocus.indexOf(counterRange) >= 0, counterPaneShot + ' → ' + counterRange);

// 第 8 项：勾选 → 确认采纳 → 简历被真的改掉 → 导出三件套 → 全部撤销退回原文。
// 这一段必须落在「清空」之前：那时 demo 场次还开着，5 条主张里有 4 条带改写建议。
// 断言分三层：界面上的勾选与结论、服务端真的改了、导出的文件里真有改动。
// C1：改完再跑一遍 -> 比上次。一场跑完右栏就有「比上次」这一栏，
// 第一场它说的是「这是第一版」；「改完再跑一遍」按钮只在真的采纳过之后才出现——
// 没改过简历就点它，等于把同一份简历跑两遍，比出来的「没变」毫无意义。
// 「这是第一版」这五个字是这一栏的副标题（Pane 的 subtitle），headline 里是那句解释，
// 所以这里读整栏的文字：两处都在这一栏里，分开读会把状态与说明割成两个断言。
const comparePane = await textOf('compare');
check('跑完一场，「比上次」就说清这是第一版', comparePane.indexOf('第一版') >= 0 && comparePane.indexOf('改完再跑一遍') >= 0, comparePane.replace(/\n/g, ' / ').slice(0, 70));
const rerunIdle = await hasShot('revision-rerun');
check('没改过简历时不给「改完再跑一遍」', rerunIdle === 'no', rerunIdle);
const revBar = await evalJs('(() => { const el = document.querySelector("[data-shot=revisions]"); return el === null ? "" : el.innerText; })()');
check('右栏有「采纳改写」这一栏', revBar.indexOf('采纳改写') >= 0, revBar.replace(/\n/g, ' / ').slice(0, 60));
const chooseCount = await evalJs('document.querySelectorAll("[data-shot^=choose-]").length');
check('每条有建议的主张都能勾选采纳', chooseCount === advised.length, String(chooseCount) + ' 个勾选框 / ' + String(advised.length) + ' 条建议');
await evalJs('document.querySelector("[data-shot=revision-accept-all]").click()');
await sleep(250);
const chosenBar = await evalJs('(() => { const el = document.querySelector("[data-shot=revisions]"); return el === null ? "" : el.innerText; })()');
check('「全部采纳」把建议一次勾上', chosenBar.indexOf('本次勾选 ' + String(advised.length)) >= 0, chosenBar.replace(/\n/g, ' / ').slice(0, 60));
await evalJs('document.querySelector("[data-shot=revision-submit]").click()');
const revisedNote = await waitFor(async () => { const t = await evalJs('(() => { const el = document.querySelector("[data-shot=revision-note]"); return el === null ? "" : el.innerText; })()'); return t.length > 0 ? t : ''; }, '采纳结论', 20000);
check('确认采纳后给出结论（改成了几处）', revisedNote.indexOf('已按这次勾选改好简历') >= 0, revisedNote.slice(0, 80));
const rerunReady = await hasShot('revision-rerun');
check('采纳之后才出现「改完再跑一遍」', rerunReady === 'yes', rerunReady);
const revisedResume = (await (await fetch('http://127.0.0.1:' + PORT + '/api/sessions/' + demoSession.id + '/revisions')).json()).revised;
check('服务端真的把简历改了（不是只在前端画一下）',
  revisedResume !== null && revisedResume.applied.length > 0 && revisedResume.text !== view.session.resumeText,
  revisedResume === null ? 'null' : String(revisedResume.applied.length) + ' 处 / ' + String(revisedResume.text.length) + ' 字');
const paneRevised = await evalJs('document.querySelector("[data-shot=resume]").innerText');
check('右栏换成改完的版本并标出改动', paneRevised.indexOf('改完的简历') >= 0 && paneRevised.indexOf('改动 ') >= 0, paneRevised.replace(/\n/g, ' / ').slice(0, 70));
const exportHrefs = await evalJs('(() => { const pick = (n) => { const a = document.querySelector("[data-shot=" + n + "]"); return a === null ? "" : a.getAttribute("href"); }; return { txt: pick("resume-txt"), pdf: pick("resume-pdf"), doc: pick("resume-doc") }; })()');
const resumeHref = (key) => String((exportHrefs ?? {})[key] ?? '');
check('改完之后才出现 txt / PDF / Word 三个导出入口',
  resumeHref('txt').indexOf('/resume.txt') >= 0 && resumeHref('pdf').indexOf('/resume.html?') >= 0 && resumeHref('doc').indexOf('/resume.doc') >= 0,
  JSON.stringify(exportHrefs));
const resumeTxt = await fetch('http://127.0.0.1:' + PORT + resumeHref('txt'));
const resumeTxtText = await resumeTxt.text();
check('导出的 txt 就是改完的那一版', resumeTxt.status === 200 && resumeTxtText === (revisedResume === null ? '' : revisedResume.text), String(resumeTxtText.length) + ' 字');
const resumeHtml = await fetch('http://127.0.0.1:' + PORT + resumeHref('pdf'));
const resumeHtmlText = await resumeHtml.text();
check('PDF 入口给的是带改动标记与打印脚本的可打印 HTML',
  resumeHtml.status === 200 && resumeHtmlText.indexOf('mark class') >= 0 && resumeHtmlText.indexOf('本版改了什么') >= 0 && resumeHtmlText.indexOf('window.print()') >= 0,
  String(resumeHtmlText.length) + ' 字符');
const resumeDoc = await fetch('http://127.0.0.1:' + PORT + resumeHref('doc'));
const resumeDocText = await resumeDoc.text();
check('简历的 Word 入口给的是 application/msword 附件',
  resumeDoc.status === 200 && String(resumeDoc.headers.get('content-type')).indexOf('msword') >= 0 && String(resumeDoc.headers.get('content-disposition')).indexOf('.doc') >= 0,
  String(resumeDocText.length) + ' 字符');
// B2：并排看改动。默认收起，展开后每条改动一行，左边原文右边改后。
const hasDiffBefore = await evalJs('document.querySelector("[data-shot=revision-diff]") === null');
check('并排对照默认收起，不占这一栏的地方', hasDiffBefore === true, String(hasDiffBefore));
await clickShot('revision-diff-toggle');
await sleep(250);
const diffRows = await evalJs('(() => { const t = document.querySelector("[data-shot=revision-diff]"); if (t === null) return -1; return t.querySelectorAll("tbody tr").length; })()');
const appliedCount = revisedResume === null ? -2 : revisedResume.applied.length;
check('展开后每条改动一行，改前改后并排', diffRows === appliedCount, String(diffRows) + ' 行 / ' + String(appliedCount) + ' 处改动');
const diffHead = await evalJs('(() => { const t = document.querySelector("[data-shot=revision-diff]"); if (t === null) return ""; return t.querySelector("thead").innerText; })()');
check('对照表两列写的是「原文」与「改后」', String(diffHead).indexOf('原文') >= 0 && String(diffHead).indexOf('改后') >= 0, String(diffHead).split(String.fromCharCode(10)).join(' '));
await clickShot('revision-diff-toggle');
await sleep(200);
const diffGone = await evalJs('document.querySelector("[data-shot=revision-diff]") === null');
check('再点一次把对照收起来', diffGone === true, String(diffGone));
await evalJs('document.querySelector("[data-shot=revision-discard]").click()');
const discardNote = await waitFor(async () => { const t = await evalJs('(() => { const el = document.querySelector("[data-shot=revision-note]"); return el === null ? "" : el.innerText; })()'); return t.indexOf('已撤销全部采纳') >= 0 ? t : ''; }, '撤销结论', 20000);
const afterDiscard = (await (await fetch('http://127.0.0.1:' + PORT + '/api/sessions/' + demoSession.id + '/revisions')).json()).revised;
const paneBack = await evalJs('document.querySelector("[data-shot=resume]").innerText');
check('「全部撤销」把简历退回原文（界面与服务端同时退）', discardNote.length > 0 && afterDiscard === null && paneBack.indexOf('改完的简历') < 0, String(afterDiscard));
// A1：用户自己补一句真话。挑的是没有改写建议的那条主张——
// 它原本连勾选框都没有，补了说明之后必须能勾上，否则「确认采纳」就成了点了没反应的按钮。
async function shotSelector(name) {
  return "[data-shot=" + JSON.stringify(name) + "]";
}
async function textOf(name) {
  const selector = await shotSelector(name);
  return evalJs("(() => { const el = document.querySelector(" + JSON.stringify(selector) + "); return el === null ? '' : el.innerText; })()");
}
async function clickShot(name) {
  const selector = await shotSelector(name);
  return evalJs("(() => { const el = document.querySelector(" + JSON.stringify(selector) + "); if (el === null) return 'missing'; el.click(); return 'ok'; })()");
}
async function hasShot(name) {
  const selector = await shotSelector(name);
  return evalJs("document.querySelector(" + JSON.stringify(selector) + ") === null ? 'no' : 'yes'");
}
const chooseCountBefore = await evalJs('document.querySelectorAll(' + JSON.stringify('[data-shot^=choose-]') + ').length');
check('补说明之前，只有带建议的主张能勾选', chooseCountBefore === advised.length, String(chooseCountBefore) + ' 个 / 建议 ' + String(advised.length) + ' 条');
const noSuggest = view.claims.find((c) => !advised.some((s) => s.claimId === c.id));
const supId = String(noSuggest === undefined ? '' : noSuggest.id);
const hadChoose = await hasShot('choose-' + supId);
check('没有建议的那条主张本来就勾不上', hadChoose === 'no', supId + ' → ' + hadChoose);
const SUP_TEXT = '日订单 30 万，峰值 QPS 5000（这句是我自己补的事实）。';
const typedSup = await setShot('supplement-input-' + supId, SUP_TEXT);
check('卡片上有「补一句真话」的输入框，能填进去', typedSup > 0, String(typedSup) + ' 字');
await clickShot('supplement-save-' + supId);
const supNote = await waitFor(async () => { const t = await textOf('supplement-note-' + supId); return t.indexOf('已记下') >= 0 ? t : ''; }, '补充说明已存下', 15000);
check('存下这句并给出结论', supNote.indexOf('已记下') >= 0, supNote.slice(0, 60));
const shownSup = await textOf('supplement-text-' + supId);
check('这句显示在那张卡片上', shownSup.indexOf('峰值 QPS 5000') >= 0, shownSup.slice(0, 50));
const chooseNow = await hasShot('choose-' + supId);
check('补了说明之后这条也能勾选采纳', chooseNow === 'yes', chooseNow);
await clickShot('choose-' + supId);
await sleep(200);
await clickShot('revision-submit');
const supAccepted = await waitFor(async () => { const t = await textOf('revision-note'); return t.indexOf('已按这次勾选改好简历') >= 0 ? t : ''; }, '采纳补充说明', 20000);
check('没有建议、只有这句补充说明，也能确认采纳', supAccepted.indexOf('改成了 1 处') >= 0, supAccepted.slice(0, 70));
const supRevised = (await (await fetch('http://127.0.0.1:' + PORT + '/api/sessions/' + demoSession.id + '/revisions')).json()).revised;
const lineCountOf = (t) => String(t).split(String.fromCharCode(10)).length;
check('服务端把这句话作为新的一行加进简历（原文一个字没动）',
  supRevised !== null && supRevised.text.indexOf('峰值 QPS 5000') >= 0 && lineCountOf(supRevised.text) === lineCountOf(view.session.resumeText) + 1,
  supRevised === null ? 'null' : lineCountOf(supRevised.text) + ' 行 / 原文 ' + lineCountOf(view.session.resumeText) + ' 行');
const supTxt = await (await fetch('http://127.0.0.1:' + PORT + '/api/sessions/' + demoSession.id + '/resume.txt')).text();
check('导出的简历里就有这句新加的话', supTxt.indexOf('峰值 QPS 5000') >= 0 && supTxt === supRevised.text, String(supTxt.length) + ' 字');
// 存下之后卡片会收起来（textarea 与按钮都不再渲染），要改或要删得先点「改一句」。
// 这是刻意的：那句真话是要拿出去的事实，不该在界面上一直摆着一个「删掉」等着被误点。
const deleteHidden = await hasShot('supplement-delete-' + supId);
check('存下之后收起编辑区，删除按钮不常驻', deleteHidden === 'no', deleteHidden);
await clickShot('supplement-edit-' + supId);
const reopened = await hasShot('supplement-delete-' + supId);
check('点「改一句」才重新展开，此时能删掉这句', reopened === 'yes', reopened);
// 收尾：删掉这句、再撤销，让后面的场景看到的是「刚跑完、什么都没改」的干净状态
await clickShot('supplement-delete-' + supId);
const supDeleted = await waitFor(async () => { const t = await textOf('supplement-note-' + supId); return t.indexOf('已删掉') >= 0 ? t : ''; }, '补充说明已删掉', 15000);
await clickShot('revision-discard');
const backToOriginal = await waitFor(async () => { const t = await textOf('revision-note'); return t.indexOf('已撤销全部采纳') >= 0 ? t : ''; }, '再次撤销', 20000);
const settled = await (await fetch('http://127.0.0.1:' + PORT + '/api/sessions/' + demoSession.id)).json();
const settledRev = (await (await fetch('http://127.0.0.1:' + PORT + '/api/sessions/' + demoSession.id + '/revisions')).json()).revised;
check('删掉补充说明再撤销之后，库与界面都回到没有改动的状态',
  supDeleted.length > 0 && backToOriginal.length > 0 && settled.supplements.length === 0 && settledRev === null,
  String(settled.supplements.length) + ' 句补充说明 / revised ' + String(settledRev));

// C1：改完再跑一遍。这一步走完整链路——采纳改写、点按钮、新开一场、比上次出结论。
// 只验页面元素存不存在是不够的：这个功能的价值全在「判定真的变了」这句话上，
// 所以断言落在「比上次」那一栏的实际文字上，而且要求它说出 1 → 5。
await evalJs('document.querySelector("[data-shot=revision-accept-all]").click()');
await sleep(250);
await evalJs('document.querySelector("[data-shot=revision-submit]").click()');
const rerunNote = await waitFor(async () => { const t = await textOf('revision-note'); return t.indexOf('已按这次勾选改好简历') >= 0 ? t : ''; }, '采纳完成', 20000);
check('再跑一遍之前先把改写真的采纳了', rerunNote.length > 0, rerunNote.slice(0, 60));
const preRerunSessions = (await sessions()).length;
await clickShot('revision-rerun');
const compareAfter = await waitFor(async () => { const t = await textOf('compare'); return t.indexOf('变好') >= 0 ? t : ''; }, '比上次出结论', 40000);
check('点「改完再跑一遍」会新开一场并当场比出结论',
  compareAfter.indexOf('变好 4 条') >= 0 && compareAfter.indexOf('站得住 1 → 5 条') >= 0,
  compareAfter.replace(/\n/g, ' / ').slice(0, 100));
const postRerunSessions = (await sessions()).length;
check('这一场是新的一场，不是把上一场覆盖掉', postRerunSessions === preRerunSessions + 1, String(preRerunSessions) + ' → ' + String(postRerunSessions));
const rerunCards = await countCards();
check('新一场的判定全变成了站得住', rerunCards === 5 && compareAfter.indexOf('变差') < 0, String(rerunCards) + ' 张卡 / 变差 0 条');
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
// 岗位模板库（P9）：不熟悉某个行业的人，也能在十秒内得到一份「有东西可问」的料。
// 放在「清空」之后：这时投料台是空的，装完模板之后多出来的每一样都是模板带来的。
const tplIndustryCount = await evalJs('document.querySelectorAll("[data-shot^=tpl-industry-]").length');
const tplJobCount = await evalJs('Array.from(document.querySelectorAll("[data-shot^=tpl-]")).filter((e) => String(e.getAttribute("data-shot")).indexOf("tpl-industry-") < 0 && String(e.getAttribute("data-shot")) !== "tpl-note").length');
check('投料台给出「行业 × 岗位」模板选择器', tplIndustryCount === 12 && tplJobCount === 3, String(tplIndustryCount) + ' 个行业 / ' + String(tplJobCount) + ' 个岗位');
const tplCustomBefore = await evalJs('document.querySelectorAll("[data-shot^=role-custom-]").length');
// 行业 chip 靠正文认，不靠属性值里的中文；换行业之后岗位列表必须跟着换，否则 36 条就是平铺出来的。
const pickIndustry = (name) => '(function () { var chip = Array.from(document.querySelectorAll("[data-shot^=tpl-industry-]")).find(function (x) { return String(x.textContent).indexOf(' + JSON.stringify(name) + ') >= 0; }); if (chip === undefined) return "no-chip"; chip.click(); return "ok"; })()';
const tplSwitched = await evalJs(pickIndustry('财务会计'));
const tplFinance = await waitFor(async () => {
  const ids = await evalJs('Array.from(document.querySelectorAll("[data-shot^=tpl-]")).map((e) => String(e.getAttribute("data-shot"))).filter((n) => n.indexOf("tpl-fin-") === 0).join(",")');
  return String(ids).length > 0 ? String(ids) : '';
}, '切到财务会计后的岗位列表', 8000);
check('换个行业，岗位列表跟着换', tplSwitched === 'ok' && tplFinance.indexOf('tpl-fin-cost') >= 0, tplFinance);
await evalJs(pickIndustry('医疗护理'));
const tplBack = await waitFor(async () => {
  const found = await evalJs('document.querySelector("[data-shot=tpl-med-pharmacy-lead]") !== null');
  return found === true ? 'ok' : '';
}, '回到医疗护理的岗位列表', 8000);
const tplHint = await evalJs('(function () { var b = document.querySelector("[data-shot=tpl-med-pharmacy-lead]"); return b === null ? "" : String(b.getAttribute("title")); })()');
check('岗位按钮上带着「这类简历常见的坑」', tplBack === 'ok' && String(tplHint).length >= 10, String(tplHint).slice(0, 60));
const tplClicked = await evalJs('(function () { var b = document.querySelector("[data-shot=tpl-med-pharmacy-lead]"); if (b === null) return "no-button"; if (b.disabled) return "busy"; b.click(); return "ok"; })()');
// waitFor 只认非空字符串，所以把「填好了没」的判断放在回调里，别把对象丢出来。
const tplFilled = await waitFor(async () => {
  const state = await evalJs('(function () { var ta = document.querySelectorAll("textarea"); var inputs = Array.from(document.querySelectorAll("input:not([type=file])")); var title = inputs.find(function (e) { return String(e.placeholder).indexOf("例如") >= 0; }); return { resume: ta[0] ? ta[0].value.length : 0, jd: ta[1] ? ta[1].value.length : 0, title: title ? title.value : "" }; })()');
  return state.resume >= 200 && state.jd >= 180 && state.title.length > 0 ? String(state.resume) + '/' + String(state.jd) + '/' + state.title : '';
}, '模板把料填进投料台', 15000);
check('点一下模板：岗位名、JD、示例简历一起填好', tplClicked === 'ok' && tplFilled.length > 0, String(tplClicked) + ' / ' + tplFilled);
const tplNote = await evalJs('(document.querySelector("[data-shot=tpl-note]") || { textContent: "" }).textContent');
check('提示一次说清装了什么、换了谁', tplNote.indexOf('已装好') >= 0 && tplNote.indexOf('药房主管') >= 0, tplNote.slice(0, 80));
const tplContracts = await evalJs('document.querySelectorAll("[data-shot=contract-toggle]").length');
const tplCustom = await evalJs('document.querySelectorAll("[data-shot^=role-custom-]").length');
check('模板自带的面试官进了阵容并渲染出契约', tplContracts === 3 && tplCustom === tplCustomBefore + 1, String(tplContracts) + ' 条契约 / ' + String(tplCustom) + ' 位自建（此前 ' + String(tplCustomBefore) + ' 位）');
await evalJs('(function () { var b = document.querySelector("[data-shot=tpl-med-pharmacy-lead]"); if (b !== null) b.click(); return "ok"; })()');
const tplReused = await waitFor(async () => { const t = await evalJs('(document.querySelector("[data-shot=tpl-note]") || { textContent: "" }).textContent'); return t.indexOf('复用了') >= 0 ? t : ''; }, '复用提示', 15000);
check('同一套模板点两次不会多出一位面试官，并明说复用', tplReused.length > 0, tplReused.slice(-40));
const tplCustomAfter = await evalJs('document.querySelectorAll("[data-shot^=role-custom-]").length');
check('阵容里的自建面试官还是那几位，没多出来', String(tplCustomAfter) === String(tplCustom), String(tplCustomAfter) + ' 位');

// 模板这条路走完，把料收回去：后面还要看历史与删除，别带着一版填好的简历。
await clickText('清空');
await sleep(400);
const tplCleared = await evalJs('(function () { var ta = document.querySelectorAll("textarea"); return ta[0] ? ta[0].value.length : -1; })()');
check('清空能把模板装进来的料一起收回', tplCleared === 0, String(tplCleared) + ' 字');

// P8：目标岗位从单个输入框变成 1–8 份的列表。「多贴一份」这条路必须自己走得通，
// 否则「同一份简历投不同岗位」只是一句宣传语。
const jdRowsEmpty = await evalJs('document.querySelectorAll("[data-shot^=jd-row-]").length');
check('清空之后目标岗位回到一份空行', jdRowsEmpty === 1, String(jdRowsEmpty) + ' 行');
const jdAddClicked = await evalJs('(() => { const b = document.querySelector("[data-shot=jd-add]"); if (b === null) return "no-button"; if (b.disabled) return "disabled"; b.click(); return "ok"; })()');
const jdRowsTwo = await waitFor(async () => { const n = await evalJs('document.querySelectorAll("[data-shot^=jd-row-]").length'); return n === 2 ? '2' : ''; }, '第二份 JD 行', 8000);
check('「+ 再加一份」能加出第二份 JD', jdAddClicked === 'ok' && jdRowsTwo === '2', String(jdAddClicked) + ' / ' + jdRowsTwo + ' 行');
// 两个输入框都要填：空行不算一份 JD（filledJds），只填一份的话右栏还是单栏视图。
await setShot('jd-text-1', '负责后端服务的设计与开发；三年以上 Node.js 经验；熟悉 PostgreSQL 与 Redis，能独立排查线上问题。');
// 先把简历填够字数：只检验「JD 太短挡住开始」，不检验「简历太短挡住开始」（后者在别处已经点过）。
await setTextarea(0, '示例简历：负责订单系统的重构，首屏加载从 2.4 秒降到 0.8 秒，参与的三个项目都按期上线。');
await setShot('jd-text-2', '太短了');
const jdProblem = await waitFor(async () => { const t = await evalJs('(document.querySelector("[data-shot=jd-problem]") || { textContent: "" }).textContent'); return t.length > 0 ? t : ''; }, 'JD 太短的提示', 8000);
const runBlocked = await evalJs('document.querySelector("[data-shot=run]").disabled');
check('一份 JD 太短就点名是哪一份，并把开始按钮压灰', jdProblem.indexOf('第 2 份') >= 0 && jdProblem.indexOf('40') >= 0 && runBlocked === true, jdProblem);
await setShot('jd-text-2', '负责处方审核与用药交代；五年以上医院药房工作经验；熟悉药事管理法规与抗菌药物分级管理制度。');
const jdRecovered = await waitFor(async () => { const t = await evalJs('(document.querySelector("[data-shot=jd-problem]") || { textContent: "" }).textContent'); const d = await evalJs('document.querySelector("[data-shot=run]").disabled'); return t.length === 0 && d === false ? 'ok' : ''; }, '补够字数后重新可跑', 8000);
check('补够字数之后提示自己消失、按钮自己变回来', jdRecovered === 'ok', String(jdRecovered));
const jdPickChips = await evalJs('document.querySelectorAll("[data-shot^=jd-pick-]").length');
check('两份 JD 在右栏给出切换按钮', jdPickChips === 2, String(jdPickChips) + ' 个');
const jdRemoved = await evalJs('(() => { const b = document.querySelector("[data-shot=jd-remove-2]"); if (b === null) return "no-button"; b.click(); return "ok"; })()');
await sleep(300);
const jdRowsBack = await evalJs('document.querySelectorAll("[data-shot^=jd-row-]").length');
check('删掉第二份之后回到一份', jdRemoved === 'ok' && jdRowsBack === 1, String(jdRowsBack) + ' 行');
// 收尾：把这一轮填进去的简历一起清掉，后面的历史与删除不该带着一版半成品。
await clickText('清空');
await sleep(400);


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
  if (e.method === 'Network.responseReceived' && e.params.response.status >= 400) problems.push('HTTP ' + String(e.params.response.status) + ' ' + String(requestMethods.get(e.params.requestId) || '?') + '：' + e.params.response.url);
}
check('整轮下来浏览器控制台没有报错或警告', problems.length === 0, problems.slice(0, 4).join(' | '));

} finally {
  await closeBrowser(CDP_PORT);
  cleanup();
  await warnIfPortBusy(CDP_PORT);
  await sleep(400);
  // 半路失败也要留下现场：results 里最后一条就是失败原因。
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ results, serverLog: serverLog.slice(-1500) }, null, 2));
}
const failed = results.filter((r) => !r.ok);
console.log('--- ' + String(results.length - failed.length) + '/' + String(results.length) + ' 项通过 ---');
process.exit(failed.length === 0 ? 0 : 1);
