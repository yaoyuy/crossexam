/**
 * 意图契约的展示层：把结构化契约摊成人能读的几行，并说清指纹对账的结果。
 *
 * 契约本身是数据，不是文案——所以这里只做「数据到句子」的确定性转换，
 * 便于测试盯着；真正防漂移的是服务端算出来的 digest。
 */

import type { ContractView, InterviewerRole } from './api.ts';

export interface ContractLine {
  label: string;
  value: string;
}

/** 预算那三条数字在界面上必须和服务端渲染进 prompt 的数字是同一组，所以只有这一个来源 */
export function budgetText(view: ContractView): string {
  const budget = view.contract.budget;
  return (
    '每主张最多 ' +
    String(budget.maxRoundsPerClaim) +
    ' 轮追问 · 每人每主张最多 ' +
    String(budget.maxProbesPerInterviewerPerClaim) +
    ' 次 · 全场最多 ' +
    String(budget.maxTotalProbes) +
    ' 次'
  );
}

/** 契约摊开的几行；顺序固定，界面照抄即可 */
export function contractLines(view: ContractView): ContractLine[] {
  const contract = view.contract;
  const persona = contract.persona;
  return [
    { label: '人设', value: persona.name + ' · ' + persona.seniority + ' · ' + persona.tone },
    { label: '目标', value: contract.goal },
    { label: '手法', value: contract.tactics.join('；') },
    { label: '禁区', value: contract.forbidden.join('；') },
    { label: '共同约束', value: contract.constraints.join('；') },
    { label: '追问预算', value: budgetText(view) },
  ];
}

/** 指纹是 16 位十六进制，界面上只露前 8 位，够人对账又不喧宾夺主 */
export function digestText(digest: string): string {
  return digest.length <= 8 ? digest : digest.slice(0, 8);
}

export type ConsistencyTone = 'pending' | 'ok' | 'drift';

export interface ConsistencyNote {
  tone: ConsistencyTone;
  text: string;
}

/**
 * 三种状态必须区分开，否则「对账」就成了装饰：
 *   pending —— 还没跑过这场沙盘，没有可对账的指纹；
 *   ok      —— 指纹与版本都与运行时一致；
 *   drift   —— 代码里的契约被人改过，界面必须显式告警。
 */
export function consistencyNote(view: ContractView): ConsistencyNote {
  const now = digestText(view.digest);
  if (view.storedDigest === null) {
    return { tone: 'pending', text: '尚未开跑 · 当前指纹 ' + now };
  }
  if (view.verified) {
    return { tone: 'ok', text: '与运行时一致 · 指纹 ' + now };
  }
  return {
    tone: 'drift',
    text: '契约已漂移 · 运行时 ' + digestText(view.storedDigest) + ' → 现在 ' + now,
  };
}

/**
 * 面试官面板的规范顺序。
 *
 * 增删面试官时如果直接往数组尾巴上追加，面板就会变成点击顺序：先把「压力面试官」加进来、
 * 再删掉，或者先删后加，就会得到 [技术, 业务主管, HR] 这种顺序。而追问编号（P1、P2…）、
 * 契约条数、以及送进模型的那份提示词都是按面板顺序生成的——顺序一变，回放模式下按提示词
 * 指纹寻址的卡带就全部对不上，本来能离线跑通的演示会报「找不到记录」。
 * 所以面板顺序一律按这个枚举重排，与点击历史无关。
 */
export const PANEL_ORDER: InterviewerRole[] = ['tech', 'hr', 'hiring_manager', 'stress', 'domain_expert'];

/** 增删一位面试官，并按 PANEL_ORDER 归一化顺序（理由见上） */
export function nextPanel(current: readonly InterviewerRole[], role: InterviewerRole): InterviewerRole[] {
  const picked = current.includes(role) ? current.filter((item) => item !== role) : [...current, role];
  return PANEL_ORDER.filter((item) => picked.includes(item));
}
