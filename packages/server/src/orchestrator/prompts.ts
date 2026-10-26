/**
 * 提示词渲染（创新点 3 的另一半：Intent Contract 的结构化字段在这里变成真正的提示词）。
 *
 * 两条纪律：
 * 1. **纯函数、确定性**：同样输入永远得到逐字节相同的提示词。没有时间戳、没有随机数、
 *    没有 Object.keys 的巧合顺序。这不是洁癖——卡带是按提示词指纹寻址的，
 *    提示词抖一个字节，回放就全盘失效。
 * 2. **把 JSON 契约写在提示词里**：模型输出的形状由 zod 兜底，但先要让它知道该说什么。
 *    每个阶段都在末尾重复一次输出要求，比只写一遍在 system 里可靠得多。
 *
 * 面试官的 system prompt 不在这里手写，而是由契约渲染（renderSystemPrompt），
 * 于是「改人设」= 改结构化字段，可 diff、可版本化。
 */

import type { Answer, Claim, IntentContract, Probe, ResumeOutline, Verdict } from '@crossexam/shared';
import { VERDICT_LABEL, renderSystemPrompt } from '@crossexam/shared';
import type { LlmRequest } from '../llm/types.ts';

const NL = String.fromCharCode(10);

export type StageName = 'extract' | 'probe' | 'answer' | 'verdict' | 'suggest';

/**
 * 每个阶段的采样参数。temperature 全部取 0 附近：
 * 这是一场「可复现」的比赛，评估类任务不需要创造力；
 * 需要创造力的地方是产品设计，不是让模型每次换一种说法。
 */
export const STAGE_SETTINGS: Record<StageName, { temperature: number; maxTokens: number }> = {
  extract: { temperature: 0.2, maxTokens: 2000 },
  probe: { temperature: 0.4, maxTokens: 1200 },
  answer: { temperature: 0.3, maxTokens: 800 },
  verdict: { temperature: 0.1, maxTokens: 1500 },
  suggest: { temperature: 0.3, maxTokens: 1500 },
};

export function stageRequest(stage: StageName, system: string, user: string, channel?: string): LlmRequest {
  const s = STAGE_SETTINGS[stage];
  return {
    purpose: stage,
    // 路由标识只给界面用；缺省退回阶段名（extract 阶段天然只有一路）。
    channel: channel ?? stage,
    system: system,
    messages: [{ role: 'user', content: user }],
    temperature: s.temperature,
    maxTokens: s.maxTokens,
    json: true,
  };
}

/** 简历按片段编号渲染。编号用于「这条主张出自哪一段」的定位，不是简历正文的一部分。 */
export function renderResume(outline: ResumeOutline): string {
  const lines: string[] = [];
  for (const seg of outline.segments) {
    const tag = seg.kind === 'header' ? '[小节]' : seg.kind === 'bullet' ? '[条目]' : '[段落]';
    lines.push('#' + seg.index + ' ' + tag);
    lines.push(seg.text);
    lines.push('');
  }
  return lines.join(NL).trim();
}

function fmtWeight(w: number): string {
  return w.toFixed(2);
}

/** 渲染一条主张，附带它在预算账本里的状态——让模型自己看到"还剩几次" */
export function renderClaim(claim: Claim, note?: string): string {
  const lines: string[] = [];
  lines.push('[' + claim.id + '] 类别=' + claim.category + ' 权重=' + fmtWeight(claim.weight));
  lines.push('  主张：' + claim.text);
  lines.push('  原文引文：' + claim.anchor.quote);
  if (note) lines.push('  ' + note);
  return lines.join(NL);
}

export function renderClaims(claims: readonly Claim[], notes?: Record<string, string>): string {
  return claims.map((c) => renderClaim(c, notes ? notes[c.id] : undefined)).join(NL + NL);
}

export function renderProbes(probes: readonly Probe[]): string {
  if (probes.length === 0) return '（无）';
  return probes.map((p) => '- [' + p.interviewerId + ' 第 ' + p.round + ' 轮] ' + p.question).join(NL);
}

export function renderInterview(probes: readonly Probe[], answers: readonly Answer[]): string {
  if (probes.length === 0) return '（没有追问记录）';
  const byProbe = new Map<string, Answer>();
  for (const a of answers) byProbe.set(a.probeId, a);
  const blocks: string[] = [];
  for (const p of probes) {
    const a = byProbe.get(p.id);
    const lines: string[] = [];
    lines.push('Q（' + p.interviewerId + '，第 ' + p.round + ' 轮）：' + p.question);
    if (!a) {
      lines.push('A：（尚未作答）');
    } else if (!a.text) {
      lines.push('A：（答不上来）');
    } else {
      lines.push('A：' + a.text);
      for (const cited of a.citedAnchors) lines.push('  援引原文：' + cited.quote);
    }
    blocks.push(lines.join(NL));
  }
  return blocks.join(NL + NL);
}

