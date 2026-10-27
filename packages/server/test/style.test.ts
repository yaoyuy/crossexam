/**
 * 三档改写风格（conservative / normal / bold）：同一套闸门，三种收敛程度。
 *
 * 为什么值得单独一个文件测：
 *   1. 档位会进提示词，而提示词进卡带指纹——换档必须真的换掉那一版提示词；
 *   2. 但它**不进契约指纹**：契约描述「谁在问」，风格描述「改得多狠」，两者必须解耦；
 *   3. 档位是随会话落库的输入，跑完之后重读会话必须还看得见。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { contractDigest } from '@crossexam/shared';
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

// 判「表述过度」而不是「站得住」：站得住的主张不进改写阶段（没什么可改的），
// 那样三档风格就都拿不到建议，这条测试会变成在测「有没有建议」而不是「风格生没生效」。
const VERDICT = JSON.stringify({ kind: 'overstated', confidence: 0.75, rationale: '数字在，但没说清 0.8s 的测试条件', evidenceQuotes: [QUOTE] });

/**
 * 脚本化模型：三种风格各给一句改法，句子的主观强度依次递增。
 * 真正要证明的不是「模型会不会这么写」，而是「服务端有没有把档位真的送进提示词、
 * 并让三档的产物不一样」——所以这里只要求句子可区分。
 */
const AFTER_BY_STYLE: Record<string, string> = {
  conservative: '重构订单系统首屏，从 2.4s 降到 0.8s。',
  normal: '主导重构订单系统，首屏从 2.4s 降到 0.8s，日订单量 30 万。',
  bold: '主导订单系统重构：首屏 2.4s → 0.8s（日订单量 30 万），是当时最大的一笔性能收益。',
};

const STYLE_IN_SYSTEM = ['保守', '常规', '敢改'];

function styleOf(system: string): string {
  for (let i = 0; i < STYLE_IN_SYSTEM.length; i += 1) {
    if (system.indexOf('用户选的档位：' + STYLE_IN_SYSTEM[i]) >= 0) {
      return ['conservative', 'normal', 'bold'][i]!;
    }
  }
  return 'normal';
}

function scripted(): ScriptedClient {
  return createScriptedClient((req) => {
    if (req.purpose === 'extract') return EXTRACT;
    if (req.purpose === 'probe') {
      return JSON.stringify({
        probes: [{ claimId: 'C1', question: '这个 0.8s 是怎么测出来的？', quote: QUOTE, rationale: '测量方法最容易被追问' }],
      });
    }
    if (req.purpose === 'answer') return ANSWER;
    if (req.purpose === 'verdict') return VERDICT;
    if (req.purpose === 'suggest') {
      const after = AFTER_BY_STYLE[styleOf(req.system)] ?? AFTER_BY_STYLE['normal']!;
      // 改写阶段一次只问一条主张，返回的**是单个对象**而不是数组（与抽取阶段不同）。
      // 四个字段都是 schema 的必填项：少一个整条建议会被判为格式不符。
      return JSON.stringify({ claimId: 'C1', problem: '说了结果但没说清测试条件', before: QUOTE, after, why: '补上测量口径' });
    }
    if (req.purpose === 'counter') return JSON.stringify({ counters: [] });
    return new Error('脚本化模型没有为 purpose=' + req.purpose + ' 准备返回值');
  });
}

interface Rig {
  db: Db;
  app: ReturnType<typeof createApp>;
}

const opened: Db[] = [];

