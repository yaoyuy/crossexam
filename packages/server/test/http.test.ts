/**
 * HTTP 层的端到端测试：建会话 → 开跑（JSON 与 SSE 两条路）→ 读结果 → 下载报告。
 *
 * 为什么这层值得测：
 *   1. SSE 是"过程可复现"的对外接口，事件带 seq 才能断线续传，不能只测"跑完了"；
 *   2. 前端所有判断都基于这些响应形状，形状变了测试要先红，而不是等演示时才发现；
 *   3. 这些断言同时也是给评审看的接口文档——想接前端的同学读这一份就够了。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.ts';
import { closeDatabase, migrate, openDatabase } from '../src/store/index.ts';
import type { Db } from '../src/store/index.ts';
import { createScriptedClient } from './scripted.ts';
import type { ScriptedClient } from './scripted.ts';

const RESUME = [
  '项目经历',
  '主导重构订单系统，首屏从 2.4s 降到 0.8s，日订单量 30 万。',
  '熟悉 TypeScript 与 Node.js。',
].join(String.fromCharCode(10));

const QUOTE = '首屏从 2.4s 降到 0.8s';

const EXTRACT = JSON.stringify({
  claims: [
    { text: '主导订单系统重构，把首屏从 2.4s 降到 0.8s', quote: QUOTE, category: 'achievement', weight: 0.9 },
  ],
});

function probe(question: string): string {
  return JSON.stringify({
    probes: [{ claimId: 'C1', question, quote: QUOTE, rationale: '性能数字最容易被追问测量方法' }],
  });
}

const ANSWER = JSON.stringify({ answered: true, text: '本地 Chrome 冷启动测的首屏', citedQuotes: [QUOTE] });

const VERDICT = JSON.stringify({
  kind: 'solid',
  confidence: 0.8,
  rationale: '简历写了具体数字，候选人也说得出测量方法',
  evidenceQuotes: [QUOTE],
});

/** 三轮追问：前两轮各问一个新问题，第三轮没有新问题，于是沙盘自然收尾 */
function scripted(): ScriptedClient {
  let probeCalls = 0;
  return createScriptedClient((req) => {
    if (req.purpose === 'extract') return EXTRACT;
    if (req.purpose === 'probe') {
      probeCalls += 1;
      if (probeCalls === 1) return probe('这个 2.4s 是怎么测出来的？');
      if (probeCalls === 2) return probe('测试设备和网络条件是什么？');
      return JSON.stringify({ probes: [] });
    }
    if (req.purpose === 'answer') return ANSWER;
    if (req.purpose === 'verdict') return VERDICT;
    if (req.purpose === 'suggest') return JSON.stringify({ suggestions: [] });
    return new Error('脚本化模型没有为 purpose=' + req.purpose + ' 准备返回值');
  });
}

interface RunSummary {
  rounds: number;
  claims: number;
  probes: number;
  verdicts: { claimId: string; kind: string; confidence: number }[];
  suggestions: number;
  rejectedClaims: number;
  notices: string[];
  usage: { outputTokens: number };
}

interface Rig {
  db: Db;
  client: ScriptedClient;
  app: ReturnType<typeof createApp>;
}

const opened: Db[] = [];

function rig(extra: { panelSize?: number } = {}): Rig {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  opened.push(db);
  const client = scripted();
  return {
    db,
    client,
    app: createApp({ db, client, cassetteDir: '.tmp/fixtures', panelSize: extra.panelSize }),
  };
}

afterEach(() => {
  while (opened.length > 0) {
    const db = opened.pop();
    if (db !== undefined) closeDatabase(db);
  }
});

const JSON_HEADERS = { 'content-type': 'application/json' };

