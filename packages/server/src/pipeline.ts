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

import { contractDigest, difficultyOf, matchSummary, renderSystemPrompt, requirementNotes, shortHash } from '@crossexam/shared';
import type {
  BudgetConfig,
  ContractBudgetView,
  Difficulty,
  IntentContract,
  JobDescription,
  CounterQuestion,
  MatchSummary,
  RejectedClaim,
  RejectedCounter,
  RejectedRequirement,
  Requirement,
  RequirementMatch,
  RequirementNote,
  Suggestion,
} from '@crossexam/shared';
import type { LlmClient, LlmRequest, LlmResult, LlmStreamEvent, LlmUsage } from './llm/types.ts';
import { EMPTY_USAGE } from './llm/types.ts';
import { withStreaming } from './llm/streaming.ts';
import type { StreamSink } from './llm/streaming.ts';
import { DEFAULT_MAX_ROUNDS, DEFAULT_PANEL, runSession } from './orchestrator/run.ts';
import { budgetView, presetContracts, resolvePanel } from './orchestrator/panel.ts';
import type { RunEvent, RunSessionResult } from './orchestrator/run.ts';
import type { VerdictOutcome } from './orchestrator/verdict.ts';
import type { SuggestOutcome } from './orchestrator/suggest.ts';
import {
  appendEvent,
  clearRunArtifacts,
  getSession,
  insertClaims,
  insertCounters,
  insertJds,
  insertProbe,
  insertRequirementMatches,
  insertRequirements,
  listClaims,
  listCounters,
  listEvents,
  listJds,
  listProbes,
  listRequirementMatches,
  listSupplements,
  listRequirements,
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
import type {
  ClaimRow,
  Db,
  EventRow,
  LlmStats,
  ProbeRow,
  SessionRow,
  SessionStatus,
  SupplementRow,
} from './store/index.ts';

/** 阶段 → 会话状态：刷新页面也能看出跑到哪一步了 */
const STAGE_STATUS: Record<string, SessionStatus> = {
  extract: 'extracting',
  'jd-extract': 'extracting',
  'jd-merge': 'extracting',
  'jd-match': 'extracting',
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
  /**
   * 这一场上场的面试官 id（预设角色名或自定义契约 id）。
   * 不传就读会话行里记的那一份——重跑必须和当初跑的是同一批人。
   */
  panelIds?: readonly string[];
  budgetConfig?: BudgetConfig;
  maxRounds?: number;
  maxClaims?: number;
  maxProbesPerTurn?: number;
  /** seq 是事件日志里的序号：SSE 用它当 id，断线就能按序号续传 */
  onEvent?: (event: RunEvent, seq: number) => void | Promise<void>;
  /**
   * 要直播分片就传它。传了以后五个阶段都改走 stream()：
   * 分片只给界面看（按 channel 路由到对应卡片），最终结果仍取自 done，
   * 既不进事件表也不落库——否则回放会变慢、日志会变吵，而且分片拼接得到的文本并不比 done 更可信。
   */
  onStream?: StreamSink;
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
  // 上一轮的进程被直接关掉（不是抛错）时，主张还没落库，事件与追问却已经写进去了。
  // 这种半截会话允许重跑，但必须先把痕迹抹掉：否则同一段过程会在事件日志里出现两份，
  // 而事件日志是前端重放的唯一真相。
  if (listEvents(db, sessionId).length > 0 || listProbes(db, sessionId).length > 0) {
    clearRunArtifacts(db, sessionId);
  }

  async function emit(event: RunEvent): Promise<void> {
    if (event.type === 'stage') {
      const next = STAGE_STATUS[event.stage];
      if (next !== undefined) updateSessionStatus(db, sessionId, next);
    }
    const seq = appendEvent(db, sessionId, event.type, event as unknown as Record<string, unknown>);
    if (input.onEvent) await input.onEvent(event, seq);
  }

  // 阵容以会话行里记的那份为准：同一场会话重跑，不能因为页面此刻勾了别人就换人。
  // 自定义面试官的契约全文在库里，所以这一步必须查库——它也是唯一需要库的一步。
  const budgetConfig = input.budgetConfig ?? session.budget.config;
  const wanted = input.panelIds ?? metaPanelIds(session.meta);
  const roster = resolvePanel(db, wanted.length > 0 ? wanted : DEFAULT_PANEL, budgetConfig);
  if (roster.missing.length > 0) {
    throw new Error(
      '会话里记的面试官已经不在库里了：' + roster.missing.join('、') + '。请新建会话，或在「面试组阵容」里去掉这几位。',
    );
  }

  updateSessionStatus(db, sessionId, 'extracting');
  const base = input.onStream === undefined ? input.client : withStreaming(input.client, input.onStream);
  // JD 是随会话创建写进库的输入：重跑读的还是当初那几份，页面上此刻贴了什么不算数。
  const jds = listJds(db, sessionId);
  try {
    const result = await runSession({
      client: withAccounting(base, { db, sessionId, model: input.model }),
      resumeText: session.resumeText,
      jdText: session.jdText,
      jds,
      contracts: roster.contracts,
      // 用上面算好的那一份，不是 input.budgetConfig：
      // 后者为 undefined 时编排层会回落 DEFAULT_BUDGET，而契约是按 session.budget.config 算的，
      // 两处不一致就会出现「提示词里的预算是这一档、界面按另一档对账」的裂缝。
      budgetConfig,
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


  // meta 是**一张表**，装着两类字段：输入侧（source / model / jdDigests / difficulty）
  // 与产物侧（panel / rounds / usage / contracts）。而 saveSessionMeta 是整段替换，
  // 直接写产物侧会把输入侧吃掉——跑完之后 session.meta.model 就没了，
  // 半截会话重跑时读不到当初选的模型，报告也说不清这一场是什么档问的。
  const previousMeta = getSession(db, sessionId)?.meta ?? {};

  withTransaction(db, () => {
    insertClaims(db, sessionId, result.claims);
    for (const probe of result.probes) insertProbe(db, sessionId, probe);

    for (const [claimId, entries] of Object.entries(result.transcriptByClaim)) {
      for (const entry of entries) {
        if (entry.answer !== null) saveAnswer(db, sessionId, entry.probe.id, entry.answer);
      }
      const detail = result.verdictDetails.find((d) => d.verdict.claimId === claimId);
      if (detail === undefined) continue;
      saveVerdict(db, sessionId, claimId, detail.verdict, suggestionByClaim.get(claimId) ?? null);
      for (const probeId of detail.verdict.probeIds) saveProbeVerdict(db, sessionId, probeId, detail.verdict.kind);
    }

    // 岗位要求这一块：JD 原文是输入，要求清单与对照结果是产物。
    // 原文通常在建会话时就写好了，这里兜一次底——测试与脚本会直接调 persistResult，
    // 那时没有 HTTP 层的建会话那一步。已有行时绝不重写：JD 是输入，不该被第二次跑覆盖。
    if (listJds(db, sessionId).length === 0 && result.jds.length > 0) {
      insertJds(db, sessionId, result.jds);
    }
    insertRequirements(db, sessionId, result.requirements);
    insertRequirementMatches(db, sessionId, result.requirementMatches);
    // 反问是最后一步的产物，整批替换：上一轮留下的一律清掉。
    insertCounters(db, sessionId, result.counters);

    saveSessionBudget(db, sessionId, result.budgetState);
    saveSessionMeta(db, sessionId, {
      ...previousMeta,
      panel: result.panel,
      // 自定义面试官的契约全文一起留档：它不在代码里，重算不出来
      custom: result.contracts.filter((c) => c.persona.role === 'custom'),
      rounds: result.rounds,
      notices: result.notices,
      usage: result.usage,
      resumeHash: shortHash(result.resumeText, 24),
      contracts: result.contracts.map((c) =>
        c.persona.role === 'custom'
          ? { id: c.id, version: c.version, digest: contractDigest(c), contract: c }
          : { id: c.id, version: c.version, digest: contractDigest(c) },
      ),
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
  /** 这场沙盘照着哪几份 JD 问的。没上传过 JD 就是空数组，不是缺数据 */
  jds: JobDescription[];
  /** 抽出来并跨份合并后的要求清单（R1..Rn） */
  requirements: Requirement[];
  /** 锚不到原文、被丢掉的要求（带丢弃理由） */
  requirementRejected: RejectedRequirement[];
  /** 每条要求与简历主张的对照结果，顺序与要求一致 */
  requirementMatches: RequirementMatch[];
  /** 直接喂给追问提示词的那几条（只有能对上主张的才在里面） */
  requirementNotes: RequirementNote[];
  requirementSummary: MatchSummary;
  /** 这一场问得多深。老会话没记过这个字段，按默认档算 */
  difficulty: Difficulty;
  /** 这场沙盘当时用的意图契约。表里只存了指纹，全文是按同样输入重算出来的 */
  contracts: ContractView[];
  /** 用户当场补的那几句真话（简历上没有原句的那些事实） */
  supplements: SupplementRow[];
  /** 轮到求职者问的那几句（Q1..Qn），每句都挂着依据所在的原文区间 */
  counters: CounterQuestion[];
  /** 想反问、但依据锚不回材料的句子（带丢弃理由） */
  counterRejected: RejectedCounter[];
}

/**
 * 落库时留一行指纹，够对账又不必把契约全文塞进 meta。
 *
 * 但自定义面试官是例外：它的契约**不在代码里**，重算不出来（用户可能已经改过、也删过）。
 * 所以这一类把全文一起存进 meta——一份契约 JSON 不到 1 KB，而「三个月后回看这场会话，
 * 发现当时那位面试官的规则已经查不到了」是不可接受的。
 */
interface StoredContract {
  id: string;
  version: number;
  digest: string;
  contract?: IntentContract;
}

/** 会话里记的阵容。旧会话没有这个字段，退回从契约指纹里推。 */
export function metaPanelIds(meta: Record<string, unknown>): string[] {
  const value = meta['panel'];
  if (Array.isArray(value)) {
    const ids = value.filter((item): item is string => typeof item === 'string');
    if (ids.length > 0) return ids;
  }
  return metaContracts(meta).map((item) => item.id);
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
    const stored: StoredContract = { id, version: typeof version === 'number' ? version : 1, digest };
    const contract = raw['contract'];
    if (contract !== null && typeof contract === 'object') stored.contract = contract as IntentContract;
    out.push(stored);
  }
  return out;
}

/**
 * 由 id + 预算生成契约视图；纯函数，不碰数据库也不调模型。
 *
 * 预设面试官的契约按角色重算（代码里那一份才是权威）；自定义的用会话里存的那一份全文，
 * 只把预算换成这一场的——预算属于会话，不属于人设。
 */
export function contractViews(
  ids: readonly string[],
  config: BudgetConfig,
  stored: readonly StoredContract[] = [],
): ContractView[] {
  // 契约里只声明三个预算字段：maxConsecutiveUnanswerable 是编排层的关停策略，
  // 面试官读不到也遵守不了。这里必须先收窄，否则算出的指纹与会话里存的那份对不上，
  // 界面会把一场没漂移的沙盘报成「契约漂移」。
  const budget: ContractBudgetView = budgetView(config);
  const byId = new Map<string, IntentContract>();
  for (const contract of presetContracts(ids, budget)) byId.set(contract.id, contract);
  const matchById = new Map<string, StoredContract>();
  for (const item of stored) {
    matchById.set(item.id, item);
    if (item.contract !== undefined) {
      byId.set(item.id, { ...item.contract, budget });
    }
  }

  const contracts: IntentContract[] = [];
  for (const id of ids) {
    const contract = byId.get(id);
    if (contract !== undefined) contracts.push(contract);
  }
  return viewsOfContracts(contracts, stored);
}

/**
 * 契约列表 → 界面视图。开跑之前没有「落库的指纹」可对账，
 * 所以这时每个视图的 storedDigest 都是 null、verified 都是 false——
 * 「还没跑过」和「对上了」必须能区分开，否则对账就没有意义。
 */
export function viewsOfContracts(
  contracts: readonly IntentContract[],
  stored: readonly StoredContract[] = [],
): ContractView[] {
  const matchById = new Map<string, StoredContract>();
  for (const item of stored) matchById.set(item.id, item);
  return contracts.map((contract) => {
    const digest = contractDigest(contract);
    const match = matchById.get(contract.id);
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
  const recorded = metaPanelIds(session.meta);
  const panel: string[] = recorded.length > 0 ? recorded : [...DEFAULT_PANEL];
  const jds = listJds(db, sessionId);
  const requirements = listRequirements(db, sessionId);
  const requirementMatches = listRequirementMatches(db, sessionId);
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
    jds,
    requirements,
    requirementRejected: lastPayload<RejectedRequirement>(events, 'requirements', 'rejected'),
    requirementMatches,
    // 提示词要的那几条按同样规则从库里重算，不存第三份：
    // 「哪些要求能进提示词」是纯函数，存下来只会多一个会和代码不一致的副本。
    requirementNotes: requirementNotes(jds, requirements, requirementMatches),
    requirementSummary: matchSummary(requirementMatches),
    difficulty: difficultyOf(session.meta['difficulty']),
    supplements: listSupplements(db, sessionId),
    counters: listCounters(db, sessionId),
    counterRejected: lastPayload<RejectedCounter>(events, 'counter', 'rejected'),
  };
}
