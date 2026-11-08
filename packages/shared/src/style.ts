/**
 * 改写风格（档位）：同一套闸门，三种收敛程度。
 *
 * 为什么要有它：改写建议只有一档口径时，用户能选的其实只有「改不改」，选不了「改得多狠」。
 * 一份准备投大厂终面的简历想被人往具体里改，一份刚转行、心里没底的简历只想把夸大的地方先删掉——
 * 这两种诉求都不是「更多建议」能解决的，它们要的是不同的收敛程度。
 *
 * 三档只调**措辞的收敛程度**，不碰事实边界。三条红线在任何档位下都不变：
 *   1. after 里不允许出现简历原文没有的数字（newNumbersIn 拦）；
 *   2. 不许把「参与」写成「主导」（contributionEscalation 拦，词表就在本文件下面）；
 *   3. before 必须是简历原文里锚得回的逐字片段。
 * 档位写进 session.meta.style（与追问强度同一套办法），进提示词、落库、跑完可对账；
 * 但它**不进契约指纹**——契约描述的是「谁在问」，改写风格描述的是「改得多狠」。
 */

export const REWRITE_STYLES = ['conservative', 'normal', 'bold'] as const;
export type RewriteStyle = (typeof REWRITE_STYLES)[number];

export const DEFAULT_REWRITE_STYLE: RewriteStyle = 'normal';

export const REWRITE_STYLE_LABEL: Record<RewriteStyle, string> = {
  conservative: '保守',
  normal: '常规',
  bold: '敢改',
};

/** 一句话说清这一档会改成什么样：界面直接显示这一句，不另写文案 */
export const REWRITE_STYLE_HINT: Record<RewriteStyle, string> = {
  conservative: '只做减法：删掉撑不住的形容词与范围，尽量保留原句结构，保守到你还认得出原句。',
  normal: '该收敛的收敛、该补口径的补口径：允许重写句子，但每一句都必须是原句里已经有的信息。',
  bold: '在不新增任何事实的前提下写得更具体：把含糊的说法换成原文里已经写明的口径与范围，句式可以大改。',
};

/** 给提示词用的那一段：只描述措辞的收敛程度，三条红线写在 SUGGEST_SYSTEM 里，不在这里重复 */
export const REWRITE_STYLE_GUIDE: Record<RewriteStyle, string> = {
  conservative:
    '只做减法。优先删掉撑不住的形容词、范围与程度词（比如「精通」「全面」「大幅」），尽量保留原句的主干与语序；除了把过强的词降级，不要重写句子。这一档宁可改得少，也不要改得花。',
  normal:
    '该收敛的收敛、该补口径的补口径。可以重写句子，但改完的每一句都必须是原句里已经写明的信息，不许把没写的东西换一种说法补进来。',
  bold:
    '在不新增任何事实的前提下，把这句话改得更具体、更像这个岗位的人写的：含糊的说法换成原文里已经写明的口径、范围或职责边界，句式可以大改；但原文没写的经历、数字、头衔、成果一律不许出现，也不许把「参与」升格成「主导」。',
};

export interface RewriteStyleView {
  id: RewriteStyle;
  label: string;
  hint: string;
}

export function isRewriteStyle(raw: unknown): raw is RewriteStyle {
  return typeof raw === 'string' && (REWRITE_STYLES as readonly string[]).indexOf(raw) >= 0;
}

/**
 * 认不出就当默认档：风格是「没填也应该能跑」的输入。
 * 让老请求（以及没带这个字段的脚本）整条路走不通，代价远大于收益。
 */
export function rewriteStyleOf(raw: unknown): RewriteStyle {
  return isRewriteStyle(raw) ? raw : DEFAULT_REWRITE_STYLE;
}

export function rewriteStyleViews(): RewriteStyleView[] {
  return REWRITE_STYLES.map((id) => ({ id, label: REWRITE_STYLE_LABEL[id], hint: REWRITE_STYLE_HINT[id] }));
}

