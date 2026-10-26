/**
 * 存储层测试。全部跑在内存库上（':memory:'），不碰磁盘、不依赖外部服务。
 *
 * 最该被测的不是"能存能取"，而是三条容易静默出错的约定：
 * 级联删除、事件 seq 的连续性、以及事务失败后不能留下半条数据。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initBudget } from '@crossexam/shared';
import { closeDatabase, openDatabase, withTransaction } from '../src/store/db.ts';
import { SCHEMA_VERSION, SchemaVersionError, migrate } from '../src/store/schema.ts';
import {
  appendEvent,
  deleteSession,
  getClaim,
  getSession,
  insertClaims,
  insertProbe,
  insertSession,
  latestSession,
  listClaims,
  listEvents,
  listProbes,
  listSessions,
  llmStats,
  recordLlmCall,
  saveAnswer,
  saveVerdict,
  updateSessionStatus,
} from '../src/store/repo.ts';
import type { Db } from '../src/store/db.ts';
import type { Anchor, Claim, Probe, Suggestion, Verdict } from '@crossexam/shared';

const RESUME = '主导重构订单系统，首屏从 2.4s 降到 0.8s。熟悉 TypeScript 与 Node.js。';

function anchor(quote: string, start: number, end: number): Anchor {
  return { quote: quote, start: start, end: end, exact: true };
}

function claimOf(id: string, text: string, quote: string): Claim {
  return { id: id, text: text, anchor: anchor(quote, 0, quote.length), category: 'achievement', weight: 0.8 };
}

function probeOf(id: string, claimId: string, round: number): Probe {
  return {
    id: id,
    claimId: claimId,
    interviewerId: 'tech-1',
    round: round,
    question: '这个 2.4s 是怎么测出来的？',
    anchor: anchor('首屏从 2.4s 降到 0.8s', 10, 26),
    parentProbeId: null,
    rationale: '数字化成果必须能说明测量口径。',
  };
}

let db: Db;

beforeEach(function () {
  db = openDatabase({ path: ':memory:' });
  migrate(db);
});

afterEach(function () {
  closeDatabase(db);
});

function seedSession(): string {
  return insertSession(db, {
    id: 'sess-1',
    jobTitle: '高级前端工程师',
    jdText: '负责订单系统性能优化。',
    resumeText: RESUME,
    resumeHash: 'deadbeef',
    llmMode: 'replay',
    budget: initBudget(['claim-1', 'claim-2']),
    meta: { demo: true },
    createdAt: '2026-10-26T00:00:00.000Z',
  });
}

describe('建表与迁移', function () {
  it('首次迁移建好表并写入版本号，重复执行是幂等的', function () {
    expect(migrate(db)).toBe(SCHEMA_VERSION);
    expect(migrate(db)).toBe(SCHEMA_VERSION);
    const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    expect(row?.user_version).toBe(SCHEMA_VERSION);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as unknown as { name: string }[];
    const names = tables.map(function (t) { return t.name; });
    expect(names).toContain('session');
    expect(names).toContain('claim');
    expect(names).toContain('probe');
    expect(names).toContain('event');
    expect(names).toContain('llm_call');
  });

  it('库版本比代码新时拒绝启动，而不是按老结构去读', function () {
    db.exec('PRAGMA user_version = ' + String(SCHEMA_VERSION + 1));
    let caught: unknown;
    try {
      migrate(db);
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof SchemaVersionError).toBe(true);
    expect(String((caught as Error).message)).toContain('高于本代码支持的');
  });
});

describe('会话', function () {
  it('存取往返保真：预算与元信息都能原样读回', function () {
    const id = seedSession();
    const row = getSession(db, id);
    expect(row).not.toBeNull();
    expect(row?.jobTitle).toBe('高级前端工程师');
    expect(row?.resumeText).toBe(RESUME);
    expect(row?.resumeHash).toBe('deadbeef');
    expect(row?.llmMode).toBe('replay');
    expect(row?.status).toBe('draft');
    expect(row?.budget.config.maxRoundsPerClaim).toBe(3);
    expect(Object.keys(row?.budget.claims ?? {})).toEqual(['claim-1', 'claim-2']);
    expect(row?.meta).toEqual({ demo: true });
    expect(row?.createdAt).toBe('2026-10-26T00:00:00.000Z');
  });

  it('列表按创建时间倒序，latestSession 拿到最近一条', function () {
    insertSession(db, {
      id: 'old', jobTitle: 'A', jdText: '', resumeText: RESUME, resumeHash: 'h1',
      llmMode: 'replay', budget: initBudget([]), createdAt: '2026-10-01T00:00:00.000Z',
    });
    insertSession(db, {
      id: 'new', jobTitle: 'B', jdText: '', resumeText: RESUME, resumeHash: 'h2',
      llmMode: 'live', budget: initBudget([]), createdAt: '2026-10-20T00:00:00.000Z',
    });
    expect(listSessions(db).map(function (s) { return s.id; })).toEqual(['new', 'old']);
    expect(latestSession(db)?.id).toBe('new');
  });

  it('状态可以推进，更新时间跟着走', function () {
    seedSession();
    updateSessionStatus(db, 'sess-1', 'probing', '2026-10-27T00:00:00.000Z');
    const row = getSession(db, 'sess-1');
    expect(row?.status).toBe('probing');
    expect(row?.updatedAt).toBe('2026-10-27T00:00:00.000Z');
  });

  it('删会话会把主张、追问、事件一并带走（否则会留下孤儿数据）', function () {
    seedSession();
    insertClaims(db, 'sess-1', [claimOf('claim-1', '性能优化', '首屏从 2.4s 降到 0.8s')]);
    insertProbe(db, 'sess-1', probeOf('probe-1', 'claim-1', 1));
    appendEvent(db, 'sess-1', 'session/created', {});
    deleteSession(db, 'sess-1');

    expect(getSession(db, 'sess-1')).toBeNull();
    expect(listClaims(db, 'sess-1')).toHaveLength(0);
    expect(listProbes(db, 'sess-1')).toHaveLength(0);
    expect(listEvents(db, 'sess-1')).toHaveLength(0);
  });
});

describe('主张', function () {
  it('ordinal 按传入顺序写死，读出来顺序不变', function () {
    seedSession();
    insertClaims(db, 'sess-1', [
      claimOf('claim-1', '首条', '主导重构订单系统'),
      claimOf('claim-2', '次条', '熟悉 TypeScript'),
    ]);
    const rows = listClaims(db, 'sess-1');
    expect(rows.map(function (r) { return r.ordinal; })).toEqual([0, 1]);
    expect(rows[0]?.id).toBe('claim-1');
    expect(rows[0]?.anchor.quote).toBe('主导重构订单系统');
    expect(rows[0]?.anchor.exact).toBe(true);
    expect(rows[0]?.status).toBe('open');
    expect(rows[0]?.verdict).toBeNull();
  });

  it('判定与修改建议一起落盘，读回来还是同一个对象', function () {
    seedSession();
    insertClaims(db, 'sess-1', [claimOf('claim-1', '性能优化', '首屏从 2.4s 降到 0.8s')]);
    const verdict: Verdict = {
      claimId: 'claim-1', kind: 'unsupported', confidence: 0.7,
      rationale: '没有说明测量口径。', evidence: [anchor('首屏从 2.4s 降到 0.8s', 10, 26)], probeIds: ['probe-1'],
    };
    const suggestion: Suggestion = {
      claimId: 'claim-1', anchor: anchor('首屏从 2.4s 降到 0.8s', 10, 26),
      problem: '数字缺口径', before: '首屏从 2.4s 降到 0.8s', after: '首屏（Lighthouse，Moto G4 模拟）从 2.4s 降到 0.8s',
      why: '面试官一定会问数字怎么测的。',
    };
    saveVerdict(db, 'claim-1', verdict, suggestion);

    const row = getClaim(db, 'claim-1');
    expect(row?.verdict).toBe('unsupported');
    expect(row?.suggestion?.after).toContain('Lighthouse');
    expect(row?.suggestion?.problem).toBe('数字缺口径');
  });
});

describe('追问', function () {
  it('追问、作答、单条判定都能往返', function () {
    seedSession();
    insertClaims(db, 'sess-1', [claimOf('claim-1', '性能优化', '首屏从 2.4s 降到 0.8s')]);
    insertProbe(db, 'sess-1', probeOf('probe-1', 'claim-1', 1), '2026-10-26T01:00:00.000Z');
    saveAnswer(db, 'probe-1', { probeId: 'probe-1', text: '用 Lighthouse 在 Moto G4 上跑的。', mode: 'live', citedAnchors: [] });
    db.prepare('UPDATE probe SET verdict = ? WHERE id = ?').run('solid', 'probe-1');

    const rows = listProbes(db, 'sess-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.question).toContain('2.4s');
    expect(rows[0]?.rationale).toContain('测量口径');
    expect(rows[0]?.answer?.mode).toBe('live');
    expect(rows[0]?.answer?.text).toContain('Lighthouse');
    expect(rows[0]?.createdAt).toBe('2026-10-26T01:00:00.000Z');
    expect(listProbes(db, 'sess-1', 'claim-1')).toHaveLength(1);
    expect(listProbes(db, 'sess-1', 'claim-2')).toHaveLength(0);
  });
});

describe('事件日志', function () {
  it('seq 连续自增，可以按 seq 续传', function () {
    seedSession();
    expect(appendEvent(db, 'sess-1', 'turn/start', { turn: 1 })).toBe(1);
    expect(appendEvent(db, 'sess-1', 'probe/asked', { probeId: 'p1' })).toBe(2);
    expect(appendEvent(db, 'sess-1', 'turn/end', { turn: 1 })).toBe(3);

    expect(listEvents(db, 'sess-1')).toHaveLength(3);
    const tail = listEvents(db, 'sess-1', 1);
    expect(tail.map(function (e) { return e.seq; })).toEqual([2, 3]);
    expect(tail[0]?.payload).toEqual({ probeId: 'p1' });
  });
});

describe('模型调用账本', function () {
  it('区分回放与真实调用，并统计 token 与去重指纹', function () {
    seedSession();
    const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30, reasoningTokens: 5 };
    recordLlmCall(db, { sessionId: 'sess-1', digest: 'd1', purpose: '抽取主张', model: 'm', replayed: true, usage: usage, elapsedMs: 0 });
    recordLlmCall(db, { sessionId: 'sess-1', digest: 'd1', purpose: '抽取主张', model: 'm', replayed: true, usage: usage, elapsedMs: 0 });
    recordLlmCall(db, {
      sessionId: 'sess-1', digest: 'd2', purpose: '生成提问', model: 'm', replayed: false,
      usage: { inputTokens: 50, outputTokens: 10, cacheReadTokens: 0, reasoningTokens: 0 }, elapsedMs: 900,
    });

    const stats = llmStats(db, 'sess-1');
    expect(stats.calls).toBe(3);
    expect(stats.replayedCalls).toBe(2);
    expect(stats.liveCalls).toBe(1);
    expect(stats.distinctDigests).toBe(2);
    expect(stats.inputTokens).toBe(250);
    expect(stats.outputTokens).toBe(50);
    expect(stats.cacheReadTokens).toBe(60);
    expect(llmStats(db).calls).toBe(3);
  });
});

describe('事务', function () {
  it('中途抛错就整段回滚，不留半条数据', function () {
    seedSession();
    expect(function () {
      withTransaction(db, function () {
        insertClaims(db, 'sess-1', [claimOf('claim-1', '第一条', '主导重构订单系统')]);
        throw new Error('模拟抽取中途失败');
      });
    }).toThrowError('模拟抽取中途失败');
    expect(listClaims(db, 'sess-1')).toHaveLength(0);
  });

  it('嵌套调用直接报错，不静默产生半个事务', function () {
    seedSession();
    expect(function () {
      withTransaction(db, function () {
        withTransaction(db, function () {
          return 1;
        });
      });
    }).toThrowError('不支持嵌套');
    // 报错后标志位必须复位，否则整个进程接下来的写入都会失败。
    const id = insertSession(db, {
      id: 'after', jobTitle: 'C', jdText: '', resumeText: RESUME, resumeHash: 'h',
      llmMode: 'replay', budget: initBudget([]),
    });
    expect(id).toBe('after');
  });
});
