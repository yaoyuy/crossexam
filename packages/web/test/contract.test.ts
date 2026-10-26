/**
 * 契约展示层的单元测试：契约是数据，界面只是把它摊成人话。
 *
 * 这里盯的是三件容易出错的事：行的顺序与来源、预算数字只有一个出处、
 * 以及「待对账 / 一致 / 漂移」三种状态不能被混成同一句话。
 */

import { describe, expect, it } from 'vitest';
import { budgetText, consistencyNote, contractLines, digestText, nextPanel, PANEL_ORDER } from '../src/contract.ts';
import type { ContractView, InterviewerRole } from '../src/api.ts';

function view(patch: Partial<ContractView> = {}): ContractView {
  return {
    id: 'tech',
    version: 1,
    digest: '0123456789abcdef',
    storedDigest: null,
    verified: false,
    contract: {
      id: 'tech',
      version: 1,
      persona: {
        name: '技术面试官',
        role: 'tech',
        seniority: '资深工程师',
        tone: '冷静、只问细节',
        blurb: '技术面只认细节和数字',
      },
      goal: '把简历里的技术细节问到能复现',
      tactics: ['追测量口径', '追边界条件'],
      constraints: ['提问必须逐字引用简历原文'],
      forbidden: ['不问与岗位无关的隐私'],
      budget: { maxRoundsPerClaim: 3, maxProbesPerInterviewerPerClaim: 2, maxTotalProbes: 60 },
    },
    systemPrompt: '你是「技术面试官」。',
    ...patch,
  };
}

describe('意图契约的展示层', () => {
  it('契约摊成固定六行，内容逐字来自契约数据', () => {
    const lines = contractLines(view());
    expect(lines.map((line) => line.label)).toEqual(['人设', '目标', '手法', '禁区', '共同约束', '追问预算']);
    expect(lines[0]?.value).toBe('技术面试官 · 资深工程师 · 冷静、只问细节');
    expect(lines[1]?.value).toBe('把简历里的技术细节问到能复现');
    expect(lines[2]?.value).toBe('追测量口径；追边界条件');
    expect(lines[3]?.value).toBe('不问与岗位无关的隐私');
    expect(lines[4]?.value).toBe('提问必须逐字引用简历原文');
    expect(lines[5]?.value).toContain('全场最多 60 次');
  });

  it('预算那行只有一个出处：改契约，界面文字跟着改', () => {
    const tweaked = view({
      contract: {
        ...view().contract,
        budget: { maxRoundsPerClaim: 5, maxProbesPerInterviewerPerClaim: 1, maxTotalProbes: 12 },
      },
    });
    expect(budgetText(tweaked)).toBe('每主张最多 5 轮追问 · 每人每主张最多 1 次 · 全场最多 12 次');
    expect(budgetText(view())).not.toBe(budgetText(tweaked));
  });

  it('指纹只露前八位，本来就短的原样返回', () => {
    expect(digestText('0123456789abcdef')).toBe('01234567');
    expect(digestText('abcd')).toBe('abcd');
    expect(digestText('')).toBe('');
  });

  it('三种对账状态各有各的说法，不会被混成一句', () => {
    const pending = consistencyNote(view());
    expect(pending.tone).toBe('pending');
    expect(pending.text).toContain('尚未开跑');
    expect(pending.text).toContain('01234567');

    const same = consistencyNote(view({ storedDigest: '0123456789abcdef', verified: true }));
    expect(same.tone).toBe('ok');
    expect(same.text).toContain('与运行时一致');

    const drift = consistencyNote(view({ storedDigest: 'fedcba9876543210', verified: false }));
    expect(drift.tone).toBe('drift');
    expect(drift.text).toContain('契约已漂移');
    expect(drift.text).toContain('fedcba98');
    expect(drift.text).toContain('01234567');
  });
});

describe('面试官面板的增删', () => {
  it('增删都按规范顺序重排，不受点击历史影响', () => {
    const base: InterviewerRole[] = ['tech', 'hr', 'hiring_manager'];
    const withStress = nextPanel(base, 'stress');
    expect(withStress).toEqual(['tech', 'hr', 'hiring_manager', 'stress']);
    const withoutStress = nextPanel(withStress, 'stress');
    expect(withoutStress).toEqual(base);
    // 这一步就是真跑出来的那次：先加再删、先删后加，面板顺序会走样，回放卡带就全对不上
    const dropHr = nextPanel(base, 'hr');
    expect(dropHr).toEqual(['tech', 'hiring_manager']);
    const backToBase = nextPanel(dropHr, 'hr');
    expect(backToBase).toEqual(base);
  });

  it('规范顺序覆盖全部五个角色，不重不漏', () => {
    expect(PANEL_ORDER.length).toBe(5);
    expect(new Set(PANEL_ORDER).size).toBe(5);
  });
});