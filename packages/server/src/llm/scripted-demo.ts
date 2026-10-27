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
import type {
  ClaimCategory,
  CounterKind,
  MatchStatus,
  RequirementKind,
  RewriteStyle,
  VerdictKind,
} from '@crossexam/shared';
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
  /**
   * 保守档与敢改档各写一句：常规档就是 after 本身。
   * 为什么三分必写：改写风格换的是提示词里的一段收敛说明，指纹随之改变；
   * 演示脚本若对档位无感知，三档就会吐出同一批建议，界面上的档位等于假的。
   */
  afterByStyle: Partial<Record<RewriteStyle, string>>;
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
      // before 只圈住「QPS 从 800 提升到 5000」这半句，改完还要接得上前面的「主导引入 Redis 缓存，」，
      // 所以 after 必须从 QPS 起头——一上来就写「引入 Redis 缓存后…」会与前半句撞车。
      after: 'QPS 由 800 提升到 5000（预发环境单机压测：提升前是旧接口日常统计值，提升后是新接口压测峰值）',
      afterByStyle: {
        conservative: 'QPS 由 800 提升到 5000（前后口径不同，不作直接对比）',
        bold: 'QPS 由 800 提升到 5000（缓存方案、压测口径与上线节奏均由我负责；前后口径不同，只比量级不作对比）',
      },
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
      afterByStyle: {
        conservative: '负责 RBAC 权限模块，覆盖 12 个业务线',
        bold: 'RBAC 权限模块由我负责设计与实现，覆盖 12 个业务线的权限接入；其中核心模型与鉴权链路为独立完成',
      },
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
      afterByStyle: {
        conservative: '学习能力强，抗压能力强，有责任心（具体事例见项目经历）',
        bold: '学习能力：两周内独立接手陌生模块并交付；抗压：承担过线上故障值班，做过完整复盘（详见项目经历）',
      },
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
      afterByStyle: {
        conservative: '参与的项目获得公司年度技术突破奖（本人负责其中权限模块）',
        bold: '参与的项目获得公司年度技术突破奖（部门推荐、公司评审的年度评选；本人负责其中权限模块的设计与实现与业务线接入）',
      },
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

/**
 * 第二场的剧本：**改完之后**再过一遍，同一条主张会得到什么。
 *
 * 这一场存在的理由只有一个：没有第二场，「采纳改写 → 再跑一遍 → 看到判定变了」
 * 这条链路在离线演示里就是别人说的一句话，而不是评委自己能点出来的东西。
 * 第一场把它判成「表述过度 / 证据缺失 / 无法回答」的那几条，改完口径之后
 * 应该站得住——判据也变了：「简历里已经把口径分开写」而不是「模型自己补上了口径」。
 *
 * 刻意不写 quote：引文必须正好落在**改完的简历**上，而改完的文本随改写风格档位
 * 由 applyRevisions 现算。手抄一份只会抄错一个标点，然后整条主张被锚定闸门丢掉，
 * 表面上看起来像「第二场一条主张都没抽到」。
 */
export interface DemoRerunPlan {
  /** 对应 DEMO_PLANS 里的第 n 条（C1 是站得住的那条，改完还是原句） */
  claimId: string;
  text: string;
  /**
   * 这条主张改完之后的那一行里，**三个风格档位都有**的一段逐字标记。
   *
   * 引文从这里取到行尾。保守档只做减法、敢改档会多写一句，同一句在三档下尾巴不同，
   * 所以标记必须挑在三档共有的前缀上（「抗压」「技术突破奖」「RBAC 权限模块」这类）。
   */
  marker: string;
  /** 第二场只问一个问题：这一场要短，短才看得出「改完就过了」 */
  questions: string[];
  answerText: string;
  rationale: string;
  confidence: number;
}

