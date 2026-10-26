/**
 * 仓储层：领域对象与 SQLite 行之间的翻译。
 *
 * 两条约定：
 * 1. **仓储只搬数据，不做判定。** 任何「该不该问」「站不站得住」的决策都在
 *    shared 的纯函数里，那样规则能被单测，而 SQL 只负责存取。
 * 2. **每个函数只发一条语句。** 需要原子性的多步写入请自己用
 *    withTransaction 包起来——仓储内部偷偷开事务会让调用方无法组合。
 */

import { newId } from '@crossexam/shared';
import type {
  Anchor,
  Answer,
  BudgetState,
  Claim,
  ClaimCategory,
  Probe,
  Suggestion,
  Verdict,
  VerdictKind,
} from '@crossexam/shared';
import type { Db } from './db.ts';

export type SessionStatus = 'draft' | 'extracting' | 'probing' | 'scoring' | 'done' | 'failed';

/** 存下来的运行模式：决定这次会话的模型调用有没有联网。 */
export type StoredLlmMode = 'live' | 'record' | 'replay';

/* ---------------------------------------------------------------- 行 <-> 对象 */

function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function bit(value: boolean): number {
  return value ? 1 : 0;
}

function toBool(value: unknown): boolean {
  return value === 1 || value === true;
}

function toInt(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

/** node:sqlite 把查询结果标成宽泛的记录类型；这里收口一次，避免每处写双断言。 */
function asRows<T>(value: unknown): T[] {
  return value as T[];
}

function anchorOf(quote: unknown, start: unknown, end: unknown, exact: unknown): Anchor {
  return { quote: toText(quote), start: toInt(start), end: toInt(end), exact: toBool(exact) };
}

/** 时间统一用 ISO 字符串存：人能读、字典序即时序、跨时区不会歧义。 */
export function nowIso(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------- session */

export interface NewSession {
  id?: string;
  jobTitle: string;
  jdText: string;
  resumeText: string;
  /** 简历内容的哈希：用来确认一盘卡带属于哪份简历，而不必存第二份正文。 */
  resumeHash: string;
  llmMode: StoredLlmMode;
  budget: BudgetState;
  meta?: Record<string, unknown>;
  createdAt?: string;
}

export interface SessionRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  llmMode: StoredLlmMode;
  jobTitle: string;
  jdText: string;
  resumeText: string;
  resumeHash: string;
  status: SessionStatus;
  budget: BudgetState;
  meta: Record<string, unknown>;
}

interface SessionDbRow {
  id: string;
  created_at: string;
  updated_at: string;
  mode: string;
  job_title: string;
  jd_text: string;
  resume_text: string;
  resume_hash: string;
  status: string;
  budget_json: string;
  meta_json: string;
}

function mapSession(row: SessionDbRow): SessionRow {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    llmMode: row.mode as StoredLlmMode,
    jobTitle: row.job_title,
    jdText: row.jd_text,
    resumeText: row.resume_text,
    resumeHash: row.resume_hash,
    status: row.status as SessionStatus,
    budget: parseJson<BudgetState>(row.budget_json, { config: { maxRoundsPerClaim: 0, maxProbesPerInterviewerPerClaim: 0, maxTotalProbes: 0, maxConsecutiveUnanswerable: 0 }, totalProbes: 0, claims: {} }),
    meta: parseJson<Record<string, unknown>>(row.meta_json, {}),
  };
}

export function insertSession(db: Db, input: NewSession): string {
  const id = input.id ?? newId('s');
  const at = input.createdAt ?? nowIso();
  db.prepare(
    'INSERT INTO session (id, created_at, updated_at, mode, job_title, jd_text, resume_text, resume_hash, status, budget_json, meta_json)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    at,
    at,
    input.llmMode,
    input.jobTitle,
    input.jdText,
    input.resumeText,
    input.resumeHash,
    'draft',
    JSON.stringify(input.budget),
    JSON.stringify(input.meta ?? {}),
  );
  return id;
}

export function getSession(db: Db, id: string): SessionRow | null {
  const row = db.prepare('SELECT * FROM session WHERE id = ?').get(id) as SessionDbRow | undefined;
  return row === undefined ? null : mapSession(row);
}