// ---------------------------------------------------------------------------
// 个人贡献阶梯（升格闸门的词表）
//
// 为什么分高低两档、而不是一条从弱到强的细梯度：「负责」在真实简历里既可能比「参与」重，
// 也可能只是中性动词（「负责 XX 模块」）；把它算成升格，会把本来正确的降级改写拦下。
// 而「主导 / 独立完成 / 全权负责」这类词一旦原文没有，就是实打实把个人贡献放大了一档。
// 所以只对高阶梯做一票否决，低阶梯只用来把拒绝理由说成人话。
// 词表放在 shared 而不是提示词里：能被单测覆盖，也不会随某次改提示词悄悄消失。
// ---------------------------------------------------------------------------

/** 低阶梯：只用于解释「原文写的是什么」，不参与拦截 */
export const CONTRIBUTION_LOW_MARKERS: readonly string[] = [
  '参与',
  '协助',
  '配合',
  '支持',
  '参加',
  '加入',
  '负责',
  '承担',
  '经手',
  '接触',
];

/**
 * 高阶梯：after 里出现而 before 没有，即为升格。
 * 注意不含裸「独立」——「独立接手陌生模块」是边界描述，不是贡献升格，误杀它得不偿失。
 */
export const CONTRIBUTION_HIGH_MARKERS: readonly string[] = [
  '主导',
  '独立完成',
  '独立负责',
  '独立主导',
  '独立搭建',
  '独立设计',
  '全权负责',
  '全程负责',
  '牵头',
  '带领',
  '带队',
  '从0到1',
  '从零到一',
  '独当一面',
];

function markersIn(text: string, markers: readonly string[]): string[] {
  return markers.filter((marker) => text.indexOf(marker) >= 0);
}

export interface ContributionEscalation {
  /** after 新出现（before 没有）的高阶梯词：就是它们把贡献放大了 */
  markers: string[];
  /** before 里的低阶梯词，用来把理由说具体 */
  lower: string[];
  /** 可直接展示给用户的拒绝理由 */
  reason: string;
}

/**
 * 升格检查：after 出现的高阶梯贡献词，在 before 与 support 里都找不到，就判升格。
 *
 * 为什么按词比对、而不是再调一次模型判：这是一条要能逐字复现的红线，判错了用户能指着词问为什么；
 * 交给模型只会把「同一份输入、不同一次输出」引进门禁，闸门立刻不可复现。
 * 比的是集合差（after 有、依据里没有），不看词序与位置——升格是把贡献说大，不是把句子改顺。
 *
 * support 是这条主张所在的简历原文（调用方传原句，缺省退回 before）。
 * 为什么不能只拿 before 当依据：before 是模型自己挑的窄引文，常常短于它所在的那句话，
 * 于是「把简历原句补全」会被误判成升格——style.test.ts 的常规档就是这么被打红的。
 */
export function contributionEscalation(
  before: string,
  after: string,
  support: string = before,
): ContributionEscalation | null {
  const afterHigh = markersIn(after, CONTRIBUTION_HIGH_MARKERS);
  if (afterHigh.length === 0) return null;
  const grounded = markersIn(before, CONTRIBUTION_HIGH_MARKERS).concat(
    markersIn(support, CONTRIBUTION_HIGH_MARKERS),
  );
  const markers = afterHigh.filter((marker) => grounded.indexOf(marker) < 0);
  if (markers.length === 0) return null;
  const lower = markersIn(before, CONTRIBUTION_LOW_MARKERS);
  const from = lower.length > 0 ? '「' + lower.join('」「') + '」' : '原文完全没有的贡献级别';
  return {
    markers,
    lower,
    reason:
      '改写把个人贡献升格了：原文写的是' +
      from +
      '，改写后出现「' +
      markers.join('」「') +
      '」，属于放大事实，已拦下。要说得更重，先把简历原文改成同一级别。',
  };
}
