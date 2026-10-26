import type { ClaimCategory, InterviewerRole, VerdictKind } from '@crossexam/shared/domain.ts';

/**
 * 判定与类别的中文标签**直接复用领域层**，不在这里另抄一份：
 * 报告、接口、界面必须用同一套词，否则「站得住」在报告里写一套、界面上写另一套。
 * domain.ts 只依赖类型与常量，没有 node: 依赖，所以能被浏览器端打包。
 */
export { CLAIM_CATEGORY_LABEL, VERDICT_LABEL } from '@crossexam/shared/domain.ts';

/** 判定徽章的配色语义：绿=过了，黄=说过头了，红=站不住，灰=没答上来 */
export const VERDICT_TONE: Record<VerdictKind, 'solid' | 'warn' | 'danger' | 'muted'> = {
  solid: 'solid',
  overstated: 'warn',
  unsupported: 'danger',
  contradicts: 'danger',
  unanswerable: 'muted',
};

/** 判定旁边的一句话解释，写给不懂「锚定」的人看 */
export const VERDICT_GLOSS: Record<VerdictKind, string> = {
  solid: '追问下来有据可依，这条主张可以留着',
  overstated: '事实可能有，但表述超出了简历能支撑的范围',
  unsupported: '答不到简历原文上的细节，等于没有证据',
  contradicts: '回答与简历原文对不上，面试官会往坏处想',
  unanswerable: '连续追问都答不上来，这条主张是风险点',
};

/**
 * 人设文案与 D:\\CZB\\packages\\shared\\src\\contract.ts 的 PERSONA_PRESETS 一一对应。
 * 之所以抄一份，是因为 contract.ts 经由 util.ts 依赖 node:crypto，进不了浏览器包；
 * 抄写由 packages/web/test/labels.test.ts 的漂移测试看守。
 */
export const PERSONA_LABEL: Record<InterviewerRole, string> = {
  tech: '技术面试官',
  hr: 'HR 面试官',
  hiring_manager: '业务主管',
  stress: '压力面试官',
  domain_expert: '领域专家',
};

export const PERSONA_BLURB: Record<InterviewerRole, string> = {
  tech: '资深工程师，冷静、只问细节',
  hr: '招聘负责人，语气温和但咬住时间线不放',
  hiring_manager: '团队负责人，务实，只关心结果能不能归因到你身上',
  stress: '合伙人，说话直接、不留情面',
  domain_expert: '领域专家，学术腔，爱抠术语定义',
};

/** 阶段名：接口给的是英文，界面要中文 */
export const STAGE_LABEL: Record<string, string> = {
  extract: '抽取主张',
  probe: '并发追问',
  answer: '求职者作答',
  verdict: '给出判定',
  suggest: '反推改写',
};

export const STAGE_HINT: Record<string, string> = {
  extract: '把简历里值得被追问的话挑出来，并锚定到原文',
  probe: '多名面试官并发提问，每条提问都必须带原文锚点',
  answer: '求职者 Agent 只依据简历作答，答不上来就承认',
  verdict: '对照追问与作答，逐条判定这条主张站不站得住',
  suggest: '把站不住的主张改写成经得起追问的表述',
};

export const CLAIM_CATEGORY_ORDER: ClaimCategory[] = [
  'metric',
  'achievement',
  'ownership',
  'experience',
  'skill',
  'timeline',
  'other',
];

/** 会话状态 */
export const SESSION_STATUS_LABEL: Record<string, string> = {
  draft: '待质询',
  extracting: '抽取中',
  probing: '追问中',
  scoring: '判定中',
  done: '已完成',
  failed: '失败',
};

/**
 * 流式输出的 channel → 实况栏那一行的标题。
 * channel 由服务端拼（见 packages/server/src/orchestrator/*.ts 传给 stageRequest 的第四参）：
 * 阶段名，或「阶段:编号」。认不出来的原样显示，不猜。
 */
export function channelLabel(channel: string): string {
  if (channel === 'extract') return '正在抽取主张';
  const cut = channel.indexOf(':');
  if (cut <= 0) return channel;
  const stage = channel.slice(0, cut);
  const id = channel.slice(cut + 1);
  if (stage === 'probe') return (PERSONA_LABEL[id as InterviewerRole] ?? id) + ' 正在追问';
  if (stage === 'answer') return '求职者作答 ' + id;
  if (stage === 'verdict') return '判定 ' + id;
  if (stage === 'suggest') return '改写建议 ' + id;
  return channel;
}
