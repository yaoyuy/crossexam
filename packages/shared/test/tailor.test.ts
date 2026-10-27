import { describe, expect, it } from 'vitest';
import { TAILOR_REASON_LABEL, claimRanges, tailorHeadline, tailorResume } from '../src/tailor.ts';
import type { Anchor, Requirement, RequirementMatch } from '../src/domain.ts';
import type { Revision } from '../src/revise.ts';

const NL = String.fromCharCode(10);

const RESUME = [
  '张明',
  '个人信息',
  '- 主导重构订单系统，首屏加载从 2.4s 降到 0.8s。',
  '- 学习能力强，抗压能力强。',
  '教育背景',
  '- 计算机科学与技术，本科。',
  '专业技能',
  '- 熟练使用 Node.js 与 TypeScript。',
].join(NL);

function anchorOf(quote: string): Anchor {
  const start = RESUME.indexOf(quote);
  if (start < 0) throw new Error('夹具里没有这句话：' + quote);
  return { start, end: start + quote.length, quote, exact: true };
}

const C1 = { id: 'C1', anchor: anchorOf('主导重构订单系统，首屏加载从 2.4s 降到 0.8s。') };
const C2 = { id: 'C2', anchor: anchorOf('学习能力强，抗压能力强。') };

function requirement(id: string, text: string): Requirement {
  const start = RESUME.indexOf('个人信息');
  return {
    id,
    kind: 'must',
    text,
    keywords: [],
    anchor: { start, end: start + 4, quote: '个人信息', exact: true },
    jdId: 'J1',
    sources: ['J1'],
  };
}

function match(requirementId: string, claimId: string | null, status: RequirementMatch['status']): RequirementMatch {
  return { requirementId, claimId, status, reason: '夹具' };
}

const R1 = requirement('R1', '有订单系统的性能优化经验，能给出量化结论');
const R2 = requirement('R2', '具备良好的沟通能力与主人翁意识');
const MATCHES = [match('R1', 'C1', 'hit'), match('R2', null, 'missing')];

function tailor(overrides: Record<string, unknown> = {}) {
  return tailorResume({
    text: RESUME,
    claims: [C1, C2],
    requirements: [R1, R2],
    matches: MATCHES,
    jdTitle: '高级后端工程师',
    ...overrides,
  });
}

