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

import type { ClaimCategory, VerdictKind } from '@crossexam/shared';
import { CASSETTE_VERSION, digestFor, writeCassette } from './cassette.ts';
import type { CassetteEntry } from './cassette.ts';
import { chunkText } from './replay.ts';
import type { LlmClient, LlmRequest, LlmResult, LlmUsage } from './types.ts';

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
function estimateUsage(req: LlmRequest, text: string): LlmUsage {
  let promptChars = req.system.length;
  for (const message of req.messages) promptChars += message.content.length;
  return {
    inputTokens: Math.max(1, Math.round(promptChars / 2)),
    outputTokens: Math.max(1, Math.round(text.length / 2)),
    cacheReadTokens: 0,
    reasoningTokens: 0,
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

/** 只挑"还有没用过的问题"的主张；问题用完了就交白卷（空数组是被允许的） */
function probeText(prompt: string, state: ScriptState): string {
  const capMatch = MAX_PROBES_LINE.exec(prompt);
  const cap = capMatch ? Number(capMatch[1] ?? '2') : 2;
  const probes: { claimId: string; question: string; quote: string; rationale: string }[] = [];
  for (const block of claimBlocks(prompt)) {
    if (probes.length >= cap) break;
    const plan = planForClaimId(block.claimId);
    if (plan === null) continue;
    for (const question of plan.questions) {
      if (state.asked.has(question)) continue;
      state.asked.add(question);
      probes.push({ claimId: block.claimId, question, quote: block.quote, rationale: plan.probeRationale });
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

function respond(req: LlmRequest, state: ScriptState): string {
  const user = req.messages[0]?.content ?? '';
  if (req.purpose === 'extract') return extractText();
  if (req.purpose === 'probe') return probeText(user, state);
  if (req.purpose === 'answer') return answerText(user);
  if (req.purpose === 'verdict') return verdictText(user);
  if (req.purpose === 'suggest') return suggestText(user);
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
    const digest = digestFor(req);
    const usage = estimateUsage(req, text);
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
      response: { text, usage },
    };
    const file = writeCassette(dir, entry);
    entries.push({ digest, purpose: req.purpose, file });
    return { text, usage, digest, replayed: false, elapsedMs: 0 };
  }

  const client: LlmClient = {
    mode: 'record',
    async complete(req: LlmRequest): Promise<LlmResult> {
      return produce(req);
    },
    async *stream(req: LlmRequest): AsyncGenerator<{ type: 'delta'; text: string } | { type: 'done'; result: LlmResult }, void, void> {
      const result = produce(req);
      for (const piece of chunkText(result.text)) yield { type: 'delta', text: piece };
      yield { type: 'done', result };
    },
  };

  return { client, entries };
}
