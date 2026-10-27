/**
 * 成长档案（P12 · ②）：一条主张在几个版本里的判定轨迹。
 *
 * C1 只比相邻两版，C2 只给跨场次的合计数。真正让人下决心改简历的那件事
 * 落在两者之间：**同一句话我改了两回，第三回还是被判证据缺失**。
 * 这一层就是把相邻两版的配对（compare.ts 的 alignClaims）连成链，
 * 一条链 = 同一句话的判定历史。
 *
 * 三个刻意的设计：
 * 1. 纯函数、不调模型。轨迹要在离线回放里一模一样地复现，
 *    让模型判断「这两句是不是同一件事」会让同一条曲线今天是这样、明天是那样。
 * 2. 链是**连**出来的，不是重新配对出来的。只在相邻两版之间配对，
 *    再把配对结果串起来；跨三版直接配对会让相似度阈值的作用被放大三次。
 * 3. 认错是可能的。相似度配对是启发式的，所以每条链都带着还原到原文的
 *    claimId 与文本，界面上能点开看，而不是只给一条漂亮的曲线。
 */

import type { VerdictKind } from './domain.ts';
import { VERDICT_LABEL } from './domain.ts';
import type { JudgedClaimLike } from './shortfall.ts';
import type { ShiftKind } from './compare.ts';
import { alignClaims, verdictShift } from './compare.ts';

/** 一版会话。只要这三样就够连链，不要把整个 SessionView 拖进来。 */
export interface GrowthSession {
  id: string;
  createdAt: string;
  jobTitle: string;
  claims: readonly JudgedClaimLike[];
  /** 这一场一共追问了几次；取不到就是 null，不许猜 0 */
  probes: number | null;
}

/** 曲线上的一个点：一版一行。 */
export interface GrowthPoint {
  sessionId: string;
  createdAt: string;
  jobTitle: string;
  /** 0 是第一版 */
  version: number;
  judged: number;
  solid: number;
  /** judged - solid */
  weak: number;
  probes: number | null;
}

export interface TrailStep {
  sessionId: string;
  version: number;
  claimId: string;
  text: string;
  verdict: VerdictKind | null;
  /** 相对上一次出现的变化；null 表示这是这条链第一次出现 */
  shift: ShiftKind | null;
}

export interface ClaimTrail {
  /** 稳定标识：首次出现的 版本号:主张id。跨版本不重排，界面可以拿它当 React key */
  key: string;
  firstVersion: number;
  lastVersion: number;
  /** 出现过几个版本（相邻两版是一对一配对，所以等于 steps.length） */
  versions: number;
  /** 最近一次的文本 */
  text: string;
  /** 最近一次的判定；这条链最后一版没判就是 null */
  verdict: VerdictKind | null;
  /** 这一条在最新一版里还在不在 */
  presentInLatest: boolean;
  /** 历史上有没有被判过站得住 */
  everSolid: boolean;
  /** 改了还在被打回：出现在最新一版、至少两版、从来没有一次站得住、且这次有判定 */
  persistent: boolean;
  steps: TrailStep[];
}

export interface GrowthView {
  versions: GrowthPoint[];
  trails: ClaimTrail[];
  /** 改了还在被打回的（按版本数从多到少） */
  persistent: ClaimTrail[];
  /** 之前被打回、现在站住了的 */
  fixed: ClaimTrail[];
  /** 只出现过一版、还谈不上轨迹的条数 */
  single: number;
  headline: string;
  /** 只有一版、或者链断在中间时要说的话；没有要说的就是 null */
  trailNote: string | null;
}

function newestLast(a: GrowthSession, b: GrowthSession): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** 判定计数与 overview 同源：只数出现过的判定，省得摆一排 0 */
function countsOf(claims: readonly JudgedClaimLike[]): { judged: number; solid: number; weak: number } {
  let judged = 0;
  let solid = 0;
  for (const claim of claims) {
    if (claim.verdict === null) continue;
    judged += 1;
    if (claim.verdict === 'solid') solid += 1;
  }
  return { judged, solid, weak: judged - solid };
}

export function growthPointOf(session: GrowthSession, version: number): GrowthPoint {
  const counts = countsOf(session.claims);
  return {
    sessionId: session.id,
    createdAt: session.createdAt,
    jobTitle: session.jobTitle,
    version,
    judged: counts.judged,
    solid: counts.solid,
    weak: counts.weak,
    probes: session.probes,
  };
}

/** 一条链说人话：「C2 改了 3 版，最新一次仍判「证据缺失」」 */
export function trailLine(trail: ClaimTrail): string {
  const head = trail.steps[0];
  const label = head === undefined ? '' : head.claimId;
  const verdict = trail.verdict === null ? '还没判' : '「' + VERDICT_LABEL[trail.verdict] + '」';
  if (trail.versions <= 1) return label + ' 只出现过一版，判' + verdict + '。';
  const tail = trail.presentInLatest ? '最新一版仍在，判' + verdict : '最新一版里已经没有了';
  return label + ' 前后出现 ' + String(trail.versions) + ' 版，' + tail + '。';
}

