/**
 * 成长档案的服务层（P12 · ②）。
 *
 * 这组用例回答的是：**沿版本链往上走这件事，凭什么可信**。
 * 所以每条断言都在对账——接口说的版数、判定、追问次数，必须等于库里数出来的数字；
 * 链断了要如实说断了，不许把两段接成一条。
 * 连链算法本身在 shared/test/growth.test.ts 里测过了，这里只验「链走对了」。
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

function verdictOf(kind: string): string {
  return JSON.stringify({ kind: kind, confidence: 0.8, rationale: '按简历原文与追问记录判断', evidenceQuotes: [QUOTE] });
}

interface GrowthBody {
  sessionId: string;
  rootId: string;
  broken: boolean;
  brokenAt: string | null;
  window: number;
  order: string[];
  versions: { sessionId: string; version: number; judged: number; solid: number; probes: number | null }[];
  trails: { key: string; versions: number; text: string; verdict: string | null; persistent: boolean; presentInLatest: boolean }[];
  persistent: { text: string }[];
  fixed: { text: string }[];
  single: number;
  headline: string;
  trailNote: string | null;
}

const opened: Db[] = [];

afterEach(() => {
  while (opened.length > 0) {
    const db = opened.pop();
    if (db !== undefined) closeDatabase(db);
  }
});

interface Rig {
  db: Db;
  app: ReturnType<typeof createApp>;
  next: (kind: string) => void;
  /** 换一份简历时，抽取阶段也要跟着换一句话 */
  extractAs: (text: string, quote: string) => void;
}

function rig(): Rig {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  opened.push(db);
  let kind = 'unsupported';
  let extract = EXTRACT;
  const client = createScriptedClient((req) => {
    if (req.purpose === 'extract') return extract;
    if (req.purpose === 'probe') return probe('这个 2.4s 是怎么测出来的？');
    if (req.purpose === 'answer') return ANSWER;
    if (req.purpose === 'verdict') return verdictOf(kind);
    if (req.purpose === 'suggest') return JSON.stringify({ suggestions: [] });
    if (req.purpose === 'counter') return JSON.stringify({ counters: [] });
    return new Error('脚本化模型没有为 purpose=' + req.purpose + ' 准备返回值');
  });
  const app = createApp({ db, client, cassetteDir: '.tmp/fixtures' });
  return {
    db,
    app,
    next: (value: string) => { kind = value; },
    extractAs: (text: string, quote: string) => {
      extract = JSON.stringify({ claims: [{ text, quote, category: 'experience', weight: 0.9 }] });
    },
  };
}

const JSON_HEADERS = { 'content-type': 'application/json' };

async function runOnce(
  target: ReturnType<typeof rig>,
  options: { parentSessionId?: string; resumeText?: string } = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    resumeText: options.resumeText ?? RESUME,
    jobTitle: '后端工程师',
  };
  if (options.parentSessionId !== undefined) body['parentSessionId'] = options.parentSessionId;
  const created = await target.app.request('/api/sessions', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const ran = await target.app.request('/api/sessions/' + id + '/run?stream=0', { method: 'POST' });
  expect(ran.status).toBe(200);
  return id;
}

async function growthOf(target: ReturnType<typeof rig>, id: string): Promise<GrowthBody> {
  const res = await target.app.request('/api/sessions/' + id + '/growth');
  expect(res.status).toBe(200);
  return (await res.json()) as GrowthBody;
}

