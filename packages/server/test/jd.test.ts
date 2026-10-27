/**
 * 岗位要求（多 JD 驱动）的端到端测试。
 *
 * 这一层守住四件事，每一件都能被指到具体产物上：
 *   1. 多份 JD 各自抽要求、跨份合并成一条：编号与来源由代码算，不是模型说了算；
 *   2. 每条要求都有一条对照结果：模型漏掉的、指错主张的，由代码补成「简历里没写」；
 *   3. 追问的第二处锚（岗位要求原文）锚不回 JD 时退回普通追问，并把原因写进理由；
 *   4. 第二处锚必须落库：重开一场历史会话时，它不能只剩下简历那一处。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.ts';
import { closeDatabase, migrate, openDatabase } from '../src/store/index.ts';
import type { Db } from '../src/store/index.ts';
import type { Probe, Requirement, RequirementMatch } from '@crossexam/shared';
import { createScriptedClient } from './scripted.ts';
import type { ScriptedClient } from './scripted.ts';

const NL = String.fromCharCode(10);

/** 两份 JD 都写了「5 年以上后端研发经验」，用来验证跨份合并：同一条要求不该出现两次 */
const JD_A = [
  '高级后端工程师（Node.js）',
  '',
  '岗位职责：',
  '1. 负责交易与订单核心链路的架构设计与性能优化；',
  '',
  '任职要求：',
  '1. 本科及以上学历，5 年以上后端研发经验；',
  '2. 精通 Node.js / TypeScript，熟悉 PostgreSQL、Redis。',
  '3. 有带团队的经验。',
].join(NL);

const JD_B = [
  '数据平台后端工程师',
  '',
  '任职要求：',
  '1. 5 年以上后端研发经验，有大规模系统经验；',
  '2. 熟悉 Kafka 与 Flink。',
].join(NL);

const RESUME = [
  '项目经历',
  '主导重构订单系统，首屏从 2.4s 降到 0.8s，日订单量 30 万。',
  '熟悉 TypeScript 与 Node.js。',
].join(NL);

const QUOTE = '首屏从 2.4s 降到 0.8s';
const R1_TEXT = '5 年以上后端研发经验';
const R2_TEXT = '精通 Node.js / TypeScript，熟悉 PostgreSQL、Redis';

const EXTRACT = JSON.stringify({
  claims: [
    { text: '主导订单系统重构，把首屏从 2.4s 降到 0.8s', quote: QUOTE, category: 'achievement', weight: 0.9 },
  ],
});

/** 第三条（跨部门推动）在两份 JD 里都不存在：验证「锚不回的要求宁可丢掉」这条口径 */
const JD_EXTRACT_A = JSON.stringify({
  requirements: [
    { text: R1_TEXT, quote: R1_TEXT, kind: 'must', keywords: ['年限'] },
    { text: R2_TEXT, quote: R2_TEXT, kind: 'must', keywords: ['Node.js', 'Redis'] },
    { text: '有跨部门推动的经验', quote: '有跨部门推动的经验', kind: 'plus', keywords: [] },
  ],
});

const JD_EXTRACT_B = JSON.stringify({
  requirements: [
    { text: R1_TEXT, quote: R1_TEXT, kind: 'must', keywords: ['年限'] },
  ],
});

const JD_MERGE = JSON.stringify({
  groups: [
    { text: R1_TEXT, kind: 'must', members: ['J1#1', 'J2#1'], keywords: ['年限'] },
    { text: R2_TEXT, kind: 'must', members: ['J1#2'], keywords: ['Node.js'] },
  ],
});

const JD_MATCH = JSON.stringify({
  matches: [
    { requirementId: 'R1', claimId: 'C1', status: 'weak', reason: '简历写了后端经验，但没写年限' },
    { requirementId: 'R2', claimId: null, status: 'missing', reason: '简历没有提数据库与缓存' },
  ],
});

/** 对照写坏的版本：漏掉 R2、给 R2 指了一个不存在的主张、还多指了一条不存在的要求 */
const JD_MATCH_BROKEN = JSON.stringify({
  matches: [
    { requirementId: 'R1', claimId: 'C1', status: 'weak', reason: '简历写了后端经验，但没写年限' },
    { requirementId: 'R2', claimId: 'C9', status: 'hit', reason: '看起来能对上' },
    { requirementId: 'R99', claimId: 'C1', status: 'hit', reason: '凭空多出来的一条' },
  ],
});

