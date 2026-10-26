#!/usr/bin/env node
// CrossExam 界面截图器：真起服务 + 真浏览器（系统 Edge/Chrome，走 CDP），产出可复跑的界面截图。
//
// 为什么不用 Playwright：本仓库有一条硬约束——不引入需要本地编译的原生依赖，
// 而且希望能用系统里已经有的浏览器跑。Node 22 自带全局 WebSocket，CDP 本身是纯 JSON 协议，
// 于是「真浏览器验证」可以做到零依赖。这条路径同时是 README 配图与演示视频封面的唯一来源：
// 图不是手点的，跑一条命令就能重新生成。
//
// 用法：
//   node tools/ui-shots/shots.mjs                 # 默认输出到 docs/screenshots
//   node tools/ui-shots/shots.mjs --url http://127.0.0.1:8787   # 驱动一个已经在跑的服务
//   node tools/ui-shots/shots.mjs --keep          # 保留临时目录与浏览器窗口，便于排查
//   node tools/ui-shots/shots.mjs --allow-console # 控制台有报错也照样出图（默认报错即失败）

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const NL = '\n';

const VIEWPORT = { width: 1600, height: 1000 };
const RUN_TIMEOUT_MS = 60000;
// 每条 CDP 命令都要有个头。可见浏览器点测时遇到过 Page.captureScreenshot 永不返回：
// 连接还在、进程还在，脚本却永久卡住，除了按端口杀进程没有别的办法。
// 有超时之后，最坏情况是少一张图，而不是整轮没有结论。
const CDP_TIMEOUT_MS = 20000;

function log(message) {
  process.stdout.write(message + NL);
}

function parseArgs(argv) {
  const opts = { out: join(ROOT, 'docs', 'screenshots'), port: 8791, url: null, keep: false, allowConsole: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') { opts.out = resolve(argv[i + 1]); i += 1; }
    else if (arg === '--port') { opts.port = Number(argv[i + 1]); i += 1; }
    else if (arg === '--url') { opts.url = argv[i + 1]; i += 1; }
    else if (arg === '--keep') { opts.keep = true; }
    else if (arg === '--allow-console') { opts.allowConsole = true; }
    else if (arg === '--quiet') { opts.quiet = true; }
    else if (arg === '--help' || arg === '-h') { log(readFileSync(join(HERE, 'README.md'), 'utf8')); process.exit(0); }
    else { throw new Error('不认识的参数：' + arg); }
  }
  return opts;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

// Windows 上 proc.kill() 只结束启动器，Edge 的进程树还活着。残留浏览器会继续占着 CDP
// 端口，下一轮就悄悄连到它——它的 profile 里可能已经有 localStorage（例如「教程看过
// 了」），于是截图与断言都不再来自这一次运行。所以按进程树杀。
function killTree(proc) {
  if (proc === null || proc.pid === undefined) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    else proc.kill('SIGKILL');
  } catch { /* 已经退出了 */ }
}

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
      log('警告：调试端口 ' + String(port) + ' 仍被占用，残留的浏览器会干扰下一轮。');
      log('  找占用者：Get-NetTCPConnection -LocalPort ' + String(port) + ' -State Listen');
    }
  } catch (error) { /* 端口是空的，正常 */ }
}

// 浏览器进程退出时会短暂占着 user-data-dir（Windows 上表现为 EPERM），删不掉不是错误，
// 但**绝不能让它盖住真正的结果**：出图是否成功与临时目录是否删干净是两件事。
async function removeDirWithRetry(dir, attempts) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return true;
    } catch {
      await sleep(400);
    }
  }
  return false;
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
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
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

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'unknown';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = 'HTTP ' + String(response.status);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error('等不到 ' + url + '：' + lastError);
}

async function waitForDevtools(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'unknown';
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + String(port) + '/json/list')).json();
      // 只认「刚启动的空窗口」：端口上若已有别的页面，说明连到的是别人留下的浏览器。
      const page = list.find((target) => target.type === 'page' && target.url === 'about:blank');
      if (page !== undefined && typeof page.webSocketDebuggerUrl === 'string') return page.webSocketDebuggerUrl;
      const stranger = list.find((target) => target.type === 'page');
      lastError = stranger === undefined ? '还没有 page target' : '端口上的页面是 ' + String(stranger.url) + '，不是刚启动的空窗口';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error('等不到浏览器调试端口 ' + String(port) + '：' + lastError);
}

