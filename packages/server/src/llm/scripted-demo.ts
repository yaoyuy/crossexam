/**
 * 演示卡带的合成脚本：离线演示的原材料。
 *
 * 为什么需要它：比赛承诺「没有 API Key 也能 10 分钟跑通全流程」，
 * 而回放模式必须先有一盘卡带。真实录制要联网、要 Key，
 * 于是这里用一个**确定性脚本化模型**扮演抽取官、三位面试官、求职者与复盘官：
 * 把真实提示词喂进来，把演示内容吐出去，并按提示词指纹写进 fixtures/llm。
 * 读写路径与真实录制完全一致（同一个 digestFor / writeCassette），
 * 所以回放客户端分不出这盘卡带是合成的还是录的——这是刻意的。
 *
 * 三条纪律：
 * 1. 产出是**合成演示数据**，不是任何真实模型或真人的输出。卡带里 model 字段固定为
 *    scripted-demo，一眼可辨；fixtures/README.md 也写明了这一点。
 * 2. 逐字节确定：没有时间戳、没有随机数、没有 Date.now。重跑 seed 结果完全一致。
 * 3. 内容必须真的过得了各阶段的闸门（引文逐字可定位、after 不含简历里没有的数字、
 *    问题不重复）。过不了就让 seed 自己报错，而不是留下一盘跑不通的卡带。
 *
 * 演示的剧本（刻意覆盖五种判定里的四种 + 两类代码级收敛）：
 *   C1 有数字、能说清口径        -> 站得住（不出改写建议）
 *   C2 有数字、但两个口径混着说    -> 表述过度 + 改写建议
 *   C3 只有规模、没有个人贡献边界  -> 两次都答不上来 -> 代码强制判「无法回答」
 *   C4 纯形容词自我评价          -> 同上，无法回答
 *   C5 只说获奖、没有范围与贡献    -> 模型想判「站得住」但拿不出证据 -> 代码降级为「证据缺失」
 *   另有第 6 条草稿故意锚不到原文 -> 被锚定闸门丢弃，前端展示「AI 没有乱问」的正面证据
 */

import { REQUIREMENT_KIND_LABEL, VERDICT_LABEL } from '@crossexam/shared';
import type { ClaimCategory, MatchStatus, RequirementKind, VerdictKind } from '@crossexam/shared';
import { CASSETTE_VERSION, digestFor, writeCassette } from './cassette.ts';
import type { CassetteEntry } from './cassette.ts';
import { chunkText } from './replay.ts';
import type { LlmClient, LlmRequest, LlmResult, LlmStreamEvent, LlmUsage } from './types.ts';

/** 卡带里记的模型名：一眼看出这是脚本合成的演示数据 */
export const DEMO_MODEL = 'scripted-demo';
/** 固定的录制时间：让重跑 seed 产出逐字节相同的文件（可复现优先于「像真的」） */
export const DEMO_RECORDED_AT = '2026-10-26T00:00:00.000Z';

export interface DemoClaimDraft {
  text: string;
  quote: string;
  category: ClaimCategory;
  weight: number;
}

export interface DemoAnswerPlan {
  /** 答不上来就老实说 false —— 这条禁令在演示里也要遵守 */
  answered: boolean;
  text: string;
  citedQuotes: string[];
}

export interface DemoVerdictPlan {
  kind: VerdictKind;
  confidence: number;
  rationale: string;
  evidenceQuotes: string[];
}

export interface DemoSuggestionPlan {
  problem: string;
  before: string;
  after: string;
  why: string;
}

export interface DemoClaimPlan extends DemoClaimDraft {
  /** 备好的追问。同一个问题全场只问一次，所以每个问题都自成一事 */
  questions: string[];
  probeRationale: string;
  answer: DemoAnswerPlan;
  verdict: DemoVerdictPlan;
  suggestion: DemoSuggestionPlan | null;
}

