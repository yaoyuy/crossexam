/**
 * CrossExam 领域模型。
 *
 * 设计原则：**凡是 AI 说的话，都必须能指回简历原文的某个字符区间。**
 * 因此 Anchor 不是可选的装饰字段，而是 Claim / Probe / Verdict / Suggestion
 * 四类实体的构造必经之路——没有锚点就构造不出来。见 anchor.ts。
 */

/** 简历全文里的一个左闭右开区间 */
export interface TextSpan {
  start: number;
  end: number;
}

/**
 * 证据锚点。
 * quote 必须逐字（或归一化后）出现在简历原文中，否则锚点无法建立。
 */
export interface Anchor extends TextSpan {
  quote: string;
  /** true = 逐字命中；false = 归一化后命中（全半角标点 / 空白 / 大小写差异） */
  exact: boolean;
}

export type ClaimCategory =
  | 'skill'        // 技能掌握
  | 'experience'   // 经历
  | 'achievement'  // 成果
  | 'metric'       // 数字指标
  | 'ownership'    // 主导 / 负责程度
  | 'timeline'     // 时间线
  | 'other';

export type VerdictKind =
  | 'solid'         // 站得住
  | 'overstated'    // 表述过度
  | 'unsupported'   // 证据缺失
  | 'contradicts'   // 与原文矛盾
  | 'unanswerable'; // 无法回答

export const VERDICT_LABEL: Record<VerdictKind, string> = {
  solid: '站得住',
  overstated: '表述过度',
  unsupported: '证据缺失',
  contradicts: '与原文矛盾',
  unanswerable: '无法回答',
};

/** 主张类别的中文标签。和 VERDICT_LABEL 一样放在领域层，前端与报告共用一份，避免两处各写一套 */
export const CLAIM_CATEGORY_LABEL: Record<ClaimCategory, string> = {
  skill: '技能掌握',
  experience: '经历',
  achievement: '成果',
  metric: '数字指标',
  ownership: '主导程度',
  timeline: '时间线',
  other: '其他',
};

export type InterviewerRole = 'tech' | 'hr' | 'hiring_manager' | 'stress' | 'domain_expert';

export type Seniority = 'junior' | 'mid' | 'senior' | 'principal';
export type Tone = 'neutral' | 'skeptical' | 'warm' | 'blunt';

export interface Persona {
  name: string;
  /** 五位内置面试官用角色名；用户自己定义的面试官用 'custom'（见 interviewer.ts） */
  role: InterviewerRole | 'custom';
  seniority: Seniority;
  tone: Tone;
  /** 一句话人设描述，同时用于前端展示与提示词渲染 */
  blurb: string;
}

/** 主张：从简历里抽出来、值得被追问的一句话 */
export interface Claim {
  id: string;
  text: string;
  anchor: Anchor;
  category: ClaimCategory;
  /** 0..1，被追问的价值；由抽取阶段给出，判定阶段不修改 */
  weight: number;
}

/** 被锚定机制拦下来的主张——这是「证据锚定」创新点的可见产物 */
export interface RejectedClaim {
  text: string;
  quote: string;
  reason: string;
}

export interface Probe {
  id: string;
  claimId: string;
  interviewerId: string;
  /** 第几轮追问，从 1 开始 */
  round: number;
  question: string;
  anchor: Anchor;
  parentProbeId: string | null;
  /** 为什么问这个——可解释性要求，前端要展示 */
  rationale: string;
  /**
   * 岗位要求锚点（双锚点）。
   * 命中某条岗位要求但答得含糊时，追问会同时锚住简历原文与要求原文——
   * 「你为什么说我答得含糊」于是有据可查，而不是面试官的主观印象。
   * 纯简历场次与老会话没有这两个字段，一律按「只锚简历」处理。
   */
  requirementId?: string | null;
  jdAnchor?: Anchor | null;
}

export interface Answer {
  probeId: string;
  text: string;
  mode: AnswerMode;
  /** 作答时援引的简历原文；为空即「答不上来」 */
  citedAnchors: Anchor[];
}

/** live = 用户亲自作答；simulated = 求职者 Agent 只依据简历作答（离线演示路径） */
export type AnswerMode = 'live' | 'simulated';

export interface Verdict {
  claimId: string;
  kind: VerdictKind;
  confidence: number;
  rationale: string;
  evidence: Anchor[];
  probeIds: string[];
}

/** 反推回简历的修改建议，定位到原文区间 */
export interface Suggestion {
  claimId: string;
  anchor: Anchor;
  problem: string;
  before: string;
  after: string;
  why: string;
}

export type SessionMode = 'live' | 'simulated';

export interface SessionRecord {
  id: string;
  resumeName: string;
  jdText: string;
  mode: SessionMode;
  createdAt: number;
}

/* ------------------------------------------------------------- 岗位要求（多 JD 驱动） */

/** 一条要求在招聘语境里的分量。三类分开摆，界面才不会把「硬性」和「职责」混成一锅。 */
export type RequirementKind = 'must' | 'plus' | 'duty';

export const REQUIREMENT_KIND_LABEL: Record<RequirementKind, string> = {
  must: '硬性要求',
  plus: '加分项',
  duty: '岗位职责',
};

/** 用户交进来的一份岗位描述。id 由代码按顺序编（J1..Jn），与 JD 文本一起落库。 */
export interface JobDescription {
  id: string;
  ordinal: number;
  title: string;
  text: string;
}

/**
 * 一条岗位要求。
 *
 * anchor 锚在这条要求所属的那份 JD 原文上（resolveAnchor 不关心 source 是简历还是 JD，
 * 所以这里不需要新机制）；sources 记的是跨份 JD 合并时并进来的 JD id。
 */
export interface Requirement {
  id: string;
  kind: RequirementKind;
  text: string;
  keywords: string[];
  anchor: Anchor;
  /** 代表句出自哪份 JD（合并后取最长引文那一份） */
  jdId: string;
  /** 合并进来的所有 JD id，按 JD 顺序 */
  sources: string[];
}

/** 简历对一条要求的回答程度。missing 不生成追问——没写过的经历，逼问没有意义。 */
export type MatchStatus = 'hit' | 'weak' | 'missing';

export const MATCH_LABEL: Record<MatchStatus, string> = {
  hit: '答得上',
  weak: '答得含糊',
  missing: '简历里没写',
};

export interface RequirementMatch {
  requirementId: string;
  /** 命中的主张 id；missing 时是 null */
  claimId: string | null;
  status: MatchStatus;
  reason: string;
}