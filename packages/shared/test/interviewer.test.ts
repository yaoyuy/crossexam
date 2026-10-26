import { describe, expect, it } from 'vitest';
import {
  CUSTOM_ID_PREFIX,
  DOMAIN_HINTS,
  DRAFT_SEEDS,
  buildCustomContract,
  customInterviewerId,
  diffDrafts,
  draftDigest,
  interviewerDraftSchema,
  localDraftFromText,
  localDraftNotes,
  type InterviewerDraft,
} from '../src/interviewer.ts';
import { COMMON_CONSTRAINTS } from '../src/contract.ts';
import type { ContractBudgetView } from '../src/contract.ts';

const BUDGET: ContractBudgetView = { maxRoundsPerClaim: 3, maxProbesPerInterviewerPerClaim: 2, maxTotalProbes: 60 };

const MARKETING =
  '我要面一位市场营销专员。简历里写满了「策划过活动」「粉丝增长多少」「转化率提升」，我想让他把这些数字的口径和归属说清楚。';

describe('自定义面试官的 id', () => {
  it('带固定前缀、可读、且同名同 salt 稳定', () => {
    const a = customInterviewerId('市场面试官');
    const b = customInterviewerId('市场面试官');
    expect(a).toBe(b);
    expect(a.startsWith(CUSTOM_ID_PREFIX)).toBe(true);
    expect(a).toContain('市场面试官');
  });

  it('同名不同 salt 会得到不同 id —— 改过三次的那位必须能区分是哪一版', () => {
    expect(customInterviewerId('市场面试官', 'v1')).not.toBe(customInterviewerId('市场面试官', 'v2'));
  });

  it('名字里全是符号时也不会生成空壳 id', () => {
    const id = customInterviewerId('!!!');
    expect(id.startsWith(CUSTOM_ID_PREFIX + 'interviewer-')).toBe(true);
  });
});

describe('草稿 schema（模型输出的唯一入口）', () => {
  it('接受一份合法草稿', () => {
    const draft = localDraftFromText(MARKETING);
    expect(() => interviewerDraftSchema.parse(draft)).not.toThrow();
  });

  it('追问手法少于 2 条或多于 5 条都拒绝', () => {
    const base = localDraftFromText(MARKETING);
    expect(interviewerDraftSchema.safeParse({ ...base, tactics: ['只有一条手法'] }).success).toBe(false);
    expect(
      interviewerDraftSchema.safeParse({ ...base, tactics: ['一', '二', '三', '四', '五', '六'] }).success,
    ).toBe(false);
  });

  it('目标太短（一句话敷衍）会被拒绝', () => {
    const base = localDraftFromText(MARKETING);
    expect(interviewerDraftSchema.safeParse({ ...base, goal: '看看' }).success).toBe(false);
  });
});

describe('草稿补成契约', () => {
  it('换成 custom 角色，但硬约束与禁止项仍是共享的那一份', () => {
    const draft = localDraftFromText(MARKETING);
    const contract = buildCustomContract({ id: 'custom-x', draft, budget: BUDGET });
    expect(contract.persona.role).toBe('custom');
    expect(contract.constraints).toBe(COMMON_CONSTRAINTS);
    expect(contract.id).toBe('custom-x');
    expect(contract.version).toBe(1);
  });

  it('指纹只跟着草稿内容变', () => {
    const draft = localDraftFromText(MARKETING);
    expect(draftDigest(draft)).toBe(draftDigest({ ...draft }));
    expect(draftDigest(draft)).not.toBe(draftDigest({ ...draft, goal: draft.goal + '（改过）' }));
  });
});

describe('字段级 diff', () => {
  it('没改动就没有条目', () => {
    const draft = localDraftFromText(MARKETING);
    expect(diffDrafts(draft, { ...draft })).toHaveLength(0);
  });

  it('改了哪些字段就报哪些，追问手法合成一行便于对照', () => {
    const before = localDraftFromText(MARKETING);
    const after: InterviewerDraft = { ...before, goal: before.goal + '（优化后）', tactics: ['只问数字口径：怎么算的。'] };
    const diff = diffDrafts(before, after);
    expect(diff.map((d) => d.field).sort()).toEqual(['goal', 'tactics']);
  });
});

describe('离线兜底草稿（不联网也要能走完）', () => {
  it('输出永远能过 schema —— 这是它存在的底线', () => {
    const inputs = [MARKETING, '面一位会计', '', '面一位护士，简历写了参与抢救', '我要招一个前端', '面一位中学老师'];
    for (const text of inputs) {
      const draft = localDraftFromText(text);
      const parsed = interviewerDraftSchema.safeParse(draft);
      if (!parsed.success) throw new Error('草稿不合规：' + JSON.stringify(parsed.error.issues) + ' 输入=' + text);
    }
  });

  it('确定性：同样的输入两次得到逐字节相同的结果', () => {
    expect(JSON.stringify(localDraftFromText(MARKETING))).toBe(JSON.stringify(localDraftFromText(MARKETING)));
  });

  it('非计算机方向也能猜出领域与人名，且手法咬住简历里的措辞', () => {
    const draft = localDraftFromText(MARKETING);
    expect(draft.domain).toBe('市场营销');
    expect(draft.name).toContain('市场营销');
    const joined = draft.tactics.join(' | ');
    expect(joined).toContain('数字');
    expect(joined).toContain('口径');
  });

  it('医护方向的措辞（参与抢救）也能命中职责边界那条手法', () => {
    const draft = localDraftFromText('面一位临床护士，简历写参与多起抢救，获患者好评');
    expect(draft.domain).toBe('医护与药学');
    expect(draft.tactics.join(' | ')).toContain('你负责');
  });

  it('认得出语气与自我评价类措辞', () => {
    const draft = localDraftFromText('面一位销售，简历写学习能力强、抗压，我要压力面');
    expect(draft.tone).toBe('blunt');
    expect(draft.tactics.join(' | ')).toContain('具体场景');
  });

  it('空输入给的是三条通用手法，不是一句空话', () => {
    const draft = localDraftFromText('');
    expect(draft.tactics.length).toBeGreaterThanOrEqual(3);
    expect(draft.tactics.join(' | ')).toContain('具体例子');
    expect(draft.name).toBe('自定义面试官');
  });

  it('生成说明写清命中了哪条规则，便于界面展示', () => {
    const notes = localDraftNotes(MARKETING, localDraftFromText(MARKETING));
    expect(notes.length).toBeGreaterThan(1);
    expect(notes.join(' | ')).toContain('命中措辞');
    expect(notes.join(' | ')).toContain('不发送任何网络请求');
  });

  it('行业提示与示例都避开了计算机方向，且示例文本能生成合规草稿', () => {
    for (const seed of DRAFT_SEEDS) {
      expect(seed.text).not.toContain('代码');
      expect(interviewerDraftSchema.safeParse(localDraftFromText(seed.text)).success).toBe(true);
    }
    expect(DOMAIN_HINTS.length).toBeGreaterThanOrEqual(12);
  });
});