describe('一岗一版：只做留下与去掉', () => {
  it('没有要求可对照时原样返回，并说明这一版就是原文', () => {
    const result = tailor({ requirements: [], matches: [] });
    expect(result.ok).toBe(true);
    // 原样返回：一个字符都不动，包括结尾有没有换行
    expect(result.text).toBe(RESUME);
    expect(result.note).toContain('就是原文');
    expect(result.droppedClaims).toEqual([]);
  });

  it('命中要求的主张留下，对不上的那一行去掉', () => {
    const result = tailor();
    expect(result.ok).toBe(true);
    expect(result.keptClaims).toEqual(['C1']);
    expect(result.droppedClaims).toEqual(['C2']);
    expect(result.text).toContain('主导重构订单系统');
    expect(result.text).not.toContain('学习能力强');
  });

  it('没有主张的行一律留下：岗位没提教育背景，不等于教育背景该删', () => {
    const result = tailor();
    expect(result.text).toContain('计算机科学与技术，本科。');
    expect(result.text).toContain('熟练使用 Node.js 与 TypeScript。');
    expect(result.text).toContain('教育背景');
    expect(result.text).toContain('专业技能');
    expect(result.text).toContain('个人信息');
  });

  it('保留下来的行与原文逐字一致：一个字的表述都没改', () => {
    const result = tailor();
    for (const line of result.lines) {
      if (!line.keep) continue;
      expect(result.text.split(NL)).toContain(line.text);
    }
    expect(result.lines.find((line) => line.text.includes('学习能力强'))?.keep).toBe(false);
  });

  it('每一条留下的主张都说得清是因为哪条要求', () => {
    const result = tailor();
    const kept = result.lines.find((line) => line.claimIds.includes('C1'));
    expect(kept?.reason).toBe('matched');
    expect(kept?.requirementIds).toEqual(['R1']);
    expect(kept?.header).toBe(false);
    const heading = result.lines.find((line) => line.header);
    expect(heading?.reason).toBe('no-claim');
    expect(heading?.keep).toBe(true);
  });

  it('一条都对不上时明确拒绝筛，交回原文并说清原因', () => {
    const result = tailor({ matches: [match('R1', null, 'missing'), match('R2', null, 'missing')] });
    expect(result.ok).toBe(false);
    expect(result.text).toBe(RESUME);
    expect(result.note).toContain('空壳');
    expect(result.headline).toContain('没敢筛');
  });

  it('句子里的数字与要求一起进结论：缺口也报出来', () => {
    const result = tailor();
    expect(result.missingRequirements).toBe(1);
    expect(result.headline).toBe('按《高级后端工程师》：留下 1 条主张、去掉 1 条，另有 1 条要求简历里没写');
    expect(tailorHeadline(1, 1, 0, 'X')).toBe('按《X》：留下 1 条主张、去掉 1 条');
  });

  it('对得上这个岗位的每一行都留下时不报警，只说这份简历对得上', () => {
    const result = tailor({ claims: [C1], matches: [match('R1', 'C1', 'hit'), match('R2', null, 'missing')] });
    expect(result.note).toContain('没有筛掉任何一条主张');
  });

  it('输出以换行结尾，留下的段数与被去掉的段数相加等于正文段数', () => {
    const result = tailor();
    expect(result.text.endsWith(NL)).toBe(true);
    expect(result.keptSegments + result.droppedSegments).toBe(result.lines.length);
  });

  it('三种理由都有中文说明，界面不用自己编', () => {
    expect(TAILOR_REASON_LABEL['no-claim']).toContain('任何岗位都留着');
    expect(TAILOR_REASON_LABEL.matched).toContain('对得上');
    expect(TAILOR_REASON_LABEL.unmatched).toContain('对不上');
  });
});

describe('采纳过改写之后，主张坐标要能挪到改后的文本上', () => {
  const before = '学习能力强，抗压能力强。';
  const after = '抗压：有线上故障值班与复盘经历。';
  const revisedText = RESUME.split(before).join(after);
  const revisions: Revision[] = [
    {
      claimId: 'C2',
      start: C2.anchor.start,
      end: C2.anchor.end,
      before,
      after,
    },
  ];

  it('整句被改写过的那条，长度按改后的文本算', () => {
    const ranges = claimRanges([C1, C2], revisions);
    const c1 = ranges.find((range) => range.claimId === 'C1');
    const c2 = ranges.find((range) => range.claimId === 'C2');
    expect(c2?.start).toBe(C2.anchor.start);
    expect(c2?.end).toBe(C2.anchor.start + after.length);
    expect(revisedText.slice(c2?.start, c2?.end)).toBe(after);
    expect(c1?.start).toBe(C1.anchor.start);
  });

  it('裁的是改后那一版：留下的仍是改后的句子，被去掉的仍是同一条主张', () => {
    const result = tailorResume({
      text: revisedText,
      claims: [C1, C2],
      applied: revisions,
      requirements: [R1, R2],
      matches: MATCHES,
      jdTitle: '高级后端工程师',
    });
    expect(result.keptClaims).toEqual(['C1']);
    expect(result.droppedClaims).toEqual(['C2']);
    expect(result.text).not.toContain('抗压：有线上故障值班');
    expect(result.text).toContain('主导重构订单系统');
  });

  it('坐标没采纳过的那些主张按位移近似，仍落在同一行里', () => {
    const inserted: Revision = { claimId: 'C9', start: 0, end: 0, before: '', after: '手机 13800000000' + NL };
    const result = tailorResume({
      text: '手机 13800000000' + NL + RESUME,
      claims: [C1, C2],
      applied: [inserted],
      requirements: [R1, R2],
      matches: MATCHES,
      jdTitle: '高级后端工程师',
    });
    expect(result.keptClaims).toEqual(['C1']);
    expect(result.droppedClaims).toEqual(['C2']);
  });
});
