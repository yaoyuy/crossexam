import { describe, expect, it } from 'vitest';
import { PERSONA_PRESETS } from '@crossexam/shared/contract.ts';
import {
  CLAIM_CATEGORY_LABEL as SHARED_CATEGORY_LABEL,
  VERDICT_LABEL as SHARED_VERDICT_LABEL,
} from '@crossexam/shared/domain.ts';
import type { ClaimCategory, InterviewerRole, VerdictKind } from '@crossexam/shared/domain.ts';
import {
  CLAIM_CATEGORY_LABEL,
  CLAIM_CATEGORY_ORDER,
  PERSONA_BLURB,
  PERSONA_LABEL,
  SESSION_STATUS_LABEL,
  STAGE_HINT,
  STAGE_LABEL,
  VERDICT_GLOSS,
  VERDICT_LABEL,
  VERDICT_TONE,
} from '../src/labels.ts';

const VERDICT_KINDS: VerdictKind[] = ['solid', 'overstated', 'unsupported', 'contradicts', 'unanswerable'];
const CATEGORIES: ClaimCategory[] = ['skill', 'experience', 'achievement', 'metric', 'ownership', 'timeline', 'other'];
const ROLES: InterviewerRole[] = ['tech', 'hr', 'hiring_manager', 'stress', 'domain_expert'];
const STAGES = ['extract', 'probe', 'answer', 'verdict', 'suggest'];

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

  it('五个阶段与会话状态都有中文名', () => {
    for (const stage of STAGES) {
      expect((STAGE_LABEL[stage] ?? '').length).toBeGreaterThan(0);
      expect((STAGE_HINT[stage] ?? '').length).toBeGreaterThan(0);
    }
    for (const status of ['draft', 'extracting', 'probing', 'scoring', 'done', 'failed']) {
      expect((SESSION_STATUS_LABEL[status] ?? '').length).toBeGreaterThan(0);
    }
  });
});
