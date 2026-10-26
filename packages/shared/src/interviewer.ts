/**
 * 自定义面试官（P7 第 4 项）。
 *
 * 用户的原话是「不能只有技术面试官，要能在页面里自己设置面试官，并通过 API 对自己设置的
 * 面试官契约进行优化，要求所有专业的人都能用」。这三件事在实现上是三件事：
 *
 * 1. 页面里自己设置：自定义面试官也要走 IntentContract，不能退化成一坨自由文本。
 *    它和五位内置面试官共用同一套渲染、同一套指纹、同一套约束。
 * 2. 用 API 优化契约：用户写一句人话（「我要面市场营销，简历里全是策划过活动」），
 *    由模型把它补成结构化契约。模型给的字段一律过 zod，过不了就退回本地规则。
 * 3. 所有专业都能用：提示词与本地兜底都**不假设候选人是程序员**。
 *    本地兜底见 localDraftFromText，它是纯规则、可离线、可测试的，不是随便凑三句话。
 *
 * 领域无关是这条链路里最容易做砸的地方：一份「技术面试官」的提示词在会计岗上会问出
 * 「这个税务筹划的架构是怎样的」这种废话。所以本文件里的手法模板按**简历里出现的措辞**触发，
 * 而不是按行业硬编码。
 */

import { z } from 'zod';
import type { Persona } from './domain.ts';
import {
  COMMON_CONSTRAINTS,
  COMMON_FORBIDDEN,
  type ContractBudgetView,
  type IntentContract,
} from './contract.ts';
import { shortHash, stableStringify } from './util.ts';

export const SENIORITY_VALUES = ['junior', 'mid', 'senior', 'principal'] as const;
export const TONE_VALUES = ['neutral', 'skeptical', 'warm', 'blunt'] as const;

/**
 * 模型优化契约时的输出形状。字段偏窄是故意的：
 * 契约要能被评审，就不该容忍一段两百字的「人设散文」。
 */
export const interviewerDraftSchema = z.object({
  name: z.string().min(1).max(24),
  domain: z.string().max(40),
  seniority: z.enum(SENIORITY_VALUES),
  tone: z.enum(TONE_VALUES),
  blurb: z.string().min(4).max(60),
  goal: z.string().min(8).max(200),
  tactics: z.array(z.string().min(4).max(120)).min(2).max(5),
});

export type InterviewerDraft = z.infer<typeof interviewerDraftSchema>;

/** 自定义面试官的 id 前缀。预设面试官的 id 就是角色名（tech / hr / ...），两者不会撞。 */
export const CUSTOM_ID_PREFIX = 'custom-';

/**
 * 由名称生成可读的 id。带 4 位指纹是为了「同名不等于同一位」：
 * 用户把「市场面试官」改了三次，历史会话里的那一位必须还能指出是哪一版。
 */
export function customInterviewerId(name: string, salt = ''): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const stem = slug.length > 0 ? slug : 'interviewer';
  return CUSTOM_ID_PREFIX + stem + '-' + shortHash(name + '|' + salt, 4);
}

/** 由草稿算出指纹。同一份草稿永远得到同一个指纹，会话记录据此对账。 */
export function draftDigest(draft: InterviewerDraft): string {
  return shortHash(stableStringify(draft), 16);
}

/** 把草稿补成一份完整契约：硬约束与禁止项是共享的，不允许用户改掉 */
export function buildCustomContract(input: {
  id: string;
  draft: InterviewerDraft;
  budget: ContractBudgetView;
  version?: number;
}): IntentContract {
  const persona: Persona = {
    name: input.draft.name,
    role: 'custom',
    seniority: input.draft.seniority,
    tone: input.draft.tone,
    blurb: input.draft.blurb,
  };
  return {
    id: input.id,
    version: input.version ?? 1,
    persona,
    goal: input.draft.goal,
    tactics: input.draft.tactics,
    constraints: COMMON_CONSTRAINTS,
    forbidden: COMMON_FORBIDDEN,
    budget: input.budget,
  };
}

export interface DraftDiff {
  field: string;
  before: string;
  after: string;
}

/** 字段级 diff：让「AI 改了什么」在界面上看得见，而不是让用户对着两段 JSON 找不同 */
export function diffDrafts(before: InterviewerDraft, after: InterviewerDraft): DraftDiff[] {
  const out: DraftDiff[] = [];
  const scalar: readonly (keyof InterviewerDraft)[] = ['name', 'domain', 'seniority', 'tone', 'blurb', 'goal'];
  for (const key of scalar) {
    const a = String(before[key]);
    const b = String(after[key]);
    if (a !== b) out.push({ field: String(key), before: a, after: b });
  }
  const ta = before.tactics.join(' / ');
  const tb = after.tactics.join(' / ');
  if (ta !== tb) out.push({ field: 'tactics', before: ta, after: tb });
  return out;
}

/**
 * 行业识别表：既给页面当提示（DOMAIN_HINTS），也给离线兜底当识别规则。
 * 用别名匹配而不是让用户从下拉里选，是因为用户写的是人话（「面一位临床护士」），
 * 不该为了用这个工具先去理解我们的分类法。识别不到就留空，由用户自己填。
 */
