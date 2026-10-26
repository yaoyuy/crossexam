import { describe, expect, it } from 'vitest';
import { PERSONA_PRESETS } from '@crossexam/shared/contract.ts';
import {
  CLAIM_CATEGORY_LABEL as SHARED_CATEGORY_LABEL,
  VERDICT_LABEL as SHARED_VERDICT_LABEL,
} from '@crossexam/shared/domain.ts';
import type { ClaimCategory, InterviewerRole, VerdictKind, MatchStatus, RequirementKind } from '@crossexam/shared/domain.ts';
import {
  CLAIM_CATEGORY_LABEL,
  CLAIM_CATEGORY_ORDER,
  MATCH_LABEL,
  MATCH_TONE,
  PERSONA_BLURB,
  PERSONA_LABEL,
  REQUIREMENT_KIND_LABEL,
  SESSION_STATUS_LABEL,
  STAGE_HINT,
  STAGE_LABEL,
  VERDICT_CRITERIA,
  VERDICT_GLOSS,
  VERDICT_LABEL,
  VERDICT_TONE,
} from '../src/labels.ts';

const VERDICT_KINDS: VerdictKind[] = ['solid', 'overstated', 'unsupported', 'contradicts', 'unanswerable'];
const CATEGORIES: ClaimCategory[] = ['skill', 'experience', 'achievement', 'metric', 'ownership', 'timeline', 'other'];
const ROLES: InterviewerRole[] = ['tech', 'hr', 'hiring_manager', 'stress', 'domain_expert'];
/** 与服务端 orchestrator/prompts.ts 的 StageName 同一份清单：漏一个阶段界面上就没名字 */
const STAGES = ['extract', 'jd-extract', 'jd-merge', 'jd-match', 'probe', 'answer', 'verdict', 'suggest'];
const MATCH_STATUSES: MatchStatus[] = ['hit', 'weak', 'missing'];
const REQUIREMENT_KINDS: RequirementKind[] = ['must', 'plus', 'duty'];

describe('界面文案不漂移', () => {
  it('判定与类别的中文标签直接复用领域层那一份，不是另抄的', () => {
    expect(VERDICT_LABEL).toBe(SHARED_VERDICT_LABEL);
    expect(CLAIM_CATEGORY_LABEL).toBe(SHARED_CATEGORY_LABEL);
  });

  it('五个判定都有配色和一句人话解释', () => {
    for (const kind of VERDICT_KINDS) {
      expect(['solid', 'warn', 'danger', 'muted']).toContain(VERDICT_TONE[kind]);
      expect((VERDICT_GLOSS[kind] ?? '').length).toBeGreaterThan(4);
    }
  });

  it('七个类别都有中文标签，排序清单不漏不重', () => {
    for (const category of CATEGORIES) {
      expect((CLAIM_CATEGORY_LABEL[category] ?? '').length).toBeGreaterThan(0);
    }
    expect([...CLAIM_CATEGORY_ORDER].sort()).toEqual([...CATEGORIES].sort());
  });

  it('五类人设的名字与一句话简介跟 PERSONA_PRESETS 逐字一致', () => {
    // PERSONA_PRESETS 的每一项是「人设 + 目标 + 战术」，人设本身在 persona 字段里
    const presets = PERSONA_PRESETS as unknown as Record<string, { persona: { name: string; blurb: string } }>;
    expect(Object.keys(presets).sort()).toEqual([...ROLES].sort());
    for (const role of ROLES) {
      const preset = presets[role];
      expect(preset).toBeDefined();
      expect(PERSONA_LABEL[role]).toBe(preset?.persona.name);
      expect(PERSONA_BLURB[role]).toBe(preset?.persona.blurb);
    }
  });

  it('五个判定都有判据：一句规则 + 一句为什么', () => {
    for (const kind of VERDICT_KINDS) {
      const criteria = VERDICT_CRITERIA[kind];
      expect(criteria).toBeDefined();
      expect(criteria.rule.length).toBeGreaterThan(6);
      expect(criteria.basis.length).toBeGreaterThan(12);
    }
    // 「证据缺失」必须说清「不是没做过，是没有可核对的细节」，这是最容易被误读的一条
    expect(VERDICT_CRITERIA.unsupported.basis).toContain('可核对');
    expect(VERDICT_CRITERIA.unsupported.rule).toContain('证据');
  });

  it('八个阶段与会话状态都有中文名，且不多不少', () => {
    for (const stage of STAGES) {
      expect((STAGE_LABEL[stage] ?? '').length).toBeGreaterThan(0);
      expect((STAGE_HINT[stage] ?? '').length).toBeGreaterThan(0);
    }
    // 键集必须一一对上：多写一个没用的阶段名、或漏掉一个真阶段，都会被这条戳出来
    expect(Object.keys(STAGE_LABEL).sort()).toEqual([...STAGES].sort());
    expect(Object.keys(STAGE_HINT).sort()).toEqual([...STAGES].sort());
    for (const status of ['draft', 'extracting', 'probing', 'scoring', 'done', 'failed']) {
      expect((SESSION_STATUS_LABEL[status] ?? '').length).toBeGreaterThan(0);
    }
  });

  it('岗位要求的三种对照结果都有标签与配色，「简历里没写」用的是灰而不是红', () => {
    for (const status of MATCH_STATUSES) {
      expect((MATCH_LABEL[status] ?? '').length).toBeGreaterThan(0);
      expect(['solid', 'warn', 'muted']).toContain(MATCH_TONE[status]);
    }
    expect(MATCH_TONE.missing).toBe('muted');
    expect(MATCH_LABEL.hit).toBe('答得上');
  });

  it('三条要求的类型都有中文名：硬性 / 加分 / 职责', () => {
    for (const kind of REQUIREMENT_KINDS) {
      expect((REQUIREMENT_KIND_LABEL[kind] ?? '').length).toBeGreaterThan(0);
    }
    expect(REQUIREMENT_KIND_LABEL.must).toBe('硬性要求');
  });
});
