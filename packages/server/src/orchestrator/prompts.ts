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

import type {
  Answer,
  Claim,
  ExtractedRequirement,
  IntentContract,
  JobDescription,
  Probe,
  Requirement,
  RequirementNote,
  ResumeOutline,
  Verdict,
  VerdictKind,
} from '@crossexam/shared';
import { REQUIREMENT_KIND_LABEL, VERDICT_LABEL, renderSystemPrompt } from '@crossexam/shared';
import type { LlmRequest } from '../llm/types.ts';

const NL = String.fromCharCode(10);

export type StageName =
  | 'extract'
  | 'jd-extract'
  | 'jd-merge'
  | 'jd-match'
  | 'probe'
  | 'answer'
  | 'verdict'
  | 'suggest'
  | 'counter'
  | 'contract';

/**
 * 每个阶段的采样参数。temperature 全部取 0 附近：
 * 这是一场「可复现」的比赛，评估类任务不需要创造力；
 * 需要创造力的地方是产品设计，不是让模型每次换一种说法。
 */
export const STAGE_SETTINGS: Record<StageName, { temperature: number; maxTokens: number }> = {
  extract: { temperature: 0.2, maxTokens: 2000 },
  // 岗位要求三阶段：抽取与归并都是「把话说明白」，对照是判断题，温度一律压到 0 附近。
  'jd-extract': { temperature: 0.2, maxTokens: 1600 },
  'jd-merge': { temperature: 0.1, maxTokens: 1600 },
  'jd-match': { temperature: 0.1, maxTokens: 2200 },
  probe: { temperature: 0.4, maxTokens: 1200 },
  answer: { temperature: 0.3, maxTokens: 800 },
  verdict: { temperature: 0.1, maxTokens: 1500 },
  suggest: { temperature: 0.3, maxTokens: 1500 },
  // 反问阶段：要问得像一个真在考虑去不去的人，温度比判定类高一点，但仍然只依据材料。
  counter: { temperature: 0.5, maxTokens: 2200 },
  // 设计师阶段：输出结构比文采重要，温度同样压到 0 附近。
  contract: { temperature: 0.2, maxTokens: 1200 },
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

/**
 * 渲染「岗位要求 → 简历主张」这张对照表里对得上的几条。
 * missing 的要求不出现在这里：它们是给人看的缺口清单，不是用来编问题的素材。
 */
export function renderRequirementNotes(notes: readonly RequirementNote[]): string {
  if (notes.length === 0) return '（这次没有可对照的岗位要求，忽略这一节）';
  return notes
    .map(
      (note) =>
        '- [' +
        note.id +
        '] ' +
        note.label +
        '（对应主张 ' +
        (note.claimId ?? '?') +
        '，来自《' +
        note.jdTitle +
        '》）：' +
        note.text +
        NL +
        '  要求原文：' +
        note.jdQuote,
    )
    .join(NL);
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

// ---------------------------------------------------------------- 阶段一之二：岗位要求
//
// 多份 JD 走三次调用：逐份抽取 → 跨份归并 → 与主张逐条对照。
// 三次都不引入新机制：抽取沿用「不信模型给的坐标、只信逐字引文」的锚定，
// 归并只做集合运算（谁并进了谁由代码判定），对照的产物是一张「要求 → 主张」的表。
// 这张表只有一个用途：让追问能同时锚住简历原文与岗位要求原文（双锚点）。
// missing 的要求不生成任何追问——它是给人看的缺口清单，不是编问题的素材。

export const JD_EXTRACT_SYSTEM = [
  '你是「岗位要求抽取官」。给你一份招聘 JD，你要挑出**能被拿去检验简历**的要求，逐条列出。',
  '',
  '## 什么算一条要求',
  '- 硬性要求（must）：学历、年限、证书、必须掌握的工具或技能。',
  '- 加分项（plus）：优先考虑、有则更好、某类经验加分。',
  '- 岗位职责（duty）：入职后要负责的具体工作——它同样可以拿来问「你做过吗」。',
  '',
  '## 硬约束（由程序校验，违反的直接丢弃）',
  '1. quote 必须是 JD 原文中**逐字存在**的片段，不少于 4 个字符。不要改写、不要补标点、不要拼接两处不连续的文字。',
  '2. text 是你用一句话复述这条要求，可以改写。',
  '3. 一条要求只写一件事：「熟悉 Node.js 与 TypeScript」与「有高并发经验」要拆成两条。',
  '4. 不要臆造 JD 里没有的要求；公司福利、薪资、办公地点、招聘流程都不算要求。',
  '5. 挑最能用来检验简历的那些，条数不超过指定上限。',
  '',
  '## 输出要求（只输出一个 JSON 对象）',
  '{"requirements":[{"text":"一句话复述的要求","quote":"JD 原文中的逐字片段","kind":"must","keywords":["关键字"]}]}',
  'kind 只能取：must / plus / duty。keywords 最多 6 个，写这条要求里最该被追问的点。',
].join(NL);

export function buildJdExtractPrompt(input: { jd: JobDescription; maxRequirements: number }): string {
  const lines: string[] = [];
  lines.push('## 第 ' + String(input.jd.ordinal) + ' 份 JD：' + input.jd.title);
  lines.push('## JD 原文（quote 必须从下面这些行里逐字复制）');
  lines.push(input.jd.text);
  lines.push('');
  lines.push('## 本次最多抽 ' + String(input.maxRequirements) + ' 条');
  return lines.join(NL);
}

export const JD_MERGE_SYSTEM = [
  '你是「岗位要求归并官」。你会看到从若干份 JD 里分别抽出来的要求，每条都带一个编号（形如 J1#3）。',
  '',
  '## 你的任务',
  '把**说的是同一件事**的要求并成一组，其余的各自单独成组。',
  '',
  '## 纪律',
  '1. members 只能填下方出现过的编号，不要新造编号；一条编号最多出现在一个组里。',
  '2. 同一个意思换了个说法（「熟悉 TypeScript」与「熟练掌握 TypeScript」）应当并成一组；',
  '   只是同属一个行业但要求不同的（「会写 SQL」与「会做数据看板」）不要并。',
  '3. 每组给一句 text 概括这条要求的**最严口径**：两份 JD 一个写 3 年、一个写 5 年，就写 5 年。',
  '4. kind 取组内最强的那个：只要有 must 就写 must；全是 duty 才写 duty。',
  '5. 没有把握并的时候不要硬并——并错一条比多留一条更糟。',
  '6. **不要漏掉任何编号**：列完每一组之后回头检查一遍，还有哪些编号没被任何组收进去。',
  '',
  '## 输出要求（只输出一个 JSON 对象）',
  '{"groups":[{"text":"概括后的要求","kind":"must","members":["J1#1","J2#2"],"keywords":["关键字"]}]}',
].join(NL);

export function buildJdMergePrompt(items: readonly ExtractedRequirement[]): string {
  const lines: string[] = [];
  const jdIds: string[] = [];
  for (const item of items) if (!jdIds.includes(item.jdId)) jdIds.push(item.jdId);
  lines.push('## 从 ' + String(jdIds.length) + ' 份 JD 里抽出来的要求（共 ' + String(items.length) + ' 条）');
  for (const item of items) {
    lines.push(
      '- [' +
        item.key +
        '] ' +
        REQUIREMENT_KIND_LABEL[item.kind] +
        '：' +
        item.text +
        NL +
        '  原文：' +
        item.quote,
    );
  }
  return lines.join(NL);
}

export const JD_MATCH_SYSTEM = [
  '你是「岗位要求对照官」。你要逐条判断：这份简历里有没有能对上某条岗位要求的内容。',
  '',
  '## 三种状态',
  '- hit：简历写清楚了，能直接对上这条要求（技能、年限、项目、证书）。',
  '- weak：沾边但不硬——只提了名字没有深度、只有课程培训没有实战、只写了「参与」。',
  '- missing：简历里根本没写这类内容。**这是最有价值的信息，不要为了凑 hit 而硬对。**',
  '',
  '## 纪律',
  '1. claimId 必须从下面列出的主张编号里选；对不上就写 null，不要硬凑一条主张。',
  '2. status 是 hit 或 weak 时必须给出 claimId；是 missing 时 claimId 必须是 null。',
  '3. reason 一句话说清依据（简历哪句话对上了，或者缺了什么），最多 300 字。',
  '4. 每一条要求都要出现一次，不多不少。',
  '',
  '## 输出要求（只输出一个 JSON 对象）',
  '{"matches":[{"requirementId":"R1","claimId":"C3","status":"hit","reason":"简历写了三年 Node.js 经验"}]}',
].join(NL);

export function buildJdMatchPrompt(input: {
  requirements: readonly Requirement[];
  claims: readonly Claim[];
}): string {
  const lines: string[] = [];
  lines.push('## 岗位要求（每一条都要对照一次，方括号里的就是 requirementId）');
  for (const requirement of input.requirements) {
    lines.push(
      '- [' +
        requirement.id +
        '] ' +
        REQUIREMENT_KIND_LABEL[requirement.kind] +
        '：' +
        requirement.text +
        NL +
        '  要求原文：' +
        requirement.anchor.quote,
    );
  }
  lines.push('');
  lines.push('## 这份简历里可以被引用的主张（claimId 只能从这里选）');
  lines.push(renderClaims(input.claims));
  return lines.join(NL);
}

// ---------------------------------------------------------------- 阶段二：追问

export function probeSystem(contract: IntentContract): string {
  const lines: string[] = [];
  lines.push(renderSystemPrompt(contract));
  lines.push('');
  lines.push('## 输出要求（只输出一个 JSON 对象）');
  lines.push(
    '{"probes":[{"claimId":"C1","question":"一个问题","quote":"简历原文中的逐字片段","rationale":"为什么问这个"}]}',
  );
  lines.push('claimId 必须是下方列表里出现过的编号；quote 必须逐字来自简历原文。');
  lines.push(
    '如果这次追问正好在追「岗位要求里对得上的几条」里的一条，就再带上 requirementId（要求编号）与 jdQuote（该要求的原文片段，逐字）。两个要么都给，要么都不给。',
  );
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
  /** 岗位要求与主张对得上的那几条：追问它们时可以带上双锚点 */
  requirements?: readonly RequirementNote[];
}): string {
  const lines: string[] = [];
  lines.push('## 本轮是第 ' + input.round + ' 轮追问');
  lines.push('## 你可以追问的主张（只从这些里选，不要新造主张）');
  lines.push(renderClaims(input.claims, input.notes));
  lines.push('');
  lines.push('## 岗位要求里对得上的几条');
  lines.push(renderRequirementNotes(input.requirements ?? []));
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
  '- unsupported（证据缺失）：简历只有结论、没有过程或口径，追问也没问出口径（例如只写了数字，说不出怎么测的）。**责任在简历写法**，改法是把这句话写具体。',
  '- contradicts（与原文矛盾）：回答与简历原文、或与此前回答互相冲突。',
  '- unanswerable（无法回答）：候选人本人在追问中承认拿不出东西（不记得、举不出例子、没做过），简历里也找不到可核验的依据。**责任在候选人**，是风险最高的一类。',
  '',
  '## 纪律',
  '1. 判定必须落在**证据**上，不能凭语气好不好、回答长不长。',
  '2. evidenceQuotes 必须是简历原文或候选人回答里的逐字片段，用来支撑你的判定。',
  '3. 答不上来不等于说谎：如果简历本来就写得含糊，主要责任在简历表述，判定应为 unsupported 而不是 contradicts。',
  '4. 区分 unsupported 与 unanswerable：候选人说"简历里没写"是 unsupported（简历的错，改简历就行）；候选人说"我不会""我举不出例子"才是 unanswerable（人的错，要么补真实经历要么删掉这条）。拿不准时判 unsupported。',
  '5. confidence 是你对这个判定的把握，0 到 1。',
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

// ---------------------------------------------------------------- 阶段六：设计面试官（用户自定义）
//
// 这一阶段的产物**不是**这一场沙盘的一部分：它把用户的一句人话变成一份可评审的契约草稿，
// 之后这位面试官可以出现在任何一场沙盘里。所以它的提示词写的不是「怎么问简历」，
// 而是「怎么设计一个会问简历的人」。这是本项目和「换个 prompt 就完事」的工具最不一样的地方：
// 用户改的是**意图的结构**，不是一段散文。

export const CONTRACT_OPTIMIZER_SYSTEM = [
  '你是「面试官设计师」。用户会用一句人话描述他想要一位什么样的面试官，',
  '你要把它变成一份结构化的面试官契约草稿（JSON）。',
  '',
  '## 字段要求',
  '- name：这位面试官的称呼，2-12 字，例如「市场总监」「护理部主管」「语文教研组长」。',
  '- domain：他所在的专业领域，不超过 20 字；用户没提就按目标岗位推断，推断不出就留空串。',
  '- seniority：只能取 junior / mid / senior / principal。',
  '- tone：只能取 neutral / skeptical / warm / blunt。',
  '- blurb：一句话自我介绍，4-60 字，用第一人称。',
  '- goal：这一场你想问出什么，8-200 字。要具体到「判断候选人哪一项能力」，不要写「全面了解候选人」。',
  '- tactics：2-5 条追问手法，每条 4-120 字，必须是**可执行的动作**，',
  '  例如「听到百分比就追问分母是多少」「听到负责就追问你具体交付了哪一部分」。',
  '',
  '## 纪律',
  '1. 只输出一个 JSON 对象，不要解释，不要 markdown 代码块。',
  '2. **不要假设用户是程序员。** 用户可能来自医护、财会、教师、公考、外贸、制造、法律等行业，',
  '   tactics 必须用该行业的行话，而不是通用的「技术深度」「八股」。',
  '3. tactics 是「怎么问」，不是「问什么」。不要把你猜到的某条简历内容写进 tactics——',
  '   这位面试官要能被用在任何一份简历上，写死一条经历等于只对一份简历有效。',
  '4. 用户没提供的信息不要编造：推断不出来就留空串或保持宽泛，不要凭空写「十年经验」。',
  '5. 语气要像一个真的要面你的人，不要写成 HR 手册。',
  '',
  '## 输出要求（只输出一个 JSON 对象）',
  '{"name":"市场总监","domain":"市场营销","seniority":"senior","tone":"skeptical",' +
    '"blurb":"我关心你做的活动到底带来了多少可归因的生意。","goal":"判断候选人的营销成果里有多少是他自己推动的",' +
    '"tactics":["听到增长数字就追问口径和基线","听到负责就追问哪一部分是你亲手做的","听到投放就追问预算与回收周期"]}',
].join(NL);

/**
 * 给设计师的输入。岗位与简历都只给**摘要**：
 * 目的是让 tactics 说得像这个行业的人，而不是让模型去逐条点评这份简历
 * （那是沙盘本身要干的事，提前做等于让面试官先看了答案）。
 */
export function buildContractPrompt(input: {
  description: string;
  jobTitle?: string;
  jdText?: string;
  resumeText?: string;
}): string {
  const lines: string[] = [];
  lines.push('## 用户的描述');
  lines.push(input.description.trim());
  lines.push('');
  lines.push('## 目标岗位');
  lines.push((input.jobTitle ?? '').trim() === '' ? '（用户没填）' : (input.jobTitle ?? '').trim());
  const jd = (input.jdText ?? '').trim();
  if (jd !== '') {
    lines.push('');
    lines.push('## 岗位要求（节选）');
    lines.push(jd.slice(0, 400));
  }
  const resume = (input.resumeText ?? '').trim();
  if (resume !== '') {
    lines.push('');
    lines.push('## 求职者简历（节选，只用于判断行业与层级，不要针对其中内容写 tactics）');
    lines.push(resume.slice(0, 600));
  }
  return lines.join(NL);
}

// ---------------------------------------------------------------- 阶段七：反问（轮到求职者提问）
//
// 与前面几个阶段不同，这一阶段的产物**不是**对求职者的评价，而是给求职者的信息：
// 面试快结束时那句「你有什么想问我们的吗」，大多数人会浪费掉。
// 所以提示词要它做的不是「评价这份简历」，而是「基于已经读到的材料，替他问几个真问题」。

export const COUNTER_SYSTEM = [
  '你是「反问教练」。这一场压力测试已经跑完了，现在轮到求职者提问（面试官会说「你有什么想问我们的吗」）。',
  '你要替他想出 3 到 6 句**真正值得问出口**的反问——问出去能帮他判断这个岗位值不值得去。',
  '',
  '## 只能依据这两类材料',
  '1. 岗位描述里的原句（sourceId 写 JD 编号，如 J1）',
  '2. 他简历里的某条主张（sourceId 写主张编号，如 C3）',
  '没有依据的话不要问——下面会给出材料和编号。',
  '',
  '## 五类取向（kind 只能取这五个）',
  '- team：团队与协作（团队多大、汇报给谁、和谁配合最多）',
  '- tech：技术栈与工具（实际在用什么、有没有历史包袱、要不要参与选型）',
  '- growth：成长与考核（晋升路径、考核周期、新人上手期怎么带）',
  '- business：业务与产品（业务现状、用户规模、未来一年要做什么）',
  '- process：流程与节奏（发布节奏、需求从哪来、值班与加班）',
  '五类不必都覆盖，但不要六句话全挤在一类上。',
  '',
  '## 纪律',
  '1. quote 必须是那份材料里的**逐字片段**——代码会拿它回原文重新定位，定位不到这句反问会被丢掉。',
  '2. sourceId 只能取下面列出的编号；指不出依据就别写这一句。',
  '3. reply 写「用人方大概会怎么答」，1 到 2 句、要具体，不要写「这要看情况」。',
  '4. 不要问薪资福利，不要问「公司文化怎么样」这类问了等于没问的问题。',
  '5. 下面标了判定的主张，说明已经被问过了，不要再拿来反问。',
  '',
  '## 输出要求（只输出一个 JSON 对象）',
  '{"counters":[{"text":"我想问的那句话","kind":"team","reason":"为什么该问这个",' +
    '"reply":"用人方大概会这样答","quote":"材料里的逐字片段","sourceId":"J1"}]}',
].join(NL);

/**
 * 给反问阶段的输入。
 *
 * JD 原文照给：quote 必须是 JD 里的逐字片段，模型看不到原文就只能编。
 * 岗位要求那张表也给它，但只是帮它理解岗位——R 编号不是合法的 sourceId，
 * 免得它把「一张对照表里的条目」当成原始材料。
 */
export function buildCounterPrompt(input: {
  jds: readonly JobDescription[];
  requirements: readonly Requirement[];
  claims: readonly Claim[];
  /** 主张 id → 判定；作为附注渲染在被问过的主张旁边 */
  verdicts?: ReadonlyMap<string, VerdictKind>;
}): string {
  const lines: string[] = [];
  lines.push('## 岗位（sourceId 可以选这里的 JD 编号）');
  if (input.jds.length === 0) {
    lines.push('（这次没有上传岗位描述）');
  } else {
    for (const jd of input.jds) {
      lines.push('### [' + jd.id + '] ' + jd.title + '（' + String(jd.text.length) + ' 字）');
      lines.push(jd.text);
      lines.push('');
    }
  }
  if (input.requirements.length > 0) {
    lines.push('## 岗位要求（帮你理解这个岗位；R 编号不能当 sourceId）');
    for (const requirement of input.requirements) {
      lines.push('- [' + requirement.id + '] ' + REQUIREMENT_KIND_LABEL[requirement.kind] + '：' + requirement.text);
    }
    lines.push('');
  }
  lines.push('## 简历里可以被引用的主张（sourceId 可以选这里的编号）');
  const notes: Record<string, string> = {};
  if (input.verdicts) {
    for (const claim of input.claims) {
      const kind = input.verdicts.get(claim.id);
      if (kind !== undefined) notes[claim.id] = '判定：' + VERDICT_LABEL[kind] + '（已经被追问过，别再拿来反问）';
    }
  }
  lines.push(input.claims.length === 0 ? '（这份简历没有抽到可引用的主张）' : renderClaims(input.claims, notes));
  return lines.join(NL);
}

