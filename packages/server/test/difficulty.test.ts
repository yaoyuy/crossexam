/**
 * 三档追问强度（gentle / normal / hard）：同一套编排，三种预算。
 *
 * 为什么值得单独一个文件测：
 *   1. 预算是「强制记账」而不是提示词里的一句建议，换档之后追问次数必须真的变；
 *   2. 档位会落进契约与指纹，换档就等于换一场沙盘，对账不能出错；
 *   3. 档位是随会话落库的输入，跑完之后重读会话必须还看得见。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { contractBudgetView } from '@crossexam/shared';
import { BUDGET_BY_DIFFICULTY } from '@crossexam/shared/difficulty.ts';
import { createApp } from '../src/http/app.ts';
import { closeDatabase, getSession, migrate, openDatabase } from '../src/store/index.ts';
import type { Db } from '../src/store/index.ts';
import { createScriptedClient } from './scripted.ts';
import type { ScriptedClient } from './scripted.ts';

const RESUME = ['项目经历', '主导重构订单系统，首屏从 2.4s 降到 0.8s，日订单量 30 万。'].join(String.fromCharCode(10));

const QUOTE = '首屏从 2.4s 降到 0.8s';

const EXTRACT = JSON.stringify({
  claims: [{ text: '主导订单系统重构，把首屏从 2.4s 降到 0.8s', quote: QUOTE, category: 'achievement', weight: 0.9 }],
});

const ANSWER = JSON.stringify({ answered: true, text: '本地 Chrome 冷启动测的首屏', citedQuotes: [QUOTE] });

const VERDICT = JSON.stringify({ kind: 'solid', confidence: 0.8, rationale: '有具体数字，也说得出测量方法', evidenceQuotes: [QUOTE] });

/**
 * 每次追问都换一句全新的问题：
 * 追问层有「全局提问去重」，重复的句子会被丢掉，那样就分不清「预算挡住了」还是「问题重了」。
 */
function scripted(): ScriptedClient {
  let n = 0;
  return createScriptedClient((req) => {
    if (req.purpose === 'extract') return EXTRACT;
    if (req.purpose === 'probe') {
      n += 1;
      return JSON.stringify({
        probes: [
          {
            claimId: 'C1',
            question: '第 ' + n + ' 次追问：这个数字是怎么测出来的？',
            quote: QUOTE,
            rationale: '测量方法最容易被追问',
          },
        ],
      });
    }
    if (req.purpose === 'answer') return ANSWER;
    if (req.purpose === 'verdict') return VERDICT;
    if (req.purpose === 'suggest') return JSON.stringify({ suggestions: [] });
    if (req.purpose === 'counter') return JSON.stringify({ counters: [] });
    return new Error('脚本化模型没有为 purpose=' + req.purpose + ' 准备返回值');
  });
}

interface RunSummary {
  rounds: number;
  claims: number;
  probes: number;
}

interface Rig {
  db: Db;
  client: ScriptedClient;
  app: ReturnType<typeof createApp>;
}

const opened: Db[] = [];