export const DEMO_PLANS: readonly DemoClaimPlan[] = [
  {
    text: '主导订单系统重构，把首屏加载从 2.4s 优化到 0.8s',
    quote: '主导重构订单系统，首屏加载从 2.4s 降到 0.8s。',
    category: 'metric',
    weight: 0.95,
    questions: [
      '这个「从 2.4s 降到 0.8s」指的是哪个指标，在什么环境下测的？',
      '压测和生产的数据量、缓存命中率分别是多少，取的是均值还是分位数？',
    ],
    probeRationale: '性能数字最容易注水，先确认指标口径与测量环境。',
    answer: {
      answered: true,
      text: '是首屏可交互时间，取的是公司性能监控平台上的 P75，测的时候订单量是日均三百万单，Redis 命中率大概九成。',
      citedQuotes: ['首屏加载从 2.4s 降到 0.8s'],
    },
    verdict: {
      kind: 'solid',
      confidence: 0.82,
      rationale: '简历原文给出了优化前后的数字，追问补上了指标口径（首屏可交互时间、P75）与测量环境，回答与原文一致，没有发现矛盾。',
      evidenceQuotes: ['首屏加载从 2.4s 降到 0.8s'],
    },
    suggestion: null,
  },
  {
    text: '引入 Redis 缓存，把接口 QPS 从 800 提升到 5000',
    quote: '主导引入 Redis 缓存，QPS 从 800 提升到 5000。',
    category: 'metric',
    weight: 0.9,
    questions: [
      '5000 这个 QPS 是用什么工具压出来的，并发模型是什么样的？',
      '提升前后的两个数字是同一个接口、同一套压测口径吗？',
    ],
    probeRationale: '两个数字并列成一次提升，很可能是不同口径拼起来的。',
    answer: {
      answered: true,
      text: '压测用 wrk，在预发环境单机压的。严格说提升前的 800 是旧接口的日常统计值，提升后的 5000 是新接口的压测峰值，口径确实不一样。',
      citedQuotes: ['QPS 从 800 提升到 5000'],
    },
    verdict: {
      kind: 'overstated',
      confidence: 0.76,
      rationale: '优化本身是真实的，但简历把两个不同口径的数字并列成一次提升，属于表述过度；追问中候选人也承认前后口径不一致。',
      evidenceQuotes: ['QPS 从 800 提升到 5000'],
    },
    suggestion: {
      problem: '把日常统计值与压测峰值并列成一次提升，面试官追问压测条件就会露馅。',
      before: 'QPS 从 800 提升到 5000',
      after: '引入 Redis 缓存后，同一接口在预发环境单机压测下 QPS 由 800 提升到 5000（压测工具与口径见附录）',
      why: '数字保留，但把口径与场景交代清楚：日常值不做跨口径比较，面试官问起来你能直接把压测条件摊开。',
    },
  },
  {
    text: '独立完成 RBAC 权限模块，覆盖 12 个业务线',
    quote: '独立完成 RBAC 权限模块，覆盖 12 个业务线。',
    category: 'ownership',
    weight: 0.8,
    questions: [
      '这 12 个业务线具体是哪几条，各自的用户量级大概是多少？',
      '权限模块里哪些部分是你独立完成的，团队其他人在做什么？',
    ],
    probeRationale: '规模数字好看，但个人贡献边界最容易说不清。',
    answer: {
      answered: false,
      text: '简历里没有写这些业务线的具体情况，也没有写个人贡献的边界。',
      citedQuotes: [],
    },
    verdict: {
      kind: 'unsupported',
      confidence: 0.7,
      rationale: '简历只写了覆盖规模，没有个人贡献边界与业务线明细，追问后仍无法补充。',
      evidenceQuotes: [],
    },
    suggestion: {
      problem: '只有规模、没有贡献边界，面试官一问细节就答不上来。',
      before: '独立完成 RBAC 权限模块，覆盖 12 个业务线。',
      after: '负责 RBAC 权限模块的设计与实现，覆盖 12 个业务线的权限接入（核心模型与鉴权链路由我独立完成）',
      why: '把「独立完成」的边界限定到具体部分：既保住了成果，也不再让别人以为整件事都是你一个人做的。',
    },
  },
  {
    text: '学习能力强、抗压能力强',
    quote: '学习能力强，抗压能力强，有责任心，能快速融入团队。',
    category: 'skill',
    weight: 0.6,
    questions: [
      '「抗压能力强」能不能举一个具体的例子，当时压力来自哪里？',
      '有没有一次压力下没扛住的情况，后来是怎么处理的？',
    ],
    probeRationale: '纯形容词没有事实支撑，任何面试官都会要求举例。',
    answer: {
      answered: false,
      text: '简历里只有这一句自我评价，我确实举不出具体事例，这块我说不上来。',
      citedQuotes: [],
    },
    verdict: {
      kind: 'unanswerable',
      confidence: 0.65,
      rationale: '自我评价只有形容词，候选人被追问两次都明确承认举不出具体事例——这条在面试现场会直接翻车。',
      evidenceQuotes: [],
    },
    suggestion: {
      problem: '纯形容词无法被验证，追问两次就暴露了。',
      before: '学习能力强，抗压能力强，有责任心，能快速融入团队。',
      after: '学习能力：能在两周内独立接手陌生模块；抗压：有线上故障值班与复盘经历（详见项目经历）',
      why: '把形容词换成可被追问的事实，面试官接着问也问得下去，反而给了你展开的机会。',
    },
  },
  {
    text: '参与的项目获得公司年度技术突破奖',
    quote: '参与的项目获得公司年度技术突破奖。',
    category: 'achievement',
    weight: 0.75,
    questions: [
      '这个年度技术突破奖是公司级还是部门级，评选范围有多大？',
      '获奖的具体技术贡献是什么，有没有可量化的结果？',
    ],
    probeRationale: '奖要问清评选范围与个人贡献，否则听上去像集体荣誉。',
    answer: {
      answered: true,
      text: '奖是公司年度评选的，部门推荐、公司评审；具体贡献是我负责的权限模块支撑了多条业务线接入，量化结果简历里没写。',
      citedQuotes: ['参与的项目获得公司年度技术突破奖'],
    },
    verdict: {
      kind: 'solid',
      confidence: 0.68,
      rationale: '获奖这个事实没问题，但简历只有结论、没有评选范围与个人贡献，撑不起「技术突破」这个说法。',
      evidenceQuotes: [],
    },
    suggestion: {
      problem: '只说获奖，没说评选范围与个人贡献，读起来像集体荣誉。',
      before: '参与的项目获得公司年度技术突破奖。',
      after: '参与的项目获得公司年度技术突破奖（部门推荐、公司评审；本人负责其中权限模块的设计与实现）',
      why: '把范围与你的那部分补上，奖项才从「团队光环」变成可追问的个人成果。',
    },
  },
];