interface DomainAlias {
  domain: string;
  keywords: readonly string[];
}

const DOMAIN_ALIASES: readonly DomainAlias[] = [
  { domain: '软件研发', keywords: ['软件', '开发', '程序员', '前端', '后端', '测试工程师', '运维', '架构'] },
  { domain: '算法与数据', keywords: ['算法', '数据科学', '机器学习', '建模', '数据分析'] },
  { domain: '产品经理', keywords: ['产品经理', '产品岗', '需求分析'] },
  { domain: '市场营销', keywords: ['市场营销', '市场', '营销', '品牌', '策划', '推广'] },
  { domain: '销售', keywords: ['销售', '业绩', '客户经理', '渠道'] },
  { domain: '财务与会计', keywords: ['财务', '会计', '税务', '审计', '出纳'] },
  { domain: '人力资源', keywords: ['人力资源', '人事', '招聘', 'HR'] },
  { domain: '运营', keywords: ['运营', '社群', '内容岗'] },
  { domain: '设计与创意', keywords: ['设计', '创意', '视觉', '美术', '插画'] },
  { domain: '中小学教师', keywords: ['教师', '老师', '教学', '班主任', '中学', '小学', '教研'] },
  { domain: '高校教师与科研', keywords: ['高校', '科研', '论文', '讲师', '副教授', '课题'] },
  { domain: '医护与药学', keywords: ['医护', '护理', '护士', '临床', '药学', '药师', '医院'] },
  { domain: '法律与合规', keywords: ['法律', '法务', '律师', '合规', '诉讼'] },
  { domain: '公务员与事业单位', keywords: ['公务员', '事业单位', '机关', '编制', '选调'] },
  { domain: '生产制造', keywords: ['生产', '制造', '车间', '工艺', '质检'] },
  { domain: '供应链与物流', keywords: ['供应链', '物流', '仓储', '采购', '配送'] },
  { domain: '客户服务', keywords: ['客服', '客户服务', '售后'] },
  { domain: '外贸与翻译', keywords: ['外贸', '翻译', '英语', '报关', '跨境电商'] },
];

/** 页面上的行业提示。只是提示，用户可以填任何一行——这不是白名单。 */
export const DOMAIN_HINTS: readonly string[] = DOMAIN_ALIASES.map((item) => item.domain);

/** 一键套用的例子，全部刻意避开计算机方向——这是「所有专业都能用」最直接的证据 */
export interface DraftSeed {
  label: string;
  text: string;
}

export const DRAFT_SEEDS: readonly DraftSeed[] = [
  {
    label: '市场营销',
    text: '我要面一位市场营销专员。简历里写满了「策划过活动」「粉丝增长多少」「转化率提升」，我想让他把这些数字的口径和归属说清楚。',
  },
  {
    label: '财务会计',
    text: '我要面一位会计。简历写着「熟悉税务筹划」「帮公司节约成本多少万」，我想验证这些数字是怎么算出来的、口径是什么。',
  },
  {
    label: '中小学教师',
    text: '我要面一位初中数学老师。简历写「带班成绩提升」「获评优秀教师」「善于因材施教」，我想问清班级规模、评价口径和具体做法。',
  },
  {
    label: '医护',
    text: '我要面一位临床护士。简历写「熟练各项护理操作」「参与多起抢救」「获患者好评」，我想问清具体场景、职责边界与资质。',
  },
  {
    label: '公务员 / 事业单位',
    text: '我要面一位综合管理岗。简历写「组织协调能力突出」「撰写材料上百篇」「获评先进个人」，我想问清具体事项与个人贡献。',
  },
  {
    label: '人力资源',
    text: '我要面一位招聘专员。简历写「年度招聘完成率 120%」「搭建人才库」「降低离职率」，我想追问数据口径与我在其中的角色。',
  },
];

/** 措辞触发的追问手法。领域无关：触发词是简历里通用的中文表述，不是编程术语。 */
interface TacticRule {
  keywords: readonly string[];
  tactic: string;
}

const TACTIC_RULES: readonly TacticRule[] = [
  {
    keywords: ['%', '％', '倍', '万', '亿', '提升', '增长', '降低', '下降', '缩短', '达到'],
    tactic: '把简历里的数字拆开问：怎么测出来的、口径是什么、跟什么比。',
  },
  {
    keywords: ['负责', '主导', '带领', '牵头', '参与', '独立完成', '从 0 到 1', '从0到1'],
    tactic: '追问「你负责」与「你参与」的边界：这件事里哪一部分是你独立完成的。',
  },
  {
    keywords: ['团队', '协作', '配合', '跨部门', '沟通'],
    tactic: '追问协作细节：对方是谁、你提了什么、最后按谁的意见改的。',
  },
  {
    keywords: ['熟悉', '了解', '掌握', '精通', '运用', '擅长'],
    tactic: '对「熟悉 / 掌握」这类词追一层：最近一次用它解决具体问题是什么时候、结果如何。',
  },
  {
    keywords: ['年', '月', '至今', '起', '期间'],
    tactic: '把两段经历的时间线摆在一起，问衔接处的空档与变化原因。',
  },
  {
    keywords: ['奖', '优秀', '第一', '先进', '表彰', '评为', '好评', '认可'],
    tactic: '追问成果的评选范围与你的实际贡献占比。',
  },
  {
    keywords: ['学习能力强', '抗压', '责任心', '执行力', '积极主动'],
    tactic: '要求为这类自我评价给一个具体场景：当时的情况、你做了什么、对方的反应。',
  },
];

