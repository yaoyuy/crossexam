// 定速抓帧：Page.captureScreenshot 循环，比 screencast 的事件式出帧更均匀
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function startCapture(page, dir, { quality = 90 } = {}) {
  mkdirSync(dir, { recursive: true });
  const frames = [];
  let running = true;
  const t0 = Date.now();
  const loop = (async () => {
    while (running) {
      try {
        const r = await page.send('Page.captureScreenshot', { format: 'jpeg', quality, optimizeForSpeed: true });
        const i = frames.length + 1;
        const file = join(dir, 'f' + String(i).padStart(6, '0') + '.jpg');
        writeFileSync(file, Buffer.from(r.data, 'base64'));
        frames.push({ file, t: Date.now() - t0 });
      } catch { /* 抓帧失败就跳过这一拍 */ }
    }
  })();
  return {
    frames,
    async stop() {
      running = false;
      await loop;
      return frames;
    },
  };
}
