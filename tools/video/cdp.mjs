// 极简 CDP 驱动：零依赖（Node 自带 WebSocket），只做演示视频需要的那几件事。
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

export function findBrowser() {
  for (const p of CANDIDATES) if (existsSync(p)) return p;
  throw new Error('没找到 Edge/Chrome');
}

export async function launch({ width = 1920, height = 1080, port = 9333, profile }) {
  mkdirSync(profile, { recursive: true });
  const proc = spawn(findBrowser(), [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--window-size=' + width + ',' + height,
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--disable-features=Translate,MediaRouter',
    '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 100; i += 1) {
    await sleep(150);
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/list');
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch { /* 还没起来 */ }
  }
  if (!target) throw new Error('浏览器没起来');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (!p) return;
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    } else if (msg.method) {
      const l = listeners.get(msg.method);
      if (l) l(msg.params);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    id += 1;
    const myId = id;
    pending.set(myId, { resolve, reject });
    ws.send(JSON.stringify({ id: myId, method, params }));
    setTimeout(() => {
      if (pending.has(myId)) { pending.delete(myId); reject(new Error('CDP 超时：' + method)); }
    }, 30000);
  });
  const on = (method, fn) => listeners.set(method, fn);
  const close = () => {
    try { ws.close(); } catch { /* ignore */ }
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  };
  return { send, on, close, port };
}

export async function setup(page) {
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.setLifecycleEventsEnabled', { enabled: true });
}

export async function goto(page, url, settle = 1200) {
  await page.send('Page.navigate', { url });
  await sleep(settle);
}

export async function evaluate(page, expression) {
  const r = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面脚本出错：' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  return r.result?.value;
}

export async function shot(page, path) {
  const r = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(r.data, 'base64'));
}

/** 起屏流：把每一帧写成 jpg，并记下时间戳（毫秒）。 */
export async function startCast(page, dir, { quality = 88 } = {}) {
  mkdirSync(dir, { recursive: true });
  const frames = [];
  let started = null;
  page.on('Page.screencastFrame', (params) => {
    const t = params.metadata.timestamp * 1000;
    if (started === null) started = t;
    const i = frames.length + 1;
    const file = join(dir, 'f' + String(i).padStart(6, '0') + '.jpg');
    writeFileSync(file, Buffer.from(params.data, 'base64'));
    frames.push({ file, t: t - started });
    page.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
  });
  await page.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  return {
    frames,
    async stop() {
      await page.send('Page.stopScreencast');
      return frames;
    },
  };
}