function rig(): Rig {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  opened.push(db);
  const client = scripted();
  return { db, client, app: createApp({ db, client, cassetteDir: '.tmp/fixtures' }) };
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

async function runWith(target: Rig, id: string, panel: string): Promise<RunSummary> {
  const res = await target.app.request('/api/sessions/' + id + '/run?stream=0&panel=' + panel, { method: 'POST' });
  expect(res.status).toBe(200);
  return (await res.json()) as RunSummary;
}

describe('追问强度三档', () => {
  it('健康检查把三档的名字、说明与预算一起下发，界面不用自己编文案', async () => {
    const t = rig();
    const res = await t.app.request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      difficulties: { id: string; label: string; hint: string; budget: Record<string, number> }[];
      defaultDifficulty: string;
    };
    expect(body.difficulties.map((item) => item.id)).toEqual(['gentle', 'normal', 'hard']);
    expect(body.difficulties.map((item) => item.label)).toEqual(['温和', '常规', '挑刺']);
    expect(body.defaultDifficulty).toBe('normal');
    expect(body.difficulties[0]?.budget).toEqual(BUDGET_BY_DIFFICULTY.gentle);
    expect(body.difficulties[0]?.hint).toContain('2 轮');
    expect(body.difficulties[2]?.hint).toContain('80');
  });

  it('契约按档位算：换档就是换指纹，而预算里只有三个字段', async () => {
    const t = rig();
    const gentle = (await (await t.app.request('/api/contracts?panel=tech&difficulty=gentle')).json()) as {
      difficulty: string;
      budget: Record<string, number>;
      contracts: { digest: string; contract: { budget: Record<string, number> } }[];
    };
    const hard = (await (await t.app.request('/api/contracts?panel=tech&difficulty=hard')).json()) as typeof gentle;
    expect(gentle.difficulty).toBe('gentle');
    // 响应里的 budget 是这一场的完整预算（含编排层的关停策略），契约里的才是收窄后的三字段
    expect(gentle.budget).toEqual(BUDGET_BY_DIFFICULTY.gentle);
    expect(hard.budget).toEqual(BUDGET_BY_DIFFICULTY.hard);
    expect(hard.budget['maxTotalProbes']).toBe(80);
    // 指纹里带着预算，所以同一批面试官在两档下的指纹必须不同
    expect(gentle.contracts[0]?.digest).not.toBe(hard.contracts[0]?.digest);
    // 契约里的预算就是收窄后的三字段：maxConsecutiveUnanswerable 是编排层的关停策略，
    // 不属于「问得多深」，多带一个字段就会让「运行」与「对账」算出两个指纹
    expect(gentle.contracts[0]?.contract.budget).toEqual(contractBudgetView(BUDGET_BY_DIFFICULTY.gentle));
    expect(Object.keys(gentle.contracts[0]?.contract.budget ?? {}).sort()).toEqual([
      'maxProbesPerInterviewerPerClaim',
      'maxRoundsPerClaim',
      'maxTotalProbes',
    ]);
  });

  it('建会话时选的档位随会话落库，重读还在', async () => {
    const t = rig();
    const res = await createSession(t, { resumeText: RESUME, difficulty: 'hard' });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; difficulty: string };
    expect(created.difficulty).toBe('hard');
    const detail = (await (await t.app.request('/api/sessions/' + created.id)).json()) as {
      difficulty: string;
      session: { budget: { config: Record<string, number> } };
    };
    expect(detail.difficulty).toBe('hard');
    expect(detail.session.budget.config['maxRoundsPerClaim']).toBe(4);
    expect(getSession(t.db, created.id)?.meta['difficulty']).toBe('hard');
  });

  it('不认的档位直接 400，并且说清有哪几档', async () => {
    const t = rig();
    const res = await createSession(t, { resumeText: RESUME, difficulty: 'extreme' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('gentle');
    expect(body.error).toContain('extreme');
  });

  it('不填档位就是常规档：老请求与老脚本不会因此走不通', async () => {
    const t = rig();
    const res = await createSession(t, { resumeText: RESUME });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { difficulty: string };
    expect(created.difficulty).toBe('normal');
  });

  it('档位真的会改变追问次数：三档在同一个面板上问出 2 / 3 / 4 条', async () => {
    // 同一条主张、同一个面板（技术 + HR）、同一个脚本化模型，只有档位不同。
    // 主张级的轮数闸门按这条主张**累计**问了几条来算（第二位面试官接着问也占额度），
    // 每人每主张额度是叠加在它上面的第二道门——所以两闸门一起把上限钉在 2 / 3 / 4。
    async function probesAt(difficulty: string): Promise<number> {
      const t = rig();
      const res = await createSession(t, { resumeText: RESUME, difficulty });
      const id = ((await res.json()) as { id: string }).id;
      const run = await runWith(t, id, 'tech,hr');
      return run.probes;
    }

    expect(await probesAt('gentle')).toBe(2);
    expect(await probesAt('normal')).toBe(3);
    expect(await probesAt('hard')).toBe(4);
  });

  it('跑完之后会话的 meta 不会被写丢（回归：整段替换会吃掉档位与面板）', async () => {
    const t = rig();
    const res = await createSession(t, { resumeText: RESUME, difficulty: 'hard' });
    const id = ((await res.json()) as { id: string }).id;
    await runWith(t, id, 'tech');
    const meta = getSession(t.db, id)?.meta ?? {};
    // 输入侧字段必须活过这一次写：跑完一场之后 meta 只多不少，不能被产物侧整段顶掉
    expect(meta['difficulty']).toBe('hard');
    expect(meta['panel']).toEqual(['tech']);
  });
});
