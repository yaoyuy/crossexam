import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGET } from '../src/budget.ts';
import { buildContracts, contractBudgetView } from '../src/contract.ts';
import {
  BUDGET_BY_DIFFICULTY,
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  DIFFICULTY_HINT,
  DIFFICULTY_LABEL,
  budgetOf,
  difficultyOf,
  difficultyViews,
  isDifficulty,
} from '../src/difficulty.ts';

describe('追问强度档位', () => {
  it('三档的顺序与默认档都写死，不靠字典序', () => {
    expect([...DIFFICULTIES]).toEqual(['gentle', 'normal', 'hard']);
    expect(DEFAULT_DIFFICULTY).toBe('normal');
  });

  it('默认档就是 DEFAULT_BUDGET：加档位不该动任何一场已有的沙盘', () => {
    expect(budgetOf('normal')).toBe(DEFAULT_BUDGET);
  });

  it('越狠的档位每一项预算都不松：轮数、每人次数、总次数', () => {
    const gentle = budgetOf('gentle');
    const normal = budgetOf('normal');
    const hard = budgetOf('hard');
    expect(gentle.maxRoundsPerClaim).toBeLessThan(normal.maxRoundsPerClaim);
    expect(normal.maxRoundsPerClaim).toBeLessThan(hard.maxRoundsPerClaim);
    expect(gentle.maxProbesPerInterviewerPerClaim).toBeLessThan(normal.maxProbesPerInterviewerPerClaim);
    expect(hard.maxProbesPerInterviewerPerClaim).toBeGreaterThanOrEqual(normal.maxProbesPerInterviewerPerClaim);
    expect(gentle.maxTotalProbes).toBeLessThan(normal.maxTotalProbes);
    expect(normal.maxTotalProbes).toBeLessThan(hard.maxTotalProbes);
  });

  it('关停策略三档一致：maxConsecutiveUnanswerable 是编排层的事，与问得多深无关', () => {
    const values = DIFFICULTIES.map((id) => budgetOf(id).maxConsecutiveUnanswerable);
    expect(values).toEqual([2, 2, 2]);
  });

  it('每个数字都是正整数：预算要被当成计数用，不能被当成描述', () => {
    for (const id of DIFFICULTIES) {
      const budget = budgetOf(id);
      for (const value of Object.values(budget)) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  it('只有三档字符串算数，别的都当默认档', () => {
    expect(isDifficulty('hard')).toBe(true);
    expect(isDifficulty('HARD')).toBe(false);
    expect(isDifficulty('')).toBe(false);
    expect(isDifficulty(null)).toBe(false);
    expect(isDifficulty(42)).toBe(false);
    expect(difficultyOf('gentle')).toBe('gentle');
    expect(difficultyOf('狂野')).toBe('normal');
    expect(difficultyOf(undefined)).toBe('normal');
  });

  it('档位真的进了契约：三档算出的指纹互不相同，同一档重算稳定', () => {
    const digests = DIFFICULTIES.map((id) =>
      buildContracts(['tech'], contractBudgetView(budgetOf(id)), 1)[0]!.budget,
    );
    const keys = digests.map((budget) => JSON.stringify(budget));
    expect(new Set(keys).size).toBe(DIFFICULTIES.length);
    // 收窄会把 maxConsecutiveUnanswerable 摘掉，所以只能跟三个字段的显式字面量比
    expect(contractBudgetView(budgetOf('hard'))).toEqual({
      maxRoundsPerClaim: 4,
      maxProbesPerInterviewerPerClaim: 2,
      maxTotalProbes: 80,
    });
  });

  it('给界面的那一份：顺序、名字、一句话说明、预算都对得上', () => {
    const views = difficultyViews();
    expect(views.map((item) => item.id)).toEqual([...DIFFICULTIES]);
    expect(views.map((item) => item.label)).toEqual(['温和', '常规', '挑刺']);
    for (const view of views) {
      expect(view.hint).toBe(DIFFICULTY_HINT[view.id]);
      expect(view.hint.length).toBeGreaterThan(10);
      expect(view.budget).toEqual(budgetOf(view.id));
      expect(DIFFICULTY_LABEL[view.id]).toBe(view.label);
    }
  });

  it('三档的说明各不相同：文案重复说明界面在骗人', () => {
    const hints = new Set(DIFFICULTIES.map((id) => DIFFICULTY_HINT[id]));
    expect(hints.size).toBe(DIFFICULTIES.length);
  });

  it('改档位不该改到常量本身：BUDGET_BY_DIFFICULTY 是只读来源', () => {
    expect(BUDGET_BY_DIFFICULTY.hard).toBe(budgetOf('hard'));
    expect(BUDGET_BY_DIFFICULTY.gentle.maxTotalProbes).toBe(40);
  });
});