export function growthHeadline(view: Omit<GrowthView, 'headline' | 'trailNote'>): string {
  const total = view.versions.length;
  if (total === 0) return '还没有可以连成轨迹的场次。';
  if (total === 1) {
    return '目前只有 1 版：' + String(view.trails.length) + ' 条主张都在这一版上，轨迹要等第二版跑完才连得起来。';
  }
  const parts: string[] = [String(total) + ' 版、' + String(view.trails.length) + ' 条主张轨迹'];
  if (view.persistent.length > 0) parts.push('改了还在被打回 ' + String(view.persistent.length) + ' 条');
  if (view.fixed.length > 0) parts.push('已经改站住 ' + String(view.fixed.length) + ' 条');
  if (view.single > 0) parts.push('只出现过一版 ' + String(view.single) + ' 条');
  const latest = view.versions[view.versions.length - 1];
  if (latest !== undefined && latest.judged > 0) {
    parts.push('最新一版站得住 ' + String(latest.solid) + '/' + String(latest.judged) + ' 条');
  }
  return parts.join('，') + '。';
}

/** 给界面的一句话提示：没有轨迹可讲的时候必须说清楚为什么，不要留个空框 */
export function growthNote(sessions: readonly GrowthSession[], trails: readonly ClaimTrail[]): string | null {
  if (sessions.length === 0) return null;
  if (sessions.length === 1) return '再按「改完再跑一遍」跑一版，这里就会连出轨迹。';
  if (trails.length === 0) return '这几版都没有抽出主张，连不出轨迹。';
  return null;
}

/**
 * 把一串版本连成轨迹。
 *
 * 入参按 createdAt 升序排一遍（并列时按 id 兜底），所以调用方不必保证顺序——
 * 但**版本号是排完序之后的序号**，界面上「第 2 版」指的就是这个。
 */
export function growthOf(sessions: readonly GrowthSession[]): GrowthView {
  const ordered = [...sessions].sort(newestLast);
  const versions = ordered.map((session, index) => growthPointOf(session, index));
  const trails: ClaimTrail[] = [];
  /** 上一版里每个 claimId 落在哪条链上 */
  let previousIndex = new Map<string, number>();
  ordered.forEach((session, version) => {
    const nextIndex = new Map<string, number>();
    if (version === 0) {
      for (const claim of session.claims) {
        const index = trails.length;
        trails.push({
          key: String(version) + ':' + claim.id,
          firstVersion: version,
          lastVersion: version,
          versions: 1,
          text: claim.text,
          verdict: claim.verdict ?? null,
          presentInLatest: false,
          everSolid: claim.verdict === 'solid',
          persistent: false,
          steps: [{ sessionId: session.id, version, claimId: claim.id, text: claim.text, verdict: claim.verdict ?? null, shift: null }],
        });
        nextIndex.set(claim.id, index);
      }
    } else {
      const previous = ordered[version - 1];
      const previousClaims = previous === undefined ? [] : previous.claims;
      const alignment = alignClaims(previousClaims, session.claims);
      for (const pair of alignment.pairs) {
        const trailIndex = previousIndex.get(pair.prev.id);
        if (trailIndex === undefined) continue;
        const trail = trails[trailIndex];
        if (trail === undefined) continue;
        trail.steps.push({
          sessionId: session.id,
          version,
          claimId: pair.next.id,
          text: pair.next.text,
          verdict: pair.next.verdict ?? null,
          shift: verdictShift(pair.prev.verdict ?? null, pair.next.verdict ?? null),
        });
        trail.lastVersion = version;
        trail.versions = trail.steps.length;
        trail.text = pair.next.text;
        trail.verdict = pair.next.verdict ?? null;
        if (pair.next.verdict === 'solid') trail.everSolid = true;
        nextIndex.set(pair.next.id, trailIndex);
      }
      for (const claim of alignment.added) {
        const index = trails.length;
        trails.push({
          key: String(version) + ':' + claim.id,
          firstVersion: version,
          lastVersion: version,
          versions: 1,
          text: claim.text,
          verdict: claim.verdict ?? null,
          presentInLatest: false,
          everSolid: claim.verdict === 'solid',
          persistent: false,
          steps: [{ sessionId: session.id, version, claimId: claim.id, text: claim.text, verdict: claim.verdict ?? null, shift: null }],
        });
        nextIndex.set(claim.id, index);
      }
    }
    previousIndex = nextIndex;
  });
  const latestVersion = ordered.length - 1;
  for (const trail of trails) {
    trail.presentInLatest = trail.lastVersion === latestVersion;
    trail.persistent =
      trail.presentInLatest &&
      trail.versions >= 2 &&
      !trail.everSolid &&
      trail.verdict !== null;
  }
  trails.sort((a, b) => {
    if (a.persistent !== b.persistent) return a.persistent ? -1 : 1;
    if (a.versions !== b.versions) return b.versions - a.versions;
    if (a.lastVersion !== b.lastVersion) return b.lastVersion - a.lastVersion;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  const persistent = trails.filter((trail) => trail.persistent);
  const fixed = trails.filter((trail) => trail.everSolid && trail.steps.some((step) => step.shift === 'better'));
  const single = trails.filter((trail) => trail.versions <= 1).length;
  const base = { versions, trails, persistent, fixed, single };
  return { ...base, headline: growthHeadline(base), trailNote: growthNote(ordered, trails) };
}
