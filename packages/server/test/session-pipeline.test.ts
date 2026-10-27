/**
 * 会话执行器的端到端测试：编排器 + 数据库 + 事件日志 + 记账。
 *
 * 这一层的价值不在于"能写库"，而在于三件事可断言：
 *   1. 事件日志连续（前端断线按 seq 续传不会漏不会重）
 *   2. 每次模型调用都落了一行账（"到底联没联网"是可以查的）
 *   3. 会话状态随阶段推进，失败会留下 failed
 *
 * 这里刻意只用一位面试官、每主张一轮，把调用次数钉成常量：
 * 一旦编排层悄悄多开一轮，这条测试会立刻变红，不会靠"看起来还行"混过去。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BUDGET } from '@crossexam/shared';
import { assembleSession, runAndPersist } from '../src/pipeline.ts';
import {
  appendEvent,
  closeDatabase,
  getSession,
  insertSession,
  listClaims,
  listEvents,
  listProbes,
  llmStats,
  migrate,
  openDatabase,
} from '../src/store/index.ts';
import type { Db } from '../src/store/index.ts';
import { createScriptedClient } from './scripted.ts';
import type { LlmClient } from '../src/llm/types.ts';

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

const PROBE = JSON.stringify({
  probes: [
    { claimId: 'C1', question: '这个 2.4s 是怎么测出来的？', quote: QUOTE, rationale: '性能数字最容易被追问测量方法' },
  ],
});

const ANSWER = JSON.stringify({ answered: true, text: '本地 Chrome 冷启动测的首屏', citedQuotes: [QUOTE] });

const VERDICT = JSON.stringify({
  kind: 'solid',
  confidence: 0.8,
  rationale: '简历写了具体数字，候选人也说得出测量方法',
  evidenceQuotes: [QUOTE],
});

/** 只留一位面试官、每主张一轮：调用次数因此是确定的 4 次 */
const RUN_OPTS = {
  panelIds: ['tech'],
  budgetConfig: { maxRoundsPerClaim: 1, maxProbesPerInterviewerPerClaim: 1, maxTotalProbes: 4, maxConsecutiveUnanswerable: 2 },
} as const;

function purposeRouter(): (req: { purpose: string }) => string {
  const map: Record<string, string> = {
    extract: EXTRACT,
    probe: PROBE,
    answer: ANSWER,
    verdict: VERDICT,
    suggest: JSON.stringify({ suggestions: [] }),
    counter: JSON.stringify({ counters: [] }),
  };
  return (req) => map[req.purpose] ?? JSON.stringify({});
}

let db: Db;
let sessionId: string;

beforeEach(() => {
  db = openDatabase({ path: ':memory:' });
  migrate(db);
  sessionId = insertSession(db, {
    jobTitle: '后端工程师',
    jdText: '负责订单系统',
    resumeText: RESUME,
    resumeHash: 'hash-demo',
    llmMode: 'live',
    budget: { config: DEFAULT_BUDGET, totalProbes: 0, claims: {} },
  });
});

afterEach(() => {
  closeDatabase(db);
});

function scripted(): LlmClient {
  return createScriptedClient(purposeRouter() as never);
}

