/**
 * 无头浏览器（CDP）这一层的共用封装。
 *
 * 为什么单独一层：报告验收与联网验收都要「真浏览器里点一下」，两处各写一遍 CDP 胶水
 * 就会出现两份只有细节差一点的探测逻辑，改一处忘一处（F41 那个假 PASS 就是这么来的）。
 * 这里统一：等元素等到就返回，等不到就抛错，绝不拿上一轮的旧文本当结果。
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep } from './accept.mjs';

/** 起浏览器并接上第一个页面目标；超时返回 null，调用方据此跳过浏览器相关的项。 */
export async function launchBrowser(browserPath, { cdpPort, profileDir, width = 1500, height = 1100, cleanup }) {
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + String(cdpPort),
    '--user-data-dir=' + profileDir,
    'about:blank',
  ];
  const child = spawn(browserPath, args, { stdio: 'ignore' });
  if (cleanup !== undefined) cleanup.track(child);
  const deadline = Date.now() + 30000;
  let version = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:' + String(cdpPort) + '/json/version');
      if (res.ok) { version = await res.json(); break; }
    } catch { /* 还没起来 */ }
    await sleep(300);
  }
  if (version === null) {
    try { child.kill(); } catch { /* 已经退了 */ }
    return null;
  }
  const list = await (await fetch('http://127.0.0.1:' + String(cdpPort) + '/json/list')).json();
  const target = list.find((t) => t.type === 'page' && t.url === 'about:blank') ?? list.find((t) => t.type === 'page');
  if (target === undefined) { try { child.kill(); } catch { /* 同上 */ } return null; }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });

  let nextId = 0;
  const pending = new Map();
  const consoleIssues = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const waiter = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(JSON.stringify(msg.error))); else waiter.resolve(msg.result);
      return;
    }
    // 控制台里的 error/warning 本身就是证据：界面「看着对了」但控制台在刷错，那不算通过。
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
      consoleIssues.push('console.' + msg.params.type + ': ' + String(msg.params.args?.map((a) => a.value ?? a.description ?? '').join(' ')).slice(0, 160));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleIssues.push('exception: ' + String(msg.params.exceptionDetails.text ?? ''));
    } else if (msg.method === 'Log.entryAdded' && (msg.params.entry.level === 'error' || msg.params.entry.level === 'warning')) {
      consoleIssues.push('log.' + msg.params.entry.level + ': ' + String(msg.params.entry.text).slice(0, 160));
    }
  });

  const send = (method, params) => new Promise((resolve, reject) => {
    const id = nextId + 1; nextId = id;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params ?? {} }));
  });

  await send('Page.enable', {});
  await send('Runtime.enable', {});
  await send('Log.enable', {});
  await send('DOM.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  async function evalJs(expression) {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails !== undefined) {
      const detail = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text;
      throw new Error('页面里抛错：' + String(detail).slice(0, 200));
    }
    return res.result?.value;
  }
  /** 等到 fn 返回真值为止；超时抛错——宁可红，也不要拿旧值假装通过。 */
  async function waitFor(fn, label, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let value = null;
      try { value = await fn(); } catch { value = null; }
      if (value !== null && value !== undefined && value !== false && String(value).length > 0 && value !== 'false') return value;
      if (Date.now() > deadline) throw new Error('等不到：' + label);
      await sleep(300);
    }
  }
  async function waitText(part, timeoutMs) {
    return waitFor(async () => {
      const text = await evalJs('document.body.innerText');
      return text.includes(part) ? text : '';
    }, part, timeoutMs);
  }
  async function shot(dir, name) {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(dir, name), Buffer.from(res.data, 'base64'));
  }
  return {
    evalJs, waitFor, waitText, shot, send, consoleIssues,
    browserVersion: version['Browser'],
    async close() {
      try { await send('Browser.close', {}); } catch { /* 关不掉就算了，cleanup 会兜底 */ }
    },
  };
}
