/**
 * 版本对比的服务层（P11 · C1）。
 *
 * 这组用例要回答的问题只有一个：**改完再跑一遍，界面凭什么说"变好了"**。
 * 所以每条断言都落在"库里是什么、接口说什么"这两者的对账上，
 * 而不是落在对比函数自己的中间结果上——中间结果在 shared 的纯函数测试里已经测过了。
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

const opened: Db[] = [];

afterEach(() => {
  while (opened.length > 0) {
    const db = opened.pop();
    if (db !== undefined) closeDatabase(db);
  }
});

/**
 * 两场用同一个脚本化模型，但判定内容由一个开关控制：
 * 第一场判"表述过度"，第二场判"站得住"。这就是真实用法的形状——
 * 用户照着建议改完简历再跑，模型看到的东西变了，判定跟着变。
 */
function rig(): { db: Db; app: ReturnType<typeof createApp>; next: (kind: string) => void } {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  opened.push(db);
  let kind = 'overstated';
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
    if (req.purpose === 'suggest') return JSON.stringify({ suggestions: [] });
    if (req.purpose === 'counter') return JSON.stringify({ counters: [] });
    return new Error('脚本化模型没有为 purpose=' + req.purpose + ' 准备返回值');
  });
  const app = createApp({ db, client, cassetteDir: '.tmp/fixtures' });
  return { db, app, next: (value: string) => { kind = value; } };
}

const JSON_HEADERS = { 'content-type': 'application/json' };

