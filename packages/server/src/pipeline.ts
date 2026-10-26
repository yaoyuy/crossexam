/**
 * 会话执行器：把纯编排器接到数据库与事件流上。
 *
 * run.ts 刻意不碰数据库、不碰时间；所有脏活都在这里：落库、发事件、记账。
 * 于是"同一份输入在 live / record / replay 走同一条代码路径"不是一句口号，
 * 三个模式唯一的差别，是注入进来的 client 从哪儿拿文本。
 *
 * 另外一条刻意的设计：事件日志是**真相**，表是索引。
 * 判定的理由、证据、调整说明全都写在事件里，claim 表只留一个 kind 供筛选。
 * 这样前端"重放一遍"与"查表"看到的是同一件事，不需要把 JSON 拆成十个列。
 */

import { buildContracts, contractDigest, renderSystemPrompt, shortHash } from '@crossexam/shared';
import type {
  BudgetConfig,
  ContractBudgetView,
  IntentContract,
  InterviewerRole,
  RejectedClaim,
  Suggestion,
} from '@crossexam/shared';
import type { LlmClient, LlmRequest, LlmResult, LlmStreamEvent, LlmUsage } from './llm/types.ts';
import { EMPTY_USAGE } from './llm/types.ts';
import { DEFAULT_MAX_ROUNDS, DEFAULT_PANEL, runSession } from './orchestrator/run.ts';
import type { RunEvent, RunSessionResult } from './orchestrator/run.ts';
import type { VerdictOutcome } from './orchestrator/verdict.ts';
import type { SuggestOutcome } from './orchestrator/suggest.ts';
import {
  appendEvent,
  getSession,
  insertClaims,
  insertProbe,
  listClaims,
  listEvents,
  listProbes,
  llmStats,
  recordLlmCall,
  saveAnswer,
  saveProbeVerdict,
  saveSessionBudget,
  saveSessionMeta,
  saveVerdict,
  updateSessionStatus,
  withTransaction,
} from './store/index.ts';
import type { ClaimRow, Db, EventRow, LlmStats, ProbeRow, SessionRow, SessionStatus } from './store/index.ts';

/** 阶段 → 会话状态：刷新页面也能看出跑到哪一步了 */
const STAGE_STATUS: Record<string, SessionStatus> = {
  extract: 'extracting',
  probe: 'probing',
  answer: 'probing',
  verdict: 'scoring',
  suggest: 'scoring',
};

export interface AccountingOptions {
  db: Db;
  sessionId: string | null;
  /** 落账用的模型名。回放时没有模型，写 fixture 更诚实。 */
  model?: string;
}

/**
 * 给任何客户端套一层记账。
 *
 * 这一层存在的意义：让"这次演示到底联没联网、花了多少 token"
 * 变成数据库里可查询的事实，而不是技术文档里的一句自称。
 */
export function withAccounting(inner: LlmClient, opts: AccountingOptions): LlmClient {
  function note(req: LlmRequest, result: LlmResult): void {
    recordLlmCall(opts.db, {
      sessionId: opts.sessionId,
      digest: result.digest,
      purpose: req.purpose,
      model: opts.model ?? (result.replayed ? 'fixture' : 'unknown'),
      replayed: result.replayed,
      usage: result.usage,
      elapsedMs: result.elapsedMs,
    });
  }

  const wrapped: LlmClient = {
    mode: inner.mode,
    async complete(req: LlmRequest): Promise<LlmResult> {
      const result = await inner.complete(req);
      note(req, result);
      return result;
    },
    async *stream(req: LlmRequest): AsyncGenerator<LlmStreamEvent, void, void> {
      let last: LlmResult | null = null;
      for await (const event of inner.stream(req)) {
        if (event.type === 'done') last = event.result;
        yield event;
      }
      if (last !== null) note(req, last);
    },
  };
  return wrapped;
}

export interface PersistRunInput {
  db: Db;
  sessionId: string;
  client: LlmClient;
  model?: string;
  panel?: readonly InterviewerRole[];
  budgetConfig?: BudgetConfig;
  maxRounds?: number;
  maxClaims?: number;
  maxProbesPerTurn?: number;
  /** seq 是事件日志里的序号：SSE 用它当 id，断线就能按序号续传 */
  onEvent?: (event: RunEvent, seq: number) => void | Promise<void>;
}