export const DEMO_RERUN_PLANS: readonly DemoRerunPlan[] = [
  {
    claimId: 'C1',
    // 主张那一行（text）刻意与第一场一字不差：界面上的版本对比按**主张文本**配对，
    // 这里每改一个字，那一条就从「变好」掉进「这一版新出现的 / 上一版没了」两堆里。
    // 改的是简历原文（quote 从改完的文本里现取），不是模型给这句话起的摘要。
    text: '主导订单系统重构，把首屏加载从 2.4s 优化到 0.8s',
    marker: '主导重构订单系统',
    questions: ['这条上一版就问过了，口径也补过。这次我只确认一句：0.8s 之后还做过优化吗？'],
    answerText: '没有了。0.8s 是那一版的终点，后面的工作转向了稳定性治理。',
    rationale: '上一版已经确认过指标口径与测量环境，这次追问没有出现新的矛盾点，判定维持站得住。',
    confidence: 0.85,
  },
  {
    claimId: 'C2',
    text: '引入 Redis 缓存，把接口 QPS 从 800 提升到 5000',
    marker: '主导引入 Redis 缓存',
    questions: ['这一版把日常值和压测峰值分开写了。那我按简历这么理解，可以吗？'],
    answerText: '可以。提升前的 800 是旧接口的日常统计值，5000 是新接口在预发环境单机压测的峰值，简历里就是这么写的。',
    rationale: '简历已经把两个口径分开陈述，追问确认后与原文一致，不再构成「并列成一次提升」的误导。',
    confidence: 0.84,
  },
  {
    claimId: 'C3',
    text: '独立完成 RBAC 权限模块，覆盖 12 个业务线',
    marker: 'RBAC 权限模块',
    questions: ['这一版写清了「核心模型与鉴权链路独立完成」。那我确认一下：业务线接入是各团队自己推的？'],
    answerText: '对。业务线接入是各团队自己做的，我负责核心模型与鉴权链路，简历里这么写就是为了把边界说清楚。',
    rationale: '改写之后个人贡献边界明确，追问确认与原文一致，不再需要「证据缺失」这档兜底。',
    confidence: 0.8,
  },
  {
    claimId: 'C4',
    text: '学习能力强、抗压能力强',
    marker: '抗压',
    questions: ['「两周内独立接手陌生模块」和「线上故障值班」这两件，能各说一件具体的吗？'],
    answerText: '接手的是权限模块的接入层，两周内交付了三条业务线的接入；值班是去年四季度，处理过一次缓存击穿，事后做了复盘。',
    rationale: '形容词换成了可被追问的事实，追问时能落到具体事例上。',
    confidence: 0.78,
  },
  {
    claimId: 'C5',
    text: '参与的项目获得公司年度技术突破奖',
    marker: '技术突破奖',
    questions: ['这一版补了评选范围与个人贡献。那我确认：部门推荐、公司评审，你负责其中权限模块？'],
    answerText: '是。部门推荐上去、公司层面评审，我负责的是其中权限模块的设计与实现。',
    rationale: '评选范围与个人贡献都写进了原文，追问确认后一致，奖项从「团队光环」变成了可追问的个人成果。',
    confidence: 0.8,
  },
];

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
  /**
   * 这是第几场：1 = 原始简历，2 = 采纳改写之后又跑的那一场。
   *
   * 为什么要显式记：两场共用同一个客户端实例（卡带要按提示词指纹落进同一个目录），
   * 而两场的答案、判定、引文全都不一样。靠「提示词里有没有改后的句子」去猜，
   * 第一场也会被认成第二场——简历原文里本来就有一模一样的半句。
   */
  session: 1 | 2;
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

/** 从 at 开始取到这一行结束 */
function lineFrom(text: string, at: number): string {
  const nl = text.indexOf(NL, at);
  return (nl < 0 ? text.slice(at) : text.slice(at, nl)).trim();
}

