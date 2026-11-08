import { describe, expect, it } from 'vitest';
import { MAX_QUESTION_MARKS, WELL_KNOWN_ORGS, assumedFactsIn, questionMarkCount } from '../src/contract.ts';
import {
  CONTRIBUTION_HIGH_MARKERS,
  CONTRIBUTION_LOW_MARKERS,
  contributionEscalation,
} from '../src/style.ts';

/** 与 orchestrator 测试保持同一份简历：闸门是拿它当「原文依据」的 */
const RESUME = '项目经历\n主导重构订单系统，首屏从 2.4s 降到 0.8s，日订单量 30 万。\n熟悉 TypeScript 与 Node.js。';

describe('契约③：一次只问一个问题', () => {
  it('中英文问号一起数，阈值写死为 1', () => {
    expect(MAX_QUESTION_MARKS).toBe(1);
    expect(questionMarkCount('这个 2.4s 是怎么测出来的？')).toBe(1);
    expect(questionMarkCount('怎么测的?')).toBe(1);
    expect(questionMarkCount('怎么测的？口径是什么??')).toBe(3);
    expect(questionMarkCount('没有问号，只是陈述。')).toBe(0);
  });
});

describe('契约④：不得假设简历里没有的事实', () => {
  it('数字：简历里没有的大数、小数会被点名', () => {
    expect(assumedFactsIn('这台机器上 5000 的 QPS 是怎么压出来的？', RESUME)).toEqual([
      { kind: 'number', token: '5000' },
    ]);
    expect(assumedFactsIn('延迟 3.5s 是吧？', RESUME)).toEqual([{ kind: 'number', token: '3.5' }]);
    expect(assumedFactsIn('首屏 0.8s 是怎么测的？', RESUME)).toEqual([]);
  });

  it('反面：序数、小整数、P75 这类标识符不是事实断言，不能被当成编造', () => {
    expect(assumedFactsIn('第 2 次追问 P75 是什么？', RESUME)).toEqual([]);
    expect(assumedFactsIn('岗位写 5 年以上，你简历里没写年限？', RESUME)).toEqual([]);
  });

  it('机构名：简历里没出现过的机构会被点名', () => {
    expect(assumedFactsIn('你在字节跳动做过什么？', RESUME)).toEqual([{ kind: 'org', token: '字节跳动' }]);
    expect(assumedFactsIn('你在字节跳动的实习做了什么？', '2023 年在字节跳动实习')).toEqual([]);
  });

  it('反面：指代词不是机构名，别把「你在这家公司做什么」判成编造', () => {
    expect(assumedFactsIn('你说的这家公司是做什么的？', RESUME)).toEqual([]);
  });

  it('词表放在 shared 里：可测、可扩、不散落在提示词', () => {
    expect(WELL_KNOWN_ORGS.length).toBeGreaterThan(10);
    expect(WELL_KNOWN_ORGS).toContain('字节跳动');
  });

  it('断言式贡献：高阶梯动词 + 过/了 之后的对象必须在原文里有依据', () => {
    const facts = assumedFactsIn('你主导过的高并发架构是怎么设计的？', RESUME);
    expect(facts.map((f) => f.kind)).toEqual(['contribution']);
    expect(facts[0]?.token).toContain('高并发架构');
  });

  it('反面：询问归属而不是假设事实的提问不能被误杀', () => {
    expect(assumedFactsIn('这个重构是你主导的还是参与的？', RESUME)).toEqual([]);
    expect(assumedFactsIn('Node.js 的哪些部分是你独立完成的？', RESUME)).toEqual([]);
    expect(assumedFactsIn('你主导的是哪一部分？', RESUME)).toEqual([]);
  });

  it('反面：对象能在原文里锚回来的断言不算编造', () => {
    expect(assumedFactsIn('你主导过的订单系统重构是怎么排期的？', RESUME)).toEqual([]);
    expect(assumedFactsIn('你独立完成过的 TypeScript 类型体操是什么？', '熟悉 TypeScript 类型体操')).toEqual([]);
  });
});

describe('升格闸门：before → after 的个人贡献阶梯', () => {
  it('词表放在 shared：高低两档都非空且可断言', () => {
    expect(CONTRIBUTION_HIGH_MARKERS).toContain('主导');
    expect(CONTRIBUTION_HIGH_MARKERS).toContain('独立完成');
    expect(CONTRIBUTION_HIGH_MARKERS).toContain('全权负责');
    expect(CONTRIBUTION_LOW_MARKERS).toContain('参与');
  });

  it('红队输入：参与 → 主导 + 独立完成，必须拦下并说清理由', () => {
    const hit = contributionEscalation('参与支付网关迁移', '主导支付网关迁移，独立完成全流程');
    expect(hit).not.toBeNull();
    expect(hit?.markers).toEqual(['主导', '独立完成']);
    expect(hit?.reason).toContain('参与');
    expect(hit?.reason).toContain('升格');
  });

  it('依据（这条主张所在的简历原句）里本来就写了「主导」：把原句补全不算升格', () => {
    // 漏了这条，style.test.ts 的常规档会被误杀 —— 那次红就是被它抓出来的。
    // before 只是模型挑的窄引文，短于它所在的那句话；依据要给整句，否则「补全原句」看起来就像升格。
    expect(
      contributionEscalation(
        '首屏从 2.4s 降到 0.8s',
        '主导重构订单系统，首屏从 2.4s 降到 0.8s，日订单量 30 万。',
        '主导重构订单系统，首屏从 2.4s 降到 0.8s，日订单量 30 万。',
      ),
    ).toBeNull();
    // 反过来：依据里也没有，照样拦
    expect(
      contributionEscalation(
        '首屏从 2.4s 降到 0.8s',
        '主导重构订单系统，首屏从 2.4s 降到 0.8s，日订单量 30 万。',
        '首屏从 2.4s 降到 0.8s，日订单量 30 万。',
      )?.markers,
    ).toEqual(['主导']);
  });

  it('反面：降级（主导 → 参与）不算升格', () => {
    expect(contributionEscalation('主导重构订单系统', '参与重构订单系统')).toBeNull();
  });

  it('反面：原文本来就写了「独立完成」，改写后保留不算升格', () => {
    expect(
      contributionEscalation(
        '独立完成 RBAC 权限模块，覆盖 12 个业务线。',
        '负责 RBAC 权限模块的设计与实现，覆盖 12 个业务线的权限接入（核心模型与鉴权链路由我独立完成）',
      ),
    ).toBeNull();
  });

  it('反面：「负责」是中性动词不算升格；原文完全没有贡献词时也不判升格', () => {
    expect(
      contributionEscalation(
        '参与的项目获得公司年度技术突破奖。',
        '参与的项目获得公司年度技术突破奖（本人负责其中权限模块的设计与实现）',
      ),
    ).toBeNull();
    expect(
      contributionEscalation(
        '学习能力强，抗压能力强，有责任心，能快速融入团队。',
        '学习能力：能在两周内独立接手陌生模块；抗压：有线上故障值班与复盘经历（详见项目经历）',
      ),
    ).toBeNull();
  });
});
