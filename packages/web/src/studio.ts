/**
 * 面试官工作室要用到的文案与边界值。
 *
 * 为什么抄一份而不是 import @crossexam/shared：见 labels.ts 顶部——
 * shared 依赖 node:crypto，进不了浏览器包。抄写的代价是可能漂移，
 * 所以 packages/web/test/studio.test.ts 会把它和 shared 的真值逐项对账，
 * 任何一边改了另一边没跟上，测试立刻红。
 */

/** 与 shared 的 SENIORITY_VALUES 同序 */
export const SENIORITY_LABEL: { value: string; label: string }[] = [
  { value: 'junior', label: '初级' },
  { value: 'mid', label: '中级' },
  { value: 'senior', label: '资深' },
  { value: 'principal', label: '专家 / 负责人' },
];

/** 与 shared 的 TONE_VALUES 同序 */
export const TONE_LABEL: { value: string; label: string; hint: string }[] = [
  { value: 'neutral', label: '中性', hint: '按事实问，不带情绪' },
  { value: 'skeptical', label: '存疑', hint: '默认先不信，要求拿证据' },
  { value: 'warm', label: '温和', hint: '鼓励式追问，适合应届与转行' },
  { value: 'blunt', label: '直接', hint: '压力面，话短、问题硬' },
];

/** 行业提示。只是提示，不是白名单——用户可以填任何一行。与 shared 的 DOMAIN_HINTS 对账。 */
export const DOMAIN_HINTS: string[] = [
  '软件研发',
  '算法与数据',
  '产品经理',
  '市场营销',
  '销售',
  '财务与会计',
  '人力资源',
  '运营',
  '设计与创意',
  '中小学教师',
  '高校教师与科研',
  '医护与药学',
  '法律与合规',
  '公务员与事业单位',
  '生产制造',
  '供应链与物流',
  '客户服务',
  '外贸与翻译',
];

/** 一键套用的例子。全部刻意避开计算机方向——「所有专业都能用」最直接的证据。与 shared 的 DRAFT_SEEDS 对账。 */
export const DRAFT_SEEDS: { label: string; text: string }[] = [
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

/**
 * 草稿的字段边界，与 shared 的 interviewerDraftSchema 一致。
 * 前端先拦一道是为了让错误出现在输入框旁边，而不是等服务端返回 400。
 */
export const DRAFT_LIMITS = {
  nameMax: 24,
  domainMax: 40,
  blurbMin: 4,
  blurbMax: 60,
  goalMin: 8,
  goalMax: 200,
  tacticMin: 4,
  tacticMax: 120,
  tacticsMin: 2,
  tacticsMax: 5,
} as const;

/** 空草稿：新建时用它起步，字段全部为空但形状合法 */
export function emptyDraft(): {
  name: string;
  domain: string;
  seniority: string;
  tone: string;
  blurb: string;
  goal: string;
  tactics: string[];
} {
  return { name: '', domain: '', seniority: 'mid', tone: 'neutral', blurb: '', goal: '', tactics: [] };
}

/**
 * 把字段级错误压成一句人话。
 * 返回 null 表示这份草稿可以直接提交——前端不重复实现 zod，只做边界预检。
 */
export function draftProblem(draft: {
  name: string;
  domain: string;
  blurb: string;
  goal: string;
  tactics: string[];
}): string | null {
  const L = DRAFT_LIMITS;
  const name = draft.name.trim();
  if (name.length === 0) return '给它起个名字：界面上要能指名道姓地说「谁在问」。';
  if (name.length > L.nameMax) return '名字最多 ' + String(L.nameMax) + ' 个字，现在 ' + String(name.length) + ' 个。';
  if (draft.domain.length > L.domainMax) return '方向最多 ' + String(L.domainMax) + ' 个字。';
  const blurb = draft.blurb.trim();
  if (blurb.length < L.blurbMin) return '一句话简介至少 ' + String(L.blurbMin) + ' 个字，这句会显示在面试官卡片上。';
  if (blurb.length > L.blurbMax) return '一句话简介最多 ' + String(L.blurbMax) + ' 个字，现在 ' + String(blurb.length) + ' 个。';
  const goal = draft.goal.trim();
  if (goal.length < L.goalMin) return '目标至少 ' + String(L.goalMin) + ' 个字：它要能被别人读懂，才谈得上「可评审的契约」。';
  if (goal.length > L.goalMax) return '目标最多 ' + String(L.goalMax) + ' 个字。';
  const tactics = draft.tactics.map((item) => item.trim()).filter((item) => item.length > 0);
  if (tactics.length < L.tacticsMin) return '至少写 ' + String(L.tacticsMin) + ' 条追问手法：只有一条的契约没有可审计性。';
  if (tactics.length > L.tacticsMax) return '最多 ' + String(L.tacticsMax) + ' 条追问手法，太多了在场上用不完。';
  for (const item of tactics) {
    if (item.length < L.tacticMin) return '这条手法太短了（「' + item + '」），至少 ' + String(L.tacticMin) + ' 个字才说得清。';
    if (item.length > L.tacticMax) return '这条手法超过 ' + String(L.tacticMax) + ' 个字，压短一点。';
  }
  return null;
}