export function listSessions(db: Db, limit: number = 50): SessionRow[] {
  const rows = asRows<SessionDbRow>(db.prepare('SELECT * FROM session ORDER BY created_at DESC, id DESC LIMIT ?').all(limit));
  return rows.map(mapSession);
}

/** 比赛演示只需要"最近一次"，单独给一个函数，省得前端到处写 LIMIT 1。 */
export function latestSession(db: Db): SessionRow | null {
  const all = listSessions(db, 1);
  return all.length > 0 ? (all[0] as SessionRow) : null;
}

export function updateSessionStatus(db: Db, id: string, status: SessionStatus, at: string = nowIso()): void {
  db.prepare('UPDATE session SET status = ?, updated_at = ? WHERE id = ?').run(status, at, id);
}

export function saveSessionBudget(db: Db, id: string, budget: BudgetState, at: string = nowIso()): void {
  db.prepare('UPDATE session SET budget_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(budget), at, id);
}

export function saveSessionMeta(db: Db, id: string, meta: Record<string, unknown>, at: string = nowIso()): void {
  db.prepare('UPDATE session SET meta_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(meta), at, id);
}

export function deleteSession(db: Db, id: string): void {
  // 外键上的 ON DELETE CASCADE 会把主张 / 追问 / 事件一并带走。
  db.prepare('DELETE FROM session WHERE id = ?').run(id);
}

/* --------------------------------------------------------------------- claim */

export interface ClaimRow extends Claim {
  ordinal: number;
  /** open = 还可以追问；closed = 预算已关停 */
  status: string;
  verdict: VerdictKind | null;
  suggestion: Suggestion | null;
}

interface ClaimDbRow {
  id: string;
  ordinal: number;
  text: string;
  category: string;
  weight: number;
  quote: string;
  start: number;
  end: number;
  exact: number;
  status: string;
  verdict: string | null;
  advice_json: string | null;
}

function mapClaim(row: ClaimDbRow): ClaimRow {
  return {
    id: row.id,
    ordinal: toInt(row.ordinal),
    text: row.text,
    category: row.category as ClaimCategory,
    weight: Number(row.weight),
    anchor: anchorOf(row.quote, row.start, row.end, row.exact),
    status: row.status,
    verdict: row.verdict === null ? null : (row.verdict as VerdictKind),
    suggestion: parseJson<Suggestion | null>(row.advice_json, null),
  };
}

/** 按抽取顺序写入主张。ordinal 由数组下标决定，保证展示顺序稳定可复现。 */
export function insertClaims(db: Db, sessionId: string, claims: readonly Claim[]): void {
  const stmt = db.prepare(
    'INSERT INTO claim (id, session_id, ordinal, text, category, weight, quote, start, end, exact, status, verdict, advice_json)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)',
  );
  claims.forEach(function (claim, index) {
    stmt.run(
      claim.id,
      sessionId,
      index,
      claim.text,
      claim.category,
      claim.weight,
      claim.anchor.quote,
      claim.anchor.start,
      claim.anchor.end,
      bit(claim.anchor.exact),
      'open',
    );
  });
}

export function listClaims(db: Db, sessionId: string): ClaimRow[] {
  const rows = asRows<ClaimDbRow>(db.prepare('SELECT * FROM claim WHERE session_id = ? ORDER BY ordinal').all(sessionId));
  return rows.map(mapClaim);
}

/**
 * 主张编号是会话内编号（每场都从 C1 数起），所以所有按编号定位的写操作
 * 都必须带上 sessionId。少带一次就会在第二场会话里改到第一场的行上——
 * 而且 SQL 不会报错，只会静默改错。
 */
export function getClaim(db: Db, sessionId: string, claimId: string): ClaimRow | null {
  const row = db.prepare('SELECT * FROM claim WHERE session_id = ? AND id = ?').get(sessionId, claimId) as
    | ClaimDbRow
    | undefined;
  return row === undefined ? null : mapClaim(row);
}

export function setClaimStatus(db: Db, sessionId: string, claimId: string, status: string): void {
  db.prepare('UPDATE claim SET status = ? WHERE session_id = ? AND id = ?').run(status, sessionId, claimId);
}

/** 判定结果与修改建议一起落盘：前端展示时两者如影随形，分两次写没有好处。 */
export function saveVerdict(
  db: Db,
  sessionId: string,
  claimId: string,
  verdict: Verdict,
  suggestion: Suggestion | null = null,
): void {
  db.prepare('UPDATE claim SET verdict = ?, advice_json = ? WHERE session_id = ? AND id = ?').run(
    verdict.kind,
    suggestion === null ? null : JSON.stringify(suggestion),
    sessionId,
    claimId,
  );
}

/* --------------------------------------------------------------------- probe */

export interface ProbeRow extends Probe {
  answer: Answer | null;
  verdict: VerdictKind | null;
  createdAt: string;
}

interface ProbeDbRow {
  id: string;
  claim_id: string;
  interviewer_id: string;
  round: number;
  question: string;
  rationale: string;
  parent_probe_id: string | null;
  quote: string;
  start: number;
  end: number;
  exact: number;
  answer_text: string | null;
  answer_mode: string | null;
  verdict: string | null;
  created_at: string;
}

function mapProbe(row: ProbeDbRow): ProbeRow {
  const answer: Answer | null =
    row.answer_text === null
      ? null
      : {
          probeId: row.id,
          text: row.answer_text,
          mode: (row.answer_mode ?? 'simulated') as Answer['mode'],
          citedAnchors: [],
        };
  return {
    id: row.id,
    claimId: row.claim_id,
    interviewerId: row.interviewer_id,
    round: toInt(row.round),
    question: row.question,
    rationale: row.rationale,
    parentProbeId: row.parent_probe_id,
    anchor: anchorOf(row.quote, row.start, row.end, row.exact),
    answer: answer,
    verdict: row.verdict === null ? null : (row.verdict as VerdictKind),
    createdAt: row.created_at,
  };
}

export function insertProbe(db: Db, sessionId: string, probe: Probe, createdAt: string = nowIso()): void {
  db.prepare(
    'INSERT INTO probe (id, session_id, claim_id, interviewer_id, round, question, rationale, parent_probe_id, quote, start, end, exact, answer_text, answer_mode, verdict, created_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)',
  ).run(
    probe.id,
    sessionId,
    probe.claimId,
    probe.interviewerId,
    probe.round,
    probe.question,
    probe.rationale,
    probe.parentProbeId,
    probe.anchor.quote,
    probe.anchor.start,
    probe.anchor.end,
    bit(probe.anchor.exact),
    createdAt,
  );
}

export function listProbes(db: Db, sessionId: string, claimId?: string): ProbeRow[] {
  const sql =
    claimId === undefined
      ? 'SELECT * FROM probe WHERE session_id = ? ORDER BY created_at, round'
      : 'SELECT * FROM probe WHERE session_id = ? AND claim_id = ? ORDER BY round, created_at';
  const rows = asRows<ProbeDbRow>(
    claimId === undefined ? db.prepare(sql).all(sessionId) : db.prepare(sql).all(sessionId, claimId),
  );
  return rows.map(mapProbe);
}

export function saveAnswer(db: Db, sessionId: string, probeId: string, answer: Answer): void {
  db.prepare('UPDATE probe SET answer_text = ?, answer_mode = ? WHERE session_id = ? AND id = ?').run(
    answer.text,
    answer.mode,
    sessionId,
    probeId,
  );
}

export function saveProbeVerdict(db: Db, sessionId: string, probeId: string, verdict: VerdictKind): void {
  db.prepare('UPDATE probe SET verdict = ? WHERE session_id = ? AND id = ?').run(verdict, sessionId, probeId);
}

/* --------------------------------------------------------------------- event */

export interface EventRow {
  seq: number;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface EventDbRow {
  seq: number;
  kind: string;
  payload_json: string;
  created_at: string;
}

/**
 * 只追加的事件日志。seq 在事务里自增，
 * 因此重连时按 seq 续传不会漏也不会重。
 */
export function appendEvent(
  db: Db,
  sessionId: string,
  kind: string,
  payload: Record<string, unknown>,
  createdAt: string = nowIso(),
): number {
  const row = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM event WHERE session_id = ?').get(sessionId) as
    | { next?: number }
    | undefined;
  const seq = toInt(row?.next ?? 1);
  db.prepare('INSERT INTO event (session_id, seq, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
    sessionId,
    seq,
    kind,
    JSON.stringify(payload),
    createdAt,
  );
  return seq;
}

export function listEvents(db: Db, sessionId: string, fromSeq: number = 0): EventRow[] {
  const rows = asRows<EventDbRow>(db.prepare('SELECT * FROM event WHERE session_id = ? AND seq > ? ORDER BY seq').all(sessionId, fromSeq));
  return rows.map(function (row) {
    return {
      seq: toInt(row.seq),
      kind: row.kind,
      payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
      createdAt: row.created_at,
    };
  });
}

/* ------------------------------------------------- 重跑之前要抹掉的痕迹 */

/**
 * 抹掉一次没跑完的运行留下的痕迹：事件、追问、主张。
 *
 * 用在「上次跑到一半进程就没了，这次重来」：主张是整批落在最后那个事务里的，所以半截的运行
 * 没有主张，但事件与追问已经写进去了；不清掉的话，重跑之后日志里会把同一段过程记两遍。
 *
 * 刻意**不动 llm_call**：那是真实花掉的 token 与钱，删掉账本就不诚实了。
 */
export function clearRunArtifacts(db: Db, sessionId: string): void {
  db.prepare('DELETE FROM probe WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM claim WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM event WHERE session_id = ?').run(sessionId);
}

/* ------------------------------------------------------------------ llm_call */

export interface NewLlmCall {
  sessionId?: string | null;
  digest: string;
  purpose: string;
  model: string;
  replayed: boolean;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; reasoningTokens: number };
  elapsedMs: number;
  createdAt?: string;
}

export function recordLlmCall(db: Db, call: NewLlmCall): string {
  const id = newId('c');
  db.prepare(
    'INSERT INTO llm_call (id, session_id, digest, purpose, model, replayed, input_tokens, output_tokens, cache_read_tokens, reasoning_tokens, elapsed_ms, created_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    call.sessionId ?? null,
    call.digest,
    call.purpose,
    call.model,
    bit(call.replayed),
    call.usage.inputTokens,
    call.usage.outputTokens,
    call.usage.cacheReadTokens,
    call.usage.reasoningTokens,
    call.elapsedMs,
    call.createdAt ?? nowIso(),
  );
  return id;
}

export interface LlmStats {
  calls: number;
  replayedCalls: number;
  liveCalls: number;
  distinctDigests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
}

/**
 * 用量统计。
 * 这张表存在的意义就是把「这次演示到底联没联网、花了多少 token」
 * 变成一个可查询的事实，而不是靠人在文档里自称。
 */
export function llmStats(db: Db, sessionId?: string): LlmStats {
  const where = sessionId === undefined ? '' : ' WHERE session_id = ?';
  const args: string[] = sessionId === undefined ? [] : [sessionId];
  const row = db
    .prepare(
      'SELECT COUNT(*) AS calls,' +
        ' COALESCE(SUM(replayed), 0) AS replayed_calls,' +
        ' COUNT(DISTINCT digest) AS distinct_digests,' +
        ' COALESCE(SUM(input_tokens), 0) AS input_tokens,' +
        ' COALESCE(SUM(output_tokens), 0) AS output_tokens,' +
        ' COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,' +
        ' COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens' +
        ' FROM llm_call' +
        where,
    )
    .get(...args) as Record<string, unknown> | undefined;

  const calls = toInt(row?.['calls']);
  const replayed = toInt(row?.['replayed_calls']);
  return {
    calls: calls,
    replayedCalls: replayed,
    liveCalls: calls - replayed,
    distinctDigests: toInt(row?.['distinct_digests']),
    inputTokens: toInt(row?.['input_tokens']),
    outputTokens: toInt(row?.['output_tokens']),
    cacheReadTokens: toInt(row?.['cache_read_tokens']),
    reasoningTokens: toInt(row?.['reasoning_tokens']),
  };
}
