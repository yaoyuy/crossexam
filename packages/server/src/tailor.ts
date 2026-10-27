/**
 * 一岗一版的服务层（P12 · ③）。
 *
 * 纯计算在 packages/shared/src/tailor.ts，这里只做三件事：
 * 把这一场的主张、这份 JD 的要求与对照结果挑出来，决定从哪份文本上筛，然后把结论原样交出去。
 *
 * 为什么不落库：这一版是「当前这份简历 × 这个岗位」的一次现算，随采纳改写的勾选变化。
 * 存下来就会与原文、与采纳记录构成第二个真相源——能现算的坐标不要存第二份（ADR-0013 同一条取舍）。
 */
import type { ReviseResult } from '@crossexam/shared';
import type { Requirement, RequirementMatch } from '@crossexam/shared';
import { tailorResume, type TailorResult } from '@crossexam/shared';
import type { Db } from './store/db.ts';
import { revisedOf } from './revisions.ts';
import type { SessionView } from './pipeline.ts';

export interface TailorView extends TailorResult {
  sessionId: string;
  jdId: string;
  /** 这一版是从哪份文本筛出来的：没采纳过改写就是原文 */
  base: 'original' | 'revised';
  baseChars: number;
  /** 这个岗位与它合并来的要求一共几条 */
  requirementCount: number;
  /** 真对上了主张的要求条数（hit / weak 都算） */
  supportedRequirements: number;
}

/** 这份 JD 的要求：合并过的要求把来源列在 sources 里，代表句可能出自另一份 JD */
export function requirementsOfJd(requirements: readonly Requirement[], jdId: string): Requirement[] {
  return requirements.filter((row) => row.jdId === jdId || row.sources.includes(jdId));
}

export function matchesOf(requirements: readonly Requirement[], matches: readonly RequirementMatch[]): RequirementMatch[] {
  const ids = new Set(requirements.map((row) => row.id));
  return matches.filter((row) => ids.has(row.requirementId));
}

/**
 * 按一个岗位筛一版。jdId 不在这一场里就返回 null（调用方按 404 处理）。
 */
export function tailorFor(db: Db, view: SessionView, jdId: string): TailorView | null {
  const jd = view.jds.find((row) => row.id === jdId);
  if (jd === undefined) return null;
  const requirements = requirementsOfJd(view.requirements, jdId);
  const matches = matchesOf(requirements, view.requirementMatches);
  const revised = revisedOf(db, view.session.id);
  const base = revised === null ? 'original' : 'revised';
  const text = revised === null ? view.session.resumeText : revised.text;
  const applied: ReviseResult['applied'] = revised === null ? [] : revised.applied;
  const result = tailorResume({
    text,
    claims: view.claims,
    applied,
    requirements,
    matches,
    jdTitle: jd.title,
  });
  return {
    ...result,
    sessionId: view.session.id,
    jdId,
    base,
    baseChars: text.length,
    requirementCount: requirements.length,
    supportedRequirements: matches.filter((row) => row.status !== 'missing' && row.claimId !== null).length,
  };
}