describe('成长档案接口', () => {
  it('没有这一场就是 404，不是 200 加一个空档案', async () => {
    const t = rig();
    const res = await t.app.request('/api/sessions/s_nope/growth');
    expect(res.status).toBe(404);
  });

  it('单个会话算第一版：一条轨迹、一个点，并且说明轨迹要等第二版', async () => {
    const t = rig();
    t.next('unsupported');
    const id = await runOnce(t);
    const body = await growthOf(t, id);
    expect(body.versions).toHaveLength(1);
    expect(body.versions[0]?.version).toBe(0);
    expect(body.rootId).toBe(id);
    expect(body.broken).toBe(false);
    expect(body.trails).toHaveLength(1);
    expect(body.single).toBe(1);
    expect(body.trailNote).toContain('再按「改完再跑一遍」跑一版');
  });

  it('改完再跑一遍：两版连成一条轨迹，判定从证据缺失变成站得住', async () => {
    const t = rig();
    t.next('unsupported');
    const first = await runOnce(t);
    t.next('solid');
    const second = await runOnce(t, { parentSessionId: first });
    const body = await growthOf(t, second);
    expect(body.versions).toHaveLength(2);
    expect(body.order).toEqual([first, second]);
    expect(body.rootId).toBe(first);
    expect(body.broken).toBe(false);
    expect(body.trails).toHaveLength(1);
    expect(body.trails[0]?.versions).toBe(2);
    expect(body.trails[0]?.verdict).toBe('solid');
    expect(body.fixed).toHaveLength(1);
    expect(body.persistent).toHaveLength(0);
    // 追问次数与库里真实行数对得上（脚本每场只问一条）
    expect(body.versions[0]?.probes).toBe(1);
    expect(body.versions[1]?.probes).toBe(1);
    expect(body.headline).toContain('2 版');
  });

  it('改了两版还是被打回：稳稳地进「改了还在被打回」', async () => {
    const t = rig();
    t.next('unsupported');
    const first = await runOnce(t);
    const second = await runOnce(t, { parentSessionId: first });
    const third = await runOnce(t, { parentSessionId: second });
    const body = await growthOf(t, third);
    expect(body.versions).toHaveLength(3);
    expect(body.persistent).toHaveLength(1);
    expect(body.trails[0]?.versions).toBe(3);
    expect(body.headline).toContain('改了还在被打回 1 条');
  });

  it('从中间某一版点进来，也能看到它前面的那些版', async () => {
    const t = rig();
    t.next('unsupported');
    const first = await runOnce(t);
    const second = await runOnce(t, { parentSessionId: first });
    t.next('solid');
    const third = await runOnce(t, { parentSessionId: second });
    const fromMiddle = await growthOf(t, second);
    expect(fromMiddle.versions).toHaveLength(2);
    expect(fromMiddle.order).toEqual([first, second]);
    expect(fromMiddle.sessionId).toBe(second);
    // 从最新的那一版看是三版
    const fromLatest = await growthOf(t, third);
    expect(fromLatest.versions).toHaveLength(3);
  });

  it('上一版被删了：如实说断在哪里，不把两段接成一条', async () => {
    const t = rig();
    t.next('unsupported');
    const first = await runOnce(t);
    const second = await runOnce(t, { parentSessionId: first });
    const removed = await t.app.request('/api/sessions/' + first, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    const body = await growthOf(t, second);
    expect(body.broken).toBe(true);
    expect(body.brokenAt).toBe(first);
    expect(body.versions).toHaveLength(1);
    expect(body.rootId).toBe(second);
  });

  it('换了简历的版本链不会把旧简历的主张混进来', async () => {
    const t = rig();
    t.next('solid');
    const first = await runOnce(t);
    // 第二版的简历换成另一段经历，抽取出来的主张也就跟着换了
    t.extractAs('负责支付系统的日常运维，处理过多起线上故障', '负责支付系统的日常运维');
    const second = await runOnce(t, {
      parentSessionId: first,
      resumeText: '工作经历\n负责支付系统的日常运维，处理过多起线上故障，主导过一次数据库迁移，停机窗口控制在五分钟以内。',
    });
    const body = await growthOf(t, second);
    expect(body.versions).toHaveLength(2);
    // 上一版那条主张与这一版的文本对不上，于是各成一条轨迹
    expect(body.trails.length).toBeGreaterThanOrEqual(2);
    expect(body.trails.some((trail) => trail.presentInLatest === false)).toBe(true);
  });
});