/** 故意锚不到简历原文的第六个草稿：演示「无锚点的主张一律丢弃」 */
export const DEMO_UNANCHORED_DRAFT: DemoClaimDraft = {
  text: '精通分布式事务与高并发架构',
  quote: '精通分布式事务与高并发架构',
  category: 'skill',
  weight: 0.99,
};

/** 演示 JD 里的一条要求：引文逐字取自 DEMO_JD，对照结果预先定好 */
export interface DemoRequirementDraft {
  text: string;
  quote: string;
  kind: RequirementKind;
  keywords: string[];
}

export interface DemoRequirementPlan extends DemoRequirementDraft {
  match: { status: MatchStatus; claimId: string | null; reason: string };
}

/**
 * 演示 JD（DEMO_JD）里能拿去检验简历的要求。
 *
 * 两条纪律：
 * 1. quote 逐字抄自 demo-content.ts 的 JD_LINES。抽取阶段的硬约束是「引文必须逐字存在于 JD」，
 *    演示脚本自己也不例外——写错一个字，groundExtracted 就把它当锚不到丢掉，
 *    演示场次的要求清单会莫名少一条。
 * 2. 对照结果刻意做成 7 条里只有 1 条 hit。岗位要求对照的价值在缺口：
 *    3 条答得含糊、3 条简历里完全没写，这才是评委该看见的东西。
 */