async function createSession(target: Rig, body: Record<string, unknown>): Promise<Response> {
  return target.app.request('/api/sessions', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

async function newSessionId(target: Rig): Promise<string> {
  const res = await createSession(target, { resumeText: RESUME, jobTitle: '后端工程师', jdText: '负责订单系统' });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

describe('HTTP 层', () => {
  it('健康检查直接说清"联没联网"，不让人猜', async () => {
    const t = rig();
    const res = await t.app.request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; runMode: string };
    expect(body.mode).toBe('live');
    expect(body.runMode).toContain('卡带目录');
  });

  it('简历太短时明确拒绝，而不是跑出一盘空演示', async () => {
    const t = rig();
    const res = await createSession(t, { resumeText: '会写代码' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('简历太短');
  });

  it('示例简历一键建档：返回 201，并把简历正文落进会话', async () => {
    const t = rig();
    const res = await createSession(t, { useDemo: true });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; jobTitle: string };
    expect(created.jobTitle).toContain('演示简历');

    const view = await t.app.request('/api/sessions/' + created.id);
    expect(view.status).toBe(200);
    const detail = (await view.json()) as {
      session: { resumeText: string; resumeHash: string };
      claims: unknown[];
      llm: { calls: number };
    };
    expect(detail.session.resumeText).toContain('张明');
    expect(detail.session.resumeHash.length).toBe(24);
    expect(detail.claims).toHaveLength(0);
    expect(detail.llm.calls).toBe(0);
  });

  it('跑一盘：两轮追问问到额度用尽，判定与记账都落库', async () => {
    const t = rig();
    const id = await newSessionId(t);
    const res = await t.app.request('/api/sessions/' + id + '/run?stream=0&panel=tech', { method: 'POST' });
    expect(res.status).toBe(200);
    const summary = (await res.json()) as RunSummary;
    expect(summary.claims).toBe(1);
    // 每位面试官对同一主张最多 2 问，所以第二轮之后闸门关上，而不是靠模型自觉收尾
    expect(summary.rounds).toBe(2);
    expect(summary.probes).toBe(2);
    expect(summary.verdicts[0]?.kind).toBe('solid');
    expect(summary.rejectedClaims).toBe(0);
    // 站得住的主张不需要改写，于是没有需要提醒的事
    expect(summary.notices).toEqual([]);
    // 6 次调用 = 抽取 1 + 追问 2 + 作答 2 + 判定 1（改写阶段只对有问题的主张调用）
    expect(summary.usage.outputTokens).toBe(120);
    expect(t.client.countPurpose('probe')).toBe(2);
    expect(t.client.countPurpose('suggest')).toBe(0);
  });

  it('事件带 seq，按 seq 续传不重不漏', async () => {
    const t = rig();
    const id = await newSessionId(t);
    await t.app.request('/api/sessions/' + id + '/run?stream=0&panel=tech', { method: 'POST' });

    const all = await t.app.request('/api/sessions/' + id + '/events');
    const everything = (await all.json()) as { events: { seq: number; kind: string }[] };
    // 16 条 = 抽取 2 + 每轮（阶段、追问、阶段、作答、预算）5 x 2 + 判定 2 + 改写 2
    expect(everything.events).toHaveLength(16);
    expect(everything.events.map((e) => e.seq)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(everything.events[0]?.kind).toBe('stage');
    expect(everything.events[1]?.kind).toBe('claims');

    const tail = await t.app.request('/api/sessions/' + id + '/events?from=7');
    const rest = (await tail.json()) as { from: number; events: { seq: number }[] };
    expect(rest.from).toBe(7);
    expect(rest.events).toHaveLength(9);
    expect(rest.events.every((e) => e.seq > 7)).toBe(true);
  });

  it('报告能作为 Markdown 下载，判定用中文说人话', async () => {
    const t = rig();
    const id = await newSessionId(t);
    await t.app.request('/api/sessions/' + id + '/run?stream=0&panel=tech', { method: 'POST' });

    const res = await t.app.request('/api/sessions/' + id + '/report.md');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const text = await res.text();
    expect(text).toContain('站得住');
    expect(text).toContain('这个 2.4s 是怎么测出来的？');
  });

  it('同一个会话跑第二次会被挡住，不是悄悄叠一份', async () => {
    const t = rig();
    const id = await newSessionId(t);
    await t.app.request('/api/sessions/' + id + '/run?stream=0&panel=tech', { method: 'POST' });
    const again = await t.app.request('/api/sessions/' + id + '/run?stream=0&panel=tech', { method: 'POST' });
    expect(again.status).toBe(409);
    const body = (await again.json()) as { error: string };
    expect(body.error).toContain('已经跑过了');
  });

  it('SSE 把每个阶段实时推出去，最后给一份跑完小结', async () => {
    const t = rig();
    const id = await newSessionId(t);
    const res = await t.app.request('/api/sessions/' + id + '/run?panel=tech', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('event: claims');
    expect(text).toContain('event: probes');
    expect(text).toContain('event: verdicts');
    expect(text).toContain('event: result');
    expect(text).toContain('id: 2');
    expect(text).not.toContain('event: fatal');
    expect(text).toContain('"kind":"solid"');
    // 分片走独立的 stream 事件：五种阶段各有自己的 channel，界面据此把字送回对应卡片
    expect(text).toContain('event: stream');
    expect(text).toContain('"channel":"extract"');
    expect(text).toContain('"channel":"probe:tech"');
    expect(text).toContain('"channel":"answer:P1"');
    expect(text).toContain('"channel":"verdict:C1"');
    expect(text).toContain('"kind":"reasoning"');

    // 关键回归：走 SSE（也就是走流式）不改变落库的事件条数——分片不进事件表
    const events = await t.app.request('/api/sessions/' + id + '/events');
    const rows = (await events.json()) as { events: unknown[] };
    expect(rows.events).toHaveLength(16);
  });

  it('中途失败也走 SSE，前端能拿到 fatal 而不是转圈到天荒地老', async () => {
    const db = openDatabase({ path: ':memory:' });
    migrate(db);
    opened.push(db);
    const client = createScriptedClient(() => new Error('模型连接断了'));
    const app = createApp({ db, client, cassetteDir: '.tmp/fixtures' });
    const created = await app.request('/api/sessions', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ resumeText: RESUME }),
    });
    const { id } = (await created.json()) as { id: string };

    const res = await app.request('/api/sessions/' + id + '/run?panel=tech', { method: 'POST' });
    const text = await res.text();
    expect(text).toContain('event: fatal');
    expect(text).toContain('模型连接断了');
  });

  it('记账能被查询：这次演示到底调了几次、花了多少 token', async () => {
    const t = rig();
    const id = await newSessionId(t);
    await t.app.request('/api/sessions/' + id + '/run?stream=0&panel=tech', { method: 'POST' });
    const res = await t.app.request('/api/stats?session=' + id);
    const stats = (await res.json()) as { calls: number; replayedCalls: number; outputTokens: number };
    expect(stats.calls).toBe(6);
    expect(stats.replayedCalls).toBe(0);
    expect(stats.outputTokens).toBe(120);
  });

  it('没有的接口给出中文 404，不吐栈', async () => {
    const t = rig();
    const res = await t.app.request('/api/nope');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('没有这个接口');
  });

  it('意图契约在开跑之前就能摊开：全文、指纹、System Prompt 都在', async () => {
    const t = rig();
    const res = await t.app.request('/api/contracts');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      panel: string[];
      budget: { maxRoundsPerClaim: number; maxProbesPerInterviewerPerClaim: number; maxTotalProbes: number };
      contracts: {
        id: string;
        version: number;
        digest: string;
        storedDigest: string | null;
        verified: boolean;
        contract: { goal: string; tactics: string[]; forbidden: string[] };
        systemPrompt: string;
      }[];
    };
    expect(body.panel).toEqual(['tech', 'hr', 'hiring_manager']);
    expect(body.contracts).toHaveLength(3);
    expect(body.budget.maxRoundsPerClaim).toBe(3);
    expect(body.budget.maxProbesPerInterviewerPerClaim).toBe(2);
    expect(body.budget.maxTotalProbes).toBe(60);
    for (const view of body.contracts) {
      expect(view.digest).toMatch(/^[0-9a-f]{16}$/);
      // 还没跑过这场沙盘，就没有可对账的指纹
      expect(view.storedDigest).toBeNull();
      expect(view.verified).toBe(false);
      expect(view.contract.forbidden.length).toBeGreaterThan(0);
      // System Prompt 是确定性渲染的：目标与预算数字必须逐字出现在里面
      expect(view.systemPrompt).toContain(view.contract.goal);
      expect(view.systemPrompt).toContain('全场追问总次数上限 60 次');
    }
    // 两张人设的契约必须不同，否则等于只有一个面试官换了名字
    expect(body.contracts[0]?.digest).not.toBe(body.contracts[1]?.digest);
  });

  it('可以指定面板；认不出的角色明确报错，而不是静默丢掉', async () => {
    const t = rig();
    const ok = await t.app.request('/api/contracts?panel=tech,stress');
    const picked = (await ok.json()) as { panel: string[]; contracts: { id: string }[] };
    expect(picked.panel).toEqual(['tech', 'stress']);
    expect(picked.contracts.map((item) => item.id)).toEqual(['tech', 'stress']);

    const bad = await t.app.request('/api/contracts?panel=tech,cto');
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: string };
    expect(body.error).toContain('cto');
    expect(body.error).toContain('domain_expert');
  });

  it('跑完一场之后契约能与运行时对账，指纹一致即未漂移', async () => {
    const t = rig();
    const id = await newSessionId(t);
    await t.app.request('/api/sessions/' + id + '/run?stream=0&panel=tech,hr', { method: 'POST' });
    const res = await t.app.request('/api/sessions/' + id);
    const body = (await res.json()) as {
      contracts: { id: string; digest: string; storedDigest: string | null; verified: boolean; systemPrompt: string }[];
    };
    expect(body.contracts.map((item) => item.id)).toEqual(['tech', 'hr']);
    for (const view of body.contracts) {
      expect(view.storedDigest).toBe(view.digest);
      expect(view.verified).toBe(true);
      expect(view.storedDigest).toBe(view.digest);
      expect(view.verified).toBe(true);
      expect(view.systemPrompt).toContain('## 追问预算');
    }
  });

  it('PANEL_SIZE 只截断不补齐：点名的面试官多于上限时只留前几位', async () => {
    const t = rig({ panelSize: 2 });
    // 默认面板本来就是 3 位，上限 2 应当把它压到 2 位
    const byDefault = await t.app.request('/api/contracts');
    const defaultBody = (await byDefault.json()) as { panel: string[]; contracts: { id: string }[] };
    expect(defaultBody.panel).toEqual(['tech', 'hr']);
    expect(defaultBody.contracts).toHaveLength(2);

    // 请求里点名三位也一样被截断——上限是硬约束，不是默认值
    const named = await t.app.request('/api/contracts?panel=tech,hr,hiring_manager');
    const namedBody = (await named.json()) as { panel: string[] };
    expect(namedBody.panel).toEqual(['tech', 'hr']);

    // 少于上限时原样放行，不做补齐
    const single = await t.app.request('/api/contracts?panel=stress');
    const singleBody = (await single.json()) as { panel: string[] };
    expect(singleBody.panel).toEqual(['stress']);
  });

  it('上限对开跑同样生效：只剩一位面试官上场，契约也只有一份', async () => {
    const t = rig({ panelSize: 1 });
    const id = await newSessionId(t);
    // 不带 ?panel=，走默认面板，但被上限压成只有技术面试官
    const res = await t.app.request('/api/sessions/' + id + '/run?stream=0', { method: 'POST' });
    expect(res.status).toBe(200);
    const summary = (await res.json()) as RunSummary;
    // 一位面试官、每人每主张 2 问：第一轮问一条，第二轮问第二条，第三轮无额度可用
    expect(summary.rounds).toBe(2);
    expect(summary.probes).toBe(2);
    expect(t.client.countPurpose('probe')).toBe(2);

    const view = await t.app.request('/api/sessions/' + id);
    const body = (await view.json()) as { contracts: { id: string; verified: boolean }[] };
    expect(body.contracts.map((item) => item.id)).toEqual(['tech']);
    expect(body.contracts[0]?.verified).toBe(true);
  });
});
