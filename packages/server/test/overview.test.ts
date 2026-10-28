/**
 * 历史仪表盘的服务层（P11 · C2）。
 *
 * 这组用例要回答的问题是：**打开页面时那块统计，凭什么可信**。
 * 所以每条断言都在对账——接口说的数字，必须等于库里数出来的数字。
 * 聚合算法本身在 shared/test/overview.test.ts 里测过了，这里只验「读数读对了」。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.ts';
import { closeDatabase, migrate, openDatabase } from '../src/store/index.ts';
import type { Db } from '../src/store/index.ts';
import { createScriptedClient } from './scripted.ts';

const RESUME = '项目经历\n主导重构订单系统，首屏从 2.4s 降到 0.8s，日订单量 30 万。';
const QUOTE = '首屏从 2.4s 降到 0.8s';

const EXTRACT = JSON.stringify({
  claims: [{ text: '主导重构订单系统，把首屏从 2.4s 降到 0.8s', quote: QUOTE, category: 'achievement', weight: 0.9 }],
});

function probe(question: string): string {
  return JSON.stringify({
    probes: [{ claimId: 'C1', question, quote: QUOTE, rationale: '性能数字最容易被追问测量方法' }],
  });
}

const ANSWER = JSON.stringify({ answered: true, text: '本地 Chrome 冷启动测的首屏', citedQuotes: [QUOTE] });

/**
 * 这两条 JD 里各自逐字存在的句子。
 *
 * 桩只吐「引文真出现在提示词里」的要求：jd-extract 之后 groundExtracted 会把锚不到 JD 原文的
 * 要求当场丢掉，写死一份与 JD 无关的要求，这一阶段就会静默变成零条（F56 同族）。
 */
const JD_QUOTES = [
  '负责交易与订单核心链路的架构设计与性能优化',
  '熟练掌握 Node.js 与 TypeScript',
  '负责数据仓库与指标体系建设',
  '熟练使用 SQL 与调度工具',
];

function verdictOf(kind: string): string {
  return JSON.stringify({ kind: kind, confidence: 0.8, rationale: '按简历原文与追问记录判断', evidenceQuotes: [QUOTE] });
}

interface OverviewBody {
  window: number;
  sessions: number;
  claims: number;
  verdicts: { judged: number; solid: number; weak: number; counts: Record<string, number> };
  categories: { category: string; label: string; weak: number; total: number }[];
  meanProbes: number | null;
  trend: { sessionId: string; judged: number; solid: number; probes: number | null }[];
  trendNote: string | null;
  resumeGroups: { resumeHash: string; sessions: number; latestId: string }[];
  sameResumeRuns: number;
  jdGroups: { jdKey: string; jdTitle: string; sessions: number; latestId: string }[];
  sameJdRuns: number;
  headline: string;
}

const opened: Db[] = [];

afterEach(() => {
  while (opened.length > 0) {
    const db = opened.pop();
    if (db !== undefined) closeDatabase(db);
  }
});

