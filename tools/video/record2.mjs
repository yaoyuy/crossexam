// 录静态证据页：文件页面，慢慢滚，让每一行都停够时间
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { launch, setup, goto, evaluate, sleep } from './cdp.mjs';
import { startCapture } from './cap.mjs';

// 不能从 record.mjs import：那个文件顶层就会开浏览器跑 beats
const smoothScroll = (page, y, ms = 900) => evaluate(page, `(async () => {
  const from = window.scrollY, to = ${y};
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

const OUT = 'D:/CZB/.tmp/video/frames';
const PAGES = 'file:///D:/CZB/.tmp/video/pages/';

const drift = async (page, step = 340, holds = 6, holdMs = 3600) => {
  const total = await evaluate(page, 'document.documentElement.scrollHeight - window.innerHeight');
  let y = 0;
  for (let i = 0; i < holds; i += 1) {
    y = Math.min(total, y + step);
    await smoothScroll(page, y, 1500);
    await sleep(holdMs);
  }
  await smoothScroll(page, 0, 1800);
};

const plans = {
  b6: { step: 300, holds: 7, holdMs: 4400 },
  b7: { step: 280, holds: 8, holdMs: 4300 },
  b8: { step: 300, holds: 7, holdMs: 4200 },
  b9: { step: 320, holds: 6, holdMs: 3500 },
  b10: { step: 300, holds: 8, holdMs: 4300 },
  b11: { step: 260, holds: 5, holdMs: 3600 },
};

const which = process.argv.slice(2);
const page = await launch({ port: 9345, profile: 'D:/CZB/.tmp/video/prof-static-' + Date.now() });
try {
  await setup(page);
  for (const id of which) {
    await goto(page, PAGES + id + '.html', 900);
    const dir = OUT + '/' + id;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const cast = await startCapture(page, dir, { quality: 92 });
    await sleep(1200);
    await drift(page, plans[id].step, plans[id].holds, plans[id].holdMs);
    const frames = await cast.stop();
    writeFileSync(dir + '/meta.json', JSON.stringify({ beat: id, frames }, null, 1));
    console.log(id, 'frames=' + frames.length, 'span=' + (frames[frames.length - 1].t / 1000).toFixed(1) + 's');
  }
} finally {
  page.close();
}
