/**
 * 反问环节（阶段七）的服务端测试。
 *
 * 产品定位是"锦上添花"：模型答得不好就留空并说清原因，绝不让整场沙盘白跑。
 * 但"依据必须锚回材料"这条不能松，所以三种失败路径各断言一次；
 * 最后一条是端到端的——反问真的落进业务表，也真的出现在两份报告里。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BUDGET } from '@crossexam/shared';
import type { Claim, JobDescription } from '@crossexam/shared';
import { LlmError } from '../src/llm/types.ts';
import { counterRound } from '../src/orchestrator/counter.ts';
import { assembleSession, runAndPersist } from '../src/pipeline.ts';
import { renderReport } from '../src/report.ts';
import { renderReportHtml } from '../src/report-html.ts';
import { closeDatabase, insertJds, insertSession, migrate, openDatabase } from '../src/store/index.ts';
import type { Db } from '../src/store/index.ts';
import { createScriptedClient } from './scripted.ts';

const NL = String.fromCharCode(10);

const RESUME = [
  '项目经历',
  '主导重构订单系统，首屏从 2.4s 降到 0.8s，日订单量 30 万。',
  '熟悉 TypeScript 与 Node.js。',
].join(NL);

const QUOTE = '首屏从 2.4s 降到 0.8s';

const JD_TEXT = [
  '高级后端工程师（Node.js）',
  '负责交易与订单核心链路的架构设计与性能优化；',
  '有日订单百万级系统的性能优化经验，能给出量化的优化结论。',
].join(NL);

const JD_QUOTE = '有日订单百万级系统的性能优化经验';

const EXTRACT = JSON.stringify({
  claims: [
    {
      text: '主导订单系统重构，把首屏从 2.4s 降到 0.8s',
      quote: QUOTE,
      category: 'achievement',
      weight: 0.9,
    },
  ],
});

function claimFixture(): Claim[] {
  const at = RESUME.indexOf(QUOTE);
  return [
    {
      id: 'C1',
      text: '主导订单系统重构，把首屏从 2.4s 降到 0.8s',
      anchor: { quote: QUOTE, start: at, end: at + QUOTE.length, exact: true },
      category: 'achievement',
      weight: 0.9,
    },
  ];
}

function jdFixture(): JobDescription[] {
  return [{ id: 'J1', ordinal: 1, title: '高级后端工程师（Node.js）', text: JD_TEXT }];
}

describe('反问环节', () => {
  it('依据锚不回材料的那条当场丢掉，并说清为什么', async () => {
    const client = createScriptedClient(() =>
      JSON.stringify({
        counters: [
          {
            text: '团队平时怎么排迭代？',
            kind: 'process',
            reason: '排期方式值得问清楚。',
            reply: '两周一个迭代。',
            quote: QUOTE,
            sourceId: 'C1',
          },
          {
            text: '你们的监控体系是怎么搭的？',
            kind: 'tech',
            reason: '想了解工程实践。',
            reply: '用了一套自研的。',
            quote: '这句话简历里没有',
            sourceId: 'C1',
          },
        ],
      }),
    );
    const result = await counterRound({ client, resumeText: RESUME, jds: [], requirements: [], claims: claimFixture() });
    expect(result.counters).toHaveLength(1);
    expect(result.counters[0]?.id).toBe('Q1');
    expect(result.counters[0]?.source).toBe('resume');
    expect(result.counters[0]?.anchor.quote).toBe(QUOTE);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('没有依据就不生成反问');
    expect(result.notices).toEqual([]);
  });

  it('没有 JD 也没有主张时，一次调用都不发', async () => {
    const client = createScriptedClient(() => new Error('这场不该调用模型'));
    const result = await counterRound({ client, resumeText: RESUME, jds: [], requirements: [], claims: [] });
    expect(result.counters).toEqual([]);
    expect(result.notices.join(' ')).toContain('没有可依据的材料');
    expect(client.countPurpose('counter')).toBe(0);
  });

  it('解析不出来只记一句说明，不让整场沙盘白跑', async () => {
    const client = createScriptedClient(() => '我今天不想输出 JSON');
    const result = await counterRound({ client, resumeText: RESUME, jds: [], requirements: [], claims: claimFixture() });
    expect(result.counters).toEqual([]);
    expect(result.notices.join(' ')).toContain('反问环节没有走通');
    expect(result.notices.join(' ')).toContain('这一节留空');
  });

  it('客户端自己报错照样冒泡：卡带缺失是可复现性契约的一部分', async () => {
    const client = createScriptedClient(() => new LlmError('cassette-missing', '没有找到该提示词的卡带'));
    await expect(counterRound({ client, resumeText: RESUME, jds: [], requirements: [], claims: claimFixture() })).rejects.toThrow(/卡带/);
  });
});

describe('反问与报告', () => {
  let db: Db;
  let sessionId: string;

  beforeEach(() => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    sessionId = insertSession(db, {
      jobTitle: '高级后端工程师（Node.js）',
      jdText: JD_TEXT,
      resumeText: RESUME,
      resumeHash: 'hash-counter',
      llmMode: 'live',
      budget: { config: DEFAULT_BUDGET, totalProbes: 0, claims: {} },
    });
    insertJds(db, sessionId, jdFixture());
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('跑完一场：反问落进业务表，两份报告里都有这一节', async () => {
    const client = createScriptedClient((req) => {
      if (req.purpose === 'extract') return EXTRACT;
      if (req.purpose === 'jd-extract') return JSON.stringify({ requirements: [] });
      if (req.purpose === 'probe') return JSON.stringify({ probes: [] });
      if (req.purpose === 'answer') return JSON.stringify({ answered: false, text: '简历里没有写这一条。', citedQuotes: [] });
      if (req.purpose === 'verdict') return JSON.stringify({ kind: 'unsupported', confidence: 0.6, rationale: '这条主张没有可定位的证据', evidenceQuotes: [] });
      if (req.purpose === 'suggest') return JSON.stringify({ suggestions: [] });
      if (req.purpose === 'counter') {
        return JSON.stringify({
          counters: [
            {
              text: '你们团队现在的订单量级大概是多少？',
              kind: 'business',
              reason: '岗位要求写了百万级订单，值得确认现在的量级。',
              reply: '现在日均几十万单，大促会翻几倍。',
              quote: JD_QUOTE,
              sourceId: 'J1',
            },
          ],
        });
      }
      return new Error('脚本化模型没有为 purpose=' + req.purpose + ' 准备返回值');
    });
    await runAndPersist({ db, sessionId, client, panelIds: ['tech'] });
    const view = assembleSession(db, sessionId);
    expect(view).not.toBeNull();
    if (view === null) return;
    expect(view.counters).toHaveLength(1);
    expect(view.counters[0]?.source).toBe('jd');
    expect(view.counters[0]?.jdId).toBe('J1');
    expect(view.counters[0]?.anchor.quote).toBe(JD_QUOTE);
    expect(view.counterRejected).toEqual([]);

    const md = renderReport(view);
    expect(md).toContain('## 四、轮到你了（1 句可以反问）');
    expect(md).toContain('你们团队现在的订单量级大概是多少？');
    expect(md).toContain('（来自《高级后端工程师（Node.js）》');

    const html = renderReportHtml(view);
    expect(html).toContain('轮到你了');
    expect(html).toContain('依据原文 · 高级后端工程师（Node.js）');
  });
});