const ANSWER = JSON.stringify({ answered: true, text: '这是本地 Chrome 冷启动测出来的', citedQuotes: [QUOTE] });
const VERDICT = JSON.stringify({
  kind: 'solid',
  confidence: 0.8,
  rationale: '有具体数字也说得出测量口径',
  evidenceQuotes: [QUOTE],
});
const NO_SUGGEST = JSON.stringify({ suggestions: [] });

function probeJson(question: string, extra: Record<string, unknown>): string {
  return JSON.stringify({
    probes: [
      { claimId: 'C1', question: question, quote: QUOTE, rationale: '岗位要求里点名了这件事', ...extra },
    ],
  });
}

/**
 * 两轮追问：第一轮带岗位要求原文（双锚点），第二轮故意给一个不在 JD 里的引文，
 * 用来验证「锚不回就不带第二个锚，但要说明这一次为什么没带上」。
 */
function scripted(options: { match?: string } = {}): ScriptedClient {
  let probeCalls = 0;
  return createScriptedClient((req) => {
    if (req.purpose === 'extract') return EXTRACT;
    if (req.purpose === 'jd-extract') return req.channel === 'jd-extract:J1' ? JD_EXTRACT_A : JD_EXTRACT_B;
    if (req.purpose === 'jd-merge') return JD_MERGE;
    if (req.purpose === 'jd-match') return options.match ?? JD_MATCH;
    if (req.purpose === 'probe') {
      probeCalls += 1;
      if (probeCalls === 1) return probeJson('岗位写 5 年以上，你简历里没写年限，凭什么？', { requirementId: 'R1', jdQuote: R1_TEXT });
      if (probeCalls === 2) return probeJson('PostgreSQL 和 Redis 你分别用在哪？', { requirementId: 'R2', jdQuote: '这句话不在 JD 原文里' });
      return JSON.stringify({ probes: [] });
    }
    if (req.purpose === 'answer') return ANSWER;
    if (req.purpose === 'verdict') return VERDICT;
    if (req.purpose === 'suggest') return NO_SUGGEST;
    return new Error('脚本化模型没有为 purpose=' + req.purpose + ' 准备返回值');
  });
}

interface Rig {
  db: Db;
  client: ScriptedClient;
  app: ReturnType<typeof createApp>;
}

const opened: Db[] = [];

function rig(extra: { match?: string } = {}): Rig {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  opened.push(db);
  const client = scripted(extra);
  return { db: db, client: client, app: createApp({ db: db, client: client, cassetteDir: '.tmp/fixtures' }) };
}

afterEach(() => {
  while (opened.length > 0) {
    const db = opened.pop();
    if (db !== undefined) closeDatabase(db);
  }
});

/** 只列这个文件真正读的字段：接口形状由 http.test.ts 负责全量盯住 */
interface ViewLike {
  notices: string[];
  claims: { id: string; verdict: string | null }[];
  probes: Probe[];
  jds: { id: string; ordinal: number; title: string; text: string }[];
  requirements: Requirement[];
  requirementMatches: RequirementMatch[];
  requirementRejected: { key: string; text: string; reason: string }[];
  requirementSummary: { hit: number; weak: number; missing: number; total: number };
}

async function createSession(target: Rig, body: Record<string, unknown>): Promise<Response> {
  return target.app.request('/api/sessions', { method: 'POST', body: JSON.stringify(body) });
}

async function jdSession(target: Rig, jds: unknown[]): Promise<{ id: string; jds: { id: string; title: string }[] }> {
  const res = await createSession(target, { resumeText: RESUME, jobTitle: '后端工程师', jds: jds });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; jds: { id: string; title: string }[] };
}

async function run(target: Rig, id: string): Promise<void> {
  const res = await target.app.request('/api/sessions/' + id + '/run?stream=0&panel=tech', { method: 'POST' });
  expect(res.status).toBe(200);
}

async function viewOf(target: Rig, id: string): Promise<ViewLike> {
  const res = await target.app.request('/api/sessions/' + id);
  expect(res.status).toBe(200);
  return (await res.json()) as ViewLike;
}

function probePrompts(target: Rig): string[] {
  return target.client.calls.filter((call) => call.purpose === 'probe').map((call) => call.messages[0]?.content ?? '');
}

const TWO_JDS = [{ title: '', text: JD_A }, { title: '数据平台后端工程师', text: JD_B }];

