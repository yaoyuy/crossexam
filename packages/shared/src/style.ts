/**
 * 改写风格（档位）：同一套闸门，三种收敛程度。
 *
 * 为什么要有它：改写建议只有一档口径时，用户能选的其实只有「改不改」，选不了「改得多狠」。
 * 一份准备投大厂终面的简历想被人往具体里改，一份刚转行、心里没底的简历只想把夸大的地方先删掉——
 * 这两种诉求都不是「更多建议」能解决的，它们要的是不同的收敛程度。
 *
 * 三档只调**措辞的收敛程度**，不碰事实边界。三条红线在任何档位下都不变：
 *   1. after 里不允许出现简历原文没有的数字（newNumbersIn 拦）；
 *   2. 不许把「参与」写成「主导」；
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