export const DEMO_REQUIREMENT_PLANS: readonly DemoRequirementPlan[] = [
  {
    text: '本科及以上学历，5 年以上后端研发经验',
    quote: '本科及以上学历，5 年以上后端研发经验',
    kind: 'must',
    keywords: ['学历', '5 年后端经验'],
    match: {
      status: 'missing',
      claimId: null,
      reason: '简历里既没有学历，也没有总年限——两段经历的起止时间只够推出四年左右。',
    },
  },
  {
    text: '精通 Node.js / TypeScript，熟悉 PostgreSQL、Redis',
    quote: '精通 Node.js / TypeScript，熟悉 PostgreSQL、Redis',
    kind: 'must',
    keywords: ['Node.js', 'TypeScript', 'PostgreSQL', 'Redis'],
    match: {
      status: 'weak',
      claimId: 'C2',
      reason: '简历写了用 Redis 做缓存，但没有 PostgreSQL 的任何痕迹，Node.js 与 TypeScript 也只有「熟悉」两个字。',
    },
  },
  {
    text: '有日订单百万级系统的性能优化经验，能给出量化的优化结论',
    quote: '有日订单百万级系统的性能优化经验，能给出量化的优化结论',
    kind: 'must',
    keywords: ['百万级订单', '量化结论'],
    match: {
      status: 'weak',
      claimId: 'C1',
      reason: '有 2.4s 降到 0.8s 这样的量化结论，但没写日订单量级，也没说首屏耗时是怎么测出来的。',
    },
  },
  {
    text: '具备良好的沟通能力与主人翁意识',
    quote: '具备良好的沟通能力与主人翁意识',
    kind: 'must',
    keywords: ['沟通能力', '主人翁意识'],
    match: {
      status: 'missing',
      claimId: null,
      reason: '简历通篇没有协作类的事实，自我评价里也没有这两项。',
    },
  },
  {
    text: '负责交易与订单核心链路的架构设计与性能优化',
    quote: '负责交易与订单核心链路的架构设计与性能优化',
    kind: 'duty',
    keywords: ['订单链路', '架构设计', '性能优化'],
    match: {
      status: 'hit',
      claimId: 'C1',
      reason: '订单系统重构这条主张正好压在这条职责上，有明确的技术动作与前后对比。',
    },
  },
  {
    text: '主导高并发场景下的稳定性治理，输出可复用的技术方案',
    quote: '主导高并发场景下的稳定性治理，输出可复用的技术方案',
    kind: 'duty',
    keywords: ['高并发', '稳定性治理', '可复用方案'],
    match: {
      status: 'weak',
      claimId: 'C2',
      reason: '只有 QPS 提升这一个数字，没写稳定性治理做了什么，也没有可复用方案的产出。',
    },
  },
  {
    text: '与产品、前端紧密协作，推动需求高质量交付',
    quote: '与产品、前端紧密协作，推动需求高质量交付',
    kind: 'duty',
    keywords: ['跨团队协作', '需求交付'],
    match: {
      status: 'missing',
      claimId: null,
      reason: '简历里没有跨团队协作与需求交付的任何描述。',
    },
  },
];

interface ScriptState {
  /** 已经问出去的问题，跨面试官共享：一场面试里同一个问题不重复问 */
  asked: Set<string>;
}

function planForClaimId(claimId: string): DemoClaimPlan | null {
  if (claimId.length < 2 || claimId.charAt(0) !== 'C') return null;
  const n = Number(claimId.slice(1));
  if (!Number.isInteger(n) || n < 1) return null;
  return DEMO_PLANS[n - 1] ?? null;
}

function planForQuestion(question: string): DemoClaimPlan | null {
  for (const plan of DEMO_PLANS) {
    if (plan.questions.indexOf(question) >= 0) return plan;
  }
  return null;
}

