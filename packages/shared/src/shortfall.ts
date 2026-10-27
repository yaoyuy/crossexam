/**
 * 按类别看短板（P10 · A3）。
 *
 * 判定结果原本只能一条一条读：十几条主张、十几个徽章，看完了还是不知道「我最该改哪儿」。
 * 这一层把同一份判定换个角度摆——先按主张类别分组，再按「欠证据的程度」排出最该补的几处。
 * 它只做聚合，不引入任何新判定：输入是什么判定，输出就是什么判定。
 *
 * 全是纯函数、同样输入同样输出（报告与界面共用这一份，回放也依赖它稳定）。
 */
import type { ClaimCategory, VerdictKind } from "./domain.ts";
import { CLAIM_CATEGORY_LABEL, VERDICT_LABEL } from "./domain.ts";

/**
 * 只取聚合真正用到的字段。
 * 服务端的 ClaimRow 与前端的 ClaimView 都能直接喂进来——两边各自多带的字段会被忽略。
 */
export interface JudgedClaimLike {
  id: string;
  text: string;
  category: ClaimCategory;
  /** null = 这一条还没判（跑一半、或判定失败） */
  verdict: VerdictKind | null;
}

/** 欠证据的程度：数字越大越该先补。solid 是「已经站得住」，排在最末、不进最该补的名单。 */
export const WEAKNESS_RANK: Record<VerdictKind, number> = {
  solid: 0,
  overstated: 1,
  unsupported: 2,
  contradicts: 3,
  unanswerable: 4,
};

/** 界面与报告默认都摆三处：再多就成了另一份清单，没人看。 */
export const SHORTFALL_DEFAULT_LIMIT = 3;

/** 类别的固定展示顺序。定义在这里，报告与界面都不各自排一遍。 */
export const CATEGORY_ORDER: readonly ClaimCategory[] = [
  "skill",
  "experience",
  "achievement",
  "metric",
  "ownership",
  "timeline",
  "other",
];

export interface CategoryShortfall {
  category: ClaimCategory;
  label: string;
  total: number;
  judged: number;
  solid: number;
  /** judged - solid：判定过、但没站住的数量 */
  weak: number;
  /** 只统计出现过的判定，省得界面上摆一排 0 */
  counts: Partial<Record<VerdictKind, number>>;
}

/** 按类别汇总。返回顺序：先按欠证据的条数降序，再按总数降序，最后按固定类别顺序。 */
export function categoryShortfalls(claims: readonly JudgedClaimLike[]): CategoryShortfall[] {
  const byCategory = new Map<ClaimCategory, CategoryShortfall>();
  for (const claim of claims) {
    const item = byCategory.get(claim.category) ?? {
      category: claim.category,
      label: CLAIM_CATEGORY_LABEL[claim.category],
      total: 0,
      judged: 0,
      solid: 0,
      weak: 0,
      counts: {},
    };
    item.total += 1;
    if (claim.verdict !== null) {
      item.judged += 1;
      item.counts[claim.verdict] = (item.counts[claim.verdict] ?? 0) + 1;
      if (claim.verdict === "solid") item.solid += 1;
      else item.weak += 1;
    }
    byCategory.set(claim.category, item);
  }
  return [...byCategory.values()].sort((a, b) => {
    if (a.weak !== b.weak) return b.weak - a.weak;
    if (a.total !== b.total) return b.total - a.total;
    return CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
  });
}

/**
 * 最该先补的几处。
 * 先按欠证据的程度排（无法回答 > 与原文矛盾 > 证据缺失 > 表述过度），同程度保持原顺序（C1..Cn），
 * 所以同一份输入永远得到同一个名单——报告里的编号与界面上的顺序不会打架。
 */
export function weakestClaims(
  claims: readonly JudgedClaimLike[],
  limit: number = SHORTFALL_DEFAULT_LIMIT,
): JudgedClaimLike[] {
  return claims
    .filter((claim) => claim.verdict !== null && claim.verdict !== "solid")
    .map((claim, index) => ({ claim, index }))
    .sort((a, b) => {
      const gap = WEAKNESS_RANK[b.claim.verdict as VerdictKind] - WEAKNESS_RANK[a.claim.verdict as VerdictKind];
      if (gap !== 0) return gap;
      return a.index - b.index;
    })
    .slice(0, Math.max(0, limit))
    .map((item) => item.claim);
}

export interface ShortfallPlan {
  /** 全部主张数（含还没判的） */
  total: number;
  judged: number;
  /** 判定过且有问题的条数 */
  weak: number;
  solid: number;
  stats: CategoryShortfall[];
  weakest: JudgedClaimLike[];
  /** 一句话结论，界面与报告都用它，不各写一句 */
  headline: string;
}

function countsPhrase(item: CategoryShortfall): string {
  const parts: string[] = [];
  for (const kind of ["unanswerable", "contradicts", "unsupported", "overstated", "solid"] as VerdictKind[]) {
    const count = item.counts[kind];
    if (count !== undefined && count > 0) parts.push(VERDICT_LABEL[kind] + " " + count);
  }
  return parts.join(" · ");
}

/** 类别那一行的完整文案，例如「技能掌握 · 欠 4 条（证据缺失 3 · 表述过度 1）」。 */
export function categoryLine(item: CategoryShortfall): string {
  if (item.judged === 0) return item.label + " · " + item.total + " 条还没判";
  if (item.weak === 0) return item.label + " · " + item.total + " 条全部站得住";
  return item.label + " · 欠 " + item.weak + " 条（" + countsPhrase(item) + "）";
}

/** 一句话结论。它要能独立读懂，所以不复述编号，只说数量与最集中的那两类。 */
export function shortfallHeadline(plan: Omit<ShortfallPlan, "headline">): string {
  if (plan.total === 0) return "这场没有抽出可判定的主张。";
  if (plan.judged === 0) return plan.total + " 条主张一条都还没判，等判定出来再看短板。";
  if (plan.weak === 0) {
    if (plan.judged < plan.total) return "已判的 " + plan.judged + " 条全部站得住，还有 " + (plan.total - plan.judged) + " 条没判。";
    return plan.total + " 条主张全部站得住，这一版不用补。";
  }
  const focus = plan.stats.filter((item) => item.weak > 0).slice(0, 2);
  const where = focus.map((item) => item.label + " " + item.weak + " 条").join("、");
  const tail = focus.length > 0 ? "，最集中的是" + where : "";
  const unjudged = plan.total - plan.judged;
  const rest = unjudged > 0 ? "（还有 " + unjudged + " 条没判）" : "";
  return "已判的 " + plan.judged + " 条里有 " + plan.weak + " 条还欠证据" + tail + rest + "。";
}

/** 报告与界面取同一份结果：一次算完，避免两处各排一遍导致编号不一致。 */
export function shortfallPlan(
  claims: readonly JudgedClaimLike[],
  limit: number = SHORTFALL_DEFAULT_LIMIT,
): ShortfallPlan {
  let judged = 0;
  let solid = 0;
  for (const claim of claims) {
    if (claim.verdict === null) continue;
    judged += 1;
    if (claim.verdict === "solid") solid += 1;
  }
  const body = {
    total: claims.length,
    judged,
    solid,
    weak: judged - solid,
    stats: categoryShortfalls(claims),
    weakest: weakestClaims(claims, limit),
  };
  return { ...body, headline: shortfallHeadline(body) };
}
