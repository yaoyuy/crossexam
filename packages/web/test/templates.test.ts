import { describe, expect, it } from 'vitest';
import { applyNote, defaultIndustry, groupTemplates, hintLine, usableIndustry } from '../src/templates.ts';

function tpl(id: string, industry: string): { id: string; industry: string } {
  return { id, industry };
}

const A = tpl('a-1', '医疗护理');
const A2 = tpl('a-2', '医疗护理');
const B = tpl('b-1', '教育教学');
const C = tpl('c-1', '计算机软件');

describe('岗位模板在界面上的分组', () => {
  it('按服务端给的行业顺序分组，空行业不出现', () => {
    const groups = groupTemplates(['教育教学', '医疗护理', '空行业'], [A, A2, B]);
    expect(groups.map((group) => group.industry)).toEqual(['教育教学', '医疗护理']);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['b-1']);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(['a-1', 'a-2']);
  });

  it('服务端漏报的行业按数据里出现的顺序补在后面，模板不能凭空消失', () => {
    const groups = groupTemplates(['医疗护理'], [A, C, B]);
    expect(groups.map((group) => group.industry)).toEqual(['医疗护理', '计算机软件', '教育教学']);
  });

  it('没有模板时分组为空，界面据此整块不渲染', () => {
    expect(groupTemplates(['医疗护理'], [])).toEqual([]);
    expect(groupTemplates([], [])).toEqual([]);
  });

  it('选中行业失效时退回第一个，不把界面停在空面板上', () => {
    const groups = groupTemplates(['医疗护理', '教育教学'], [A, B]);
    expect(defaultIndustry(groups)).toBe('医疗护理');
    expect(defaultIndustry([])).toBe('');
    expect(usableIndustry(groups, '教育教学')).toBe('教育教学');
    expect(usableIndustry(groups, '早就不存在的行业')).toBe('医疗护理');
    expect(usableIndustry([], '医疗护理')).toBe('');
  });
});

describe('一键采用之后的那句话', () => {
  const nameOf = (id: string): string => (id === 'tech' ? '技术面试官' : '药房主管');

  it('点名换了哪几位面试官，并按顺序念出来', () => {
    const note = applyNote({ title: '三甲医院药房主管', panel: ['tech', 'custom-x'], created: true }, nameOf);
    expect(note).toBe('已装好「三甲医院药房主管」：JD 与示例简历填进投料台，面试官换成 技术面试官 / 药房主管。');
  });

  it('复用了库里已有的一位时要说明，不能让用户以为又建了一位', () => {
    const note = applyNote({ title: '临床护士', panel: ['tech'], created: false }, nameOf);
    expect(note).toContain('（这位面试官库里本来就有，直接复用了）');
  });

  it('新存的就不带那句复用说明', () => {
    expect(applyNote({ title: '临床护士', panel: ['tech'], created: true }, nameOf)).not.toContain('复用了');
  });

  it('提示里把常见的坑用分号连成一行', () => {
    expect(hintLine(['成果没有口径', '时间线有空档'])).toBe('成果没有口径；时间线有空档');
    expect(hintLine([])).toBe('');
  });
});
