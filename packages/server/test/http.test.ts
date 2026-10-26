/**
 * HTTP 层的端到端测试：建会话 → 开跑（JSON 与 SSE 两条路）→ 读结果 → 下载报告。
 *
 * 为什么这层值得测：
 *   1. SSE 是"过程可复现"的对外接口，事件带 seq 才能断线续传，不能只测"跑完了"；
 *   2. 前端所有判断都基于这些响应形状，形状变了测试要先红，而不是等演示时才发现；
 *   3. 这些断言同时也是给评审看的接口文档——想接前端的同学读这一份就够了。
 */

import { readFileSync } from 'node:fs';
const NL = String.fromCharCode(10);
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
  // 刻意不带 JD：这组用例考的是 HTTP 层本身，不是岗位要求对照。空 JD 是合法输入。
  const res = await createSession(target, { resumeText: RESUME, jobTitle: '后端工程师' });
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

  it('报告能导出成可打印的 HTML，带 print 参数时自己调起打印', async () => {
    const t = rig();
    const id = await newSessionId(t);
    await t.app.request('/api/sessions/' + id + '/run?stream=0&panel=tech', { method: 'POST' });

    const plain = await t.app.request('/api/sessions/' + id + '/report.html');
    expect(plain.status).toBe(200);
    expect(plain.headers.get('content-type')).toContain('text/html');
    expect(plain.headers.get('content-disposition')).toContain('.html');
    const html = await plain.text();
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('CrossExam 质询报告');
    expect(html).toContain('站得住');
    expect(html).toContain('这个 2.4s 是怎么测出来的？');
    expect(html).toContain(QUOTE);
    // 不带参数就是普通页面：用户可能只是想先在浏览器里读一遍
    expect(html).not.toContain('window.print()');

    const printable = await t.app.request('/api/sessions/' + id + '/report.html?print=1');
    const printableHtml = await printable.text();
    expect(printableHtml).toContain('window.print()');
  });

  it('报告能导出成 Word 认识的 .doc，附件名与正文都在', async () => {
    const t = rig();
    const id = await newSessionId(t);
    await t.app.request('/api/sessions/' + id + '/run?stream=0&panel=tech', { method: 'POST' });

    const res = await t.app.request('/api/sessions/' + id + '/report.doc');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/msword');
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('.doc');
    expect(await res.text()).toContain('CrossExam 质询报告');
  });

  it('没有这一场会话时，报告接口如实说会话不存在', async () => {
    const t = rig();
    for (const path of ['/report.html', '/report.doc']) {
      const res = await t.app.request('/api/sessions/s_不存在' + path);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('会话不存在');
    }
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

/** 上传夹具：合成内容（李雷），来源见 packages/server/test/fixtures/README.md。 */
function uploadFixture(name: string): File {
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/' + name, import.meta.url)));
  return new File([bytes], name);
}

describe('简历导入接口', () => {
  async function post(target: Rig, file: File | null): Promise<Response> {
    const form = new FormData();
    if (file !== null) form.append('file', file);
    return target.app.request('/api/import', { method: 'POST', body: form });
  }

  it('上传 Word：200，返回解析出来的正文，且不带 PDF 那条提醒', async () => {
    const t = rig();
    const res = await post(t, uploadFixture('resume.docx'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; name: string; text: string; chars: number; notes: string[] };
    expect(body.kind).toBe('docx');
    expect(body.name).toBe('resume.docx');
    expect(body.text).toContain('李雷');
    expect(body.chars).toBe(body.text.length);
    expect(body.notes).toEqual([]);
  });

  it('上传 PDF：200，并附带一句「换行来自版面」的提醒', async () => {
    const t = rig();
    const res = await post(t, uploadFixture('resume-edge.pdf'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; notes: string[] };
    expect(body.kind).toBe('pdf');
    expect(body.notes[0]).toContain('换行来自版面');
  });

  it('只接得住简历：四种失败各给一个能对症的状态码与中文说明', async () => {
    const t = rig();
    const legacy = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00])], 'old.doc');
    const legacyRes = await post(t, legacy);
    expect(legacyRes.status).toBe(415);
    expect(((await legacyRes.json()) as { code: string }).code).toBe('legacy-doc');

    const photo = new File([new TextEncoder().encode('图片字节')], 'photo.png');
    const photoRes = await post(t, photo);
    expect(photoRes.status).toBe(415);
    expect(((await photoRes.json()) as { code: string }).code).toBe('unsupported');

    const blank = new File([new TextEncoder().encode('   ' + String.fromCharCode(10))], 'blank.txt');
    const blankRes = await post(t, blank);
    expect(blankRes.status).toBe(422);
    expect(((await blankRes.json()) as { code: string }).code).toBe('empty');

    const noFile = await post(t, null);
    expect(noFile.status).toBe(400);
    expect(((await noFile.json()) as { error: string }).error).toContain('没有收到文件');
  });

  it('文本简历走同一条路，导入的字数与正文一致', async () => {
    const t = rig();
    const text = '王五' + NL + '运维工程师' + NL + '负责过 30 台服务器的日常巡检。';
    const res = await post(t, new File([new TextEncoder().encode(text)], 'resume.md'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; text: string; chars: number };
    expect(body.kind).toBe('text');
    expect(body.text).toBe(text);
    expect(body.chars).toBe(text.length);
  });
});

/**
 * 运行模式与模型：这一组测试守的是「界面选的模式真的被用上了」——
 * 最容易出的错是模式在请求里传了、却没人读，最后所有会话都按进程启动时那一套跑。
 */
describe('运行模式与模型', () => {
  const ENV_KEYS = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'];

  /** 有些断言必须在「这台机器没配联网」的前提下才成立，跑完原样放回去。 */
  async function withoutLiveEnv<T>(fn: () => Promise<T>): Promise<T> {
    const saved = new Map<string, string | undefined>();
    for (const key of ENV_KEYS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
    try {
      return await fn();
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  it('健康检查把三种模式与「联网就绪了吗」一并说清', async () => {
    const t = rig();
    const res = await t.app.request('/api/health');
    const body = (await res.json()) as {
      modes: string[];
      modeLabels: Record<string, string>;
      live: { ready: boolean; missing: string[] };
    };
    expect(body.modes).toEqual(['replay', 'live', 'record']);
    expect(body.modeLabels['replay']).toContain('离线回放');
    expect(Array.isArray(body.live.missing)).toBe(true);
    expect(body.live.ready).toBe(body.live.missing.length === 0);
  });

  it('模式写错就 400：不猜，也不悄悄退回回放', async () => {
    const t = rig();
    const res = await createSession(t, { resumeText: RESUME, mode: 'liv' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('运行模式只能是');
  });

  it('没配好联网时当场 400，并点名缺哪个环境变量', async () => {
    await withoutLiveEnv(async () => {
      const t = rig();
      const res = await createSession(t, { resumeText: RESUME, mode: 'live', model: 'deepseek-chat' });
      expect(res.status).toBe(400);
      const error = ((await res.json()) as { error: string }).error;
      expect(error).toContain('LLM_BASE_URL');
      expect(error).toContain('LLM_API_KEY');
    });
  });

  it('回放不需要配置，也不需要模型名——选了回放就把它清掉', async () => {
    await withoutLiveEnv(async () => {
      const t = rig();
      const res = await createSession(t, { resumeText: RESUME, mode: 'replay', model: 'deepseek-chat' });
      expect(res.status).toBe(201);
      const created = (await res.json()) as { id: string; mode: string; model: string };
      expect(created.mode).toBe('replay');
      expect(created.model).toBe('');
      const view = (await (await t.app.request('/api/sessions/' + created.id)).json()) as {
        session: { llmMode: string };
      };
      expect(view.session.llmMode).toBe('replay');
    });
  });

  it('联网那一场把模式与模型交给客户端工厂：重跑按会话行自己记的来', async () => {
    const savedBase = process.env['LLM_BASE_URL'];
    const savedKey = process.env['LLM_API_KEY'];
    process.env['LLM_BASE_URL'] = 'https://example.invalid/v1';
    process.env['LLM_API_KEY'] = 'test-key';
    try {
      const db = openDatabase({ path: ':memory:' });
      migrate(db);
      opened.push(db);
      const seen: { mode: string; model: string }[] = [];
      const app = createApp({
        db,
        cassetteDir: '.tmp/fixtures',
        clientFactory: (mode, model) => {
          seen.push({ mode, model });
          return scripted();
        },
      });
      const created = (await (await app.request('/api/sessions', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          resumeText: RESUME,
          jobTitle: '后端工程师',
          mode: 'live',
          model: 'deepseek-reasoner',
        }),
      })).json()) as { id: string; mode: string; model: string };
      expect(created.mode).toBe('live');
      expect(created.model).toBe('deepseek-reasoner');

      const run = await app.request('/api/sessions/' + created.id + '/run?stream=0&panel=tech', { method: 'POST' });
      expect(run.status).toBe(200);
      expect(seen).toEqual([{ mode: 'live', model: 'deepseek-reasoner' }]);
    } finally {
      if (savedBase === undefined) delete process.env['LLM_BASE_URL'];
      else process.env['LLM_BASE_URL'] = savedBase;
      if (savedKey === undefined) delete process.env['LLM_API_KEY'];
      else process.env['LLM_API_KEY'] = savedKey;
    }
  });

  it('模型清单：没配好时不发请求也要能回答界面', async () => {
    await withoutLiveEnv(async () => {
      const t = rig();
      const res = await t.app.request('/api/models');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ready: boolean; models: string[]; missing: string[] };
      expect(body.ready).toBe(false);
      expect(body.models).toEqual([]);
      expect(body.missing).toContain('LLM_API_KEY');
    });
  });
});
/**
 * 面试官库与「用 AI 优化契约」：这一组守三条边界——
 * 自定义面试官能进阵容并真的上场、认不出的 id 必须拒绝而不是静默少一位、
 * 模型这条路走不通时本地规则顶上并且**说清楚是它顶上的**。
 */
describe('面试官库与自定义契约', () => {
  const DRAFT_JSON = JSON.stringify({
    name: '药房主管',
    domain: '医院药事管理',
    seniority: 'senior',
    tone: 'skeptical',
    blurb: '我在三甲医院药房待了十二年，见过太多把流程写成口号的人。',
    goal: '确认候选人是否真的经手过处方审核与效期管理，而不是只在旁边看过。',
    tactics: [
      '请举一个你自己发现并拦下的用药错误，说明当时依据的是哪一条规定。',
      '简历里的「负责效期管理」，具体是你查效期，还是你安排别人查、你来复核？',
    ],
  });

  const customRig = (extra: { panelSize?: number } = {}): Rig => {
    const db = openDatabase({ path: ':memory:' });
    migrate(db);
    opened.push(db);
    const client = createScriptedClient((req) => {
      if (req.purpose === 'contract') return DRAFT_JSON;
      if (req.purpose === 'extract') return EXTRACT;
      if (req.purpose === 'probe') return JSON.stringify({ probes: [] });
      if (req.purpose === 'answer') return ANSWER;
      if (req.purpose === 'verdict') return VERDICT;
      if (req.purpose === 'suggest') return JSON.stringify({ suggestions: [] });
      return new Error('脚本化模型没有为 purpose=' + req.purpose + ' 准备返回值');
    });
    return { db, client, app: createApp({ db, client, cassetteDir: '.tmp/fixtures', panelSize: extra.panelSize }) };
  };

  it('预设与自定义在同一个列表里，预设的契约由代码算出来、指纹可对账', async () => {
    const t = customRig();
    const res = await t.app.request('/api/interviewers');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      presets: { id: string; digest: string; systemPrompt: string }[];
      custom: unknown[];
      limit: number;
    };
    expect(body.presets.map((item) => item.id)).toEqual(['tech', 'hr', 'hiring_manager', 'stress', 'domain_expert']);
    expect(body.custom).toEqual([]);
    for (const view of body.presets) {
      expect(view.digest).toMatch(/^[0-9a-f]{16}$/);
      expect(view.systemPrompt).toContain('## 追问预算');
    }
  });

  it('用 AI 优化：模型出的草稿过 zod，回来的 id、指纹与渲染好的 System Prompt 一应俱全', async () => {
    const t = customRig();
    const res = await t.app.request('/api/interviewers/draft', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ description: '想找一位懂医院药房流程、会追问细节的主管' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: string;
      draft: { name: string; tactics: string[] };
      id: string;
      digest: string;
      systemPrompt: string;
      fallbackReason: string | null;
      diff: unknown[];
    };
    expect(body.source).toBe('llm');
    expect(body.fallbackReason).toBeNull();
    expect(body.draft.name).toBe('药房主管');
    expect(body.draft.tactics.length).toBeGreaterThanOrEqual(2);
    expect(body.id.startsWith('custom-')).toBe(true);
    expect(body.digest).toMatch(/^[0-9a-f]{16}$/);
    expect(body.systemPrompt).toContain('药房主管');
    // 没有旧草稿就没有 diff，而不是返回一堆空字段
    expect(body.diff).toEqual([]);
  });

  it('模型这条路走不通时退回本地规则，并把原因写在 fallbackReason 里', async () => {
    const t = customRig();
    const broken = createScriptedClient(() => new Error('模型说它今天不想干活'));
    const app = createApp({ db: t.db, client: broken, cassetteDir: '.tmp/fixtures' });
    const res = await app.request('/api/interviewers/draft', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ description: '我要一位会追问预算口径的财务主管' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; fallbackReason: string | null; notes: string[] };
    expect(body.source).toBe('local');
    expect(body.fallbackReason).toContain('模型说它今天不想干活');
    expect(body.notes[0]).toContain('模型这条路没有走通');
  });

  it('useModel=false 时一个网络包都不发，纯规则也能生成一份合规草稿', async () => {
    const t = customRig();
    const res = await t.app.request('/api/interviewers/draft', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ description: '想找一位懂市场营销、会追问数据来源的总监', useModel: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; draft: { name: string; tactics: string[] }; notes: string[] };
    expect(body.source).toBe('local');
    expect(t.client.countPurpose('contract')).toBe(0);
    expect(body.draft.tactics.length).toBeGreaterThanOrEqual(2);
    expect(body.notes.length).toBeGreaterThan(0);
  });

  it('存下来之后能进阵容，并且真的上场：跑完这场的契约里有它', async () => {
    const t = customRig();
    const draftRes = await t.app.request('/api/interviewers/draft', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ description: '想找一位懂医院药房流程、会追问细节的主管' }),
    });
    const drafted = (await draftRes.json()) as { draft: unknown; id: string };
    const saveRes = await t.app.request('/api/interviewers', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ draft: drafted.draft, id: drafted.id, source: 'llm' }),
    });
    expect(saveRes.status).toBe(201);

    const created = await createSession(t, {
      resumeText: RESUME,
      jobTitle: '药房主管',
      interviewers: [drafted.id],
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string; panel: string[] };
    expect(createdBody.panel).toEqual([drafted.id]);

    const run = await t.app.request('/api/sessions/' + createdBody.id + '/run?stream=0', { method: 'POST' });
    expect(run.status).toBe(200);
    const view = await t.app.request('/api/sessions/' + createdBody.id);
    const body = (await view.json()) as { contracts: { id: string; verified: boolean; systemPrompt: string }[] };
    expect(body.contracts.map((item) => item.id)).toEqual([drafted.id]);
    expect(body.contracts[0]?.verified).toBe(true);
    expect(body.contracts[0]?.systemPrompt).toContain('药房主管');
  });

  it('认不出的 id 明确拒绝，而不是少一位继续跑', async () => {
    const t = customRig();
    const contracts = await t.app.request('/api/contracts?panel=tech,custom-ghost-0000');
    expect(contracts.status).toBe(400);
    expect(((await contracts.json()) as { error: string }).error).toContain('custom-ghost-0000');

    const created = await createSession(t, {
      resumeText: RESUME,
      jobTitle: '后端工程师',
      interviewers: ['tech', 'custom-ghost-0000'],
    });
    expect(created.status).toBe(400);
  });

  it('预设不能删，自定义可以删，删完阵容里就没有它了', async () => {
    const t = customRig();
    const preset = await t.app.request('/api/interviewers/tech', { method: 'DELETE' });
    expect(preset.status).toBe(400);

    const draftRes = await t.app.request('/api/interviewers/draft', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ description: '想找一位懂医院药房流程、会追问细节的主管' }),
    });
    const drafted = (await draftRes.json()) as { draft: unknown; id: string };
    await t.app.request('/api/interviewers', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ draft: drafted.draft, id: drafted.id }),
    });
    const removed = await t.app.request('/api/interviewers/' + drafted.id, { method: 'DELETE' });
    expect(removed.status).toBe(200);

    const again = await t.app.request('/api/interviewers/' + drafted.id, { method: 'DELETE' });
    expect(again.status).toBe(404);

    const contracts = await t.app.request('/api/contracts?panel=' + drafted.id);
    expect(contracts.status).toBe(400);
  });

  it('草稿不合约时给 400，而不是存进去一半', async () => {
    const t = customRig();
    const res = await t.app.request('/api/interviewers', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        draft: { name: 'x', domain: '', seniority: 'senior', tone: 'warm', blurb: '短', goal: '太短', tactics: [] },
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('还不合约');
  });

  it('PANEL_SIZE 对自定义阵容同样生效：超了就截断', async () => {
    const t = customRig({ panelSize: 1 });
    const res = await t.app.request('/api/contracts?panel=tech,hr');
    const body = (await res.json()) as { panel: string[] };
    expect(body.panel).toEqual(['tech']);
  });
});
describe('岗位模板库', () => {
  const TEMPLATE_ID = 'med-pharmacy-lead';

  async function applyTemplateTo(target: Rig, id: string = TEMPLATE_ID): Promise<Response> {
    return target.app.request('/api/templates/' + id + '/apply', { method: 'POST' });
  }

  it('模板是只读数据：12 个行业 × 3 个岗位，每条都带指纹、两位推荐面试官与足够长的料', async () => {
    const t = rig();
    const res = await t.app.request('/api/templates');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      industries: string[];
      templates: {
        id: string;
        industry: string;
        jd: string;
        resume: string;
        hints: string[];
        presets: string[];
        digest: string;
      }[];
      limits: { industryCount: number; perIndustry: number };
    };
    expect(body.industries.length).toBe(12);
    expect(body.templates.length).toBe(36);
    expect(body.limits.perIndustry).toBe(3);
    for (const item of body.templates) {
      expect(body.industries).toContain(item.industry);
      expect(item.digest).toMatch(/^[0-9a-f]{16}$/);
      expect(item.presets.length).toBe(2);
      // 界面不校验字数，所以这里守住「点一下就能跑」的下限
      expect(item.jd.length).toBeGreaterThanOrEqual(180);
      expect(item.resume.length).toBeGreaterThanOrEqual(200);
      expect(item.hints.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('翻一遍模板库不落库：面试官库里还是空的', async () => {
    const t = rig();
    await t.app.request('/api/templates');
    const lib = (await (await t.app.request('/api/interviewers')).json()) as { custom: unknown[] };
    expect(lib.custom).toEqual([]);
  });

  it('一键采用：料与阵容一起给到，模板自带的那位这时才进库', async () => {
    const t = rig();
    const res = await applyTemplateTo(t);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      created: boolean;
      template: { id: string; industry: string; title: string; jd: string; resume: string; digest: string };
      panel: string[];
      interviewer: { id: string; digest: string; systemPrompt: string };
    };
    expect(body.created).toBe(true);
    expect(body.template.id).toBe(TEMPLATE_ID);
    expect(body.template.industry).toBe('医疗护理');
    expect(body.template.jd.length).toBeGreaterThan(100);
    expect(body.template.resume.length).toBeGreaterThan(100);
    // 阵容 = 两位预设 + 模板自带的那位，顺序由服务端定死
    expect(body.panel.length).toBe(3);
    expect(body.panel[2]).toBe(body.interviewer.id);
    expect(body.interviewer.id.startsWith('custom-')).toBe(true);
    expect(body.interviewer.digest).toMatch(/^[0-9a-f]{16}$/);
    expect(body.interviewer.systemPrompt).toContain('## 追问预算');
    const lib = (await (await t.app.request('/api/interviewers')).json()) as { custom: { id: string }[] };
    expect(lib.custom.map((row) => row.id)).toEqual([body.interviewer.id]);
  });

  it('同一套模板点两次不会多出一位面试官，第二次明说这是复用', async () => {
    const t = rig();
    const first = (await (await applyTemplateTo(t)).json()) as { created: boolean; panel: string[] };
    const second = (await (await applyTemplateTo(t)).json()) as { created: boolean; panel: string[] };
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.panel).toEqual(first.panel);
    const lib = (await (await t.app.request('/api/interviewers')).json()) as { custom: unknown[] };
    expect(lib.custom.length).toBe(1);
  });

  it('采用后的阵容能直接开跑：会话把这三位原样记下来', async () => {
    const t = rig();
    const applied = (await (await applyTemplateTo(t)).json()) as { panel: string[] };
    const res = await createSession(t, {
      resumeText: RESUME,
      jobTitle: '药房主管',
      interviewers: applied.panel,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { panel: string[] };
    expect(body.panel).toEqual(applied.panel);
  });

  it('没有这套模板就 404，不猜一个最接近的', async () => {
    const t = rig();
    const res = await applyTemplateTo(t, 'nope-nope');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain('没有这套模板');
  });
});