// ---------------------------------------------------------------- 阶段一：抽取主张

export const EXTRACT_SYSTEM = [
  '你是「主张抽取官」，服务于一场简历压力测试。',
  '',
  '你的任务：从简历里挑出**值得被面试官追问**的句子，逐条列出。',
  '',
  '## 什么值得被追问',
  '- 带数字的成果（绩效、性能、规模、比例）——数字最容易注水。',
  '- 声称"主导 / 负责 / 从 0 到 1"的地方——职责边界最容易夸大。',
  '- 技术栈与能力的断言（精通、熟悉、掌握）——最容易被追问到底。',
  '- 时间线上可能被质疑的衔接（实习与在校重叠、多段经历同时进行）。',
  '',
  '## 硬约束（由程序校验，违反的直接丢弃）',
  '1. quote 必须是简历原文中**逐字存在**的片段，长度不少于 4 个字符。',
  '2. 不要改写、不要补标点、不要拼接两处不连续的文字。不要把编号分隔行（以 # 开头的行）写进 quote。',
  '3. text 是你用一句话复述这条主张，可以改写；quote 是简历原文，必须逐字。',
  '4. 不要臆造简历里没有写的内容。',
  '5. 挑最有追问价值的，不要超过指定条数。',
  '',
  '## 输出要求（只输出一个 JSON 对象）',
  '{"claims":[{"text":"一句话复述的主张","quote":"简历原文中的逐字片段","category":"metric","weight":0.9}]}',
  'category 只能取：skill / experience / achievement / metric / ownership / timeline / other。',
  'weight 是 0 到 1 的小数，表示这条主张的追问价值。',
].join(NL);

export function buildExtractPrompt(input: {
  resumeText: string;
  outline: ResumeOutline;
  jdText: string;
  maxClaims: number;
}): string {
  const lines: string[] = [];
  lines.push('## 目标岗位 JD');
  lines.push(input.jdText.trim() || '（未提供 JD，请按通用工程师岗位判断）');
  lines.push('');
  lines.push('## 简历原文（quote 必须从下面这些行里逐字复制，不要带 # 开头的编号行）');
  lines.push(renderResume(input.outline));
  lines.push('');
  lines.push('## 本次要抽取的主张条数上限');
  lines.push(String(input.maxClaims) + ' 条。宁少勿滥：抽出一条站不住的主张，比漏掉三条更有价值。');
  return lines.join(NL);
}

// ---------------------------------------------------------------- 阶段二：追问

export function probeSystem(contract: IntentContract): string {
  const lines: string[] = [];
  lines.push(renderSystemPrompt(contract));
  lines.push('');
  lines.push('## 输出要求（只输出一个 JSON 对象）');
  lines.push('{"probes":[{"claimId":"C1","question":"一个问题","quote":"简历原文中的逐字片段","rationale":"为什么问这个"}]}');
  lines.push('claimId 必须是下方列表里出现过的编号；quote 必须逐字来自简历原文。');
  lines.push('如果这一轮你认为没有值得问的，返回 {"probes":[]} —— 空手而归是允许的，编一个问题不是。');
  return lines.join(NL);
}

export function buildProbePrompt(input: {
  claims: readonly Claim[];
  notes: Record<string, string>;
  resumeText: string;
  outline: ResumeOutline;
  asked: readonly Probe[];
  round: number;
  maxProbes: number;
}): string {
  const lines: string[] = [];
  lines.push('## 本轮是第 ' + input.round + ' 轮追问');
  lines.push('## 你可以追问的主张（只从这些里选，不要新造主张）');
  lines.push(renderClaims(input.claims, input.notes));
  lines.push('');
  lines.push('## 你此前问过的问题（不要重复，也不要换句话问同一个点）');
  lines.push(renderProbes(input.asked));
  lines.push('');
  lines.push('## 简历原文（quote 必须从这里逐字复制，不要带 # 开头的编号行）');
  lines.push(renderResume(input.outline));
  lines.push('');
  lines.push('## 本轮最多问 ' + String(input.maxProbes) + ' 条');
  lines.push('挑你最想问的去问。如果确实没有值得问的，返回空数组——凑数的提问比空手而归更糟。');
  return lines.join(NL);
}

// ---------------------------------------------------------------- 阶段三：作答（求职者 Agent）

export const ANSWER_SYSTEM = [
  '你正在扮演这份简历的主人，坐在面试现场回答问题。',
  '',
  '## 铁律',
  '1. **只依据简历原文作答**。简历里写了什么，你就说什么；简历里没写的，你也不知道。',
  '2. 如果简历不足以回答问题，就回答 {"answered":false,...}，并在 text 里说明"简历里没有写"。',
  '   **答不上来是被鼓励的诚实行为，不是失败。** 编一个听上去合理的答案，才是这场测试要抓的东西。',
  '3. 需要引用简历时，把原文片段放进 citedQuotes，必须逐字复制。',
  '4. text 用第一人称、口语化，像真人面试那样回答，不要写成小作文。',
  '',
  '## 输出要求（只输出一个 JSON 对象）',
  '{"answered":true,"text":"你的回答","citedQuotes":["简历原文片段"]}',
].join(NL);