// 极简 CDP 客户端：发命令、等回复、收事件。
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (typeof message.id === 'number') {
        const slot = this.pending.get(message.id);
        if (slot === undefined) return;
        this.pending.delete(message.id);
        if (message.error !== undefined) slot.reject(new Error('CDP ' + JSON.stringify(message.error)));
        else slot.resolve(message.result);
        return;
      }
      this.events.push(message);
    });
    ws.addEventListener('close', () => {
      for (const slot of this.pending.values()) slot.reject(new Error('调试连接被关闭'));
      this.pending.clear();
    });
  }

  send(method, params, timeoutMs = CDP_TIMEOUT_MS) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve_, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('调试调用超时（' + String(timeoutMs) + ' 毫秒）：' + method));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve_(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails !== undefined) {
      throw new Error('页面里报错：' + JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails));
    }
    return result.result?.value;
  }

  // 轮询一段表达式直到它为真，用来等界面进入某个状态，而不是盲等固定毫秒。
  async waitFor(expression, label, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await this.evaluate(expression);
      if (value === true || (typeof value === 'number' && value > 0)) return value;
      await sleep(150);
    }
    throw new Error('等不到界面状态：' + label);
  }

  problems() {
    const out = [];
    for (const event of this.events) {
      if (event.method === 'Runtime.exceptionThrown') {
        out.push('未捕获异常：' + String(event.params?.exceptionDetails?.exception?.description ?? ''));
      } else if (event.method === 'Runtime.consoleAPICalled' && (event.params?.type === 'error' || event.params?.type === 'warning')) {
        const text = (event.params.args ?? []).map((a) => String(a.value ?? a.description ?? '')).join(' ');
        out.push('console.' + String(event.params.type) + '：' + text);
      } else if (event.method === 'Log.entryAdded' && (event.params?.entry?.level === 'error' || event.params?.entry?.level === 'warning')) {
        out.push('浏览器日志 ' + String(event.params.entry.level) + '：' + String(event.params.entry.text ?? ''));
      }
    }
    return out;
  }

  async shot(outDir, name, scroll) {
    if (scroll !== undefined) {
      await this.evaluate(scroll);
      await sleep(220);
    }
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    const bytes = Buffer.from(String(result.data), 'base64');
    const file = join(outDir, name);
    writeFileSync(file, bytes);
    log('  ' + name + '  ' + String(bytes.length) + ' B');
    return file;
  }
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve_, reject) => {
    const timer = setTimeout(() => reject(new Error('连接调试端口超时')), 10000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve_(); });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('连接调试端口失败')); });
  });
  return new Cdp(ws);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const distIndex = join(ROOT, 'packages', 'web', 'dist', 'index.html');
  if (opts.url === null && !existsSync(distIndex)) {
    throw new Error('还没有构建前端：先跑 npm run build（截图要的是真实产物，不是开发服务器）');
  }
  const browserPath = findBrowser();
  if (browserPath === null) {
    throw new Error('找不到浏览器。装 Edge/Chrome，或用 CROSSEXAM_BROWSER=<可执行文件路径> 指定。');
  }
  mkdirSync(opts.out, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), 'crossexam-shots-'));
  const dbPath = join(workDir, 'shots.db');
  const profileDir = join(workDir, 'browser-profile');
  const debugPort = 9400 + Math.floor(Math.random() * 200);
  let server = null;
  let browser = null;
  let cdp = null;
  try {
    let base = opts.url;
    if (base === null) {
      base = 'http://127.0.0.1:' + String(opts.port);
      const env = { ...process.env, CROSSEXAM_PORT: String(opts.port), CROSSEXAM_DB: dbPath, CROSSEXAM_MODE: 'replay' };
      // 出图不该受本机配没配模型影响：抹掉 LLM_*，联网模式那一张的提示才稳定。
      for (const key of Object.keys(env)) {
        if (key.indexOf('LLM_') === 0) delete env[key];
      }
      server = spawn(process.execPath, [join(ROOT, 'packages', 'server', 'src', 'bin', 'serve.ts')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
      server.stderr.on('data', (chunk) => { if (!opts.quiet) process.stderr.write('[server] ' + String(chunk)); });
      await waitForHttp(base + '/api/health', 25000);
      log('服务已就绪：' + base);
    } else {
      await waitForHttp(base + '/api/health', 5000);
      log('驱动已在跑的服务：' + base);
    }

    // 起浏览器之前必须确认调试端口是空的：占用它的大概率是上一轮没杀干净的浏览器。
    let cdpBusy = false;
    try { const busy = await fetch('http://127.0.0.1:' + String(debugPort) + '/json/version'); cdpBusy = busy.ok; } catch { /* 期望是空的 */ }
    if (cdpBusy) {
      throw new Error('调试端口 ' + String(debugPort) + ' 已被占用：多半是上一轮留下的浏览器进程。先关掉它（taskkill /F /IM msedge.exe）再重跑。');
    }
    browser = spawn(browserPath, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', '--remote-debugging-port=' + String(debugPort),
      '--user-data-dir=' + profileDir,
      '--window-size=' + String(VIEWPORT.width) + ',' + String(VIEWPORT.height),
      'about:blank',
    ], { stdio: 'ignore' });
    const wsUrl = await waitForDevtools(debugPort, 20000);
    cdp = await connect(wsUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: base + '/' });
    await sleep(700);
    await cdp.waitFor("document.querySelector('[data-shot=\"use-demo\"]') !== null", '投料台出现', 20000);

    // 第一次打开会自动弹一次新手教程。截图要的是界面本身，先关掉它，
    // 最后再把教程本身拍一张（它就是「刚装上的人怎么开始用」的证据）。
    const helpClose = "document.querySelector('[data-shot=\"help-close\"]')";
    if ((await cdp.evaluate(helpClose + " !== null")) === true) {
      await cdp.evaluate(helpClose + ".click()");
      await sleep(250);
}

    // 表达式里刻意不声明变量：CDP 的 Runtime.evaluate 共用同一个全局作用域，
    // 第二次 const 同名会直接抛 SyntaxError（第一版就踩了）。
    const pane = (name) => "document.querySelector('[data-shot=\"" + name + "\"]').lastElementChild";
    const top = (name) => pane(name) + '.scrollTop = 0';
    const bottom = (name) => pane(name) + '.scrollTop = ' + pane(name) + '.scrollHeight';
    const click = (shot) => "document.querySelector('[data-shot=\"" + shot + "\"]').click()";

    log('界面截图输出到：' + opts.out);
    await cdp.shot(opts.out, '01-intake.png', top('claims'));

    // 运行模式三选一：默认离线回放（不联网），切到联网才出现模型输入框。
    // 这一张是「页面里能自己选回放还是联网、用哪个模型」的直接证据。
    await cdp.evaluate(click('mode-live'));
    await cdp.waitFor("document.querySelector('[data-shot=\"model-input\"]') !== null", '模型输入框出现', 15000);
    await cdp.waitFor("((document.querySelector('[data-shot=\"mode-note\"]') || {}).innerText || '').indexOf('正在向后端要') < 0", '模型清单结论出来', 15000);
    await sleep(300);
    await cdp.shot(opts.out, '15-modes.png');
    await cdp.evaluate(click('mode-replay'));
    await sleep(250);
    await cdp.evaluate(click('pace-slow'));
    await cdp.evaluate(click('use-demo'));
    await sleep(300);
    await cdp.shot(opts.out, '02-demo-loaded.png');

    await cdp.evaluate(click('run'));
    await cdp.waitFor("document.body.innerText.includes('第 1 轮')", '第一轮追问出现', RUN_TIMEOUT_MS);
    await cdp.shot(opts.out, '03-running.png', top('claims'));

    // 实时输出：慢放模式下模型是**真的在一个字一个字往外吐**，这一张是流式与思考可视化的直接证据。
    // 它只活在直播期间（跑完就收），所以必须趁 running 拍。
    await cdp.waitFor("(document.querySelector('[data-shot=\"live\"]')?.innerText ?? '').length > 30", '实时输出出现文字', RUN_TIMEOUT_MS);
    await cdp.shot(opts.out, '04-live-output.png', "document.querySelector('[data-shot=\"live\"]').scrollIntoView({ block: 'center' })");
    // 思考可视化：思考模型（deepseek-reasoner）的 reasoning 分片与正文分开推，
    // 只在 answer / verdict 两个阶段出现，而且同样只活在直播期间——
    // 所以用一个跑在页面里的 10 毫秒轮询把这段窗口抓住，再截图。
    const sawThinking = await cdp.evaluate("new Promise((resolve) => { const tick = setInterval(() => { const el = document.querySelector('[data-shot=\"live-reasoning\"]'); if (el !== null && el.innerText.length > 20) resolve(true); }, 10); setTimeout(() => { clearInterval(tick); resolve(false); }, " + String(RUN_TIMEOUT_MS) + "); })");
    if (sawThinking !== true) throw new Error('等不到思考分片（live-reasoning 锚点一直是空的）');
    await cdp.shot(opts.out, '05-thinking.png');

    await cdp.evaluate(top('stage'));
    await cdp.waitFor("document.querySelector('[data-shot=\"stage\"]').innerText.includes('已完成')", '质询跑完', RUN_TIMEOUT_MS);
    await sleep(400);
    await cdp.shot(opts.out, '06-done-top.png', top('claims'));
    await cdp.shot(opts.out, '07-verdicts.png', bottom('claims'));
    await cdp.shot(opts.out, '08-resume-focus.png', "(" + pane('claims') + ".querySelector('button.quote') ?? { click: () => undefined }).click(), " + pane('claims') + '.scrollTop = ' + pane('claims') + '.scrollHeight * 0.55');
    await cdp.shot(opts.out, '09-history.png', bottom('intake'));

    // 意图契约：展开一位面试官的契约，再摊开他实际拿到的 System Prompt。
    // 这一张是「意图控制」这条评分项的直接证据：目标/手法/禁区/预算都是结构化数据，
    // prompt 由它确定性渲染，指纹还要和会话里落库的那一份对得上。
    await cdp.evaluate("document.querySelectorAll('[data-shot=\"contract-toggle\"]')[0].click()");
    await cdp.evaluate("document.querySelectorAll('[data-shot=\"contract-prompt\"]')[0].click()");
    await sleep(250);
    await cdp.shot(opts.out, '10-contracts.png', "document.querySelector('[data-shot=\"contracts\"]').scrollIntoView({ block: 'start' })");
    await cdp.shot(opts.out, '11-system-prompt.png', "document.querySelector('[data-shot=\"contracts\"] pre').scrollIntoView({ block: 'center' })");

    // 新手教程与浅色配色：这两张回答「第一次拿到这个项目的人怎么开始用」以及
    // 「白天/投影仪上看得清吗」。教程只会在第一次打开时自动弹，之后从头部按钮进。
    await cdp.evaluate(click('help-open'));
    await sleep(300);
    await cdp.shot(opts.out, '12-help.png');
    await cdp.evaluate(click('help-close'));
    await sleep(250);
    await cdp.evaluate(click('theme'));
    await sleep(350);
    await cdp.shot(opts.out, '13-light.png', top('claims'));

    // 报告导出：同一份结果有三种形态（Markdown 便于携带、可打印 HTML 便于阅读、Word 便于改）。
    // 这一张拍的是服务端渲染出来的可打印 HTML——PDF 就是它经浏览器打印得到的，服务端不自己造 PDF。
    const sid = await cdp.evaluate("fetch('/api/sessions').then((r) => r.json()).then((data) => (data.sessions[0] ?? {}).id ?? '')");
    if (typeof sid !== 'string' || sid === '') throw new Error('拿不到会话编号，报告那一张拍不了');
    await cdp.send('Page.navigate', { url: base + '/api/sessions/' + sid + '/report.html' });
    await cdp.waitFor("document.body.innerText.includes('主张与判定')", '报告页打开', 20000);
    await sleep(300);
    await cdp.shot(opts.out, '14-report.png');

    const problems = cdp.problems();
    log(NL + '控制台/日志问题：' + (problems.length === 0 ? '无' : String(problems.length) + ' 条'));
    for (const problem of problems) log('  - ' + problem);
    if (problems.length > 0 && !opts.allowConsole) {
      throw new Error('界面控制台出现了报错或警告（截图已出，但按约定这算失败；确认无害可用 --allow-console）');
    }
    log(NL + '完成。演示视频封面、README 配图、技术文档插图都可以直接用这批图。');
  } finally {
    try { if (cdp !== null) cdp.ws.close(); } catch { /* 忽略 */ }
    await closeBrowser(debugPort);
    killTree(browser);
    killTree(server);
    await warnIfPortBusy(debugPort);
    await sleep(600);
    if (opts.keep) {
      log('临时目录保留在：' + workDir);
    } else if (!(await removeDirWithRetry(workDir, 5))) {
      log('临时目录没删干净（浏览器进程还占着），不影响出图：' + workDir);
    }
  }
}

main().catch((error) => {
  process.stderr.write('截图失败：' + (error instanceof Error ? error.message : String(error)) + NL);
  process.exit(1);
});
