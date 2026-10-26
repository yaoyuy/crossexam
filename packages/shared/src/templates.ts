/**
 * 岗位模板库（P9）。
 *
 * 12 个行业 × 3 个岗位 = 36 条，全部原创。分四个文件放是为了让每一组的
 * 文案能被人一次读完，而不是塞进一个两千行的巨型常量。
 *
 * 这里不做「模板 → 界面」的加工：服务端把模板原样交给前端（含自定义面试官草稿），
 * 界面上点一下就把 JD、示例简历、面试官组合三处一起填好。
 */
import type { JobTemplate } from './templates/types.ts';
import { TEMPLATE_LIMITS } from './templates/types.ts';
import { PART1 } from './templates/part1.ts';
import { PART2 } from './templates/part2.ts';
import { PART3 } from './templates/part3.ts';
import { PART4 } from './templates/part4.ts';
import { stableStringify, shortHash } from './util.ts';

export { TEMPLATE_LIMITS } from './templates/types.ts';
export type { JobTemplate } from './templates/types.ts';

export const JOB_TEMPLATES: readonly JobTemplate[] = [...PART1, ...PART2, ...PART3, ...PART4];

/** 行业顺序 = 数据里的出现顺序，界面按它分组，不另排 */
export const TEMPLATE_INDUSTRIES: readonly string[] = JOB_TEMPLATES.reduce<string[]>((acc, item) => {
  if (!acc.includes(item.industry)) acc.push(item.industry);
  return acc;
}, []);

export function templateById(id: string): JobTemplate | null {
  return JOB_TEMPLATES.find((item) => item.id === id) ?? null;
}

export function templatesOfIndustry(industry: string): JobTemplate[] {
  return JOB_TEMPLATES.filter((item) => item.industry === industry);
}

/** 模板指纹：摊位上的文案改一个字，界面上的「已更新」提示就靠它判断 */
export function templateDigest(template: JobTemplate): string {
  return shortHash(stableStringify(template), 16);
}

/** 结构自检：返回人话问题列表，空数组表示这份数据是合格的。测试与接口共用 */
export function templateProblems(list: readonly JobTemplate[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const item of list) {
    const at = item.id + '（' + item.title + '）';
    if (!/^[a-z0-9-]+$/.test(item.id)) problems.push(at + '：id 只能是小写字母、数字与短横线');
    if (seen.has(item.id)) problems.push(at + '：id 重复');
    seen.add(item.id);
    counts.set(item.industry, (counts.get(item.industry) ?? 0) + 1);
    if (item.title.trim().length < 2) problems.push(at + '：岗位名太短');
    const jd = item.jd.trim().length;
    if (jd < TEMPLATE_LIMITS.jdMin || jd > TEMPLATE_LIMITS.jdMax) {
      problems.push(at + '：JD ' + String(jd) + ' 字，应在 ' + String(TEMPLATE_LIMITS.jdMin) + '–' + String(TEMPLATE_LIMITS.jdMax) + ' 字之间');
    }
    const resume = item.resume.trim().length;
    if (resume < TEMPLATE_LIMITS.resumeMin || resume > TEMPLATE_LIMITS.resumeMax) {
      problems.push(at + '：示例简历 ' + String(resume) + ' 字，应在 ' + String(TEMPLATE_LIMITS.resumeMin) + '–' + String(TEMPLATE_LIMITS.resumeMax) + ' 字之间');
    }
    if (item.hints.length < TEMPLATE_LIMITS.hintsMin || item.hints.length > TEMPLATE_LIMITS.hintsMax) {
      problems.push(at + '：提示应 ' + String(TEMPLATE_LIMITS.hintsMin) + '–' + String(TEMPLATE_LIMITS.hintsMax) + ' 条');
    }
    for (const hint of item.hints) {
      if (hint.trim().length < TEMPLATE_LIMITS.hintMin || hint.trim().length > TEMPLATE_LIMITS.hintMax) {
        problems.push(at + '：提示「' + hint.slice(0, 12) + '…」长度不在范围内');
      }
    }
    if (item.presets.length !== TEMPLATE_LIMITS.presetsCount) {
      problems.push(at + '：推荐面试官应正好 ' + String(TEMPLATE_LIMITS.presetsCount) + ' 位');
    }
    if (new Set(item.presets).size !== item.presets.length) problems.push(at + '：推荐面试官重复');
    if (/https?:|www\.|有限公司|BOSS|智联|前程无忧/.test(item.jd + item.resume)) {
      problems.push(at + '：文案里出现了链接、真实企业名或招聘平台名');
    }
  }
  if (list.length !== TEMPLATE_LIMITS.industryCount * TEMPLATE_LIMITS.perIndustry) {
    problems.push('模板总数应为 ' + String(TEMPLATE_LIMITS.industryCount * TEMPLATE_LIMITS.perIndustry) + ' 条，实际 ' + String(list.length) + ' 条');
  }
  const industries = [...counts.keys()];
  if (industries.length !== TEMPLATE_LIMITS.industryCount) {
    problems.push('行业数应为 ' + String(TEMPLATE_LIMITS.industryCount) + ' 个，实际 ' + String(industries.length) + ' 个');
  }
  for (const [industry, n] of counts) {
    if (n !== TEMPLATE_LIMITS.perIndustry) {
      problems.push('行业「' + industry + '」有 ' + String(n) + ' 个岗位，应为 ' + String(TEMPLATE_LIMITS.perIndustry) + ' 个');
    }
  }
  return problems;
}
