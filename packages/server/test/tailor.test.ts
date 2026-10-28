/**
 * 一岗一版的服务层（P12 · ③）。
 *
 * 这组用例要回答的问题只有一个：**按岗位筛出来的那一版，凭什么说「留下的是对得上的、去掉的是对不上的」**。
 * 所以断言落在「哪几行留下了、每一行因为哪条要求留下」上，而不是落在切分算法本身——
 * 切分与配对的纯函数测试在 packages/shared/test/tailor.test.ts 里。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.ts';
import { readZipEntry } from '../src/import/zip.ts';
import { closeDatabase, migrate, openDatabase } from '../src/store/index.ts';
import type { Db } from '../src/store/index.ts';
import { createScriptedClient } from './scripted.ts';

const NL = String.fromCharCode(10);

const JD_A = [
  '高级后端工程师',
  '任职要求：',
  '1. 有性能优化经验，能给出量化结论',
  '2. 具备良好的沟通能力与主人翁意识',
].join(NL);

const JD_B = [
  '数据平台工程师',
  '任职要求：',
  '1. 有缓存与高并发经验',
  '2. 熟悉 Kafka 与 Flink',
].join(NL);

const RESUME = [
  '项目经历',
  '- 主导重构订单系统，首屏从 2.4s 降到 0.8s。',
  '- 引入 Redis 缓存，QPS 从 800 提升到 5000。',
  '- 学习能力强，抗压能力强。',
  '教育背景',
  '- 本科，计算机科学与技术。',
].join(NL);

const QUOTE_1 = '首屏从 2.4s 降到 0.8s';
const QUOTE_2 = 'QPS 从 800 提升到 5000';
const QUOTE_3 = '学习能力强，抗压能力强';
const R1 = '有性能优化经验，能给出量化结论';
const R2 = '具备良好的沟通能力与主人翁意识';
const R3 = '有缓存与高并发经验';
const R4 = '熟悉 Kafka 与 Flink';

const EXTRACT = JSON.stringify({
  claims: [
    { text: '主导重构订单系统，把首屏从 2.4s 降到 0.8s', quote: QUOTE_1, category: 'metric', weight: 0.9 },
    { text: '引入 Redis 缓存，QPS 从 800 提升到 5000', quote: QUOTE_2, category: 'metric', weight: 0.8 },
    { text: '学习能力强，抗压能力强', quote: QUOTE_3, category: 'skill', weight: 0.5 },
  ],
});

const JD_EXTRACT_A = JSON.stringify({
  requirements: [
    { text: R1, quote: R1, kind: 'must', keywords: ['性能'] },
    { text: R2, quote: R2, kind: 'must', keywords: ['沟通'] },
  ],
});

const JD_EXTRACT_B = JSON.stringify({
  requirements: [
    { text: R3, quote: R3, kind: 'must', keywords: ['缓存'] },
    { text: R4, quote: R4, kind: 'plus', keywords: ['Kafka'] },
  ],
});

const JD_MERGE = JSON.stringify({
  groups: [
    { text: R1, kind: 'must', members: ['J1#1'], keywords: ['性能'] },
    { text: R2, kind: 'must', members: ['J1#2'], keywords: ['沟通'] },
    { text: R3, kind: 'must', members: ['J2#1'], keywords: ['缓存'] },
    { text: R4, kind: 'plus', members: ['J2#2'], keywords: ['Kafka'] },
  ],
});

const JD_MATCH = JSON.stringify({
  matches: [
    { requirementId: 'R1', claimId: 'C1', status: 'hit', reason: '简历有具体性能数字' },
    { requirementId: 'R2', claimId: null, status: 'missing', reason: '简历没写沟通' },
    { requirementId: 'R3', claimId: 'C2', status: 'hit', reason: '简历写了缓存与 QPS' },
    { requirementId: 'R4', claimId: null, status: 'missing', reason: '简历没写 Kafka' },
  ],
});

function claimIdOf(prompt: string): string {
  const hit = /\[(C[0-9]+)\]/.exec(prompt);
  return hit === null ? 'C1' : hit[1] ?? 'C1';
}

function quoteOf(prompt: string): string {
  const hit = /原文引文：([^\n]*)/.exec(prompt);
  return hit === null ? QUOTE_1 : (hit[1] ?? '').trim();
}

const opened: Db[] = [];

afterEach(() => {
  while (opened.length > 0) {
    const db = opened.pop();
    if (db !== undefined) closeDatabase(db);
  }
});

function rig(): { db: Db; app: ReturnType<typeof createApp> } {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  opened.push(db);
  let probeCalls = 0;
  const client = createScriptedClient((req) => {
    if (req.purpose === 'extract') return EXTRACT;
    if (req.purpose === 'jd-extract') return req.channel === 'jd-extract:J1' ? JD_EXTRACT_A : JD_EXTRACT_B;
    if (req.purpose === 'jd-merge') return JD_MERGE;
    if (req.purpose === 'jd-match') return JD_MATCH;
    if (req.purpose === 'probe') {
      probeCalls += 1;
      if (probeCalls > 1) return JSON.stringify({ probes: [] });
      return JSON.stringify({
        probes: [{ claimId: 'C1', question: '这个 2.4s 是怎么测出来的？', quote: QUOTE_1, rationale: '性能数字最容易被追问测量方法' }],
      });
    }
    if (req.purpose === 'answer') return JSON.stringify({ answered: true, text: '本地 Chrome 冷启动测的', citedQuotes: [QUOTE_1] });
    if (req.purpose === 'verdict') {
      return JSON.stringify({
        kind: 'overstated',
        confidence: 0.7,
        rationale: '数字没错但没写口径',
        evidenceQuotes: [quoteOf(req.messages[0]?.content ?? '')],
      });
    }
    if (req.purpose === 'suggest') {
      const prompt = req.messages[0]?.content ?? '';
      const quote = quoteOf(prompt);
      return JSON.stringify({
        claimId: claimIdOf(prompt),
        problem: '数字没有口径',
        before: quote,
        after: quote + '（口径见附录）',
        why: '不写清测量条件，面试官一定会追问',
      });
    }
    if (req.purpose === 'counter') return JSON.stringify({ counters: [] });
    return new Error('脚本化模型没有为 purpose=' + req.purpose + ' 准备返回值');
  });
  return { db: db, app: createApp({ db: db, client: client, cassetteDir: '.tmp/fixtures' }) };
}

async function sessionWith(t: ReturnType<typeof rig>, jds: unknown[] | null): Promise<string> {
  const body: Record<string, unknown> = { resumeText: RESUME, jobTitle: '后端工程师' };
  if (jds !== null) body['jds'] = jds;
  const res = await t.app.request('/api/sessions', { method: 'POST', body: JSON.stringify(body) });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string };
  const run = await t.app.request('/api/sessions/' + created.id + '/run?stream=0&panel=tech', { method: 'POST' });
  expect(run.status).toBe(200);
  return created.id;
}

interface TailorReply {
  ok: boolean;
  base: string;
  text: string;
  headline: string;
  note: string | null;
  keptClaims: string[];
  droppedClaims: string[];
  missingRequirements: number;
  requirementCount: number;
  supportedRequirements: number;
  lines: { text: string; keep: boolean; reason: string; claimIds: string[]; requirementIds: string[] }[];
}

async function tailorOf(t: ReturnType<typeof rig>, id: string, jd: string): Promise<TailorReply> {
  const res = await t.app.request('/api/sessions/' + id + '/tailor?jd=' + jd);
  expect(res.status).toBe(200);
  return (await res.json()) as TailorReply;
}

const TWO_JDS = [
  { title: '高级后端工程师', text: JD_A },
  { title: '数据平台工程师', text: JD_B },
];

describe('一岗一版：按岗位筛出该留的那几条', () => {
  it('会话不存在就 404，不假装筛得出来', async () => {
    const t = rig();
    const res = await t.app.request('/api/sessions/s_missing/tailor');
    expect(res.status).toBe(404);
  });

  it('这一场没有岗位要求时明确拒绝：不拿原文冒充「按岗位筛过的一版」', async () => {
    const t = rig();
    const id = await sessionWith(t, null);
    const res = await t.app.request('/api/sessions/' + id + '/tailor');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('岗位要求');
  });

  it('按第一份 JD 筛：对得上它的那条留下，对不上的两条去掉，没有主张的行照留', async () => {
    const t = rig();
    const id = await sessionWith(t, TWO_JDS);
    const view = await tailorOf(t, id, 'J1');
    expect(view.ok).toBe(true);
    expect(view.base).toBe('original');
    expect(view.keptClaims).toEqual(['C1']);
    expect(view.droppedClaims).toEqual(['C2', 'C3']);
    expect(view.text).toContain('主导重构订单系统');
    expect(view.text).not.toContain('QPS 从 800 提升到 5000');
    expect(view.text).not.toContain('学习能力强');
    // 与任何要求都无关的行留下：岗位没提教育背景，不等于教育背景该删
    expect(view.text).toContain('本科，计算机科学与技术。');
    expect(view.text).toContain('教育背景');
    expect(view.requirementCount).toBe(2);
    expect(view.supportedRequirements).toBe(1);
    expect(view.missingRequirements).toBe(1);
    expect(view.headline).toBe('按《高级后端工程师》：留下 1 条主张、去掉 2 条，另有 1 条要求简历里没写');
  });

  it('换一份 JD：留下的是另一条主张，两版文本真的不一样', async () => {
    const t = rig();
    const id = await sessionWith(t, TWO_JDS);
    const first = await tailorOf(t, id, 'J1');
    const second = await tailorOf(t, id, 'J2');
    expect(second.keptClaims).toEqual(['C2']);
    expect(second.droppedClaims).toEqual(['C1', 'C3']);
    expect(second.text).toContain('QPS 从 800 提升到 5000');
    expect(second.text).not.toContain('主导重构订单系统');
    expect(second.text).not.toBe(first.text);
  });

  it('留下的每一行都说得清是因为哪条要求，去掉的每一行也说得清为什么', async () => {
    const t = rig();
    const id = await sessionWith(t, TWO_JDS);
    const view = await tailorOf(t, id, 'J1');
    const kept = view.lines.find((line) => line.claimIds.includes('C1'));
    expect(kept?.keep).toBe(true);
    expect(kept?.reason).toBe('matched');
    expect(kept?.requirementIds).toEqual(['R1']);
    const dropped = view.lines.find((line) => line.claimIds.includes('C2'));
    expect(dropped?.keep).toBe(false);
    expect(dropped?.reason).toBe('unmatched');
    expect(dropped?.requirementIds).toEqual([]);
  });

  it('这一场里没有那份 JD 就 404，不悄悄按第一份筛', async () => {
    const t = rig();
    const id = await sessionWith(t, TWO_JDS);
    const res = await t.app.request('/api/sessions/' + id + '/tailor?jd=J9');
    expect(res.status).toBe(404);
  });

  it('导出三件套与筛出来的那一版逐字一致，样式全部内联、没有外链', async () => {
    const t = rig();
    const id = await sessionWith(t, TWO_JDS);
    const view = await tailorOf(t, id, 'J1');

    const text = await t.app.request('/api/sessions/' + id + '/tailored.txt?jd=J1');
    expect(text.status).toBe(200);
    expect(await text.text()).toBe(view.text);
    expect(text.headers.get('content-disposition') ?? '').toContain('-tailored.txt');

    const html = await t.app.request('/api/sessions/' + id + '/tailored.html?jd=J1');
    expect(html.status).toBe(200);
    const page = await html.text();
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('按《高级后端工程师》筛出的一版');
    // 段数按「留下的行 / 去掉的行」算：小节标题与无关行都算留下的行（项目经历 + 那条主张 + 教育背景 + 学历）
    expect(page).toContain('留下 4 段、去掉 2 段');
    expect(page).not.toContain('http://');
    expect(page).not.toContain('https://');

    const doc = await t.app.request('/api/sessions/' + id + '/tailored.docx?jd=J1');
    expect(doc.status).toBe(200);
    expect(doc.headers.get('content-type') ?? '').toContain(
      'openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(doc.headers.get('content-disposition') ?? '').toContain('-tailored.docx');
    const docBytes = new Uint8Array(await doc.arrayBuffer());
    expect(docBytes[0]).toBe(0x50);
    expect(readZipEntry(docBytes, 'word/document.xml')).not.toBeNull();
  });

  it('采纳过改写之后，这一版是在改后的文本上筛的', async () => {
    const t = rig();
    const id = await sessionWith(t, TWO_JDS);
    const before = await tailorOf(t, id, 'J1');
    expect(before.base).toBe('original');
    expect(before.text).not.toContain('（口径见附录）');

    const accepted = await t.app.request('/api/sessions/' + id + '/revisions', {
      method: 'POST',
      body: JSON.stringify({ claims: ['C1'] }),
    });
    expect(accepted.status).toBe(200);

    const after = await tailorOf(t, id, 'J1');
    expect(after.base).toBe('revised');
    expect(after.text).toContain('（口径见附录）');
    expect(after.keptClaims).toEqual(['C1']);
    expect(after.droppedClaims).toEqual(['C2', 'C3']);
  });
});

describe('一岗一版的 HTML 抬头', () => {
  it('抬头写清按哪份岗位、留了几段去了几段，而不是让人自己猜', async () => {
    const t = rig();
    const id = await sessionWith(t, TWO_JDS);
    const html = await t.app.request('/api/sessions/' + id + '/tailored.html?jd=J2');
    const page = await html.text();
    expect(page).toContain('按《数据平台工程师》筛出的一版');
    expect(page).toContain('留下 4 段、去掉 2 段');
    expect(page).toContain('原文一个字都没有改');
    expect(page).not.toContain('本版改了什么');
  });
});