/**
 * 在每一处「原文引文：」之后的行里找包含标记的那一行，返回从标记起的部分。
 *
 * 为什么要先走这一条：判定、追问、回答、反问的提示词里，主张块自己就带着
 * 「原文引文：…」，而**主张的文字（主张：…）排在它前面**。只按「全提示词第一处标记」
 * 取，取到的是模型自己写的主张文字，不是简历原文——第二场 C3/C5 就是这么被判成
 * 「证据缺失」的：模型给的证据没错，是脚本喂给它的那段字不在简历里。
 */
function quoteFromAnchorLine(prompt: string, marker: string): string {
  const label = '原文引文：';
  let at = prompt.indexOf(label);
  while (at >= 0) {
    const line = lineFrom(prompt, at + label.length);
    const inner = line.indexOf(marker);
    if (inner >= 0) return line.slice(inner);
    at = prompt.indexOf(label, at + label.length);
  }
  return '';
}

/**
 * 从提示词里按「标记」取一段逐字引文：优先取主张块里的原文引文，
 * 其次只在「## 简历原文」那一段里找。
 *
 * 第二场的引文不能手写：改完的简历随改写风格档位而变（保守档只做减法、敢改档会加句子），
 * 同一句在三个档位下尾巴都不一样，手抄必然有一个档位对不上、整条主张被锚定闸门丢掉。
 * 取到行尾这个粒度正好等于「简历里那一行」——也就是锚点该落的范围。
 */
function quoteFromMarker(prompt: string, marker: string): string {
  if (marker === '') return '';
  const anchored = quoteFromAnchorLine(prompt, marker);
  if (anchored.length > 0) return anchored;
  const section = prompt.indexOf('## 简历原文');
  const scope = section < 0 ? prompt : prompt.slice(section);
  const at = scope.indexOf(marker);
  return at < 0 ? '' : lineFrom(scope, at);
}

function rerunPlanForClaimId(claimId: string): DemoRerunPlan | null {
  for (const plan of DEMO_RERUN_PLANS) if (plan.claimId === claimId) return plan;
  return null;
}

function rerunPlanForQuestion(question: string): DemoRerunPlan | null {
  for (const plan of DEMO_RERUN_PLANS) if (plan.questions.indexOf(question) >= 0) return plan;
  return null;
}

/**
 * 第二场的抽取：把「改完之后那五条」连同它们改后的引文一起交出去。
 *
 * 引文按 marker 从提示词里现取，取不到就干脆不交这条——
 * 交一条锚不到的，只会让观众以为「锚定闸门把好主张也拦了」。
 */
function rerunExtractText(prompt: string): string {
  const claims: DemoClaimDraft[] = [];
  for (const plan of DEMO_RERUN_PLANS) {
    const quote = quoteFromMarker(prompt, plan.marker);
    if (quote.length < 4) continue;
    const base = planForClaimId(plan.claimId);
    claims.push({
      text: plan.text,
      quote,
      category: base === null ? 'other' : base.category,
      weight: base === null ? 0.6 : base.weight,
    });
  }
  // 故意锚不到的那条也留在第二场：它是「AI 没有乱问」的正面证据，
  // 而第二场恰恰是最容易被怀疑「改写之后是不是什么都能过」的那一场。
  claims.push(DEMO_UNANCHORED_DRAFT);
  return JSON.stringify({ claims });
}

/** 第二场的追问：每条主张一个，问完就收——这一场要短，短才看得出「改完就过了」 */
function rerunProbeText(prompt: string, state: ScriptState): string {
  const capMatch = MAX_PROBES_LINE.exec(prompt);
  const cap = capMatch ? Number(capMatch[1] ?? '2') : 2;
  const probes: { claimId: string; question: string; quote: string; rationale: string }[] = [];
  for (const block of claimBlocks(prompt)) {
    if (probes.length >= cap) break;
    const plan = rerunPlanForClaimId(block.claimId);
    if (plan === null) continue;
    for (const question of plan.questions) {
      if (state.asked.has(question)) continue;
      state.asked.add(question);
      probes.push({ claimId: block.claimId, question, quote: block.quote, rationale: plan.rationale });
      break;
    }
  }
  return JSON.stringify({ probes });
}