/** 用量是**估算值**（按字符数折半），不是真实计费数据；演示卡带不假装自己是账单 */
function estimateUsage(req: LlmRequest, text: string, reasoning: string): LlmUsage {
  let promptChars = req.system.length;
  for (const message of req.messages) promptChars += message.content.length;
  return {
    inputTokens: Math.max(1, Math.round(promptChars / 2)),
    outputTokens: Math.max(1, Math.round(text.length / 2)),
    cacheReadTokens: 0,
    reasoningTokens: Math.round(reasoning.length / 2),
  };
}

function extractText(): string {
  const claims: DemoClaimDraft[] = [];
  for (const plan of DEMO_PLANS) {
    claims.push({ text: plan.text, quote: plan.quote, category: plan.category, weight: plan.weight });
  }
  claims.push(DEMO_UNANCHORED_DRAFT);
  return JSON.stringify({ claims });
}

/** 提示词里每条主张的渲染形状：'[C1] 类别=metric 权重=0.95' + '主张：…' + '原文引文：…' */
const CLAIM_BLOCK = /\[(C[0-9]+)\][^\n]*\n\s*主张：[^\n]*\n\s*原文引文：([^\n]*)/g;
const MAX_PROBES_LINE = /本轮最多问 ([0-9]+) 条/;

function claimBlocks(prompt: string): { claimId: string; quote: string }[] {
  const out: { claimId: string; quote: string }[] = [];
  CLAIM_BLOCK.lastIndex = 0;
  let hit = CLAIM_BLOCK.exec(prompt);
  while (hit !== null) {
    out.push({ claimId: hit[1] ?? '', quote: (hit[2] ?? '').trim() });
    hit = CLAIM_BLOCK.exec(prompt);
  }
  return out;
}

/**
 * 从追问提示词里读出「岗位要求里对得上的几条」。
 *
 * 为什么要让演示也会用上双锚点：不这么做，离线回放跑出来的追问**全都没有第二处锚**，
 * 评委会以为「照着岗位要求追问」只存在于联网模式。而这一条恰恰是 P8 的重点。
 * 格式见 orchestrator/prompts.ts 的 renderRequirementNotes。
 */
function requirementNotesIn(prompt: string): { id: string; claimId: string; quote: string }[] {
  const out: { id: string; claimId: string; quote: string }[] = [];
  const re = /^- \[(R[0-9]+)\] [^\n（]*（对应主张 (C[0-9]+)，来自《[^》]*》）：[^\n]*\n\s+要求原文：([^\n]*)$/gm;
  let hit = re.exec(prompt);
  while (hit !== null) {
    out.push({ id: hit[1] ?? '', claimId: hit[2] ?? '', quote: hit[3] ?? '' });
    hit = re.exec(prompt);
  }
  return out;
}

/** 只挑"还有没用过的问题"的主张；问题用完了就交白卷（空数组是被允许的） */
function probeText(prompt: string, state: ScriptState): string {
  const capMatch = MAX_PROBES_LINE.exec(prompt);
  const cap = capMatch ? Number(capMatch[1] ?? '2') : 2;
  const notes = requirementNotesIn(prompt);
  const usedNote = new Set<string>();
  const probes: {
    claimId: string;
    question: string;
    quote: string;
    rationale: string;
    requirementId?: string;
    jdQuote?: string;
  }[] = [];
  for (const block of claimBlocks(prompt)) {
    if (probes.length >= cap) break;
    const plan = planForClaimId(block.claimId);
    if (plan === null) continue;
    // 一条主张只挂一次要求：同一条要求反复出现在每条追问上，看着像刷屏，也不像人在问。
    const note = usedNote.has(block.claimId) ? undefined : notes.find((item) => item.claimId === block.claimId);
    for (const question of plan.questions) {
      if (state.asked.has(question)) continue;
      state.asked.add(question);
      if (note === undefined) {
        probes.push({ claimId: block.claimId, question, quote: block.quote, rationale: plan.probeRationale });
      } else {
        usedNote.add(block.claimId);
        probes.push({
          claimId: block.claimId,
          question,
          quote: block.quote,
          rationale: plan.probeRationale,
          requirementId: note.id,
          jdQuote: note.quote,
        });
      }
      break;
    }
  }
  return JSON.stringify({ probes });
}

