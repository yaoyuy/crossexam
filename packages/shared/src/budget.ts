/**
 * 追问预算账本（创新点 2：Probe Budget）。
 *
 * 多 Agent 互相追问最容易滑向两个结局：无限循环烧钱，或者某个 Agent 揪着一条主张不放。
 * 业界的常规做法是在 prompt 里写「最多追问 3 次」——那是**建议**，模型可以不听。
 *
 * 这里把预算做成**代码强制**的账本：每次追问前必须向账本申请，账本说不行就不行，
 * 模型没有权限突破。于是死循环在**设计上**就不可能发生，而不是「希望它不发生」。
 *
 * 全部函数不可变：传入状态、返回新状态，便于测试、回放与前端 diff。
 */

export interface BudgetConfig {
  /** 同一条主张最多追问几轮 */
  maxRoundsPerClaim: number;
  /** 同一个面试官对同一条主张最多问几次 */
  maxProbesPerInterviewerPerClaim: number;
  /** 整场沙盘的总追问次数上限 */
  maxTotalProbes: number;
  /** 连续答不上来几次就关停该主张（继续问没有信息增量） */
  maxConsecutiveUnanswerable: number;
}

export const DEFAULT_BUDGET: BudgetConfig = {
  maxRoundsPerClaim: 3,
  maxProbesPerInterviewerPerClaim: 2,
  maxTotalProbes: 60,
  maxConsecutiveUnanswerable: 2,
};

export interface ClaimBudget {
  rounds: number;
  perInterviewer: Record<string, number>;
  consecutiveUnanswerable: number;
  closed: boolean;
  closeReason: string | null;
}

export interface BudgetState {
  config: BudgetConfig;
  totalProbes: number;
  claims: Record<string, ClaimBudget>;
}

export type ProbeGate =
  | { allowed: true; remainingRounds: number }
  | { allowed: false; reason: string };

export function initBudget(claimIds: readonly string[], config: BudgetConfig = DEFAULT_BUDGET): BudgetState {
  const claims: Record<string, ClaimBudget> = {};
  for (const id of claimIds) {
    claims[id] = { rounds: 0, perInterviewer: {}, consecutiveUnanswerable: 0, closed: false, closeReason: null };
  }
  return { config, totalProbes: 0, claims };
}

/**
 * 追问前的唯一准入检查。任何一条不满足就拒绝，并给出**可展示给用户**的理由——
 * 前端要能解释「为什么面试官不问了」，而不是静默停下。
 */
export function canProbe(state: BudgetState, claimId: string, interviewerId: string): ProbeGate {
  const c = state.claims[claimId];
  if (!c) return { allowed: false, reason: '该主张不在本次沙盘中' };
  if (c.closed) return { allowed: false, reason: c.closeReason ?? '该主张已关停' };
  if (state.totalProbes >= state.config.maxTotalProbes) {
    return { allowed: false, reason: '已达全场追问上限 ' + state.config.maxTotalProbes + ' 次' };
  }
  if (c.rounds >= state.config.maxRoundsPerClaim) {
    return { allowed: false, reason: '该主张已达追问轮数上限 ' + state.config.maxRoundsPerClaim + ' 轮' };
  }
  const used = c.perInterviewer[interviewerId] ?? 0;
  if (used >= state.config.maxProbesPerInterviewerPerClaim) {
    return { allowed: false, reason: '该面试官对这条主张的提问额度已用完' };
  }
  return { allowed: true, remainingRounds: state.config.maxRoundsPerClaim - c.rounds };
}

function cloneClaim(c: ClaimBudget): ClaimBudget {
  return { ...c, perInterviewer: { ...c.perInterviewer } };
}

/** 记一次追问。调用方必须先过 canProbe。 */
export function consumeProbe(state: BudgetState, claimId: string, interviewerId: string): BudgetState {
  const c = state.claims[claimId];
  if (!c) return state;
  const next = cloneClaim(c);
  next.rounds += 1;
  next.perInterviewer[interviewerId] = (next.perInterviewer[interviewerId] ?? 0) + 1;
  return {
    ...state,
    totalProbes: state.totalProbes + 1,
    claims: { ...state.claims, [claimId]: next },
  };
}

/** 记一次作答结果。连续答不上来达阈值即自动关停该主张。 */
export function recordAnswer(state: BudgetState, claimId: string, answered: boolean): BudgetState {
  const c = state.claims[claimId];
  if (!c) return state;
  const next = cloneClaim(c);
  next.consecutiveUnanswerable = answered ? 0 : next.consecutiveUnanswerable + 1;
  if (!next.closed && next.consecutiveUnanswerable >= state.config.maxConsecutiveUnanswerable) {
    next.closed = true;
    next.closeReason = '已连续 ' + next.consecutiveUnanswerable + ' 次答不上来，继续追问没有信息增量';
  }
  return { ...state, claims: { ...state.claims, [claimId]: next } };
}

export function closeClaim(state: BudgetState, claimId: string, reason: string): BudgetState {
  const c = state.claims[claimId];
  if (!c) return state;
  const next = cloneClaim(c);
  next.closed = true;
  next.closeReason = reason;
  return { ...state, claims: { ...state.claims, [claimId]: next } };
}

/** 还开着的（值得继续追问的）主张 id，编排器靠它挑下一个攻击目标 */
export function openClaims(state: BudgetState): string[] {
  return Object.keys(state.claims).filter((id) => state.claims[id]?.closed === false);
}

/** 给前端看的预算快照，用来画「还剩多少追问额度」 */
export interface BudgetSnapshot {
  totalProbes: number;
  maxTotalProbes: number;
  claims: { claimId: string; rounds: number; maxRounds: number; closed: boolean; closeReason: string | null }[];
}

export function budgetSnapshot(state: BudgetState): BudgetSnapshot {
  return {
    totalProbes: state.totalProbes,
    maxTotalProbes: state.config.maxTotalProbes,
    claims: Object.entries(state.claims).map(([claimId, c]) => ({
      claimId,
      rounds: c.rounds,
      maxRounds: state.config.maxRoundsPerClaim,
      closed: c.closed,
      closeReason: c.closeReason,
    })),
  };
}
