/**
 * 采纳改写与简历导出：把「改前 / 改后」真的落到简历上，并且能被推翻。
 *
 * 这一层值得测的不是「能写库」，而是四条会直接伤到用户的边界：
 *   1. 采纳是**集合**不是叠加——点两次和点一次必须逐字节相同；
 *   2. 取消勾选必须真的撤掉，否则用户以为改回去了其实没有；
 *   3. 点了一条不存在的建议，不能静默少改，得把理由说回来；
 *   4. 撤销之后必须干净地回到原文。
 *
 * 全部走脚本化模型，所以这一份测试同时也是「没有 API Key 也能验」的证明。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.ts';
import { closeDatabase, migrate, openDatabase } from '../src/store/index.ts';
import type { Db } from '../src/store/index.ts';
import { createScriptedClient } from './scripted.ts';

const RESUME = [
  '项目经历',
  '主导重构订单系统，首屏从 2.4s 降到 0.8s。',
  '熟悉 TypeScript 与 Node.js。',
].join(String.fromCharCode(10));

const QUOTE = '主导重构订单系统';
const AFTER = '负责订单系统重构中的首屏性能优化';

const EXTRACT = JSON.stringify({
  claims: [{ text: '订单系统重构', quote: QUOTE, category: 'achievement', weight: 0.9 }],
});

const PROBE = JSON.stringify({
  probes: [{ claimId: 'C1', question: '这个重构是你主导的还是参与的？', quote: QUOTE, rationale: '主导与参与差别很大' }],
});

const ANSWER = JSON.stringify({ answered: true, text: '我负责首屏性能那一部分。', citedQuotes: [QUOTE] });

const VERDICT = JSON.stringify({ kind: 'overstated', confidence: 0.7, rationale: '主导的说法超出了简历能支撑的范围', evidenceQuotes: [QUOTE] });

const SUGGEST = JSON.stringify({
  problem: '只说主导，没说清具体负责哪一块',
  before: QUOTE,
  after: AFTER,
  why: '把负责边界写清楚，面试官就不必再问一次',
});

interface Rig {
  db: Db;
  app: ReturnType<typeof createApp>;
}

const opened: Db[] = [];

const JSON_HEADERS = { 'content-type': 'application/json' };

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

interface RevisedBody {
  text: string;
  digest: string;
  applied: { claimId: string; before: string; after: string }[];
  spans: { claimId: string; start: number; end: number }[];
  accepted: string[];
  pending: string[];
  skipped: { claimId: string; reason: string }[];
}

/** 建一场会话并跑完，返回会话 id。这一场的判定是「表述过度」，因此有一条改写建议。 */
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

async function accept(target: Rig, id: string, claims: string[]): Promise<RevisedBody> {
  const res = await target.app.request('/api/sessions/' + id + '/revisions', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ claims }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { revised: RevisedBody }).revised;
}

describe('采纳改写', () => {
  it('还没采纳过时取回的是 null，而不是空串或空对象', async () => {
    const t = rig();
    const id = await ranSession(t);
    const res = await t.app.request('/api/sessions/' + id + '/revisions');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { revised: unknown }).revised).toBeNull();
  });

  it('确认之后简历真的改了，改前那句话一个字都不剩', async () => {
    const t = rig();
    const id = await ranSession(t);
    const revised = await accept(t, id, ['C1']);
    expect(revised.applied).toHaveLength(1);
    expect(revised.applied[0]?.claimId).toBe('C1');
    expect(revised.text).toContain(AFTER);
    expect(revised.text.indexOf(QUOTE)).toBe(-1);
    // 其它内容一个字都不能动
    expect(revised.text).toContain('熟悉 TypeScript 与 Node.js。');
    expect(revised.accepted).toEqual(['C1']);
    expect(revised.pending).toEqual([]);
    expect(revised.skipped).toEqual([]);
  });

  it('改写在新区间里的坐标真的指向改后的那句话（导出高亮靠它）', async () => {
    const t = rig();
    const id = await ranSession(t);
    const revised = await accept(t, id, ['C1']);
    const span = revised.spans[0];
    expect(span === undefined ? '' : revised.text.slice(span.start, span.end)).toBe(AFTER);
  });

  it('同一批采纳点两次，结果逐字节相同（采纳是集合不是叠加）', async () => {
    const t = rig();
    const id = await ranSession(t);
    const once = await accept(t, id, ['C1']);
    const twice = await accept(t, id, ['C1']);
    expect(twice.text).toBe(once.text);
    expect(twice.digest).toBe(once.digest);
    expect(twice.applied).toHaveLength(1);
  });

  it('取消勾选再确认，那条就真的从简历里撤掉了', async () => {
    const t = rig();
    const id = await ranSession(t);
    await accept(t, id, ['C1']);
    const back = await accept(t, id, []);
    expect(back.text).toBe(RESUME);
    expect(back.applied).toEqual([]);
    expect(back.accepted).toEqual([]);
    // 建议还在，只是没被采纳：它回到「待定」，不是消失
    expect(back.pending).toEqual(['C1']);
  });

  it('点名一条不存在的主张不会被静默丢掉，而是带理由回来', async () => {
    const t = rig();
    const id = await ranSession(t);
    const revised = await accept(t, id, ['C1', 'C9']);
    expect(revised.applied).toHaveLength(1);
    expect(revised.skipped).toHaveLength(1);
    expect(revised.skipped[0]?.claimId).toBe('C9');
    expect(revised.skipped[0]?.reason).toContain('不在这份简历里');
  });

  it('会话不存在时返回 404，而不是编一份空简历出来', async () => {
    const t = rig();
    const res = await t.app.request('/api/sessions/nope/revisions', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ claims: ['C1'] }),
    });
    expect(res.status).toBe(404);
  });
});