describe('岗位要求（多 JD）', () => {
  it('多份 JD 各自抽要求、跨份合并成一条，编号与来源都由代码算', async () => {
    const t = rig();
    const created = await jdSession(t, TWO_JDS);
    // 没填标题就用 JD 第一行当岗位名：界面上不该出现「岗位 1」这种名字
    expect(created.jds.map((jd) => jd.id)).toEqual(['J1', 'J2']);
    expect(created.jds.map((jd) => jd.title)).toEqual(['高级后端工程师（Node.js）', '数据平台后端工程师']);

    await run(t, created.id);
    // 抽取是逐份并发，合并与对照各一次——调用次数本身就是成本的一部分
    expect(t.client.countPurpose('jd-extract')).toBe(2);
    expect(t.client.countPurpose('jd-merge')).toBe(1);
    expect(t.client.countPurpose('jd-match')).toBe(1);

    const view = await viewOf(t, created.id);
    expect(view.jds).toHaveLength(2);
    // 两份 JD 都写了的「5 年以上」合并成一条，来源与代表句都记下来
    expect(view.requirements).toHaveLength(2);
    expect(view.requirements[0]).toMatchObject({
      id: 'R1',
      kind: 'must',
      text: R1_TEXT,
      jdId: 'J1',
      sources: ['J1', 'J2'],
    });
    expect(view.requirements[1]?.id).toBe('R2');
    expect(view.requirements[1]?.sources).toEqual(['J1']);
    expect(view.requirementSummary).toEqual({ hit: 0, weak: 1, missing: 1, total: 2 });
    expect(view.requirementMatches.map((item) => item.requirementId)).toEqual(['R1', 'R2']);
    expect(view.requirementMatches[0]?.claimId).toBe('C1');
    // 锚不到 JD 原文的那条没有静默消失，它带着原名与理由留在这里
    expect(view.requirementRejected).toHaveLength(1);
    expect(view.requirementRejected[0]?.text).toBe('有跨部门推动的经验');
    expect(view.requirementRejected[0]?.reason).toContain('锚不到 JD 原文');
  });

  it('追问带上岗位要求原文这第二处锚，锚不回就退回普通追问并说明原因', async () => {
    const t = rig();
    const created = await jdSession(t, TWO_JDS);
    await run(t, created.id);
    const view = await viewOf(t, created.id);

    expect(view.probes).toHaveLength(2);
    expect(view.probes[0]?.requirementId).toBe('R1');
    expect(view.probes[0]?.jdAnchor?.quote).toBe(R1_TEXT);
    expect(view.probes[0]?.jdAnchor?.exact).toBe(true);
    // 锚点必须指得回 JD 原文里那一段，而不是模型顺手编的一句
    const anchor = view.probes[0]?.jdAnchor ?? null;
    expect(anchor === null ? -1 : JD_A.indexOf(anchor.quote)).toBeGreaterThanOrEqual(0);

    // 第二轮给的引文不在 JD 里：追问照问，但不带第二个锚，并且写明这一次为什么没带上
    expect(view.probes[1]?.requirementId).toBeNull();
    expect(view.probes[1]?.jdAnchor).toBeNull();
    expect(view.probes[1]?.rationale).toContain('要求原文锚不回 JD');

    // 提示词里确实把岗位要求摆上桌了——不是只在代码里算了一遍
    const prompts = probePrompts(t);
    // 每人每主张 2 次额度用光之后，编排层不再发起这一轮调用（所以是 2 次不是 3 次）
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('## 岗位要求里对得上的几条');
    expect(prompts[0]).toContain('[R1] 硬性要求｜答得含糊（对应主张 C1');
    expect(prompts[0]).toContain(R1_TEXT);
    // missing 的要求不该出现在追问提示词里：没写过的经历，逼问没有意义
    expect(prompts[0]).not.toContain('## 岗位要求（每一条都要对照一次');
    expect(prompts[0]).not.toContain(R2_TEXT);
  });

  it('报告里有岗位要求对照一节，缺的那几条单独列出来', async () => {
    const t = rig();
    const created = await jdSession(t, TWO_JDS);
    await run(t, created.id);

    const md = await (await t.app.request('/api/sessions/' + created.id + '/report.md')).text();
    expect(md).toContain('## 二、岗位要求对照');
    expect(md).toContain('- 岗位要求来源：2 份 JD');
    expect(md).toContain('- 对照结果：答得上 0 条 / 答得含糊 1 条 / 简历里没写 1 条，共 2 条');
    expect(md).toContain('### R1 · 硬性要求 · 答得含糊');
    // 报告里引的是岗位名（人要读的），不是 J1 这种编号
    expect(md).toContain('> 要求原文：「' + R1_TEXT + '」（来自《高级后端工程师（Node.js）》');
    expect(md).toContain('### 被丢掉的要求（锚不到 JD 原文，没有进入对照）');

    const html = await (await t.app.request('/api/sessions/' + created.id + '/report.html')).text();
    expect(html).toContain('岗位要求对照');
    expect(html).toContain(R1_TEXT);
  });
  it('报告里有「按类别看短板」：同一份判定换个角度摆，且能对回逐条判定', async () => {
    const t = rig();
    const created = await jdSession(t, TWO_JDS);
    await run(t, created.id);
    const view = await viewOf(t, created.id);

    const md = await (await t.app.request('/api/sessions/' + created.id + '/report.md')).text();
    expect(md).toContain('### 按类别看短板');
    // 报告不许自己造一个视角：条数必须与逐条判定对得上
    const judged = view.claims.filter((claim) => claim.verdict !== null);
    expect(judged.length).toBeGreaterThan(0);
    const weak = judged.filter((claim) => claim.verdict !== 'solid');
    if (weak.length === 0) {
      expect(md).toContain(String(view.claims.length) + ' 条主张全部站得住');
    } else {
      expect(md).toContain('已判的 ' + String(judged.length) + ' 条里有 ' + String(weak.length) + ' 条还欠证据');
      expect(md).toContain('最该先补的 ' + String(Math.min(weak.length, 3)) + ' 处');
      expect(md).toContain('（追问 ');
    }

    const html = await (await t.app.request('/api/sessions/' + created.id + '/report.html')).text();
    expect(html).toContain('按类别看短板');
  });

  it('模型漏掉的、指错主张的对照，由代码补成「简历里没写」', async () => {
    const t = rig({ match: JD_MATCH_BROKEN });
    const created = await jdSession(t, TWO_JDS);
    await run(t, created.id);
    const view = await viewOf(t, created.id);

    // 每条要求都必须有一条结果：R2 模型给了但主张不存在，于是降级；
    // R99 指向一条不存在的要求，忽略并说明。
    expect(view.requirementMatches).toHaveLength(2);
    expect(view.requirementMatches[1]?.status).toBe('missing');
    expect(view.requirementMatches[1]?.claimId).toBeNull();
    expect(view.requirementMatches[1]?.reason).toContain('指不出是哪条主张');
    expect(view.notices.some((note) => note.indexOf('不存在的要求编号') >= 0)).toBe(true);
    expect(view.notices.some((note) => note.indexOf('指不出对应主张') >= 0)).toBe(true);
  });

  it('不传 JD 也能跑完整场：纯简历质询里没有岗位要求这一节', async () => {
    const t = rig();
    const created = await jdSession(t, []);
    expect(created.jds).toEqual([]);
    await run(t, created.id);

    const view = await viewOf(t, created.id);
    expect(view.jds).toEqual([]);
    expect(view.requirements).toEqual([]);
    expect(view.requirementSummary).toEqual({ hit: 0, weak: 0, missing: 0, total: 0 });
    expect(view.requirementRejected).toEqual([]);
    expect(t.client.countPurpose('jd-extract')).toBe(0);
    // 没有 JD 就没有第二处锚——这是合法状态，不是缺数据
    expect(view.probes[0]?.requirementId).toBeNull();

    const md = await (await t.app.request('/api/sessions/' + created.id + '/report.md')).text();
    expect(md).toContain('（这场没有上传岗位要求，面试官按各自的经验追问）');
  });

  it('一份 JD 太短、或一次给太多份，都在建会话时挡下来并说清是哪一份', async () => {
    const t = rig();
    const short = await createSession(t, {
      resumeText: RESUME,
      jobTitle: '后端工程师',
      jds: [{ title: '产品经理', text: '负责需求梳理' }],
    });
    expect(short.status).toBe(400);
    const shortBody = (await short.json()) as { error: string };
    expect(shortBody.error).toContain('第 1 份 JD（产品经理）太短了');

    const many = await createSession(t, {
      resumeText: RESUME,
      jobTitle: '后端工程师',
      jds: Array.from({ length: 9 }, (_, index) => ({ title: '岗位' + String(index + 1), text: JD_A })),
    });
    expect(many.status).toBe(400);
    const manyBody = (await many.json()) as { error: string };
    expect(manyBody.error).toContain('最多 8 份 JD，收到 9 份');
  });
});
