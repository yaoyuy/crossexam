// 等待式页面操作：绝不用固定 sleep 去点还没出现的东西。
import { evaluate, sleep } from './cdp.mjs';

export async function waitFor(page, expr, { timeout = 20000, label = expr } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await evaluate(page, 'Boolean(' + expr + ')'); } catch { v = false; }
    if (v) return true;
    if (Date.now() - t0 > timeout) throw new Error('等不到：' + label);
    await sleep(120);
  }
}

export async function click(page, sel, opts = {}) {
  await waitFor(page, 'document.querySelector(' + JSON.stringify(sel) + ')', { label: sel, ...opts });
  await evaluate(page, 'document.querySelector(' + JSON.stringify(sel) + ').click()');
  await sleep(120);
}

export async function text(page, sel) {
  return evaluate(page, '(document.querySelector(' + JSON.stringify(sel) + ')?.innerText || "").trim()');
}

export async function count(page, sel) {
  return evaluate(page, 'document.querySelectorAll(' + JSON.stringify(sel) + ').length');
}