/** 一个会话只能跑一次：重跑会让同一批主张在表里出现两份，宁可明确拒绝 */
export function assertFreshSession(db: Db, sessionId: string): void {
  const existing = listClaims(db, sessionId);
  if (existing.length > 0) {
    throw new Error('会话 ' + sessionId + ' 已经跑过了（已有 ' + String(existing.length) + ' 条主张）。要重跑请新建会话，否则同一批主张会落两份。');
  }
}

export async function runAndPersist(input: PersistRunInput): Promise<RunSessionResult> {
  const db = input.db;
  const sessionId = input.sessionId;
  const session = getSession(db, sessionId);
  if (session === null) throw new Error('会话不存在：' + sessionId);
  assertFreshSession(db, sessionId);

  async function emit(event: RunEvent): Promise<void> {
    if (event.type === 'stage') {
      const next = STAGE_STATUS[event.stage];
      if (next !== undefined) updateSessionStatus(db, sessionId, next);
    }
    const seq = appendEvent(db, sessionId, event.type, event as unknown as Record<string, unknown>);
    if (input.onEvent) await input.onEvent(event, seq);
  }

  updateSessionStatus(db, sessionId, 'extracting');
  try {
    const result = await runSession({
      client: withAccounting(input.client, { db, sessionId, model: input.model }),
      resumeText: session.resumeText,
      jdText: session.jdText,
      panel: input.panel ?? DEFAULT_PANEL,
      budgetConfig: input.budgetConfig,
      maxRounds: input.maxRounds ?? DEFAULT_MAX_ROUNDS,
      maxClaims: input.maxClaims,
      maxProbesPerTurn: input.maxProbesPerTurn,
      onEvent: emit,
    });
    persistResult(db, sessionId, result);
    updateSessionStatus(db, sessionId, 'done');
    return result;
  } catch (err) {
    updateSessionStatus(db, sessionId, 'failed');
    throw err;
  }
}

/** 把一次跑完的结果落盘。整批放进一个事务：要么全在，要么都不在。 */
export function persistResult(db: Db, sessionId: string, result: RunSessionResult): void {
  const suggestionByClaim = new Map<string, Suggestion>();
  for (const suggestion of result.suggestions) suggestionByClaim.set(suggestion.claimId, suggestion);

  withTransaction(db, () => {
    insertClaims(db, sessionId, result.claims);
    for (const probe of result.probes) insertProbe(db, sessionId, probe);

    for (const [claimId, entries] of Object.entries(result.transcriptByClaim)) {
      for (const entry of entries) {
        if (entry.answer !== null) saveAnswer(db, entry.probe.id, entry.answer);
      }
      const detail = result.verdictDetails.find((d) => d.verdict.claimId === claimId);
      if (detail === undefined) continue;
      saveVerdict(db, claimId, detail.verdict, suggestionByClaim.get(claimId) ?? null);
      for (const probeId of detail.verdict.probeIds) saveProbeVerdict(db, probeId, detail.verdict.kind);
    }

    saveSessionBudget(db, sessionId, result.budgetState);
    saveSessionMeta(db, sessionId, {
      panel: result.panel,
      rounds: result.rounds,
      notices: result.notices,
      usage: result.usage,
      resumeHash: shortHash(result.resumeText, 24),
      contracts: result.contracts.map((c) => ({ id: c.id, version: c.version, digest: contractDigest(c) })),
    });
  });
}

/* --------------------------------------------------------------------- 读侧 */

export interface SessionView {
  session: SessionRow;
  claims: ClaimRow[];
  probes: ProbeRow[];
  events: EventRow[];
  llm: LlmStats;
  notices: string[];
  usage: LlmUsage;
  rounds: number;
  rejectedClaims: RejectedClaim[];
  verdicts: VerdictOutcome[];
  suggestions: SuggestOutcome[];
  /** 这场沙盘当时用的意图契约。表里只存了指纹，全文是按同样输入重算出来的 */
  contracts: ContractView[];
}

/** 落库时只留下一行指纹，够对账又不必把契约全文塞进 meta */
interface StoredContract {
  id: string;
  version: number;
  digest: string;
}