function rig(): { db: Db; app: ReturnType<typeof createApp>; next: (kind: string) => void } {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  opened.push(db);
  let kind = 'unsupported';
  let probeCalls = 0;
  const client = createScriptedClient((req) => {
    if (req.purpose === 'extract') return EXTRACT;
    if (req.purpose === 'probe') {
      probeCalls += 1;
      if (probeCalls % 3 === 1) return probe('这个 2.4s 是怎么测出来的？');
      if (probeCalls % 3 === 2) return probe('测试设备和网络条件是什么？');
      return JSON.stringify({ probes: [] });
    }
    if (req.purpose === 'answer') return ANSWER;
    if (req.purpose === 'verdict') return verdictOf(kind);
    if (req.purpose === 'jd-extract') {
      const prompt = req.messages[0]?.content ?? '';
      const requirements = JD_QUOTES.filter((quote) => prompt.includes(quote));
      return JSON.stringify({
        requirements: requirements.map((quote) => ({ text: quote, quote, kind: 'must', keywords: [] })),
      });
    }
    if (req.purpose === 'jd-merge') {
      const prompt = req.messages[0]?.content ?? '';
      const groups: { text: string; kind: string; members: string[]; keywords: string[] }[] = [];
      for (const raw of prompt.split(String.fromCharCode(10))) {
        const hit = /^- \[(J[0-9]+#[0-9]+)\] ([^：]*)：(.+)$/.exec(raw.trim());
        if (hit === null) continue;
        groups.push({ text: (hit[3] ?? '').trim(), kind: 'must', members: [hit[1] ?? ''], keywords: [] });
      }
      return JSON.stringify({ groups });
    }
    if (req.purpose === 'jd-match') {
      const prompt = req.messages[0]?.content ?? '';
      const matches: { requirementId: string; claimId: string | null; status: string; reason: string }[] = [];
      for (const raw of prompt.split(String.fromCharCode(10))) {
        const hit = /^- \[(R[0-9]+)\] ([^：]*)：(.+)$/.exec(raw.trim());
        if (hit === null) continue;
        matches.push({ requirementId: hit[1] ?? '', claimId: null, status: 'missing', reason: '这一版简历里没写。' });
      }
      return JSON.stringify({ matches });
    }
    if (req.purpose === 'suggest') return JSON.stringify({ suggestions: [] });
    if (req.purpose === 'counter') return JSON.stringify({ counters: [] });
    return new Error('脚本化模型没有为 purpose=' + req.purpose + ' 准备返回值');
  });
  const app = createApp({ db, client, cassetteDir: '.tmp/fixtures' });
  return { db, app, next: (value: string) => { kind = value; } };
}

const JSON_HEADERS = { 'content-type': 'application/json' };

async function runOnce(target: ReturnType<typeof rig>, resumeText: string = RESUME, jdText: string = ''): Promise<string> {
  const payload: Record<string, unknown> = { resumeText, jobTitle: '后端工程师' };
  if (jdText !== '') payload['jds'] = [{ title: '高级后端工程师', text: jdText }];
  const created = await target.app.request('/api/sessions', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const ran = await target.app.request('/api/sessions/' + id + '/run?stream=0', { method: 'POST' });
  expect(ran.status).toBe(200);
  return id;
}

async function overviewOf(target: ReturnType<typeof rig>, query = ''): Promise<OverviewBody> {
  const res = await target.app.request('/api/sessions/overview' + query);
  expect(res.status).toBe(200);
  return (await res.json()) as OverviewBody;
}

describe('历史仪表盘接口', () => {
  it('一场都没跑也返回 200，说清"还没有跑过任何一场"，不是 404', async () => {
    const t = rig();
    const body = await overviewOf(t);
    expect(body.sessions).toBe(0);
    expect(body.claims).toBe(0);
    expect(body.meanProbes).toBeNull();
    expect(body.trend).toEqual([]);
    expect(body.headline).toBe('还没有跑过任何一场。');
    expect(body.trendNote).toContain('趋势要等第二场');
  });

  it('/overview 不会被当成一个会话 id：会话不存在的那条路由排在它后面', async () => {
    const t = rig();
    const res = await t.app.request('/api/sessions/overview');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // 走错路由的话，这里会出现「会话不存在」或 null
    expect(body['headline']).toBe('还没有跑过任何一场。');
    expect(body['error']).toBeUndefined();
  });

  it('跑完一场：场次、主张数、判定分布、追问次数都与库里的数字对得上', async () => {
    const t = rig();
    t.next('unsupported');
    await runOnce(t);
    const body = await overviewOf(t);
    expect(body.sessions).toBe(1);
    expect(body.claims).toBe(1);
    expect(body.verdicts.judged).toBe(1);
    expect(body.verdicts.solid).toBe(0);
    expect(body.verdicts.weak).toBe(1);
    expect(body.verdicts.counts.unsupported).toBe(1);
    // 追问次数取的是真实的 probe 行数，不是预算里的估计值：脚本每场问两条
    expect(body.trend[0]?.probes).toBe(2);
    expect(body.meanProbes).toBe(2);
    expect(body.headline).toContain('1 场共 1 条主张');
  });

  it('跑两场：判定分布是合起来算的，趋势按时间升序，改完再跑一遍会多一组', async () => {
    const t = rig();
    t.next('unsupported');
    await runOnce(t);
    t.next('solid');
    await runOnce(t);
    const body = await overviewOf(t);
    expect(body.sessions).toBe(2);
    expect(body.claims).toBe(2);
    expect(body.verdicts.judged).toBe(2);
    expect(body.verdicts.solid).toBe(1);
    expect(body.verdicts.weak).toBe(1);
    expect(body.trend).toHaveLength(2);
    expect(body.trendNote).toBeNull();
    // 同一份简历跑了两遍 → 一个组、两场
    expect(body.resumeGroups).toHaveLength(1);
    expect(body.sameResumeRuns).toBe(2);
  });

  it('换了简历就是另一组：同一份跑过几场不会被别的简历混进来', async () => {
    const t = rig();
    t.next('solid');
    await runOnce(t);
    await runOnce(t, '工作经历\n负责支付系统的日常运维，处理过多起线上故障，主导过一次数据库迁移，停机窗口控制在五分钟以内。');
    const body = await overviewOf(t);
    expect(body.resumeGroups).toHaveLength(2);
    expect(body.sameResumeRuns).toBe(1);
  });

  it('limit 决定看最近几场，且 window 会如实回传', async () => {
    const t = rig();
    t.next('solid');
    await runOnce(t);
    await runOnce(t);
    await runOnce(t);
    const limited = await overviewOf(t, '?limit=2');
    expect(limited.window).toBe(2);
    expect(limited.sessions).toBe(2);
    const all = await overviewOf(t);
    expect(all.window).toBeGreaterThan(0);
    expect(all.sessions).toBe(3);
  });

  it('同一个岗位跑两遍归成一组，换了 JD 就是另一组', async () => {
    const t = rig();
    t.next('solid');
    await runOnce(t, RESUME, "岗位职责：负责交易与订单核心链路的架构设计与性能优化，要求熟练掌握 Node.js 与 TypeScript，有日订单百万级系统的性能优化经验，能给出量化的优化结论。");
    await runOnce(t, RESUME, "岗位职责：负责交易与订单核心链路的架构设计与性能优化，要求熟练掌握 Node.js 与 TypeScript，有日订单百万级系统的性能优化经验，能给出量化的优化结论。");
    await runOnce(t, RESUME, "岗位职责：负责数据仓库与指标体系建设，要求熟练使用 SQL 与调度工具，有多源数据接入与治理经验，能独立完成数据质量巡检并输出报告。");
    const body = await overviewOf(t);
    expect(body.sameJdRuns).toBe(2);
    expect(body.jdGroups).toHaveLength(2);
    const top = body.jdGroups[0];
    expect(top?.sessions).toBe(2);
    expect(top?.jdTitle).toBe('高级后端工程师');
  });

  it('粘贴时多带空白不算换岗位，正文改一个字才算', async () => {
    const t = rig();
    t.next('solid');
    await runOnce(t, RESUME, "岗位职责：负责交易与订单核心链路的架构设计与性能优化，要求熟练掌握 Node.js 与 TypeScript，有日订单百万级系统的性能优化经验，能给出量化的优化结论。");
    await runOnce(t, RESUME, '  ' + "岗位职责：负责交易与订单核心链路的架构设计与性能优化，要求熟练掌握 Node.js 与 TypeScript，有日订单百万级系统的性能优化经验，能给出量化的优化结论。" + '\n\n');
    const same = await overviewOf(t);
    expect(same.jdGroups).toHaveLength(1);
    expect(same.sameJdRuns).toBe(2);
    await runOnce(t, RESUME, "岗位职责：负责交易与订单核心链路的架构设计与性能优化，要求熟练掌握 Node.js 与 TypeScript，有日订单千万级系统的性能优化经验，能给出量化的优化结论。");
    const changed = await overviewOf(t);
    expect(changed.jdGroups).toHaveLength(2);
    expect(changed.sameJdRuns).toBe(2);
  });
});
