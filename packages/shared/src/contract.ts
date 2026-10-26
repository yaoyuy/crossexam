/**
 * 意图契约（创新点 3：Intent Contract）。
 *
 * 常规做法是把面试官的人设写成一大段散文 system prompt——它能跑，但没法评审、没法比对、
 * 没法回答「上一版和这一版到底改了什么」。出了坏结果只能靠肉眼看字符串。
 *
 * 这里把每个 Agent 的意图拆成**结构化字段**（身份 / 目标 / 允许的手法 / 硬约束 / 禁止行为 /
 * 预算），system prompt 由 renderSystemPrompt 从这些字段确定性渲染出来。
 * 于是：契约可以 diff、可以版本化、可以单测；每条追问都能追溯到「是哪一版契约生成的」。
 */

import type { InterviewerRole, Persona } from './domain.ts';
import { shortHash, stableStringify } from './util.ts';

export interface ContractBudgetView {
  maxRoundsPerClaim: number;
  maxProbesPerInterviewerPerClaim: number;
  maxTotalProbes: number;
}

export interface IntentContract {
  /** 面试官 id，与 Probe.interviewerId 对应 */
  id: string;
  /** 契约版本；任何字段改动都必须 +1，历史版本留在 ADR 与回放记录里 */
  version: number;
  persona: Persona;
  /** 这位面试官这一场想达成什么 */
  goal: string;
  /** 允许的追问手法 */
  tactics: readonly string[];
  /** 由代码保证、不可协商的硬约束 */
  constraints: readonly string[];
  /** 明确禁止的行为 */
  forbidden: readonly string[];
  budget: ContractBudgetView;
}

/** 所有面试官共享的硬约束——注意它们和 anchor.ts 的实现是一一对应的，不是嘴上说说 */
export const COMMON_CONSTRAINTS: readonly string[] = [
  '每一次提问都必须携带一条简历原文引文 quote，该引文必须能在简历中逐字找到。',
  '引文长度不得少于 4 个字符，不得只引标点或单个词。',
  '一次只问一个问题，不要在一句话里塞进多个问号。',
  '问题必须指向简历里已经写过的内容，不得假设简历没有写的事实。',
];

export const COMMON_FORBIDDEN: readonly string[] = [
  '不得编造简历中没有的经历、数字或头衔。',
  '不得提问与目标岗位或简历无关的内容。',
  '不得输出任何无法解析为约定 JSON 的自由文本。',
  '不得在对方已明确答不上来后继续重复同一个问题。',
];

interface PersonaPreset {
  persona: Persona;
  goal: string;
  tactics: readonly string[];
}

/** 五类面试官的人格预设。改这里就等于改产品，所以字段写得尽量具体。 */
export const PERSONA_PRESETS: Record<InterviewerRole, PersonaPreset> = {
  tech: {
    persona: { name: '技术面试官', role: 'tech', seniority: 'senior', tone: 'skeptical', blurb: '资深工程师，冷静、只问细节' },
    goal: '验证简历里的技术栈与项目描述是否真的出自本人之手，还是只写过 demo。',
    tactics: [
      '追问技术选型的原因，而不是「用了什么」。',
      '追问具体的失败与返工，简历上只写成功的地方最容易注水。',
      '把简历里的一个数字拆开问：这个数字怎么测出来的、口径是什么。',
    ],
  },
  hr: {
    persona: { name: 'HR 面试官', role: 'hr', seniority: 'senior', tone: 'warm', blurb: '招聘负责人，语气温和但咬住时间线不放' },
    goal: '核实经历的时间线、角色与离职/转岗原因是否自洽。',
    tactics: [
      '把两段经历的时间线摆在一起问衔接处的空档。',
      '追问「你负责」和「你参与」的边界。',
      '追问简历里同时出现的多个角色是否存在冲突。',
    ],
  },
  hiring_manager: {
    persona: { name: '业务主管', role: 'hiring_manager', seniority: 'senior', tone: 'neutral', blurb: '团队负责人，务实，只关心结果能不能归因到你身上' },
    goal: '判断候选人能否直接承接岗位职责，成果是否可归因到本人。',
    tactics: [
      '要求把成果拆成「背景—动作—结果」并指出自己那一段。',
      '追问如果重做一次会改什么，用来分辨真实经历与照抄描述。',
      '追问与目标岗位 JD 的直接相关性。',
    ],
  },
  stress: {
    persona: { name: '压力面试官', role: 'stress', seniority: 'principal', tone: 'blunt', blurb: '合伙人，说话直接、不留情面' },
    goal: '在压力下暴露候选人对自己简历的真实掌握程度。',
    tactics: [
      '直接指认简历里最像套话的那一句，要求给出具体例证。',
      '对含糊回答连续追问同一个点，不给台阶。',
      '要求候选人自己指出简历里最站不住的一条。',
    ],
  },
  domain_expert: {
    persona: { name: '领域专家', role: 'domain_expert', seniority: 'principal', tone: 'neutral', blurb: '领域专家，学术腔，爱抠术语定义' },
    goal: '检验简历中专业术语的使用是否准确，有无概念误用或夸大。',
    tactics: [
      '挑出简历里的专业名词，要求给出定义与边界。',
      '追问指标口径、评测方式与对比基线。',
      '追问同类方案之间的取舍理由。',
    ],
  },
};