/**
 * 一位面试官的意图契约，连同它此刻的指纹与运行时指纹的对照结果。
 *
 * 契约是**声明式意图**：不在数据库里存全文，而是按同样的角色与预算重新算一遍。
 * 重算的意义在于对账——如果代码里的契约被人改过，重算出的指纹就和会话里存的对不上，
 * 界面会直接显示「契约漂移」。这比存一份可能过期的副本要诚实。
 */
export interface ContractView {
  id: string;
  version: number;
  /** 此刻用代码里的契约算出的指纹 */
  digest: string;
  /** 跑这场沙盘时落库的指纹；没跑过或旧会话可能是 null */
  storedDigest: string | null;
  /** 指纹与版本都对得上，才叫「运行时一致」 */
  verified: boolean;
  contract: IntentContract;
  /** 这位面试官实际拿到的 system prompt，可逐字对照契约 */
  systemPrompt: string;
}

function metaContracts(meta: Record<string, unknown>): StoredContract[] {
  const value = meta['contracts'];
  if (!Array.isArray(value)) return [];
  const out: StoredContract[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const id = raw['id'];
    const digest = raw['digest'];
    if (typeof id !== 'string' || typeof digest !== 'string') continue;
    const version = raw['version'];
    out.push({ id, version: typeof version === 'number' ? version : 1, digest });
  }
  return out;
}

/** 由角色 + 预算生成契约视图；纯函数，不碰数据库也不调模型 */
export function contractViews(
  roles: readonly InterviewerRole[],
  budget: ContractBudgetView,
  stored: readonly StoredContract[] = [],
): ContractView[] {
  return buildContracts(roles, budget, 1).map((contract) => {
    const digest = contractDigest(contract);
    let match: StoredContract | undefined;
    for (const item of stored) {
      if (item.id === contract.id) match = item;
    }
    return {
      id: contract.id,
      version: contract.version,
      digest,
      storedDigest: match === undefined ? null : match.digest,
      verified: match !== undefined && match.digest === digest && match.version === contract.version,
      contract,
      systemPrompt: renderSystemPrompt(contract),
    };
  });
}

/** 从事件日志里取最后一次某类事件的载荷。事件是真相，表只是索引。 */
function lastPayload<T>(events: readonly EventRow[], kind: string, key: string): T[] {
  let out: T[] = [];
  for (const event of events) {
    if (event.kind !== kind) continue;
    const value = event.payload[key];
    if (Array.isArray(value)) out = value as T[];
  }
  return out;
}

function metaNumber(meta: Record<string, unknown>, key: string): number {
  const value = meta[key];
  return typeof value === 'number' ? value : 0;
}

function metaStrings(meta: Record<string, unknown>, key: string): string[] {
  const value = meta[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function metaUsage(meta: Record<string, unknown>): LlmUsage {
  const value = meta['usage'];
  if (value === null || typeof value !== 'object') return EMPTY_USAGE;
  const raw = value as Record<string, unknown>;
  const num = (key: string): number => (typeof raw[key] === 'number' ? (raw[key] as number) : 0);
  return {
    inputTokens: num('inputTokens'),
    outputTokens: num('outputTokens'),
    cacheReadTokens: num('cacheReadTokens'),
    reasoningTokens: num('reasoningTokens'),
  };
}

/** 组装前端要的一份完整会话。表 + 事件日志合起来才是一次沙盘的全貌。 */
export function assembleSession(db: Db, sessionId: string): SessionView | null {
  const session = getSession(db, sessionId);
  if (session === null) return null;
  const events = listEvents(db, sessionId, 0);
  const rejectedClaims = lastPayload<RejectedClaim>(events, 'claims', 'rejected');
  const stored = metaContracts(session.meta);
  const panel: InterviewerRole[] =
    stored.length > 0 ? stored.map((item) => item.id as InterviewerRole) : [...DEFAULT_PANEL];
  return {
    session,
    claims: listClaims(db, sessionId),
    probes: listProbes(db, sessionId),
    events,
    llm: llmStats(db, sessionId),
    notices: metaStrings(session.meta, 'notices'),
    usage: metaUsage(session.meta),
    rounds: metaNumber(session.meta, 'rounds'),
    rejectedClaims,
    verdicts: lastPayload<VerdictOutcome>(events, 'verdicts', 'verdicts'),
    suggestions: lastPayload<SuggestOutcome>(events, 'suggestions', 'suggestions'),
    contracts: contractViews(panel, session.budget.config, stored),
  };
}