const NL = String.fromCharCode(10);

/**
 * 取标题下面的那一行内容。
 * 踩过的坑：提示词里标题是**独占一行**的（'## 面试官的问题' 换行后才是问题），
 * 一开始按"标题后面到第一个换行"去取，取到的是空字符串，
 * 于是每条回答都判定成"脚本没覆盖"并抛错——而编排层会逐项容错，
 * 合成跑看着照常完成，回放时才发现回答阶段一盘卡带都没有。
 * 所以这里先看标题行内有没有内容，没有才取下一行。
 */
function lineAfter(prompt: string, heading: string): string {
  const at = prompt.indexOf(heading);
  if (at < 0) return '';
  const rest = prompt.slice(at + heading.length);
  const firstNl = rest.indexOf(NL);
  const sameLine = (firstNl < 0 ? rest : rest.slice(0, firstNl)).trim();
  if (sameLine.length > 0) return sameLine;
  const after = firstNl < 0 ? '' : rest.slice(firstNl + 1);
  const secondNl = after.indexOf(NL);
  return (secondNl < 0 ? after : after.slice(0, secondNl)).trim();
}

function firstClaimId(prompt: string): string {
  const hit = /\[(C[0-9]+)\]/.exec(prompt);
  return hit ? (hit[1] ?? '') : '';
}

function answerText(prompt: string): string {
  const question = lineAfter(prompt, '## 面试官的问题');
  const plan = planForQuestion(question);
  if (plan === null) throw new Error('演示脚本没有覆盖这个问题：' + question);
  return JSON.stringify({
    answered: plan.answer.answered,
    text: plan.answer.text,
    citedQuotes: plan.answer.citedQuotes,
  });
}

function verdictText(prompt: string): string {
  const plan = planForClaimId(firstClaimId(prompt));
  if (plan === null) throw new Error('演示脚本没有覆盖这条主张的判定：' + firstClaimId(prompt));
  const verdict = plan.verdict;
  return JSON.stringify({
    kind: verdict.kind,
    confidence: verdict.confidence,
    rationale: verdict.rationale,
    evidenceQuotes: verdict.evidenceQuotes,
  });
}

function suggestText(prompt: string): string {
  const claimId = firstClaimId(prompt);
  const plan = planForClaimId(claimId);
  if (plan === null || plan.suggestion === null) throw new Error('演示脚本没有覆盖这条主张的改写建议：' + claimId);
  const suggestion = plan.suggestion;
  return JSON.stringify({
    claimId,
    problem: suggestion.problem,
    before: suggestion.before,
    after: suggestion.after,
    why: suggestion.why,
  });
}

/**
 * 合成思考：离线演示也要看得见「思考可视化」。
 *
 * 真实联网时这一栏由思考模型（如 deepseek-reasoner）的 reasoning 分片填充；
 * 离线演示没有模型，就按同一套判据写一段自问自答。它同样是**合成内容**，「
 * 与卡带里的答案一样由 model 字段标注（scripted-demo）。
 * 只给 verdict 与 answer 两个阶段：一个演示「判定时怎么权衡」，一个演示「求职者怎么答」。
 */
function answerReasoning(prompt: string): string {
  const question = lineAfter(prompt, '## 面试官的问题');
  const plan = planForQuestion(question);
  if (plan === null) return '';
  if (!plan.answer.answered) {
    return '问题问的是「' + question + '」。先扫一遍简历：这句话只写了结论，没有能对上这个问题的原文。答不上来就老实说答不上来——编一个细节出来反而会与简历原文矛盾，那才是真的扣分。';
  }
  return '问题问的是「' + question + '」。简历里有一句能对上的原话，我就按原文答，只补简历里写过的信息（口径、环境、量级），不添新的事实。';
}