export function buildAnswerPrompt(input: {
  claim: Claim;
  probe: Probe;
  resumeText: string;
  outline: ResumeOutline;
  history: readonly Probe[];
}): string {
  const lines: string[] = [];
  lines.push('## 面试官的问题');
  lines.push(input.probe.question);
  lines.push('（这个问题针对简历里的这条主张：' + input.claim.text + '）');
  lines.push('');
  lines.push('## 本轮其他面试官问过的问题（保持口径一致，不要自相矛盾）');
  lines.push(renderProbes(input.history));
  lines.push('');
  lines.push('## 你的简历原文');
  lines.push(renderResume(input.outline));
  return lines.join(NL);
}

// ---------------------------------------------------------------- 阶段四：判定

export const VERDICT_SYSTEM = [
  '你是「复盘官」，负责判定一条简历主张在刚才那场追问里到底站不站得住。',
  '',
  '## 判定口径',
  '- solid（站得住）：简历原文本身提供了具体、可核验的信息，回答也没有前后矛盾。',
  '- overstated（表述过度）：有事实底子，但用词超出了原文能支撑的程度（例如"精通"只对应课程作业）。',
  '- unsupported（证据缺失）：简历只有结论、没有过程或口径，回答也补不上（例如只写了数字，说不出怎么测的）。',
  '- contradicts（与原文矛盾）：回答与简历原文、或与此前回答互相冲突。',
  '- unanswerable（无法回答）：连续追问后仍无法给出任何有效信息。',
  '',
  '## 纪律',
  '1. 判定必须落在**证据**上，不能凭语气好不好、回答长不长。',
  '2. evidenceQuotes 必须是简历原文或候选人回答里的逐字片段，用来支撑你的判定。',
  '3. 答不上来不等于说谎：如果简历本来就写得含糊，主要责任在简历表述，判定应为 unsupported 而不是 contradicts。',
  '4. confidence 是你对这个判定的把握，0 到 1。',
  '',
  '## 输出要求（只输出一个 JSON 对象）',
  '{"kind":"unsupported","confidence":0.7,"rationale":"判定理由","evidenceQuotes":["逐字片段"]}',
  'kind 只能取：' + Object.keys(VERDICT_LABEL).join(' / ') + '。',
].join(NL);

export function buildVerdictPrompt(input: {
  claim: Claim;
  probes: readonly Probe[];
  answers: readonly Answer[];
  resumeText: string;
  outline: ResumeOutline;
}): string {
  const lines: string[] = [];
  lines.push('## 待判定主张');
  lines.push(renderClaim(input.claim));
  lines.push('');
  lines.push('## 这场追问的全部问答');
  lines.push(renderInterview(input.probes, input.answers));
  lines.push('');
  lines.push('## 简历原文');
  lines.push(renderResume(input.outline));
  return lines.join(NL);
}

// ---------------------------------------------------------------- 阶段五：反推修改建议

export const SUGGEST_SYSTEM = [
  '你是「简历教练」。刚才的压力测试发现了一条站不住的主张，现在你要反推出**简历应该怎么改**。',
  '',
  '## 铁律',
  '1. **只能改表述，不能加事实。** 你的 after 里不允许出现简历原文中没有任何依据的新经历、新数字、新头衔。',
  '2. before 必须是简历原文里的逐字片段（就是被质疑的那一段）。',
  '3. after 是改写后的版本。允许的做法：补上口径、限定范围、把"精通"降级为"熟悉"、把"主导"改成实际职责、删掉无法支撑的形容词。',
  '4. why 要说明"面试官会从哪里问穿它"，让用户理解为什么这样改，而不是照抄一遍。',
  '5. 如果这条主张其实不该保留，after 可以是一句更保守但真实的表述。不要为了好看而夸大。',
  '',
  '## 输出要求（只输出一个 JSON 对象）',
  '{"problem":"这段表述的问题","before":"简历原文逐字片段","after":"建议改成","why":"为什么这样改"}',
].join(NL);

export function buildSuggestPrompt(input: {
  claim: Claim;
  verdict: Verdict;
  probes: readonly Probe[];
  answers: readonly Answer[];
}): string {
  const lines: string[] = [];
  lines.push('## 被质疑的主张');
  lines.push(renderClaim(input.claim));
  lines.push('');
  lines.push('## 复盘结论');
  lines.push('判定：' + VERDICT_LABEL[input.verdict.kind] + '（把握 ' + input.verdict.confidence.toFixed(2) + '）');
  lines.push('理由：' + input.verdict.rationale);
  lines.push('');
  lines.push('## 追问过程（用户能看到的就是这些）');
  lines.push(renderInterview(input.probes, input.answers));
  return lines.join(NL);
}
