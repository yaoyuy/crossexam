// 逐段录屏：每一段独立抓帧，帧与相对时间戳落到 .tmp/video/frames/<beat>/
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { launch, setup, goto, evaluate, shot, sleep } from './cdp.mjs';
import { startCapture } from './cap.mjs';
import { click, waitFor } from './lib.mjs';

const APP = 'http://127.0.0.1:8801/';
const OUT = 'D:/CZB/.tmp/video/frames';

export async function smoothScroll(page, y, ms = 900) {
  await evaluate(page, `(async () => {
    const from = window.scrollY, to = ${y}, lo = 0, hi = 1e9;
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const t0 = performance.now();
    await new Promise((done) => {
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ${ms});
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        window.scrollTo(0, Math.max(0, Math.min(max, from + (to - from) * e)));
        if (k < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
  })()`);
}

const topOf = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return Math.round(window.scrollY + r.top);
})()`;

export async function scrollToSel(page, sel, offset = -120, ms = 900) {
  const y = await evaluate(page, topOf(sel));
  if (y === null) throw new Error('找不到要滚到的元素：' + sel);
  await smoothScroll(page, Math.max(0, y + offset), ms);
}

export async function scrollToText(page, needle, offset = -140, ms = 900) {
  const y = await evaluate(page, `(() => {
    const hook = 'recscroll';
    document.querySelectorAll('[data-rec-scroll]').forEach((n) => n.removeAttribute('data-rec-scroll'));
    const nodes = [...document.querySelectorAll('section, article, div')];
    const hit = nodes.find((n) => {
      const t = (n.innerText || '').trim();
      return t.includes(${JSON.stringify(needle)}) && t.length < 700;
    });
    if (!hit) return null;
    hit.setAttribute('data-rec-scroll', '1');
    const r = hit.getBoundingClientRect();
    return Math.round(window.scrollY + r.top);
  })()`);
  if (y === null) throw new Error('找不到含文字的区块：' + needle);
  await smoothScroll(page, Math.max(0, y + offset), ms);
}

export async function hover(page, sel) {
  const box = await evaluate(page, `(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + Math.min(r.width / 2, 220)), y: Math.round(r.top + Math.min(r.height / 2, 120)) };
  })()`);
  if (!box) throw new Error('找不到要悬停的元素：' + sel);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0 });
  return box;
}

export async function clickAt(page, sel) {
  const box = await hover(page, sel);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(70);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(160);
}

/** 按可见文字找可点元素：先选中，再点它的中心 */
export async function clickText(page, scopeSel, needle) {
  const box = await evaluate(page, `(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(scopeSel)})];
    const hit = nodes
      .filter((n) => (n.innerText || '').trim() === ${JSON.stringify(needle)})
      .concat(nodes.filter((n) => (n.innerText || '').includes(${JSON.stringify(needle)}) && (n.innerText || '').length < 120))
      .find((n) => n.getBoundingClientRect().height > 0);
    if (!hit) return null;
    hit.scrollIntoView({ block: 'nearest' });
    const r = hit.getBoundingClientRect();
    return { x: Math.round(r.left + Math.min(r.width / 2, 260)), y: Math.round(r.top + Math.min(r.height / 2, 40)) };
  })()`);
  if (!box) throw new Error('找不到含文字的节点：' + needle);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0 });
  await sleep(120);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(70);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(200);
}


const tryScrollTo = async (page, sel, offset = -140, ms = 1000) => {
  try { await scrollToSel(page, sel, offset, ms); } catch (err) { console.log('  跳过滚动：' + sel); }
};
const tryScrollToText = async (page, needle, offset = -200, ms = 1000) => {
  try { await scrollToText(page, needle, offset, ms); } catch (err) { console.log('  跳过滚动（文字）：' + needle); }
};
const beats = {
  async b1(page) {
    if (await evaluate(page, 'Boolean(document.querySelector("[data-shot=wizard]"))')) {
      await sleep(3500);
      try { await clickAt(page, '[data-shot=wizard-next]'); await sleep(2200); await clickAt(page, '[data-shot=wizard-next]'); await sleep(2200); } catch {}
      try { await clickAt(page, '[data-shot=wizard-skip]'); } catch {}
      await sleep(1500);
    }
    try { await hover(page, '[data-shot=home-hero]'); } catch {}
    await sleep(2200);
    await tryScrollTo(page, '[data-shot=home-hero]', -60, 1000);
    await sleep(2600);
    await tryScrollTo(page, '[data-shot=home-card-intake]', -420, 1300);
    await sleep(2400);
    for (const id of ['intake', 'interview', 'report']) {
      try { await hover(page, '[data-shot=home-card-' + id + ']'); } catch {}
      await sleep(1200);
    }
    await tryScrollTo(page, '[data-shot=home-latest]', -240, 1200);
    await sleep(2400);
    await smoothScroll(page, 0, 1100);
    await sleep(1800);
    try { await hover(page, '[data-shot=nav-intake]'); } catch {}
    await sleep(1800);
  },
  async b2(page) {
    await clickAt(page, '[data-shot=nav-intake]');
    await sleep(2000);
    await clickAt(page, '[data-shot=use-demo]');
    await sleep(2600);
    await tryScrollTo(page, '[data-shot=resume]', -180, 1200);
    await sleep(2600);
    await tryScrollTo(page, '[data-shot=intake-templates]', -200, 1200);
    await sleep(2200);
    try { await hover(page, '[data-shot=tpl-industry-计算机软件]'); } catch {}
    await sleep(1400);
    try { await clickAt(page, '[data-shot=tpl-industry-计算机软件]'); } catch {}
    await sleep(2400);
    await tryScrollTo(page, '[data-shot=role-tech]', -260, 1200);
    await sleep(2400);
    try { await hover(page, '[data-shot=difficulty-normal]'); } catch {}
    await sleep(1400);
    await clickAt(page, '[data-shot=pace-slow]');
    await sleep(1600);
    await tryScrollTo(page, '[data-shot=run]', -320, 1200);
    await sleep(2200);
    try { await hover(page, '[data-shot=run]'); } catch {}
    await sleep(2400);
  },
  async b3(page) {
    await clickAt(page, '[data-shot=run]');
    await sleep(3000);
    await tryScrollTo(page, '[data-shot=claims]', -140, 1000);
    await sleep(3200);
    try { await hover(page, '[data-shot=claims] article'); } catch {}
    await sleep(1800);
    try { await clickText(page, '[data-shot=claims] article button', '首屏加载从 2.4s 降到 0.8s'); } catch (e) { console.log('quote click skipped'); }
    await sleep(2200);
    await tryScrollTo(page, '[data-shot=resume]', -160, 1200);
    await sleep(3200);
    await tryScrollTo(page, '[data-shot=claims]', -140, 1200);
    await sleep(2600);
    try { await clickText(page, '[data-shot=claims] article button', 'QPS 从 800 提升'); } catch {}
    await sleep(2600);
  },
  async b4(page) {
    await tryScrollTo(page, '[data-shot=claims]', -140, 1100);
    await sleep(2400);
    await tryScrollToText(page, '主导订单系统重构', -220, 1100);
    await sleep(2800);
    await tryScrollToText(page, '证据缺失', -240, 1100);
    await sleep(3200);
    await tryScrollToText(page, '被锚定机制拦下', -260, 1200);
    await sleep(3400);
    await tryScrollTo(page, '[data-shot=requirements]', -200, 1200);
    await sleep(3000);
    try { await hover(page, '[data-shot=requirements] article'); } catch {}
    await sleep(2200);
    await tryScrollToText(page, '轮到你了', -160, 1200);
    await sleep(3400);
    try { await hover(page, '[data-shot^=counter-]'); } catch {}
    await sleep(2400);
  },
  async b5(page) {
    await tryScrollTo(page, '[data-shot=contracts]', -150, 1000);
    await sleep(2400);
    try { await clickText(page, '[data-shot=contracts] button', '展开'); } catch {}
    await sleep(2600);
    try { await hover(page, '[data-shot=contracts]'); } catch {}
    await sleep(2000);
    await clickAt(page, '[data-shot=nav-report]');
    await sleep(2000);
    await tryScrollTo(page, '[data-shot=report-page]', -140, 1200);
    await sleep(2800);
    await tryScrollTo(page, '[data-shot=report-growth]', -240, 1200);
    await sleep(3000);
  },
};/** 补足到旁白长度：在当前位置做很慢的小幅往返，画面不会僵住 */
async function fill(page, targetMs, t0) {
  let dir = 1;
  let guard = 0;
  while (Date.now() - t0 < targetMs - 600 && guard < 40) {
    const y = await evaluate(page, 'window.scrollY');
    await smoothScroll(page, Math.max(0, y + 70 * dir), 2400);
    dir = -dir;
    guard += 1;
    await sleep(250);
  }
}

const TARGET = { b1: 46200, b2: 38600, b3: 31200, b4: 46700, b5: 22600 };
const which = process.argv.slice(2);
// 每次整轮录屏都用干净的 profile：向导、主题、上次会话都不会残留
const PROFILE = 'D:/CZB/.tmp/video/prof-' + Date.now();
const page = await launch({ port: 9340, profile: PROFILE });
try {
  await setup(page);
  await goto(page, APP, 1500);
  const run = async (id) => {
    const dir = OUT + '/' + id;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const cast = await startCapture(page, dir, { quality: 90 });
    const t0 = Date.now();
    await beats[id](page);
    if (TARGET[id]) await fill(page, TARGET[id], t0);
    const frames = await cast.stop();
    writeFileSync(dir + '/meta.json', JSON.stringify({ beat: id, frames }, null, 1));
    console.log(id, 'frames=' + frames.length, 'span=' + Math.round(frames[frames.length - 1].t) + 'ms');
  };
  for (const id of which) await run(id);
  await shot(page, 'D:/CZB/.tmp/video/last.png');
} finally {
  page.close();
}
