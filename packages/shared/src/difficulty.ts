/**
 * 追问强度（档位）：同一套编排，三种预算。
 *
 * 为什么要有它：预算写死在代码里时，用户能调的只有「问谁」，调不了「问多深」。
 * 但「问多深」恰恰是使用者最清楚的事——一份还没底气的简历想先看整体画像，
 * 一次模拟大厂终面则想有人往死里问。档位把这份判断交回给使用者，
 * 同时**不放弃预算的强制语义**：每一档仍然是一组确定的数字，落进契约、写进指纹、
 * 跑完之后可以和落库的那一份对账。
 *
 * 三档刻意只有预算不同——人设、手法、禁止项一个字都不改。
 * 这样「同一位面试官、同一份简历，只是问得更狠」才是可比的变量。
 */

import { DEFAULT_BUDGET } from './budget.ts';
import type { BudgetConfig } from './budget.ts';

export const DIFFICULTIES = ['gentle', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DEFAULT_DIFFICULTY: Difficulty = 'normal';

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  gentle: '温和',
  normal: '常规',
  hard: '挑刺',
};

/** 一句话说清这一档会变成什么样：界面直接显示这一句，不另写文案 */
export const DIFFICULTY_HINT: Record<Difficulty, string> = {
  gentle: '每人对一条主张只问 1 次、最多 2 轮：先看整体画像，适合还没怎么准备过的简历。',
  normal: '每人最多 2 次、最多 3 轮：默认档，仓库里那批演示卡带录的就是这一档。',
  hard: '最多 4 轮、全场 80 次：问题会明显变多，适合模拟压力面试。',
};

/**
 * 三档预算。maxConsecutiveUnanswerable 三档都是 2：
 * 它是编排层的关停策略，不属于「问得多深」，也不进契约。
 */
export const BUDGET_BY_DIFFICULTY: Record<Difficulty, BudgetConfig> = {
  gentle: { maxRoundsPerClaim: 2, maxProbesPerInterviewerPerClaim: 1, maxTotalProbes: 40, maxConsecutiveUnanswerable: 2 },
  normal: DEFAULT_BUDGET,
  hard: { maxRoundsPerClaim: 4, maxProbesPerInterviewerPerClaim: 2, maxTotalProbes: 80, maxConsecutiveUnanswerable: 2 },
};

export function isDifficulty(raw: unknown): raw is Difficulty {
  return typeof raw === 'string' && (DIFFICULTIES as readonly string[]).indexOf(raw) >= 0;
}

/**
 * 认不出就当默认档：档位是「没填也应该能跑」的输入。
 * 让老请求（以及没带这个字段的脚本）整条路走不通，代价远大于收益。
 */
export function difficultyOf(raw: unknown): Difficulty {
  return isDifficulty(raw) ? raw : DEFAULT_DIFFICULTY;
}

export function budgetOf(difficulty: Difficulty): BudgetConfig {
  return BUDGET_BY_DIFFICULTY[difficulty];
}

export interface DifficultyView {
  id: Difficulty;
  label: string;
  hint: string;
  budget: BudgetConfig;
}

/** 给界面的那一份：编号、名字、一句话说明、四个数字。顺序就是 DIFFICULTIES。 */
export function difficultyViews(): DifficultyView[] {
  return DIFFICULTIES.map((id) => ({ id, label: DIFFICULTY_LABEL[id], hint: DIFFICULTY_HINT[id], budget: budgetOf(id) }));
}