async function createSession(target: ReturnType<typeof rig>, body: Record<string, unknown>): Promise<Response> {
  return target.app.request('/api/sessions', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

async function runSession(target: ReturnType<typeof rig>, id: string): Promise<void> {
  const res = await target.app.request('/api/sessions/' + id + '/run?stream=0', { method: 'POST' });
  expect(res.status).toBe(200);
}

async function compareOf(target: ReturnType<typeof rig>, id: string): Promise<Record<string, unknown>> {
  const res = await target.app.request('/api/sessions/' + id + '/compare');
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

interface ComparisonBody {
  first: boolean;
  parentMissing: boolean;
  parentSessionId: string | null;
  resumeChanged: boolean;
  parent: { id: string } | null;
  comparison: {
    headline: string;
    improved: { prev: { id: string }; next: { id: string }; shift: string }[];
    worsened: unknown[];
    added: unknown[];
    removed: unknown[];
    before: { judged: number; solid: number };
    after: { judged: number; solid: number };
  } | null;
}

describe('改完再跑一遍的对比接口', () => {
  it('第一版明确说自己是第一版，不是 404 也不是空对象', async () => {
    const t = rig();
    const created = await createSession(t, { resumeText: RESUME, jobTitle: '后端工程师' });
    const { id } = (await created.json()) as { id: string };
    const body = (await compareOf(t, id)) as unknown as ComparisonBody;
    expect(body.first).toBe(true);
    expect(body.parentMissing).toBe(false);
    expect(body.parentSessionId).toBeNull();
    expect(body.comparison).toBeNull();
  });

  it('会话不存在时是 404，与"没有上一版"分得开', async () => {
    const t = rig();
    const res = await t.app.request('/api/sessions/s-no-such/compare');
    expect(res.status).toBe(404);
  });

  it('指一个不存在的上一场：当场 400，说清找不到哪一场', async () => {
    const t = rig();
    const res = await createSession(t, { resumeText: RESUME, parentSessionId: 's-ghost' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('s-ghost');
  });

  it('跑两场：第二场的判定变化能算出来，且与库里的判定一致', async () => {
    const t = rig();

    t.next('overstated');
    const first = await createSession(t, { resumeText: RESUME, jobTitle: '后端工程师' });
    const firstId = ((await first.json()) as { id: string }).id;
    await runSession(t, firstId);

    t.next('solid');
    const second = await createSession(t, { resumeText: RESUME, jobTitle: '后端工程师', parentSessionId: firstId });
    const secondId = ((await second.json()) as { id: string }).id;
    await runSession(t, secondId);

    const body = (await compareOf(t, secondId)) as unknown as ComparisonBody;
    expect(body.first).toBe(false);
    expect(body.parent).toEqual({ id: firstId, jobTitle: '后端工程师', createdAt: expect.any(String), resumeHash: expect.any(String) });
    expect(body.comparison).not.toBeNull();
    const comparison = body.comparison!;
    expect(comparison.before.solid).toBe(0);
    expect(comparison.after.solid).toBe(1);
    expect(comparison.improved).toHaveLength(1);
    expect(comparison.improved[0]?.shift).toBe('better');
    expect(comparison.worsened).toHaveLength(0);
    expect(comparison.headline).toContain('站得住 0 → 1 条');

    // 与库里的判定对账：对比层不许自己编一个判定出来
    const detail = await t.app.request('/api/sessions/' + secondId);
    const view = (await detail.json()) as { claims: { id: string; verdict: string | null }[] };
    expect(view.claims.every((claim) => claim.verdict === 'solid')).toBe(true);
  });

  it('第一场反而更差时说变差，不说变好', async () => {
    const t = rig();

    t.next('solid');
    const first = await createSession(t, { resumeText: RESUME, jobTitle: '后端工程师' });
    const firstId = ((await first.json()) as { id: string }).id;
    await runSession(t, firstId);

    t.next('unanswerable');
    const second = await createSession(t, { resumeText: RESUME, jobTitle: '后端工程师', parentSessionId: firstId });
    const secondId = ((await second.json()) as { id: string }).id;
    await runSession(t, secondId);

    const body = (await compareOf(t, secondId)) as unknown as ComparisonBody;
    expect(body.comparison?.worsened).toHaveLength(1);
    expect(body.comparison?.improved).toHaveLength(0);
    expect(body.comparison?.headline).toContain('变差 1 条');
  });

  it('简历改过了就说改过了：两份不一样时 resumeChanged 为真', async () => {
    const t = rig();
    const first = await createSession(t, { resumeText: RESUME, jobTitle: '后端工程师' });
    const firstId = ((await first.json()) as { id: string }).id;
    const second = await createSession(t, {
      resumeText: RESUME + '（已按建议补充测量口径）',
      jobTitle: '后端工程师',
      parentSessionId: firstId,
    });
    const secondId = ((await second.json()) as { id: string }).id;
    const body = (await compareOf(t, secondId)) as unknown as ComparisonBody;
    expect(body.resumeChanged).toBe(true);
  });

  it('上一版被删掉：说 parentMissing，而不是装作这是第一版', async () => {
    const t = rig();
    const first = await createSession(t, { resumeText: RESUME, jobTitle: '后端工程师' });
    const firstId = ((await first.json()) as { id: string }).id;
    const second = await createSession(t, { resumeText: RESUME, parentSessionId: firstId });
    const secondId = ((await second.json()) as { id: string }).id;

    const removed = await t.app.request('/api/sessions/' + firstId, { method: 'DELETE' });
    expect(removed.status).toBe(200);

    const body = (await compareOf(t, secondId)) as unknown as ComparisonBody;
    expect(body.first).toBe(false);
    expect(body.parentMissing).toBe(true);
    expect(body.parentSessionId).toBe(firstId);
    expect(body.comparison).toBeNull();
  });

  it('父会话 id 从建会话的返回值里带回来，界面不必自己记', async () => {
    const t = rig();
    const first = await createSession(t, { resumeText: RESUME, jobTitle: '后端工程师' });
    const firstId = ((await first.json()) as { id: string }).id;
    const res = await createSession(t, { resumeText: RESUME, parentSessionId: firstId });
    const created = (await res.json()) as { id: string; parentSessionId: string | null };
    expect(created.parentSessionId).toBe(firstId);
    const view = (await (await t.app.request('/api/sessions/' + created.id)).json()) as {
      session: { parentSessionId: string | null };
    };
    expect(view.session.parentSessionId).toBe(firstId);
  });
});


describe('报告里的「比上次」', () => {
  it('第一版报告里没有这一节，章节编号也不动', async () => {
    const t = rig();
    const created = await createSession(t, { resumeText: RESUME, jobTitle: '后端工程师' });
    const id = ((await created.json()) as { id: string }).id;
    await runSession(t, id);
    const md = await (await t.app.request('/api/sessions/' + id + '/report.md')).text();
    expect(md).not.toContain('## 比上次');
    expect(md).toContain('一、主张与判定');
  });

  it('第二版报告里，比上次排在主张与判定之前，且后面章节整体 +1', async () => {
    const t = rig();
    t.next('overstated');
    const first = await createSession(t, { resumeText: RESUME, jobTitle: '后端工程师' });
    const firstId = ((await first.json()) as { id: string }).id;
    await runSession(t, firstId);

    t.next('solid');
    const second = await createSession(t, { resumeText: RESUME, jobTitle: '后端工程师', parentSessionId: firstId });
    const secondId = ((await second.json()) as { id: string }).id;
    await runSession(t, secondId);

    const md = await (await t.app.request('/api/sessions/' + secondId + '/report.md')).text();
    expect(md).toContain('## 比上次');
    expect(md.indexOf('## 比上次')).toBeLessThan(md.indexOf('二、主张与判定'));
    expect(md).not.toContain('一、主张与判定');
    expect(md).toContain('站得住 0 → 1 条');
    expect(md).toContain('七、复现方式');

    const html = await (await t.app.request('/api/sessions/' + secondId + '/report.html')).text();
    expect(html).toContain('<h2>比上次</h2>');
    expect(html).toContain('七、复现方式');
  });

  it('同一份简历再跑一遍：报告直说简历没改，别把模型波动说成改好了', async () => {
    const t = rig();
    const first = await createSession(t, { resumeText: RESUME, jobTitle: '后端工程师' });
    const firstId = ((await first.json()) as { id: string }).id;
    await runSession(t, firstId);
    const second = await createSession(t, { resumeText: RESUME, jobTitle: '后端工程师', parentSessionId: firstId });
    const secondId = ((await second.json()) as { id: string }).id;
    await runSession(t, secondId);
    const md = await (await t.app.request('/api/sessions/' + secondId + '/report.md')).text();
    expect(md).toContain('与上一版完全相同');
  });
});