describe('会话执行器', () => {
  it('跑完一盘沙盘：主张、追问、回答、判定全部落库', async () => {
    const result = await runAndPersist({ db, sessionId, client: scripted(), ...RUN_OPTS });

    expect(result.claims).toHaveLength(1);
    const claims = listClaims(db, sessionId);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.id).toBe('C1');
    expect(claims[0]?.verdict).toBe('solid');
    expect(claims[0]?.anchor.quote).toBe(QUOTE);

    const probes = listProbes(db, sessionId);
    expect(probes).toHaveLength(1);
    expect(probes[0]?.answer?.text).toContain('冷启动');
    expect(probes[0]?.verdict).toBe('solid');

    expect(getSession(db, sessionId)?.status).toBe('done');
  });

  it('事件日志按 seq 连续，链路上每类事件都在', async () => {
    await runAndPersist({ db, sessionId, client: scripted(), ...RUN_OPTS });
    const events = listEvents(db, sessionId);
    expect(events.map((e) => e.kind)).toEqual([
      'stage', 'claims', 'stage', 'probes', 'stage', 'answers', 'budget', 'stage', 'verdicts', 'stage', 'suggestions',
      'stage', 'counter',
    ]);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(listEvents(db, sessionId, 7)).toHaveLength(6);
  });

  it('每次模型调用落一行账，"到底联没联网"变成可查询的事实', async () => {
    await runAndPersist({ db, sessionId, client: scripted(), ...RUN_OPTS });
    const stats = llmStats(db, sessionId);
    expect(stats.calls).toBe(5);
    expect(stats.replayedCalls).toBe(0);
    expect(stats.liveCalls).toBe(5);
    expect(stats.outputTokens).toBe(100);
    expect(stats.distinctDigests).toBe(5);
  });

  it('回放出来的客户端会被记成 replayed，不冒充真实调用', async () => {
    const inner = scripted();
    const replayish: LlmClient = {
      mode: 'replay',
      complete: async (req) => ({ ...(await inner.complete(req)), replayed: true }),
      stream: inner.stream.bind(inner),
    };
    const result = await runAndPersist({ db, sessionId, client: replayish, ...RUN_OPTS });
    expect(result.claims).toHaveLength(1);
    const stats = llmStats(db, sessionId);
    expect(stats.replayedCalls).toBe(5);
    expect(stats.liveCalls).toBe(0);
  });

  it('读侧能把表与事件日志合成一份完整视图', async () => {
    await runAndPersist({ db, sessionId, client: scripted(), ...RUN_OPTS });
    const view = assembleSession(db, sessionId);
    expect(view).not.toBeNull();
    if (view === null) return;
    expect(view.claims).toHaveLength(1);
    expect(view.probes).toHaveLength(1);
    expect(view.verdicts[0]?.verdict.kind).toBe('solid');
    expect(view.verdicts[0]?.verdict.rationale).toContain('测量方法');
    expect(view.rounds).toBe(1);
    expect(view.usage.outputTokens).toBe(100);
    expect(view.llm.calls).toBe(5);
    expect(assembleSession(db, 'nope')).toBeNull();
  });

  it('同一个会话不允许跑第二次，否则主张会落两份', async () => {
    await runAndPersist({ db, sessionId, client: scripted(), ...RUN_OPTS });
    await expect(runAndPersist({ db, sessionId, client: scripted(), ...RUN_OPTS })).rejects.toThrow(/已经跑过了/);
  });


  it('上次跑到一半就没了（进程被关），重跑会先抹掉痕迹，日志里不会留两份', async () => {
    // 模拟半截的运行：事件已经写进去了，主张还没落库（主张是最后整批落的）。
    appendEvent(db, sessionId, 'stage', { type: 'stage', stage: 'extract', round: 0 });
    appendEvent(db, sessionId, 'claims', { type: 'claims', claims: [] });
    expect(listEvents(db, sessionId)).toHaveLength(2);

    await runAndPersist({ db, sessionId, client: scripted(), ...RUN_OPTS });

    const events = listEvents(db, sessionId);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(events.filter((e) => e.kind === 'claims')).toHaveLength(1);
    expect(listClaims(db, sessionId)).toHaveLength(1);
    expect(getSession(db, sessionId)?.status).toBe('done');
  });

  it('一位面试官一轮对同一条主张问两条，也落得进库（v3 唯一约束的回归）', async () => {
    // 这个场景在产品上是合理的：第一问追口径、第二问追条件。
    // v2 的 probe 表有 UNIQUE (session_id, claim_id, round, interviewer_id)，
    // 撞上它时整场事务会在落库那一步回滚、接口直接 500 —— 而合成卡带里
    // 每条主张每轮恰好只有一问，所以这个缺陷一直没被测试碰到。
    const twoProbes = JSON.stringify({
      probes: [
        { claimId: 'C1', question: '这个 2.4s 是怎么测出来的？', quote: QUOTE, rationale: '口径' },
        { claimId: 'C1', question: '取的是均值还是 P75？', quote: QUOTE, rationale: '统计口径' },
      ],
    });
    const client = createScriptedClient((req) => {
      if (req.purpose === 'probe') return twoProbes;
      return purposeRouter()(req);
    });
    const result = await runAndPersist({
      db,
      sessionId,
      client,
      panelIds: ['tech'],
      // 轮数上限必须大于 1：否则第二条会被「轮数闸门」拦下，测的就不是唯一约束了。
      budgetConfig: { maxRoundsPerClaim: 2, maxProbesPerInterviewerPerClaim: 2, maxTotalProbes: 4, maxConsecutiveUnanswerable: 2 },
    });

    expect(result.probes).toHaveLength(2);
    const rows = listProbes(db, sessionId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.question).sort()).toEqual(['取的是均值还是 P75？', '这个 2.4s 是怎么测出来的？']);
    expect(rows.every((r) => r.round === 1 && r.interviewerId === 'tech')).toBe(true);
    // 两条追问各自的作答与判定都要落上，不能只有第一条
    expect(rows.every((r) => r.answer !== null)).toBe(true);
    expect(rows.every((r) => r.verdict === 'solid')).toBe(true);
  });

  it('失败时会话标记为 failed，并且先留一条错误事件', async () => {
    const client = createScriptedClient((req) => {
      if (req.purpose === 'extract') return new Error('模型连接断了');
      return JSON.stringify({ claims: [] });
    });
    await expect(runAndPersist({ db, sessionId, client, ...RUN_OPTS })).rejects.toThrow(/模型连接断了/);
    expect(getSession(db, sessionId)?.status).toBe('failed');
    const events = listEvents(db, sessionId);
    expect(events[events.length - 1]?.kind).toBe('error');
  });
});
