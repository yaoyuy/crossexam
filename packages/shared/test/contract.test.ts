import { describe, expect, it } from 'vitest';
import {
  COMMON_CONSTRAINTS,
  PERSONA_PRESETS,
  buildContracts,
  contractDigest,
  renderSystemPrompt,
} from '../src/contract.ts';
import type { InterviewerRole } from '../src/domain.ts';

const BUDGET = { maxRoundsPerClaim: 3, maxProbesPerInterviewerPerClaim: 2, maxTotalProbes: 60 };
const ALL_ROLES: InterviewerRole[] = ['tech', 'hr', 'hiring_manager', 'stress', 'domain_expert'];

describe('意图契约', () => {
  it('五类面试官都有人格预设', () => {
    for (const role of ALL_ROLES) {
      expect(PERSONA_PRESETS[role]).toBeDefined();
      expect(PERSONA_PRESETS[role].persona.role).toBe(role);
      expect(PERSONA_PRESETS[role].goal.length).toBeGreaterThan(0);
      expect(PERSONA_PRESETS[role].tactics.length).toBeGreaterThan(0);
    }
  });

  it('按角色生成契约，id 与角色一致且可复现', () => {
    const cs = buildContracts(['tech', 'hr'], BUDGET);
    expect(cs.map((c) => c.id)).toEqual(['tech', 'hr']);
    expect(cs[0]?.version).toBe(1);
    expect(cs[0]?.constraints).toEqual(COMMON_CONSTRAINTS);
  });

  it('同一份契约渲染出的提示词逐字节相同——这是「可复现」在提示词层的含义', () => {
    const c = buildContracts(['stress'], BUDGET)[0]!;
    expect(renderSystemPrompt(c)).toBe(renderSystemPrompt(c));
    const again = buildContracts(['stress'], BUDGET)[0]!;
    expect(renderSystemPrompt(again)).toBe(renderSystemPrompt(c));
  });

  it('提示词里带上了身份、目标、约束条数与预算数字', () => {
    const c = buildContracts(['tech'], BUDGET)[0]!;
    const p = renderSystemPrompt(c);
    expect(p).toContain(c.persona.name);
    expect(p).toContain(c.persona.blurb);
    expect(p).toContain(c.goal);
    expect(p).toContain(String(COMMON_CONSTRAINTS.length) + '. ');
    expect(p).toContain('全场追问总次数上限 60 次');
  });

  it('契约指纹：内容相同即相同，任一字段改动即变化', () => {
    const a = buildContracts(['hr'], BUDGET)[0]!;
    const b = buildContracts(['hr'], BUDGET)[0]!;
    expect(contractDigest(a)).toBe(contractDigest(b));
    const tweaked = { ...a, goal: a.goal + '（加强版）' };
    expect(contractDigest(tweaked)).not.toBe(contractDigest(a));
  });

  it('契约版本可以整体升级，用于追溯某条追问出自哪一版', () => {
    const v2 = buildContracts(['tech'], BUDGET, 2)[0]!;
    expect(v2.version).toBe(2);
    expect(contractDigest(v2)).not.toBe(contractDigest(buildContracts(['tech'], BUDGET, 1)[0]!));
  });
});
