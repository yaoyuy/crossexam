/**
 * 岗位模板的形状（P9 行业模板库）。
 *
 * 只放「一个岗位要能被一键喂进去」所必需的东西：岗位名、JD、示例简历、
 * 这类简历常见的坑、以及推荐的面试官组合。刻意不放任何渲染信息——
 * 界面怎么画是前端的事，模板只负责内容。
 *
 * 示例简历里都刻意留了两三处经不起细问的表述（「下降明显」「深受喜爱」这类），
 * 这样一键填充之后立刻能跑出有内容的质询，而不是一片「站得住」。
 */
import type { InterviewerRole } from '../domain.ts';
import type { InterviewerDraft } from '../interviewer.ts';

export interface JobTemplate {
  /** 稳定 id，形如 med-pharmacy-lead；示例简历与面试官草稿的指纹都挂在它上面 */
  id: string;
  /** 12 个行业之一，界面上按它分组 */
  industry: string;
  /** 岗位名，填进投料台的「目标岗位」 */
  title: string;
  /** 原创 JD，180–260 字 */
  jd: string;
  /** 该岗位的示例简历，200–340 字，含可被追问的模糊表述 */
  resume: string;
  /** 这类简历常见的坑，2–3 条，界面在模板旁边摊出来 */
  hints: string[];
  /** 推荐的两位内置面试官 */
  presets: InterviewerRole[];
  /** 为该行业现配的一位自建面试官草稿（与预设共用同一套契约结构） */
  custom: InterviewerDraft;
}

/** 字数与结构红线。测试与运行时共用同一份，避免文档写一套、断言写另一套。 */
export const TEMPLATE_LIMITS = {
  jdMin: 180,
  jdMax: 260,
  resumeMin: 200,
  resumeMax: 340,
  hintsMin: 2,
  hintsMax: 3,
  hintMin: 8,
  hintMax: 60,
  presetsCount: 2,
  industryCount: 12,
  perIndustry: 3,
} as const;
