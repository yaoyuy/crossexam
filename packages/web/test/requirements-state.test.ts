/**
 * 岗位要求在前端状态里的折叠规则。
 *
 * 三件事值得守住：
 * ① 要求清单是**整批替换**，不是追加——它是「输入 + 抽出来的要求」派生的一张表，
 *    追加语义会让重跑一场之后旧要求留在界面上；
 * ② 只按 status 分组渲染，所以「哪条要求对应哪条主张」必须在状态层就能查到，
 *    不能靠组件自己二次遍历；
 * ③ 没有 JD 的场次必须能走到结论文案，不能显示成「0 条要求」这种像出错的字。
 */
import { describe, expect, it } from 'vitest';
import type { Requirement, RequirementMatch } from '../src/api.ts';
import {
  anchorsOfJd,
  applyEvent,
  initialSandbox,
  matchConclusionOf,
  requirementMatch,
  requirementsForClaim,
  sandboxReducer,
} from '../src/state.ts';

function requirement(id: string, jdId = 'J1', text = '要求 ' + id): Requirement {
  return {
    id: id,
    kind: 'must',
    text: text,
    keywords: [],
    anchor: { start: 0, end: text.length, quote: text, exact: true },
    jdId: jdId,
    sources: [jdId],
  };
}

function match(requirementId: string, status: RequirementMatch['status'], claimId: string | null): RequirementMatch {
  return { requirementId: requirementId, claimId: claimId, status: status, reason: '为什么这么判' };
}

const REQUIREMENTS = [requirement('R1'), requirement('R2'), requirement('R3', 'J2')];
const MATCHES = [match('R1', 'weak', 'C1'), match('R2', 'hit', 'C1'), match('R3', 'missing', null)];

describe('岗位要求折叠进界面状态', () => {
  it('一批要求整批替换：重跑的对照结果不会和上一批混在一起', () => {
    const first = applyEvent(initialSandbox, {
      type: 'requirements',
      requirements: [requirement('R1')],
      rejected: [],
      matches: [match('R1', 'hit', 'C1')],
      summary: { hit: 1, weak: 0, missing: 0, total: 1 },
    });
    const second = applyEvent(first, {
      type: 'requirements',
      requirements: REQUIREMENTS,
      rejected: [{ key: 'J1#9', jdId: 'J1', quote: '抄错的引文', text: '这条要求', reason: '这条要求锚不到 JD 原文' }],
      matches: MATCHES,
      summary: { hit: 1, weak: 1, missing: 1, total: 3 },
    });
    expect(second.requirements.map((item) => item.id)).toEqual(['R1', 'R2', 'R3']);
    expect(second.requirementMatches).toHaveLength(3);
    expect(second.requirementRejected[0]!.reason).toContain('锚不到 JD 原文');
    expect(second.requirementSummary).toEqual({ hit: 1, weak: 1, missing: 1, total: 3 });
  });

  it('点要求跳 JD 原文改的是 jdFocus，不动简历那侧的高亮', () => {
    const state = sandboxReducer(initialSandbox, { type: 'focus-jd', anchor: requirement('R1').anchor });
    expect(state.jdFocus).toEqual(requirement('R1').anchor);
    expect(state.focus).toBeNull();
  });

  it('按编号取对照结果，没查到给 null', () => {
    const state = { ...initialSandbox, requirements: REQUIREMENTS, requirementMatches: MATCHES };
    expect(requirementMatch(state, 'R2')?.status).toBe('hit');
    expect(requirementMatch(state, 'R9')).toBeNull();
  });

  it('一条主张对上过哪些要求：「简历里没写」的没有对应主张，不该出现', () => {
    const state = { ...initialSandbox, requirements: REQUIREMENTS, requirementMatches: MATCHES };
    expect(requirementsForClaim(state, 'C1').map((item) => item.id)).toEqual(['R1', 'R2']);
    expect(requirementsForClaim(state, 'C2')).toEqual([]);
  });

  it('某份 JD 上被问过的位置：另一份 JD 的要求不串到这一份上', () => {
    const state = { ...initialSandbox, requirements: REQUIREMENTS };
    expect(anchorsOfJd(state, 'J1')).toHaveLength(2);
    expect(anchorsOfJd(state, 'J2')[0]!.quote).toBe('要求 R3');
  });

  it('结论文案三种情况分得开：没传 JD / 还没抽出结果 / 有结果', () => {
    expect(matchConclusionOf(null, 0)).toContain('没有上传岗位要求');
    expect(matchConclusionOf(null, 2)).toContain('还没抽出对照结果');
    expect(matchConclusionOf({ hit: 1, weak: 1, missing: 1, total: 3 }, 2)).toContain('答得上 1 条、答得含糊 1 条、没写 1 条');
  });
});