function rig(): Rig {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  opened.push(db);
  return { db, app: createApp({ db, client: scripted(), cassetteDir: '.tmp/fixtures' }) };
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

interface StyleRun {
  suggestions: { suggestion: { after: string } | null }[];
  style: string;
}

async function runAt(style: string): Promise<StyleRun & { report: string }> {
  const t = rig();
  const res = await createSession(t, { resumeText: RESUME, style });
  expect(res.status).toBe(201);
  const id = ((await res.json()) as { id: string }).id;
  const run = await t.app.request('/api/sessions/' + id + '/run?stream=0&panel=tech', { method: 'POST' });
  expect(run.status).toBe(200);
  const view = (await (await t.app.request('/api/sessions/' + id)).json()) as StyleRun;
  const report = await (await t.app.request('/api/sessions/' + id + '/report.md')).text();
  return { ...view, report };
}

describe('改写风格三档', () => {
  it('健康检查把三档的名字与说明一起下发，界面不用自己编文案', async () => {
    const t = rig();
    const body = (await (await t.app.request('/api/health')).json()) as {
      styles: { id: string; label: string; hint: string }[];
      defaultStyle: string;
    };
    expect(body.styles.map((item) => item.id)).toEqual(['conservative', 'normal', 'bold']);
    expect(body.styles.map((item) => item.label)).toEqual(['保守', '常规', '敢改']);
    expect(body.defaultStyle).toBe('normal');
    expect(body.styles[2]?.hint).toContain('不新增任何事实');
  });

  it('建会话时选的风格随会话落库，重读还在', async () => {
    const t = rig();
    const res = await createSession(t, { resumeText: RESUME, style: 'bold' });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; style: string };
    expect(created.style).toBe('bold');
    const detail = (await (await t.app.request('/api/sessions/' + created.id)).json()) as { style: string };
    expect(detail.style).toBe('bold');
    expect(getSession(t.db, created.id)?.meta['style']).toBe('bold');
  });

  it('不认的风格直接 400，并且说清有哪几档', async () => {
    const t = rig();
    const res = await createSession(t, { resumeText: RESUME, style: 'wild' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('conservative');
    expect(body.error).toContain('wild');
  });

  it('不填风格就是常规档：老请求与老脚本不会因此走不通', async () => {
    const t = rig();
    const res = await createSession(t, { resumeText: RESUME });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { style: string };
    expect(created.style).toBe('normal');
  });

  it('三档真的改出三句不一样的话：档位是送进了提示词，不是在界面上摆着', async () => {
    const conservative = await runAt('conservative');
    const normal = await runAt('normal');
    const bold = await runAt('bold');
    const sentenceOf = (run: StyleRun): string =>
      run.suggestions.filter((item) => item.suggestion !== null).map((item) => item.suggestion!.after).join('');
    expect(conservative.style).toBe('conservative');
    expect(bold.style).toBe('bold');
    expect(sentenceOf(conservative)).toBe(AFTER_BY_STYLE['conservative']);
    expect(sentenceOf(normal)).toBe(AFTER_BY_STYLE['normal']);
    expect(sentenceOf(bold)).toBe(AFTER_BY_STYLE['bold']);
    expect(new Set([sentenceOf(conservative), sentenceOf(normal), sentenceOf(bold)]).size).toBe(3);
  });

  it('换风格不动契约指纹：契约描述谁在问，风格描述改得多狠', async () => {
    async function digestAt(style: string): Promise<string> {
      const t = rig();
      const res = await createSession(t, { resumeText: RESUME, style });
      const id = ((await res.json()) as { id: string }).id;
      const body = (await (await t.app.request('/api/sessions/' + id)).json()) as {
        contracts: { contract: unknown; digest: string }[];
      };
      const first = body.contracts[0];
      expect(first).toBeDefined();
      // 指纹是「同样的契约对象算出来的」，换个档位它必须一个字都不差
      expect(first!.digest).toBe(contractDigest(first!.contract as never));
      return first!.digest;
    }
    const conservative = await digestAt('conservative');
    const bold = await digestAt('bold');
    expect(bold).toBe(conservative);
  });

  it('报告抬头写明这一场改得多狠：带走的产物要能解释自己', async () => {
    const bold = await runAt('bold');
    expect(bold.report).toContain('- 改写风格：敢改');
    expect(bold.report).toContain('- 追问强度：常规');
  });
});