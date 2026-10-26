/**
 * 岗位模板在界面上怎么摆：分组、提示文案。都是纯函数，便于单测。
 *
 * 模板数据来自服务端（前端不引 @crossexam/shared 的聚合出口，那会拖进 node:crypto），
 * 所以这里只做展示层的加工，不重复校验规则——规则只有服务端那一份。
 */

/** 只要求带 industry：分组这件事不该逼着调用方凑齐一整条模板 */
export interface HasIndustry {
  industry: string;
}

export interface TemplateGroup<T extends HasIndustry> {
  industry: string;
  items: T[];
}

/**
 * 按服务端给的行业顺序分组。行业里一条都没有就不出现，避免点开是空面板。
 * 服务端漏报的行业按数据里出现的顺序补在后面——宁可多一组，也不要让模板凭空消失。
 */
export function groupTemplates<T extends HasIndustry>(
  industries: readonly string[],
  templates: readonly T[],
): TemplateGroup<T>[] {
  const groups: TemplateGroup<T>[] = [];
  const push = (industry: string): void => {
    const items = templates.filter((item) => item.industry === industry);
    if (items.length > 0) groups.push({ industry, items });
  };
  for (const industry of industries) push(industry);
  for (const item of templates) {
    if (!groups.some((group) => group.industry === item.industry)) push(item.industry);
  }
  return groups;
}

/** 默认停在哪个行业：第一个有内容的 */
export function defaultIndustry(groups: readonly HasIndustry[]): string {
  return groups[0]?.industry ?? '';
}

/** 选中行业非法（数据刷新后那个行业没了）时退回默认，不把界面停在空面板上 */
export function usableIndustry(groups: readonly HasIndustry[], wanted: string): string {
  return groups.some((group) => group.industry === wanted) ? wanted : defaultIndustry(groups);
}

/**
 * 采用之后那句提示：填了什么、换了谁，一次说清，不用用户回去核对。
 * 刻意只收三个字段而不是整个 AppliedTemplate：这句话跟契约详情无关。
 */
export function applyNote(
  applied: { title: string; panel: readonly string[]; created: boolean },
  nameOf: (id: string) => string,
): string {
  const names = applied.panel.map((id) => nameOf(id)).join(' / ');
  const reused = applied.created ? '' : '（这位面试官库里本来就有，直接复用了）';
  return '已装好「' + applied.title + '」：JD 与示例简历填进投料台，面试官换成 ' + names + '。' + reused;
}

/** 模板旁边摊出来的那两三条「这类简历常见的坑」 */
export function hintLine(hints: readonly string[]): string {
  return hints.join('；');
}
