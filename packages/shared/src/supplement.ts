/**
 * 补充说明：面试官说「简历里没写」时，求职者当场补一句真话。
 *
 * 它与「改写建议」是两件事，刻意分开：
 *   - 改写建议改的是**已经写在简历上的那句话**（换措辞、加数字口径、去掉过度表述）；
 *   - 补充说明是**简历上根本没有的新事实**，没有原句可改，只能新增一行。
 *
 * 三条硬约束：
 *
 * 1. **不回写原文。** 简历原文一旦被改写，这场沙盘的证据链就断了（所有锚点都指向原文）。
 *    补充说明只作为「新增的一行」参与导出，原文一个字都不动。
 * 2. **插入位置由代码算，不由模型或客户端给。** 落在该主张锚点所在那一行的行尾，
 *    这样新句子紧跟在它支撑的那句话后面，而不是插到简历中间的随机位置。
 * 3. **它是用户写的，不是模型写的。** 所以只做长度与空白校验，不改措辞——
 *    把它「润色」成 AI 腔，等于替用户编了一遍事实。
 */

import { z } from 'zod';
import type { Anchor } from './domain.ts';
import { shortHash } from './util.ts';

export const SUPPLEMENT_LIMITS = {
  minChars: 4,
  maxChars: 200,
  /** 一场沙盘最多补多少句：超出这个数，多半是在把整份简历重写一遍 */
  maxPerSession: 20,
} as const;

/** 一句补充说明。claimId 由调用方（路径里那条主张）决定，不吃请求体里的值 */
export const supplementSchema = z.object({
  text: z.string(),
});

export type SupplementDraft = z.infer<typeof supplementSchema>;

/** 换行符。代码里到处用 charCode 拼它，是因为模板字符串里的转义在不同工具里会被吃一层 */
export const NEWLINE = String.fromCharCode(10);
const CARRIAGE = String.fromCharCode(13);

/**
 * 一句话的校验：返回人话问题，没问题返回 null。
 * 界面与接口读同一个函数，避免「按钮亮了但接口 400」这种自相矛盾。
 */
export function supplementProblem(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '先写一句真话——这句会作为新的一行加进简历。';
  if (trimmed.length < SUPPLEMENT_LIMITS.minChars) {
    return '太短了：至少 ' + String(SUPPLEMENT_LIMITS.minChars) + ' 个字符，面试官才拿它当证据。';
  }
  if (trimmed.length > SUPPLEMENT_LIMITS.maxChars) {
    return '太长了：最多 ' + String(SUPPLEMENT_LIMITS.maxChars) + ' 个字符。补充说明是一句事实，不是一段自我介绍。';
  }
  if (trimmed.indexOf(NEWLINE) >= 0) return '只能是一句话，别换行。';
  return null;
}

export function normalizeSupplement(text: string): string {
  return text.trim();
}

/** 它进的是简历，指纹就该跟着简历一起变 */
export function supplementDigest(text: string): string {
  return shortHash(normalizeSupplement(text), 16);
}

/**
 * 新的一行插在哪儿：该主张锚点所在那一行的行尾。
 *
 * 三个边界：
 *   - 锚点已经落在文末（后面没有换行了）→ 追加到最后；
 *   - 行尾是 CRLF → 插在 CR 之前，别把换行劈成两半；
 *   - anchor.end 越界（老数据里的脏坐标）→ 夹到正文长度，绝不抛错。
 */
export function insertionPointAfter(resumeText: string, anchor: Anchor): number {
  const from = Math.max(0, Math.min(anchor.end, resumeText.length));
  const newline = resumeText.indexOf(NEWLINE, from);
  let at = newline < 0 ? resumeText.length : newline;
  if (at > 0 && resumeText.charAt(at - 1) === CARRIAGE) at -= 1;
  return at;
}

/** 插进去的那一段：一个换行加用户那句话 */
export function supplementBlock(text: string): string {
  return NEWLINE + normalizeSupplement(text);
}

/**
 * 一条补充说明对应的改写：插入型——区间长度为零、改前为空串。
 * 它走同一条 applyRevisions，所以重叠判定与位移重算和普通改写是同一套逻辑。
 */
export function supplementRevision(
  claimId: string,
  resumeText: string,
  anchor: Anchor,
  text: string,
): { claimId: string; start: number; end: number; before: string; after: string } {
  const at = insertionPointAfter(resumeText, anchor);
  return { claimId, start: at, end: at, before: '', after: supplementBlock(text) };
}