describe('简历导出三件套', () => {
  it('.txt 给的是改完的文本，没采纳过就是原文', async () => {
    const t = rig();
    const id = await ranSession(t);
    const before = await t.app.request('/api/sessions/' + id + '/resume.txt');
    expect(before.status).toBe(200);
    expect(before.headers.get('content-type')).toContain('text/plain');
    expect(await before.text()).toBe(RESUME);
    await accept(t, id, ['C1']);
    const after = await t.app.request('/api/sessions/' + id + '/resume.txt');
    expect(await after.text()).toContain(AFTER);
  });

  it('.html 会标出改过的段落，并附一份改动清单', async () => {
    const t = rig();
    const id = await ranSession(t);
    await accept(t, id, ['C1']);
    const res = await t.app.request('/api/sessions/' + id + '/resume.html?marks=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html.indexOf('mark class')).toBeGreaterThan(-1);
    expect(html).toContain('本版改了什么');
    expect(html).toContain(AFTER);
  });

  it('不加 marks 时导出的是干净的简历：改动清单不该给 HR 看', async () => {
    const t = rig();
    const id = await ranSession(t);
    await accept(t, id, ['C1']);
    const res = await t.app.request('/api/sessions/' + id + '/resume.html');
    const html = await res.text();
    expect(html.indexOf('mark class')).toBe(-1);
    expect(html.indexOf('本版改了什么')).toBe(-1);
    expect(html).toContain(AFTER);
  });

  it('.doc 走 Word 的类型与附件名，内容是同一份 HTML', async () => {
    const t = rig();
    const id = await ranSession(t);
    await accept(t, id, ['C1']);
    const res = await t.app.request('/api/sessions/' + id + '/resume.doc?marks=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/msword');
    expect(res.headers.get('content-disposition')).toContain('.doc');
    expect(await res.text()).toContain(AFTER);
  });

  it('导出不存在的会话返回 404', async () => {
    const t = rig();
    for (const path of ['/resume.txt', '/resume.html', '/resume.doc']) {
      const res = await t.app.request('/api/sessions/nope' + path);
      expect(res.status).toBe(404);
    }
  });
});

describe('撤销改写', () => {
  it('撤销之后回到原文，修订版又变成 null', async () => {
    const t = rig();
    const id = await ranSession(t);
    await accept(t, id, ['C1']);
    const res = await t.app.request('/api/sessions/' + id + '/revisions', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; cleared: boolean; revised: unknown };
    expect(body.ok).toBe(true);
    expect(body.cleared).toBe(true);
    expect(body.revised).toBeNull();
    const after = await t.app.request('/api/sessions/' + id + '/revisions');
    expect(((await after.json()) as { revised: unknown }).revised).toBeNull();
    const txt = await t.app.request('/api/sessions/' + id + '/resume.txt');
    expect(await txt.text()).toBe(RESUME);
  });

  it('没采纳过就撤销：不报错，只是说没东西可撤', async () => {
    const t = rig();
    const id = await ranSession(t);
    const res = await t.app.request('/api/sessions/' + id + '/revisions', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { cleared: boolean }).cleared).toBe(false);
  });
});