/**
 * 阵容解析：把「页面上勾选的面试官」变成一份可以开跑的契约列表。
 *
 * 关键取舍：阵容的元素是**契约 id**，不是角色枚举。
 * 预设面试官的 id 恰好就是角色名（tech / hr / ...），自定义面试官是 custom-xxx，
 * 两者在同一个命名空间里，于是「混编阵容」不需要任何分支：
 * 循环里对每个 id 问一句「这是预设还是库里的」就够了。
 *
 * 解析失败（库里的 id 没了）**不静默跳过**：少一位面试官而界面显示五位，
 * 是最难查的一类问题。调用方拿到 missing 必须拒绝开跑并说明是哪一位。
 */

import { buildContracts } from '@crossexam/shared';
import type { BudgetConfig, ContractBudgetView, IntentContract, InterviewerRole } from '@crossexam/shared';
import { getInterviewer } from '../store/index.ts';
import type { Db } from '../store/index.ts';
import { DEFAULT_PANEL } from './run.ts';

/** 五位预设面试官。顺序就是界面上「面试组阵容」的默认顺序。 */
export const PRESET_ROLES: readonly InterviewerRole[] = [
  'tech',
  'hr',
  'hiring_manager',
  'stress',
  'domain_expert',
];

export function isPresetRole(id: string): id is InterviewerRole {
  return (PRESET_ROLES as readonly string[]).indexOf(id) >= 0;
}

/**
 * 预算账本里有四个字段，契约里只声明三个。
 * maxConsecutiveUnanswerable 是**编排层**关停主张的策略，不是面试官可以据以行动的规则，
 * 所以它不进契约——契约要能被面试官读到并遵守，读不到的字段写进去只是噪音。
 */
export function budgetView(config: BudgetConfig): ContractBudgetView {
  return {
    maxRoundsPerClaim: config.maxRoundsPerClaim,
    maxProbesPerInterviewerPerClaim: config.maxProbesPerInterviewerPerClaim,
    maxTotalProbes: config.maxTotalProbes,
  };
}

/** 去重 + 去空 + 兜底默认阵容。重复的 id 会让同一张配额被算两次，必须在这里挡掉。 */
export function normalizePanelIds(ids: readonly string[] | undefined, limit?: number): string[] {
  const out: string[] = [];
  for (const raw of ids ?? []) {
    const id = raw.trim();
    if (id === '' || out.indexOf(id) >= 0) continue;
    out.push(id);
  }
  const panel = out.length > 0 ? out : [...DEFAULT_PANEL];
  if (limit === undefined || panel.length <= limit) return panel;
  return panel.slice(0, limit);
}

export interface ResolvedPanel {
  /** 真正会上场的 id，顺序与请求一致且已去重 */
  ids: string[];
  contracts: IntentContract[];
  /** 这一场里用户自己配的面试官 */
  customIds: string[];
  /** 库里查不到的 id：调用方必须拒绝，而不是少一位继续跑 */
  missing: string[];
}

/**
 * 预设契约只依赖角色与预算，不需要数据库——所以页面在开跑之前就能预览它们。
 * 自定义契约必须查库：契约全文在库里，重算不出来（用户可能已经改过、也删过）。
 */
export function resolvePanel(db: Db, ids: readonly string[], budget: BudgetConfig): ResolvedPanel {
  // 契约里的预算只有三个字段：maxConsecutiveUnanswerable 是编排层关停策略，
  // 面试官读不到。这里必须收窄，否则同一场沙盘在「运行」与「对账」两处算出不同指纹。
  const presetContracts = buildContracts(ids.filter(isPresetRole), budgetView(budget), 1);
  const byId = new Map<string, IntentContract>();
  for (const contract of presetContracts) byId.set(contract.id, contract);

  const missing: string[] = [];
  const customIds: string[] = [];
  for (const id of ids) {
    if (isPresetRole(id) || byId.has(id)) continue;
    const row = getInterviewer(db, id);
    if (row === null) {
      missing.push(id);
      continue;
    }
    // 预算以**这一场**的配置为准：库里留的是保存那一刻的预算，那是历史值。
    // 但 persona / goal / tactics 一个字都不改——那才是用户配的东西。
    byId.set(id, { ...row.contract, budget: budgetView(budget) });
    customIds.push(id);
  }

  const contracts: IntentContract[] = [];
  for (const id of ids) {
    const contract = byId.get(id);
    if (contract !== undefined) contracts.push(contract);
  }
  return { ids: contracts.map((contract) => contract.id), contracts, customIds, missing };
}

/** 只要预设契约的便捷入口（不碰数据库），界面预览与测试都走它。 */
export function presetContracts(ids: readonly string[], budget: ContractBudgetView): IntentContract[] {
  return buildContracts(ids.filter(isPresetRole), budget, 1);
}
