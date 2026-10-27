/**
 * 单文件打包（P11 · C3）：一个文件扔给别人，对方双击就能看完整场。
 *
 * 这一层要守的是一条硬规矩，而不是「HTML 能不能渲染」：
 * **输出里不许出现 http:// 或 https://**。收件人的机器可能断网，
 * 一旦混进外链（字体、统计脚本、图片），他看到的会是一张半白的纸，
 * 而这种失败在发件人这边是完全看不见的——所以必须由断言盯着。
 *
 * 另外两条也是「发出去之后才发现就晚了」的：文件得是附件（不是让浏览器直接渲染），
 * 同一场导出两次得逐字节相同（否则「我发你的和他发我的不一样」无法解释）。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.ts';
import { closeDatabase, migrate, openDatabase } from '../src/store/index.ts';
import type { Db } from '../src/store/index.ts';
import { createScriptedClient } from './scripted.ts';

const NL = String.fromCharCode(10);

const RESUME = ['项目经历', '主导重构订单系统，首屏从 2.4s 降到 0.8s。', '熟悉 TypeScript 与 Node.js。'].join(NL);

const QUOTE = '主导重构订单系统';
const AFTER = '负责订单系统重构中的首屏性能优化';

const EXTRACT = JSON.stringify({
  claims: [{ text: '订单系统重构', quote: QUOTE, category: 'achievement', weight: 0.9 }],
});

const PROBE = JSON.stringify({
  probes: [{ claimId: 'C1', question: '这个重构是你主导的还是参与的？', quote: QUOTE, rationale: '主导与参与差别很大' }],
});

const ANSWER = JSON.stringify({ answered: true, text: '我负责首屏性能那一部分。', citedQuotes: [QUOTE] });

const VERDICT = JSON.stringify({
  kind: 'overstated',
  confidence: 0.7,
  rationale: '主导的说法超出了简历能支撑的范围',
  evidenceQuotes: [QUOTE],
});

const SUGGEST = JSON.stringify({
  problem: '只说主导，没说清具体负责哪一块',
  before: QUOTE,
  after: AFTER,
  why: '把负责边界写清楚，面试官就不必再问一次',
});

const JSON_HEADERS = { 'content-type': 'application/json' };

interface Rig {
  db: Db;
  app: ReturnType<typeof createApp>;
}

const opened: Db[] = [];

function rig(): Rig {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  opened.push(db);
  const client = createScriptedClient((req) => {
    if (req.purpose === 'extract') return EXTRACT;
    if (req.purpose === 'probe') return PROBE;
    if (req.purpose === 'answer') return ANSWER;
    if (req.purpose === 'verdict') return VERDICT;
    if (req.purpose === 'suggest') return SUGGEST;
    if (req.purpose === 'counter') return JSON.stringify({ counters: [] });
    return new Error('脚本化模型没有为 purpose=' + req.purpose + ' 准备返回值');
  });
  return { db, app: createApp({ db, client, cassetteDir: '.tmp/fixtures' }) };
}

afterEach(() => {
  while (opened.length > 0) {
    const db = opened.pop();
    if (db !== undefined) closeDatabase(db);
  }
});

async function ranSession(target: Rig): Promise<string> {
  const created = await target.app.request('/api/sessions', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ resumeText: RESUME, jobTitle: '后端工程师', interviewers: ['tech'] }),
  });
  expect(created.status).toBe(201);
  const id = ((await created.json()) as { id: string }).id;
  const run = await target.app.request('/api/sessions/' + id + '/run?stream=0', { method: 'POST' });
  expect(run.status).toBe(200);
  return id;
}

async function bundleOf(target: Rig, id: string): Promise<{ res: Response; html: string }> {
  const res = await target.app.request('/api/sessions/' + id + '/bundle.html');
  const html = await res.text();
  return { res, html };
}

describe('单文件打包', () => {
  it('打包出来的是一份完整 HTML：报告正文、简历原文、事件时间线都在里面', async () => {
    const t = rig();
    const id = await ranSession(t);
    const { res, html } = await bundleOf(t, id);
    expect(res.status).toBe(200);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
    // 报告正文（同一套渲染器，不是另写一份）
    expect(html).toContain('CrossExam 质询报告');
    expect(html).toContain('主张与判定');
    // 打包多出来的两块
    expect(html).toContain('附一、简历原文');
    expect(html).toContain('附二、这一场是怎么跑出来的');
    expect(html).toContain(QUOTE);
    // 时间线读的是真实事件，不是复述结论；事件里存的是英文键名，打包出去得是人话
    expect(html).toContain('阶段开始');
    expect(html).toContain('抽取主张');
    expect(html).not.toContain('· extract');
  });

  it('输出里没有任何 http:// 或 https://：断网双击也能看完整场', async () => {
    const t = rig();
    const id = await ranSession(t);
    const { html } = await bundleOf(t, id);
    expect(html.includes('http://')).toBe(false);
    expect(html.includes('https://')).toBe(false);
    // 顺带守一句：没有任何外链标签（img/script 的 src 一旦出现就说明混进了外部资源）
    expect(/<(img|iframe)[^>]*src=/.test(html)).toBe(false);
  });

  it('是附件而不是让浏览器直接渲染的页面', async () => {
    const t = rig();
    const id = await ranSession(t);
    const { res } = await bundleOf(t, id);
    expect(res.headers.get('content-type')).toContain('text/html');
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('crossexam-bundle-' + id);
  });

  it('采纳过改写之后：简历那一节换成改完的版本，改过的地方标绿', async () => {
    const t = rig();
    const id = await ranSession(t);
    const accepted = await t.app.request('/api/sessions/' + id + '/revisions', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ claims: ['C1'] }),
    });
    expect(accepted.status).toBe(200);
    const { html } = await bundleOf(t, id);
    expect(html).toContain('附一、简历原文（含本版改动）');
    expect(html).toContain('<mark>');
    expect(html).toContain(AFTER);
    // 改前那句原文在「改前改后对照」与时间线里都允许出现，
    // 但简历那一节（pre.text）里必须已经是改后的句子
    const start = html.indexOf('<pre class="text">');
    expect(start).toBeGreaterThan(-1);
    const resumeBlock = html.slice(start, html.indexOf('</pre>', start));
    expect(resumeBlock).toContain(AFTER);
    expect(resumeBlock).not.toContain('主导重构订单系统，首屏从 2.4s 降到 0.8s。');
  });

  it('同一场导出两次逐字节相同：谁发出去的哪一份，能对得上', async () => {
    const t = rig();
    const id = await ranSession(t);
    const first = await bundleOf(t, id);
    const second = await bundleOf(t, id);
    expect(first.html).toBe(second.html);
  });

  it('会话不存在时 404，不是给一份空文件', async () => {
    const t = rig();
    const res = await t.app.request('/api/sessions/nope/bundle.html');
    expect(res.status).toBe(404);
  });
});