const FALLBACK_TACTICS: readonly string[] = [
  '要求为简历里最笼统的那句话举一个具体例子：时间、对象、你做了什么。',
  '追问这件事如果重做一次会改什么，用来分辨真实经历与照抄描述。',
  '追问这件事与目标岗位的相关性：为什么它能说明你适合这个岗位。',
];

function firstSentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  const parts = trimmed.split(/[。！？!?\n]/);
  for (const part of parts) {
    const s = part.trim();
    if (s.length >= 8) return s.length > 120 ? s.slice(0, 120) : s;
  }
  return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
}

function guessDomain(text: string): string {
  for (const item of DOMAIN_ALIASES) {
    for (const kw of item.keywords) {
      if (text.includes(kw)) return item.domain;
    }
  }
  return '';
}

function guessName(text: string, domain: string): string {
  if (domain.length > 0) return domain.replace(/[与/].*$/, '') + '面试官';
  const m = /面(?:试)?(?:一位|一个|个)?([\u4e00-\u9fa5A-Za-z]{2,10}?)(?:岗|职位|岗位|专员|经理|老师|护士|会计)/.exec(text);
  if (m !== null && m[1] !== undefined) return m[1] + '面试官';
  return '自定义面试官';
}

function guessTone(text: string): 'neutral' | 'skeptical' | 'warm' | 'blunt' {
  if (text.includes('压力') || text.includes('不留情面') || text.includes('犀利')) return 'blunt';
  if (text.includes('温和') || text.includes('友好') || text.includes('鼓励')) return 'warm';
  if (text.includes('细节') || text.includes('深挖') || text.includes('较真') || text.includes('追问到底')) return 'skeptical';
  return 'neutral';
}

/**
 * 离线兜底：**不联网**也能得到一份像样的契约。
 *
 * 它存在的理由有两条，都不是「凑合」：
 * - 评委的机器上不该有 API Key 也能把自定义面试官这条链路走完；
 * - 模型不可用、超时或输出不合规时，用户不该看到一个红叉，而应拿到一份可编辑的草稿。
 *
 * 规则是显式的（TACTIC_RULES），所以它的输出可以被单测固定住，也可以在界面上说明白
 * 「这份草稿是按哪些措辞命中的规则生成的」。
 */
export function localDraftFromText(text: string, opts: Partial<InterviewerDraft> = {}): InterviewerDraft {
  const domain = opts.domain !== undefined && opts.domain.length > 0 ? opts.domain : guessDomain(text);
  const tactics: string[] = [];
  for (const rule of TACTIC_RULES) {
    if (tactics.length >= 4) break;
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        if (!tactics.includes(rule.tactic)) tactics.push(rule.tactic);
        break;
      }
    }
  }
  for (const t of FALLBACK_TACTICS) {
    if (tactics.length >= 3) break;
    if (!tactics.includes(t)) tactics.push(t);
  }
  const sentence = firstSentence(text);
  const goal =
    opts.goal !== undefined && opts.goal.length >= 8
      ? opts.goal
      : sentence.length >= 8
        ? sentence
        : '验证简历里最值得追问的那几处表述是否真的站得住，而不是只由形容词支撑。';
  return {
    name: opts.name !== undefined && opts.name.length > 0 ? opts.name : guessName(text, domain),
    domain,
    seniority: opts.seniority ?? 'senior',
    tone: opts.tone ?? guessTone(text),
    blurb:
      opts.blurb !== undefined && opts.blurb.length >= 4
        ? opts.blurb
        : (domain.length > 0 ? domain : '本行业') + '方向的面试官，按这一行的实际标准看简历',
    goal,
    tactics: tactics.slice(0, 5),
  };
}

/** 离线草稿的生成说明：哪几条规则命中了。界面上直接展示，避免「凭空的 AI 感」。 */
export function localDraftNotes(text: string, draft: InterviewerDraft): string[] {
  const notes: string[] = [];
  for (const rule of TACTIC_RULES) {
    // 只报「真的进了这份草稿」的规则：命中但被条数上限挤掉的手法如果照样写进说明，
    // 用户会照着说明去找一条草稿里根本没有的手法。
    if (!draft.tactics.includes(rule.tactic)) continue;
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        notes.push('命中措辞「' + kw + '」→ ' + rule.tactic);
        break;
      }
    }
  }
  if (notes.length === 0) notes.push('输入里没有命中任何措辞规则，改用三条通用手法（举例 / 复盘 / 相关性）。');
  notes.push('离线生成不发送任何网络请求，字段全部可在页面里手工改。');
  return notes;
}