/**
 * 第二场的判定：全部站得住，且**每条都带得出可定位的证据**。
 *
 * 证据不能省：判「站得住」却给不出引文时，verdict.ts 会按「证据缺失」降级——
 * 那正是第一场 C5 的剧本。第二场要是也降级，这一整轮演示就白跑了。
 */
function rerunVerdictText(prompt: string): string {
  const claimId = firstClaimId(prompt);
  const plan = rerunPlanForClaimId(claimId);
  if (plan === null) throw new Error('演示脚本没有覆盖这条主张的第二场判定：' + claimId);
  const quote = quoteFromMarker(prompt, plan.marker);
  return JSON.stringify({
    kind: 'solid',
    confidence: plan.confidence,
    rationale: plan.rationale,
    evidenceQuotes: quote.length >= 4 ? [quote] : [],
  });
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

function answerText(prompt: string, state: ScriptState): string {
  const question = lineAfter(prompt, '## 面试官的问题');
  if (state.session === 2) {
    const plan = rerunPlanForQuestion(question);
    if (plan === null) throw new Error('演示脚本没有覆盖这个问题的第二场回答：' + question);
    const quote = quoteFromMarker(prompt, plan.marker);
    // 援引原文也要给：第二场每一条主张的答案都该落在改完的那句话上，
    // 答得对却说不出依据，在界面上看起来像「模型自己编了一段」。
    return JSON.stringify({
      answered: true,
      text: plan.answerText,
      citedQuotes: quote.length >= 4 ? [quote] : [],
    });
  }
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

/**
 * 从提示词里读出用户选的改写风格档位。
 *
 * 档位那一行出自 suggestSystem，渲染在**系统提示词**里（messages[0] 是用户提示词，只有主张与判定）——
 * 第一版从 user 里找，三种档位全都找不到、全按常规档处理，三档建议一字不差，被测试逮住。
 * 那一行形如「## 这一版的收敛程度（用户选的档位：保守）」。
 * 认不出就按常规档：宁可让演示停在常规档，也不要为了让脚本好写而改提示词的渲染格式——
 * 提示词是评委在界面上能摊开看的东西，不该为了脚本让步。
 */
function styleIn(prompt: string): RewriteStyle {
  if (prompt.indexOf('用户选的档位：保守') >= 0) return 'conservative';
  if (prompt.indexOf('用户选的档位：敢改') >= 0) return 'bold';
  return 'normal';
}

function suggestText(prompt: string, system: string): string {
  const claimId = firstClaimId(prompt);
  const plan = planForClaimId(claimId);
  if (plan === null || plan.suggestion === null) throw new Error('演示脚本没有覆盖这条主张的改写建议：' + claimId);
  const suggestion = plan.suggestion;
  const style = styleIn(system);
  // 档位不同，改出来的句子必须真的不同：否则界面上切档位只是换了一句说明，
  // 建议本身一字未变，评委一眼就能看出是假的。
  const after = suggestion.afterByStyle[style] ?? suggestion.after;
  return JSON.stringify({
    claimId,
    problem: suggestion.problem,
    before: suggestion.before,
    after,
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

/**
 * 演示用的反问计划。
 *
 * 两条纪律与 DEMO_REQUIREMENT_PLANS 一样：
 * 1. quote 必须逐字存在于材料里。sourceId 是 'JD' 时取自 DEMO_JD，
 *    是 'RESUME' 时由claimIdForQuote 从提示词里反查主张编号——写错一个字，
 *    groundCounters 会把它当锚不到丢掉，演示场次的反问会莫名少一句。
 * 2. 四句刻意分散在四个 kind 上（业务 / 团队 / 成长 / 流程），
 *    让评委一眼看出反问不是随机凑数，而是按取向分组的。
 */
interface DemoCounterPlan {
  text: string;
  kind: CounterKind;
  reason: string;
  reply: string;
  quote: string;
  /** JD 的引文写 JD，主张的引文写 RESUME，真正的 sourceId 在运行时解析 */
  from: 'JD' | 'RESUME';
  /**
   * 第二场用：这条反问要挂在哪条主张上。
   *
   * 第一场靠「引文在哪条主张的原文引文里」反查编号；第二场的引文是改后的句子，
   * 与第一场那句已经不一样了，反查必然落空。所以第二场直接写编号。
   */
  claimId?: string;
}

export const DEMO_COUNTER_PLANS: readonly DemoCounterPlan[] = [
  {
    kind: 'business',
    from: 'JD',
    quote: '有日订单百万级系统的性能优化经验，能给出量化的优化结论',
    text: '这个岗位强调百万级订单量下的量化结论。我写的是首屏从 2.4s 降到 0.8s，却没写订单量级。想请教：这个量级在你们的业务里算大吗？我该把哪一段的日订单量补上？',
    reason: '这是硬性要求里最弱的一条，而回答它正好能把「只有耗时对比、没有量级」这个缺口补实。',
    reply: '量级是我们初筛的第一眼：百万级和十万级要用的手段完全不同。把订单量、峰值 QPS 和测量方法一起写出来，数字不大也比只有一个耗时对比可信。',
  },
  {
    kind: 'team',
    from: 'JD',
    quote: '与产品、前端紧密协作，推动需求高质量交付',
    text: '岗位职责里写着要和产品、前端紧密协作，而我的简历里一条协作事实都没有。想问：你们怎么判断一个人有没有真的推动过跨团队的事？',
    reason: '这条职责在简历里完全没有对应事实，问出来能听清团队的判断口径，回来才知道该补什么。',
    reply: '看具体动作：谁提的方案、谁去对齐、分歧最后怎么收敛。写清「我推动了什么、结果是什么」，比写一个奖项有用。',
  },
  {
    kind: 'growth',
    from: 'RESUME',
    claimId: 'C1',
    quote: '主导重构订单系统，首屏加载从 2.4s 降到 0.8s。',
    text: '这条写的是「主导重构」。想问清楚：方向是你自己判断要做的，还是上面定了方向、你负责落地？我该怎么把边界写清楚才不显得夸大？',
    reason: '「主导」是简历里最容易被追着问的词，先问清口径，回来才能把话说准。',
    reply: '主导意味着方向是你判断的、资源是你协调的；如果只是执行，写「负责落地」更稳，面试时也不会被追着打。',
  },
  {
    kind: 'process',
    from: 'RESUME',
    claimId: 'C3',
    quote: '独立完成 RBAC 权限模块，覆盖 12 个业务线。',
    text: '「独立完成」加「覆盖 12 个业务线」，想问一下：这个模块上线后是谁在维护？12 条业务线的接入是你一条条推动的吗？',
    reason: '规模与「独立完成」放在一起最容易让人怀疑边界，问清楚才改得准。',
    reply: '我们会在意上线之后那一段：谁接的需求、谁做的排障。把「上线后维护了多久」写进去，比写覆盖了几个业务线更站得住。',
  },
];

/** 从提示词里反查这段引文属于哪条主张：提示词按 [Cn] 分段渲染原文引文。 */
function claimIdForQuote(prompt: string, quote: string): string | null {
  const at = prompt.indexOf('原文引文：' + quote);
  if (at < 0) return null;
  const head = prompt.slice(0, at);
  const found = head.lastIndexOf('[C');
  if (found < 0) return null;
  const match = /^C[0-9]+/.exec(head.slice(found + 1));
  return match === null ? null : match[0];
}

function counterText(prompt: string, state: ScriptState): string {
  const counters: Record<string, string>[] = [];
  for (const plan of DEMO_COUNTER_PLANS) {
    if (state.session === 2) {
      // 第二场：引文与编号都按主张现取，只留下「这条主张还在」的那几句。
      // 改完的简历里同一句已经不是原样了，用第一场的引文去比只会一条都问不出来。
      if (plan.claimId === undefined) {
        if (prompt.indexOf(plan.quote) < 0) continue;
        counters.push({ text: plan.text, kind: plan.kind, reason: plan.reason, reply: plan.reply, quote: plan.quote, sourceId: 'J1' });
        continue;
      }
      const rerun = rerunPlanForClaimId(plan.claimId);
      if (rerun === null || prompt.indexOf('[' + plan.claimId + ']') < 0) continue;
      const quote = quoteFromMarker(prompt, rerun.marker);
      if (quote.length < 4) continue;
      counters.push({
        text: plan.text,
        kind: plan.kind,
        reason: plan.reason,
        reply: plan.reply,
        quote,
        sourceId: plan.claimId,
      });
      continue;
    }
    if (prompt.indexOf(plan.quote) < 0) continue;
    const sourceId = plan.from === 'JD' ? 'J1' : claimIdForQuote(prompt, plan.quote);
    if (sourceId === null) continue;
    counters.push({ text: plan.text, kind: plan.kind, reason: plan.reason, reply: plan.reply, quote: plan.quote, sourceId });
  }
  return JSON.stringify({ counters });
}

function rerunVerdictReasoning(prompt: string): string {
  const claimId = firstClaimId(prompt);
  const plan = rerunPlanForClaimId(claimId);
  if (plan === null) return '';
  const parts: string[] = [];
  parts.push('这一版的主张是：' + plan.text + '。');
  parts.push('和上一版比，这一版把口径写进了简历原文，不再靠临场补充。');
  parts.push('追问只有一个，回答与原文对得上，没有出现新的矛盾点。');
  parts.push('所以判「' + VERDICT_LABEL['solid'] + '」，置信度 ' + String(Math.round(plan.confidence * 100)) + '%。');
  return parts.join('');
}

function reasoningFor(req: LlmRequest, state: ScriptState): string {
  const prompt = req.messages[0]?.content ?? '';
  if (state.session === 2) return req.purpose === 'verdict' ? rerunVerdictReasoning(prompt) : '';
  if (req.purpose === 'answer') return answerReasoning(prompt);
  if (req.purpose === 'verdict') return verdictReasoning(prompt);
  return '';
}

function respond(req: LlmRequest, state: ScriptState): string {
  const user = req.messages[0]?.content ?? '';
  const second = state.session === 2;
  if (req.purpose === 'extract') return second ? rerunExtractText(user) : extractText();
  if (req.purpose === 'probe') return second ? rerunProbeText(user, state) : probeText(user, state);
  if (req.purpose === 'answer') return answerText(user, state);
  if (req.purpose === 'verdict') return second ? rerunVerdictText(user) : verdictText(user);
  if (req.purpose === 'suggest') return suggestText(user, req.system);
  if (req.purpose === 'jd-extract') return jdExtractText(user);
  if (req.purpose === 'jd-merge') return jdMergeText(user);
  if (req.purpose === 'jd-match') return jdMatchText(user);
  if (req.purpose === 'counter') return counterText(user, state);
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
/**
 * 造一个脚本客户端。
 *
 * 一个实例可以连着跑两场（原始简历、改完再跑），两场的卡带**落进同一个目录**：
 * 界面上的离线演示第二场正是用同一个 fixtures/llm 回放的。
 * 所以「现在是第几场」由调用方显式声明，不由提示词内容推断。
 */
export function createDemoScriptedClient(dir: string, session: 1 | 2 = 1): DemoScriptedClient {
  const state: ScriptState = { asked: new Set<string>(), session };
  const entries: DemoSeedEntry[] = [];

  function produce(req: LlmRequest): LlmResult {
    const text = respond(req, state);
    const reasoning = reasoningFor(req, state);
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
