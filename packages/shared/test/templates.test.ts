import { describe, expect, it } from 'vitest';
import {
  JOB_TEMPLATES,
  TEMPLATE_INDUSTRIES,
  TEMPLATE_LIMITS,
  templateById,
  templateDigest,
  templateProblems,
  templatesOfIndustry,
  type JobTemplate,
} from '../src/templates.ts';
import { interviewerDraftSchema } from '../src/interviewer.ts';
import { PERSONA_PRESETS } from '../src/contract.ts';

const PRESET_ROLES = Object.keys(PERSONA_PRESETS);

/** 示例简历里必须留着能被追问的地方，否则一键填充之后一场质询全是「站得住」 */
const VAGUE_MARKERS = ['明显', '良好', '深受', '参与', '熟悉', '较强', '若干', '多次', '优先', '大幅', '为主', '左右', '协助', '靠前', '常常'];

function clone(first: JobTemplate, patch: Partial<JobTemplate>): JobTemplate {
  return { ...first, ...patch };
}

/** 取第一条：模板库是空的就该红，而不是让下面每条断言自己去处理 undefined */
function firstTemplate(): JobTemplate {
  const first: JobTemplate | undefined = JOB_TEMPLATES[0];
  if (first === undefined) throw new Error('模板库是空的');
  return first;
}

describe('岗位模板库', () => {
  it('数量与行业分布符合约定', () => {
    expect(JOB_TEMPLATES.length).toBe(TEMPLATE_LIMITS.industryCount * TEMPLATE_LIMITS.perIndustry);
    expect(JOB_TEMPLATES.length).toBe(36);
    expect(TEMPLATE_INDUSTRIES.length).toBe(TEMPLATE_LIMITS.industryCount);
    expect(new Set(TEMPLATE_INDUSTRIES).size).toBe(TEMPLATE_LIMITS.industryCount);
    for (const industry of TEMPLATE_INDUSTRIES) {
      expect(templatesOfIndustry(industry).length).toBe(TEMPLATE_LIMITS.perIndustry);
    }
  });

  it('全部 36 条过结构自检，一条问题都不许有', () => {
    expect(templateProblems(JOB_TEMPLATES)).toEqual([]);
  });

  it('id 唯一且能按 id 取回', () => {
    const ids = JOB_TEMPLATES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of JOB_TEMPLATES) {
      expect(templateById(item.id)?.title).toBe(item.title);
    }
    expect(templateById('nope-nope')).toBeNull();
  });

  it('每条的自定义面试官草稿都过 shared 自己的 zod 契约', () => {
    for (const item of JOB_TEMPLATES) {
      const parsed = interviewerDraftSchema.safeParse(item.custom);
      if (!parsed.success) {
        throw new Error(item.id + ' 的草稿不合约：' + JSON.stringify(parsed.error.issues));
      }
      expect(parsed.success).toBe(true);
    }
  });

  it('推荐面试官只能从内置的五位里选，且正好两位不重复', () => {
    for (const item of JOB_TEMPLATES) {
      expect(item.presets.length).toBe(TEMPLATE_LIMITS.presetsCount);
      expect(new Set(item.presets).size).toBe(item.presets.length);
      for (const role of item.presets) {
        expect(PRESET_ROLES).toContain(role);
      }
    }
  });

  it('每条示例简历都留了能被追问的模糊表述，而且带具体数字', () => {
    for (const item of JOB_TEMPLATES) {
      const hit = VAGUE_MARKERS.filter((word) => item.resume.includes(word));
      if (hit.length === 0) throw new Error(item.id + ' 的示例简历太干净了：一个可追问的模糊说法都没有');
      expect(hit.length).toBeGreaterThan(0);
      expect(/[0-9０-９]/.test(item.resume)).toBe(true);
    }
  });

  it('模板指纹稳定、定长，且文案一改就变', () => {
    const first = firstTemplate();
    expect(templateDigest(first)).toBe(templateDigest(first));
    expect(templateDigest(first).length).toBe(16);
    const tweaked = clone(first, { title: first.title + '（改）' });
    expect(templateDigest(tweaked)).not.toBe(templateDigest(first));
  });

  it('把整份 36 条当底子，再逐项注入一处毛病：自检必须点名那一处', () => {
    const base = [...JOB_TEMPLATES];
    const first = firstTemplate();
    const withFirst = (patch: Partial<JobTemplate>): string[] => {
      const list = [...base];
      list[0] = { ...first, ...patch };
      return templateProblems(list);
    };
    // 用整份 36 条当底子，注入的问题才是唯一的问题；否则「总数不对」会把所有断言都变成假通过
    expect(templateProblems(base)).toEqual([]);
    expect(withFirst({ id: 'Bad_ID' }).some((item) => item.includes('id 只能'))).toBe(true);
    expect(withFirst({ id: base[1]!.id }).some((item) => item.includes('id 重复'))).toBe(true);
    expect(withFirst({ jd: '太短' }).some((item) => item.includes('JD'))).toBe(true);
    expect(withFirst({ resume: 'A'.repeat(400) }).some((item) => item.includes('示例简历'))).toBe(true);
    expect(withFirst({ hints: ['短'] }).some((item) => item.includes('提示'))).toBe(true);
    expect(withFirst({ presets: ['tech', 'tech'] }).some((item) => item.includes('重复'))).toBe(true);
    expect(withFirst({ presets: ['tech'] }).some((item) => item.includes('正好 2 位'))).toBe(true);
    expect(withFirst({ jd: first.jd + '（来源：www.example.com）' }).some((item) => item.includes('链接'))).toBe(true);
  });
});
