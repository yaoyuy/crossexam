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
  IntentContract,
  JobDescription,
  MatchStatus,
  Probe,
  Requirement,
  RequirementKind,
  RequirementMatch,
  Revision,
  RevisionSkip,
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
  answer_cites_json: string | null;
  verdict: string | null;
  requirement_id: string | null;
  jd_quote: string | null;
  jd_start: number | null;
  jd_end: number | null;
  jd_exact: number | null;
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
          citedAnchors: parseJson<Anchor[]>(row.answer_cites_json, []),
        };
  // 第二条锚（岗位要求原文）没存过就是 null：老会话与纯简历场次都走这一支，
  // 语义是「这条追问只锚了简历」，不是「锚点丢了」。
  const jdAnchor: Anchor | null =
    row.jd_quote === null ? null : anchorOf(row.jd_quote, row.jd_start, row.jd_end, row.jd_exact);
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
    requirementId: row.requirement_id,
    jdAnchor: jdAnchor,
    createdAt: row.created_at,
  };
}

export function insertProbe(db: Db, sessionId: string, probe: Probe, createdAt: string = nowIso()): void {
  // 第二条锚（岗位要求原文）在纯简历场次是 null，在「追岗位要求」时才有值；
  // 两处都得能读出来，否则重开历史会话时追问就只剩一个锚了。
  const jdAnchor = probe.jdAnchor ?? null;
  db.prepare(
    'INSERT INTO probe (id, session_id, claim_id, interviewer_id, round, question, rationale, parent_probe_id, quote, start, end, exact, answer_text, answer_mode, verdict, requirement_id, jd_quote, jd_start, jd_end, jd_exact, created_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)',
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
    jdAnchor === null ? null : (probe.requirementId ?? null),
    jdAnchor === null ? null : jdAnchor.quote,
    jdAnchor === null ? null : jdAnchor.start,
    jdAnchor === null ? null : jdAnchor.end,
    jdAnchor === null ? null : bit(jdAnchor.exact),
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

/**
 * 存一次作答。援引的原文锚点也一并存下来：历史会话重开时，
 * 「求职者援引了哪几句原文」是判定可读性的一部分，丢了就只剩一段孤零零的话。
 */
export function saveAnswer(db: Db, sessionId: string, probeId: string, answer: Answer): void {
  db.prepare('UPDATE probe SET answer_text = ?, answer_mode = ?, answer_cites_json = ? WHERE session_id = ? AND id = ?').run(
    answer.text,
    answer.mode,
    JSON.stringify(answer.citedAnchors),
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
  // 岗位要求也是这场运行的产物（编号 R1..Rn 每场重新数起），重跑前必须一起抹掉；
  // jd 表反而是**输入**：它跟着会话创建时写入，重跑时原样还在。
  db.prepare('DELETE FROM requirement_match WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM requirement WHERE session_id = ?').run(sessionId);
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

/* ---------------------------------------------------------------- interviewer */

/**
 * 自定义面试官（v4 全局库）。
 *
 * 存的是**契约本体**而不是「用户的原始描述」：页面渲染 System Prompt、会话对账指纹、
 * 回放时重建阵容，三处都要契约原文。原始描述只作为草稿的一次性输入，不留档——
 * 用户改过三次名字以后，没有人能说清哪一版才是当初那份输入。
 */
export interface InterviewerRow {
  id: string;
  version: number;
  digest: string;
  source: 'llm' | 'local';
  domain: string;
  contract: IntentContract;
  createdAt: string;
  updatedAt: string;
}

interface InterviewerDbRow {
  id: string;
  version: number;
  digest: string;
  source: string;
  domain: string;
  contract_json: string;
  created_at: string;
  updated_at: string;
}

function mapInterviewer(row: InterviewerDbRow): InterviewerRow {
  const contract = parseJson<IntentContract | null>(row.contract_json, null);
  if (contract === null) {
    throw new Error('面试官 ' + row.id + ' 的契约不是合法 JSON，库可能被外部改过。');
  }
  return {
    id: row.id,
    version: toInt(row.version),
    digest: row.digest,
    source: row.source === 'llm' ? 'llm' : 'local',
    domain: row.domain,
    contract,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 同一个 id 再次保存 = 覆盖这一版（version 由调用方决定要不要 +1）。 */
export function saveInterviewer(
  db: Db,
  input: {
    id: string;
    version: number;
    digest: string;
    source: 'llm' | 'local';
    domain: string;
    contract: IntentContract;
    at?: string;
  },
): void {
  const at = input.at ?? nowIso();
  db.prepare(
    'INSERT INTO interviewer (id, version, digest, source, domain, contract_json, created_at, updated_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)' +
      ' ON CONFLICT(id) DO UPDATE SET version = excluded.version, digest = excluded.digest,' +
      ' source = excluded.source, domain = excluded.domain, contract_json = excluded.contract_json,' +
      ' updated_at = excluded.updated_at',
  ).run(
    input.id,
    input.version,
    input.digest,
    input.source,
    input.domain,
    JSON.stringify(input.contract),
    at,
    at,
  );
}

export function listInterviewers(db: Db): InterviewerRow[] {
  const rows = asRows<InterviewerDbRow>(db.prepare('SELECT * FROM interviewer ORDER BY created_at, id').all());
  return rows.map(mapInterviewer);
}

export function getInterviewer(db: Db, id: string): InterviewerRow | null {
  const row = db.prepare('SELECT * FROM interviewer WHERE id = ?').get(id) as InterviewerDbRow | undefined;
  return row === undefined ? null : mapInterviewer(row);
}

/** 返回是否真的删掉了一行——删不存在的东西不该被当成成功。 */
export function deleteInterviewer(db: Db, id: string): boolean {
  const result = db.prepare('DELETE FROM interviewer WHERE id = ?').run(id) as { changes?: number };
  return (result.changes ?? 0) > 0;
}

/* ------------------------------------------------------------ 采纳改写（v5） */

/**
 * 一条真正落地的改写。区间是**原文**坐标，不是改完之后的坐标——
 * 改完之后的坐标由 shared 的 movedSpans 算，不存两份互相矛盾的坐标。
 */
export interface RevisionRow extends Revision {
  ordinal: number;
  createdAt: string;
}

/**
 * 改完的简历。
 *
 * accepted / pending / skipped 三份清单一起存：界面要能回答
 * 「我确认了几条、还剩几条没理、哪几条改不动、为什么」。
 * 只存改完的全文而不存这三份清单，历史会话就再也说不清这件事了。
 */
export interface RevisedResumeRow {
  sessionId: string;
  text: string;
  digest: string;
  accepted: string[];
  pending: string[];
  skipped: RevisionSkip[];
  createdAt: string;
  updatedAt: string;
}

interface RevisionDbRow {
  session_id: string;
  claim_id: string;
  ordinal: number;
  start: number;
  end: number;
  before: string;
  after: string;
  created_at: string;
}

interface RevisedResumeDbRow {
  session_id: string;
  text: string;
  digest: string;
  accepted_json: string;
  pending_json: string;
  skipped_json: string;
  created_at: string;
  updated_at: string;
}

function mapRevision(row: RevisionDbRow): RevisionRow {
  return {
    claimId: row.claim_id,
    start: toInt(row.start),
    end: toInt(row.end),
    before: row.before,
    after: row.after,
    ordinal: toInt(row.ordinal),
    createdAt: row.created_at,
  };
}

function mapRevisedResume(row: RevisedResumeDbRow): RevisedResumeRow {
  return {
    sessionId: row.session_id,
    text: row.text,
    digest: row.digest,
    accepted: parseJson<string[]>(row.accepted_json, []),
    pending: parseJson<string[]>(row.pending_json, []),
    skipped: parseJson<RevisionSkip[]>(row.skipped_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 抹掉上一轮的采纳记录。重新确认一次就是从零开始，不留叠加。 */
export function clearRevisions(db: Db, sessionId: string): void {
  db.prepare('DELETE FROM revision WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM revised_resume WHERE session_id = ?').run(sessionId);
}

export function insertRevision(db: Db, sessionId: string, revision: Revision, ordinal: number, at: string = nowIso()): void {
  db.prepare(
    'INSERT INTO revision (session_id, claim_id, ordinal, start, end, before, after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)' +
      ' ON CONFLICT(session_id, ordinal) DO UPDATE SET claim_id = excluded.claim_id, start = excluded.start,' +
      ' end = excluded.end, before = excluded.before, after = excluded.after, created_at = excluded.created_at',
  ).run(sessionId, revision.claimId, ordinal, revision.start, revision.end, revision.before, revision.after, at);
}

export function listRevisions(db: Db, sessionId: string): RevisionRow[] {
  const rows = asRows<RevisionDbRow>(db.prepare('SELECT * FROM revision WHERE session_id = ? ORDER BY ordinal').all(sessionId));
  return rows.map(mapRevision);
}

/** 一个会话只有一份「改完的简历」：再确认一次就是覆盖，不是追加。 */
export function saveRevisedResume(
  db: Db,
  input: {
    sessionId: string;
    text: string;
    digest: string;
    accepted: readonly string[];
    pending: readonly string[];
    skipped: readonly RevisionSkip[];
    at?: string;
  },
): void {
  const at = input.at ?? nowIso();
  db.prepare(
    'INSERT INTO revised_resume (session_id, text, digest, accepted_json, pending_json, skipped_json, created_at, updated_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)' +
      ' ON CONFLICT(session_id) DO UPDATE SET text = excluded.text, digest = excluded.digest,' +
      ' accepted_json = excluded.accepted_json, pending_json = excluded.pending_json,' +
      ' skipped_json = excluded.skipped_json, updated_at = excluded.updated_at',
  ).run(
    input.sessionId,
    input.text,
    input.digest,
    JSON.stringify(input.accepted),
    JSON.stringify(input.pending),
    JSON.stringify(input.skipped),
    at,
    at,
  );
}

export function getRevisedResume(db: Db, sessionId: string): RevisedResumeRow | null {
  const row = db.prepare('SELECT * FROM revised_resume WHERE session_id = ?').get(sessionId) as RevisedResumeDbRow | undefined;
  return row === undefined ? null : mapRevisedResume(row);
}

/* ------------------------------------------- 补充说明（v8）：用户当场补的那句真话 */

/** 一句补充说明。claimId 是它挂在哪条主张上，text 是用户自己写的（不经模型） */
export interface SupplementRow {
  sessionId: string;
  claimId: string;
  text: string;
  digest: string;
  createdAt: string;
  updatedAt: string;
}

interface SupplementDbRow {
  session_id: string;
  claim_id: string;
  text: string;
  digest: string;
  created_at: string;
  updated_at: string;
}

function mapSupplement(row: SupplementDbRow): SupplementRow {
  return {
    sessionId: row.session_id,
    claimId: row.claim_id,
    text: row.text,
    digest: row.digest,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 一条主张一句：再补一次就是覆盖（用户改主意比留两句更像真实操作） */
export function saveSupplement(
  db: Db,
  input: { sessionId: string; claimId: string; text: string; digest: string; at?: string },
): void {
  const at = input.at ?? nowIso();
  db.prepare(
    'INSERT INTO supplement (session_id, claim_id, text, digest, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)' +
      ' ON CONFLICT(session_id, claim_id) DO UPDATE SET text = excluded.text, digest = excluded.digest,' +
      ' updated_at = excluded.updated_at',
  ).run(input.sessionId, input.claimId, input.text, input.digest, at, at);
}

export function listSupplements(db: Db, sessionId: string): SupplementRow[] {
  const rows = asRows<SupplementDbRow>(
    db.prepare('SELECT * FROM supplement WHERE session_id = ? ORDER BY claim_id').all(sessionId),
  );
  return rows.map(mapSupplement);
}

export function getSupplement(db: Db, sessionId: string, claimId: string): SupplementRow | null {
  const row = db.prepare('SELECT * FROM supplement WHERE session_id = ? AND claim_id = ?').get(sessionId, claimId) as
    | SupplementDbRow
    | undefined;
  return row === undefined ? null : mapSupplement(row);
}

/** 返回是否真的删掉了一行——删不存在的东西不该被当成成功 */
export function deleteSupplement(db: Db, sessionId: string, claimId: string): boolean {
  const result = db.prepare('DELETE FROM supplement WHERE session_id = ? AND claim_id = ?').run(sessionId, claimId) as {
    changes?: number;
  };
  return (result.changes ?? 0) > 0;
}

/* ------------------------------------------------------- 岗位要求（多 JD 驱动） */

interface JdDbRow {
  session_id: string;
  id: string;
  ordinal: number;
  title: string;
  text: string;
}

function mapJd(row: JdDbRow): JobDescription {
  return { id: row.id, ordinal: toInt(row.ordinal), title: row.title, text: row.text };
}

/**
 * JD 原文随会话创建时写入。ordinal 取自数组下标，J1..Jn 由调用方编好——
 * 编号一旦落库就固定下来，重跑不会因为页面上的顺序变了而换号。
 */
export function insertJds(db: Db, sessionId: string, jds: readonly JobDescription[]): void {
  const stmt = db.prepare('INSERT INTO jd (session_id, id, ordinal, title, text) VALUES (?, ?, ?, ?, ?)');
  jds.forEach(function (jd, index) {
    stmt.run(sessionId, jd.id, index, jd.title, jd.text);
  });
}

export function listJds(db: Db, sessionId: string): JobDescription[] {
  const rows = asRows<JdDbRow>(db.prepare('SELECT * FROM jd WHERE session_id = ? ORDER BY ordinal').all(sessionId));
  return rows.map(mapJd);
}

interface RequirementDbRow {
  session_id: string;
  id: string;
  ordinal: number;
  kind: string;
  text: string;
  keywords_json: string;
  jd_id: string;
  sources_json: string;
  quote: string;
  start: number;
  end: number;
  exact: number;
}

function mapRequirement(row: RequirementDbRow): Requirement {
  return {
    id: row.id,
    kind: row.kind as RequirementKind,
    text: row.text,
    keywords: parseJson<string[]>(row.keywords_json, []),
    anchor: anchorOf(row.quote, row.start, row.end, row.exact),
    jdId: row.jd_id,
    sources: parseJson<string[]>(row.sources_json, []),
  };
}

/**
 * 要求清单整批替换（先清后写）。顺序按数组下标存，读回来就是 R1..Rn——
 * 排序一旦交给 ORDER BY id，R10 就会排到 R2 前面，报告里的编号顺序会莫名其妙。
 */
export function insertRequirements(db: Db, sessionId: string, requirements: readonly Requirement[]): void {
  db.prepare('DELETE FROM requirement_match WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM requirement WHERE session_id = ?').run(sessionId);
  const stmt = db.prepare(
    'INSERT INTO requirement (session_id, id, ordinal, kind, text, keywords_json, jd_id, sources_json, quote, start, end, exact)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  requirements.forEach(function (item, index) {
    stmt.run(
      sessionId,
      item.id,
      index,
      item.kind,
      item.text,
      JSON.stringify(item.keywords),
      item.jdId,
      JSON.stringify(item.sources),
      item.anchor.quote,
      item.anchor.start,
      item.anchor.end,
      bit(item.anchor.exact),
    );
  });
}

export function listRequirements(db: Db, sessionId: string): Requirement[] {
  const rows = asRows<RequirementDbRow>(
    db.prepare('SELECT * FROM requirement WHERE session_id = ? ORDER BY ordinal').all(sessionId),
  );
  return rows.map(mapRequirement);
}

interface RequirementMatchDbRow {
  session_id: string;
  requirement_id: string;
  claim_id: string | null;
  status: string;
  reason: string;
}

function mapRequirementMatch(row: RequirementMatchDbRow): RequirementMatch {
  return {
    requirementId: row.requirement_id,
    claimId: row.claim_id,
    status: row.status as MatchStatus,
    reason: row.reason,
  };
}

export function insertRequirementMatches(db: Db, sessionId: string, matches: readonly RequirementMatch[]): void {
  db.prepare('DELETE FROM requirement_match WHERE session_id = ?').run(sessionId);
  const stmt = db.prepare(
    'INSERT INTO requirement_match (session_id, requirement_id, claim_id, status, reason) VALUES (?, ?, ?, ?, ?)',
  );
  for (const item of matches) {
    stmt.run(sessionId, item.requirementId, item.claimId, item.status, item.reason);
  }
}

/** 按要求的顺序读回来：对照结果是给人按 R1..Rn 看的，不是按字母序。 */
export function listRequirementMatches(db: Db, sessionId: string): RequirementMatch[] {
  const rows = asRows<RequirementMatchDbRow>(
    db
      .prepare(
        'SELECT m.* FROM requirement_match m' +
          ' JOIN requirement r ON r.session_id = m.session_id AND r.id = m.requirement_id' +
          ' WHERE m.session_id = ? ORDER BY r.ordinal',
      )
      .all(sessionId),
  );
  return rows.map(mapRequirementMatch);
}