const VERDICT_THOUGHT: Record<VerdictKind, string> = {
  solid: '简历原文有这句话，追问也补上了口径与环境，两边对得上，不像是编的。',
  overstated: '数字本身在简历里，但两个口径被混着说，读的人会以为提升幅度更大。',
  unsupported: '这件事无法证伪，可简历只有结论、没有范围和贡献，撑不起这个说法。',
  contradicts: '回答与简历原文对不上，按原文为准。',
  unanswerable: '连续几次追问都答不上来，说明这句话背后的细节他自己也说不清。',
};

function verdictReasoning(prompt: string): string {
  const claimId = firstClaimId(prompt);
  const plan = planForClaimId(claimId);
  if (plan === null) return '';
  const kind = plan.verdict.kind;
  const parts: string[] = [];
  parts.push('先看这条主张：' + plan.text + '。');
  parts.push('追问记录里备了 ' + String(plan.questions.length) + ' 个问题，' + (plan.answer.answered ? '候选人有作答。' : '候选人没有答上来。'));
  parts.push(VERDICT_THOUGHT[kind]);
  parts.push('所以判「' + VERDICT_LABEL[kind] + '」，置信度 ' + String(Math.round(plan.verdict.confidence * 100)) + '%。');
  return parts.join('');
}

/** 提示词里每条已抽要求的渲染形状：'- [J1#3] 硬性要求：<text>'，换行后跟 '  原文：<quote>' */
const MERGE_LINE = /^- \[(J[0-9]+#[0-9]+)\] ([^：]*)：(.+)$/;
/** 提示词里每条要求的渲染形状：'- [R1] 硬性要求：<text>' */
const MATCH_LINE = /^- \[(R[0-9]+)\] ([^：]*)：(.+)$/;

function requirementPlanByText(text: string): DemoRequirementPlan | null {
  for (const plan of DEMO_REQUIREMENT_PLANS) if (plan.text === text) return plan;
  return null;
}

function kindOfLabel(label: string): RequirementKind {
  const keys = Object.keys(REQUIREMENT_KIND_LABEL) as RequirementKind[];
  for (const key of keys) if (REQUIREMENT_KIND_LABEL[key] === label) return key;
  return 'must';
}

/** jd-extract：只吐引文真出现在这份 JD 里的要求，不假装抽到了 JD 里没有的东西 */
function jdExtractText(prompt: string): string {
  const requirements: DemoRequirementDraft[] = [];
  for (const plan of DEMO_REQUIREMENT_PLANS) {
    if (prompt.indexOf(plan.quote) < 0) continue;
    requirements.push({ text: plan.text, quote: plan.quote, kind: plan.kind, keywords: plan.keywords });
  }
  return JSON.stringify({ requirements });
}

/**
 * jd-merge：演示只有一份 JD，没有可并的——如实一条一组。
 * 硬凑成一组确实更好看，但那是在伪造「跨份归并」这个动作。
 */
function jdMergeText(prompt: string): string {
  const groups: { text: string; kind: RequirementKind; members: string[]; keywords: string[] }[] = [];
  for (const raw of prompt.split(NL)) {
    const hit = MERGE_LINE.exec(raw.trim());
    if (hit === null) continue;
    const text = (hit[3] ?? '').trim();
    const plan = requirementPlanByText(text);
    groups.push({
      text,
      kind: kindOfLabel(hit[2] ?? ''),
      members: [hit[1] ?? ''],
      keywords: plan === null ? [] : plan.keywords,
    });
  }
  return JSON.stringify({ groups });
}

/** jd-match：逐条要求对照，结果写死在 DEMO_REQUIREMENT_PLANS 里，不临场编 */
function jdMatchText(prompt: string): string {
  const claimIds = new Set<string>();
  const claimHit = /\[(C[0-9]+)\]/g;
  let found = claimHit.exec(prompt);
  while (found !== null) {
    claimIds.add(found[1] ?? '');
    found = claimHit.exec(prompt);
  }
  const matches: { requirementId: string; claimId: string | null; status: MatchStatus; reason: string }[] = [];
  for (const raw of prompt.split(NL)) {
    const hit = MATCH_LINE.exec(raw.trim());
    if (hit === null) continue;
    const requirementId = hit[1] ?? '';
    const plan = requirementPlanByText((hit[3] ?? '').trim());
    if (plan === null) {
      matches.push({
        requirementId,
        claimId: null,
        status: 'missing',
        reason: '演示脚本没有为这条要求准备对照结果，按简历里没写处理。',
      });
      continue;
    }
    const wanted = plan.match.claimId;
    if (wanted === null || !claimIds.has(wanted)) {
      matches.push({ requirementId, claimId: null, status: 'missing', reason: plan.match.reason });
      continue;
    }
    matches.push({ requirementId, claimId: wanted, status: plan.match.status, reason: plan.match.reason });
  }
  return JSON.stringify({ matches });
}

function reasoningFor(req: LlmRequest): string {
  const prompt = req.messages[0]?.content ?? '';
  if (req.purpose === 'answer') return answerReasoning(prompt);
  if (req.purpose === 'verdict') return verdictReasoning(prompt);
  return '';
}

function respond(req: LlmRequest, state: ScriptState): string {
  const user = req.messages[0]?.content ?? '';
  if (req.purpose === 'extract') return extractText();
  if (req.purpose === 'probe') return probeText(user, state);
  if (req.purpose === 'answer') return answerText(user);
  if (req.purpose === 'verdict') return verdictText(user);
  if (req.purpose === 'suggest') return suggestText(user);
  if (req.purpose === 'jd-extract') return jdExtractText(user);
  if (req.purpose === 'jd-merge') return jdMergeText(user);
  if (req.purpose === 'jd-match') return jdMatchText(user);
  throw new Error('演示脚本没有覆盖这个阶段：' + req.purpose);
}

export interface DemoSeedEntry {
  digest: string;
  purpose: string;
  file: string;
}

export interface DemoScriptedClient {
  client: LlmClient;
  /** 本次写出的卡带，按调用顺序 */
  entries: DemoSeedEntry[];
}

/**
 * 造一个"边回答边录制"的客户端。
 * 它与真实录制模式（live.ts 的 record 包装）的差别只在文本从哪儿来：
 * 那边来自模型，这边来自上面的确定性脚本；指纹与落盘走的是同一条路。
 */
export function createDemoScriptedClient(dir: string): DemoScriptedClient {
  const state: ScriptState = { asked: new Set<string>() };
  const entries: DemoSeedEntry[] = [];

  function produce(req: LlmRequest): LlmResult {
    const text = respond(req, state);
    const reasoning = reasoningFor(req);
    const digest = digestFor(req);
    const usage = estimateUsage(req, text, reasoning);
    const entry: CassetteEntry = {
      version: CASSETTE_VERSION,
      digest,
      purpose: req.purpose,
      model: DEMO_MODEL,
      recordedAt: DEMO_RECORDED_AT,
      request: {
        system: req.system,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: req.temperature ?? null,
        maxTokens: req.maxTokens ?? null,
        json: req.json ?? false,
      },
      response: reasoning === '' ? { text, usage } : { text, reasoning, usage },
    };
    const file = writeCassette(dir, entry);
    entries.push({ digest, purpose: req.purpose, file });
    if (reasoning === '') return { text, usage, digest, replayed: false, elapsedMs: 0 };
    return { text, reasoning, usage, digest, replayed: false, elapsedMs: 0 };
  }

  const client: LlmClient = {
    mode: 'record',
    async complete(req: LlmRequest): Promise<LlmResult> {
      return produce(req);
    },
    async *stream(req: LlmRequest): AsyncGenerator<LlmStreamEvent, void, void> {
      const result = produce(req);
      const thinking = result.reasoning ?? '';
      if (thinking !== '') {
        for (const piece of chunkText(thinking)) yield { type: 'reasoning', text: piece };
      }
      for (const piece of chunkText(result.text)) yield { type: 'delta', text: piece };
      yield { type: 'done', result };
    },
  };

  return { client, entries };
}