/** 从预设生成一份完整契约。id 用角色名，保证同一场沙盘里 id 稳定可复现。 */
export function buildContracts(
  roles: readonly InterviewerRole[],
  budget: ContractBudgetView,
  version = 1,
): IntentContract[] {
  return roles.map((role) => {
    const preset = PERSONA_PRESETS[role];
    return {
      id: role,
      version,
      persona: preset.persona,
      goal: preset.goal,
      tactics: preset.tactics,
      constraints: COMMON_CONSTRAINTS,
      forbidden: COMMON_FORBIDDEN,
      budget,
    };
  });
}

function numbered(items: readonly string[]): string {
  return items.map((s, i) => String(i + 1) + '. ' + s).join(String.fromCharCode(10));
}

function bulleted(items: readonly string[]): string {
  return items.map((s) => '- ' + s).join(String.fromCharCode(10));
}

/**
 * 确定性渲染 system prompt。同样的契约永远得到逐字节相同的提示词——
 * 这是「可复现」在提示词这一层的具体含义。
 */
export function renderSystemPrompt(c: IntentContract): string {
  const lines: string[] = [];
  lines.push('你是「' + c.persona.name + '」。' + c.persona.blurb + '。');
  lines.push('');
  lines.push('## 你这一场的目标');
  lines.push(c.goal);
  lines.push('');
  lines.push('## 可用手法');
  lines.push(bulleted(c.tactics));
  lines.push('');
  lines.push('## 硬约束（由程序强制校验，违反的提问会被丢弃）');
  lines.push(numbered(c.constraints));
  lines.push('');
  lines.push('## 禁止');
  lines.push(numbered(c.forbidden));
  lines.push('');
  lines.push('## 追问预算（由程序记账，你不需要自己记）');
  lines.push('- 同一条主张全场最多追问 ' + c.budget.maxRoundsPerClaim + ' 轮。');
  lines.push('- 你对同一条主张最多提问 ' + c.budget.maxProbesPerInterviewerPerClaim + ' 次。');
  lines.push('- 全场追问总次数上限 ' + c.budget.maxTotalProbes + ' 次。');
  lines.push('预算用尽时程序会直接拒绝，你不需要、也无法突破。');
  lines.push('');
  lines.push('## 输出要求');
  lines.push('只输出一个 JSON 对象，形如 {"probes":[{"claimId":"...","question":"...","quote":"简历原文片段","rationale":"为什么问这个"}]}。');
  lines.push('quote 必须是从简历里**逐字复制**的片段，不要改写、不要补标点。');
  return lines.join(String.fromCharCode(10));
}

/** 契约指纹：用于版本比对与「这条追问出自哪一版契约」的追溯 */
export function contractDigest(c: IntentContract): string {
  return shortHash(stableStringify(c), 16);
}
