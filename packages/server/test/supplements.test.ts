/**
 * 补充说明：用户当场补的那句真话。
 *
 * 值得测的不是「能存能读」，而是三条会悄悄骗到用户的边界：
 *   1. 补的话在简历里必须真的多出一行，而不是把原来那句改掉；
 *   2. 同一句可以改，但不占新名额；满 20 句之后第 21 句要把原因说回来；
 *   3. 删掉之后重算，改完的简历必须回到「没有这一行」。
 *
 * 全部走脚本化模型，没有 API Key 也能跑。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.ts';
import { closeDatabase, listSupplements, migrate, openDatabase, saveSupplement } from '../src/store/index.ts';
import type { Db } from '../src/store/index.ts';
import { createScriptedClient } from './scripted.ts';

const NL = String.fromCharCode(10);

const RESUME = [
  '项目经历',
  '主导重构订单系统，首屏从 2.4s 降到 0.8s。',
  '熟悉 TypeScript 与 Node.js。',
].join(NL);

const QUOTE = '主导重构订单系统';
const AFTER = '负责订单系统重构中的首屏性能优化';
const EXTRA = '日订单 30 万，峰值 QPS 5000。';

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

async function addSupplement(target: Rig, id: string, claimId: string, text: string): Promise<Response> {
  return target.app.request('/api/sessions/' + id + '/supplements', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ claimId: claimId, text: text }),
  });
}

interface RevisedBody {
  text: string;
  applied: { claimId: string; start: number; end: number; before: string; after: string }[];
  accepted: string[];
  pending: string[];
}

async function accept(target: Rig, id: string, claims: string[]): Promise<RevisedBody> {
  const res = await target.app.request('/api/sessions/' + id + '/revisions', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ claims: claims }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { revised: RevisedBody }).revised;
}

describe('补充说明', () => {
  it('写一句就能读回来，指纹是 16 位', async () => {
    const t = rig();
    const id = await ranSession(t);
    const res = await addSupplement(t, id, 'C1', EXTRA);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { supplement: { claimId: string; text: string; digest: string } };
    expect(body.supplement.claimId).toBe('C1');
    expect(body.supplement.text).toBe(EXTRA);
    expect(body.supplement.digest).toHaveLength(16);

    const view = await t.app.request('/api/sessions/' + id);
    const detail = (await view.json()) as { supplements: { claimId: string; text: string }[] };
    expect(detail.supplements).toHaveLength(1);
    expect(detail.supplements[0]?.text).toBe(EXTRA);
  });

  it('几种写不成的情况各说各的理由', async () => {
    const t = rig();
    const id = await ranSession(t);
    const missing = await addSupplement(t, id, '', EXTRA);
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toContain('要指明');

    const noClaim = await addSupplement(t, id, 'C9', EXTRA);
    expect(noClaim.status).toBe(404);
    expect(((await noClaim.json()) as { error: string }).error).toContain('不在这份简历里');

    const noSession = await addSupplement(t, 'nope', 'C1', EXTRA);
    expect(noSession.status).toBe(404);

    const tooShort = await addSupplement(t, id, 'C1', '嗯');
    expect(tooShort.status).toBe(400);
    expect(((await tooShort.json()) as { error: string }).error).toContain('至少 4 个字符');

    const tooLong = await addSupplement(t, id, 'C1', '好'.repeat(201));
    expect(tooLong.status).toBe(400);
    expect(((await tooLong.json()) as { error: string }).error).toContain('最多 200 个字符');

    const wrapped = await addSupplement(t, id, 'C1', '第一行' + NL + '第二行');
    expect(wrapped.status).toBe(400);
    expect(((await wrapped.json()) as { error: string }).error).toContain('别换行');

    expect(listSupplements(t.db, id)).toHaveLength(0);
  });

  it('采纳之后简历真的多出一行，原来那句一个字不动', async () => {
    const t = rig();
    const id = await ranSession(t);
    await addSupplement(t, id, 'C1', EXTRA);
    const revised = await accept(t, id, ['C1']);
    // 一条替换型 + 一条插入型，插入型是「零长度区间」，不是把别的东西删掉
    expect(revised.applied).toHaveLength(2);
    const inserted = revised.applied.filter((item) => item.before === '');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.start).toBe(inserted[0]?.end);
    expect(revised.text).toContain(EXTRA);
    expect(revised.text).toContain(AFTER);
    expect(revised.text.split(NL)).toHaveLength(RESUME.split(NL).length + 1);
    expect(revised.accepted).toEqual(['C1']);
    expect(revised.pending).toEqual([]);
  });

  it('没勾这条主张时补充说明不生效，那句还在库里等着', async () => {
    const t = rig();
    const id = await ranSession(t);
    await addSupplement(t, id, 'C1', EXTRA);
    const revised = await accept(t, id, []);
    expect(revised.text).toBe(RESUME);
    expect(revised.text.indexOf(EXTRA)).toBe(-1);
    expect(revised.pending).toEqual(['C1']);
    expect(listSupplements(t.db, id)).toHaveLength(1);
  });

  it('改一句已有的不占新名额，满 20 句之后第 21 句被拒', async () => {
    const t = rig();
    const id = await ranSession(t);
    await addSupplement(t, id, 'C1', EXTRA);
    // 直接写库：insertClaims 的 ordinal 由数组下标决定，会撞上已有的那一条。
    const stmt = t.db.prepare('INSERT INTO claim (id, session_id, ordinal, text, category, weight, quote, start, end, exact, status, verdict, advice_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)');
    for (let i = 2; i <= 21; i += 1) {
      stmt.run('C' + String(i), id, 90 + i, '第 ' + String(i) + ' 条主张', 'achievement', 0.5, QUOTE, 0, QUOTE.length, 1, 'open');
    }
    for (let i = 2; i <= 20; i += 1) {
      saveSupplement(t.db, { sessionId: id, claimId: 'C' + String(i), text: '第 ' + String(i) + ' 句补充。', digest: 'd' + String(i) });
    }
    expect(listSupplements(t.db, id)).toHaveLength(20);

    const overflow = await addSupplement(t, id, 'C21', '第 21 句补充。');
    expect(overflow.status).toBe(400);
    expect(((await overflow.json()) as { error: string }).error).toContain('一场最多补 20 句');

    const rewrite = await addSupplement(t, id, 'C1', EXTRA + '（改过）');
    expect(rewrite.status).toBe(201);
    expect(listSupplements(t.db, id)).toHaveLength(20);
    expect(listSupplements(t.db, id).find((row) => row.claimId === 'C1')?.text).toBe(EXTRA + '（改过）');
  });

  it('删掉之后重算，改完的简历回到没有这一行', async () => {
    const t = rig();
    const id = await ranSession(t);
    await addSupplement(t, id, 'C1', EXTRA);
    await accept(t, id, ['C1']);
    const removed = await t.app.request('/api/sessions/' + id + '/supplements/C1', { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { removed: boolean }).removed).toBe(true);
    const again = await t.app.request('/api/sessions/' + id + '/supplements/C1', { method: 'DELETE' });
    expect(again.status).toBe(404);
    const revised = await accept(t, id, ['C1']);
    expect(revised.applied).toHaveLength(1);
    expect(revised.text.indexOf(EXTRA)).toBe(-1);
    expect(revised.text.split(NL)).toHaveLength(RESUME.split(NL).length);
  });

  it('报告里单独列出你补的证据，没补就不出现这一节', async () => {
    const t = rig();
    const id = await ranSession(t);
    const empty = await t.app.request('/api/sessions/' + id + '/report.md');
    expect(await empty.text()).not.toContain('你补的证据');

    await addSupplement(t, id, 'C1', EXTRA);
    const res = await t.app.request('/api/sessions/' + id + '/report.md');
    const md = await res.text();
    expect(md).toContain('### 你补的证据（1 句）');
    expect(md).toContain('你补的：' + EXTRA);

    const html = await t.app.request('/api/sessions/' + id + '/report.html');
    expect(await html.text()).toContain('你补的证据');
  });
});
