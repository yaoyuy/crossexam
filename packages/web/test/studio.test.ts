import { describe, expect, it } from 'vitest';
import {
  DRAFT_SEEDS as SHARED_SEEDS,
  DOMAIN_HINTS as SHARED_DOMAINS,
  SENIORITY_VALUES,
  TONE_VALUES,
  interviewerDraftSchema,
} from '@crossexam/shared/interviewer.ts';
import { DRAFT_LIMITS, DRAFT_SEEDS, DOMAIN_HINTS, SENIORITY_LABEL, TONE_LABEL, draftProblem, emptyDraft } from '../src/studio.ts';
import { personaBlurbOf, personaLabelOf } from '../src/labels.ts';
import { missingPanelIds, nextPanel } from '../src/contract.ts';

/**
 * 这一组测试守的是「抄写不得漂移」。
 *
 * web 包不能 import @crossexam/shared（它依赖 node:crypto），所以行业提示、示例文案、
 * 字段边界这些常量在前端各抄了一份。抄写本身没错，漂移才是错——
 * 前端说「最多 24 个字」而服务端 schema 允许 30，用户就会在点保存时才被打回来。
 */
describe('面试官工作室与后端不漂移', () => {
  it('资历与语气的取值和顺序跟 shared 一致', () => {
    expect(SENIORITY_LABEL.map((item) => item.value)).toEqual([...SENIORITY_VALUES]);
    expect(TONE_LABEL.map((item) => item.value)).toEqual([...TONE_VALUES]);
  });

  it('行业提示与 shared 的 DOMAIN_HINTS 逐项一致', () => {
    expect(DOMAIN_HINTS).toEqual([...SHARED_DOMAINS]);
  });

  it('示例文案与 shared 的 DRAFT_SEEDS 逐字一致', () => {
    expect(DRAFT_SEEDS).toEqual(SHARED_SEEDS.map((seed) => ({ label: seed.label, text: seed.text })));
  });

  it('字段边界与 shared 的 schema 一致（拿真 schema 探边界，而不是再抄一遍数字）', () => {
    const L = DRAFT_LIMITS;
    const ok = {
      name: '药房主管',
      domain: '医护与药学',
      seniority: 'senior',
      tone: 'skeptical',
      blurb: '盯住流程与资质',
      goal: '问清给药核对流程里他本人做了哪一步',
      tactics: ['让候选人说出具体班次与核对方式', '追问资质证书编号与有效期'],
    };
    expect(interviewerDraftSchema.safeParse(ok).success).toBe(true);
    expect(draftProblem(ok)).toBeNull();

    // 名字：长度上限处两边必须同时说「可以」，超一个字两边必须同时说「不行」
    const nameAt = { ...ok, name: '名'.repeat(L.nameMax) };
    expect(interviewerDraftSchema.safeParse(nameAt).success).toBe(true);
    expect(draftProblem(nameAt)).toBeNull();
    const nameOver = { ...ok, name: '名'.repeat(L.nameMax + 1) };
    expect(interviewerDraftSchema.safeParse(nameOver).success).toBe(false);
    expect(draftProblem(nameOver)).not.toBeNull();

    // 简介：下限与上限
    const blurbMin = { ...ok, blurb: '字'.repeat(L.blurbMin) };
    expect(interviewerDraftSchema.safeParse(blurbMin).success).toBe(true);
    const blurbUnder = { ...ok, blurb: '字'.repeat(L.blurbMin - 1) };
    expect(interviewerDraftSchema.safeParse(blurbUnder).success).toBe(false);
    expect(draftProblem(blurbUnder)).not.toBeNull();
    const blurbOver = { ...ok, blurb: '字'.repeat(L.blurbMax + 1) };
    expect(interviewerDraftSchema.safeParse(blurbOver).success).toBe(false);
    expect(draftProblem(blurbOver)).not.toBeNull();

    // 目标：下限与上限
    const goalMin = { ...ok, goal: '字'.repeat(L.goalMin) };
    expect(interviewerDraftSchema.safeParse(goalMin).success).toBe(true);
    const goalUnder = { ...ok, goal: '字'.repeat(L.goalMin - 1) };
    expect(interviewerDraftSchema.safeParse(goalUnder).success).toBe(false);
    expect(draftProblem(goalUnder)).not.toBeNull();

    // 手法：条数下限、上限、单条长度
    const oneTactic = { ...ok, tactics: ['只有一条'] };
    expect(interviewerDraftSchema.safeParse(oneTactic).success).toBe(false);
    expect(draftProblem(oneTactic)).not.toBeNull();
    const manyTactics = { ...ok, tactics: Array.from({ length: L.tacticsMax + 1 }, (_, i) => '手法第' + String(i) + '条要写得足够长') };
    expect(interviewerDraftSchema.safeParse(manyTactics).success).toBe(false);
    expect(draftProblem(manyTactics)).not.toBeNull();
    const shortTactic = { ...ok, tactics: ['短', '这条够长可以过关的追问手法'] };
    expect(interviewerDraftSchema.safeParse(shortTactic).success).toBe(false);
    expect(draftProblem(shortTactic)).not.toBeNull();
  });

  it('空草稿只报名字，不一次糊一脸错误', () => {
    const problem = draftProblem(emptyDraft());
    expect(problem).not.toBeNull();
    expect(problem ?? '').toContain('名字');
  });

  it('名字与简介的中文名查表：预设走枚举，自定义走契约', () => {
    expect(personaLabelOf('tech')).toBe('技术面试官');
    expect(personaLabelOf('custom-pharmacy-1a2b', '药房主管')).toBe('药房主管');
    // 契约里没给名字也不能显示成 id：那等于告诉用户「这人没名字」
    expect(personaLabelOf('custom-x-0000')).toBe('custom-x-0000');
    expect(personaBlurbOf('custom-x-0000', '盯流程')).toBe('盯流程');
    expect(personaBlurbOf('custom-x-0000')).toBe('');
  });

  it('自定义面试官排在预设之后，且彼此顺序稳定', () => {
    const base = nextPanel(['tech', 'hr'], 'hiring_manager');
    expect(base).toEqual(['tech', 'hr', 'hiring_manager']);
    const withCustom = nextPanel(base, 'custom-pharmacy-1a2b');
    expect(withCustom).toEqual(['tech', 'hr', 'hiring_manager', 'custom-pharmacy-1a2b']);
    // 再点一次是取消，且不打扰其余顺序
    expect(nextPanel(withCustom, 'custom-pharmacy-1a2b')).toEqual(['tech', 'hr', 'hiring_manager']);
    // 预设后加也要回到预设段里，而不是追加到自定义后面
    expect(nextPanel(withCustom, 'stress')).toEqual(['tech', 'hr', 'hiring_manager', 'stress', 'custom-pharmacy-1a2b']);
  });

  it('面板里被删掉的面试官能被指名道姓地找出来', () => {
    expect(missingPanelIds(['tech', 'custom-gone-0000'], ['tech', 'hr'])).toEqual(['custom-gone-0000']);
    expect(missingPanelIds(['tech', 'hr'], ['tech', 'hr'])).toEqual([]);
  });
});
