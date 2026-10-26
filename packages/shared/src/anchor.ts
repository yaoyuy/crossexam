/**
 * 证据锚定（创新点 1）。
 *
 * 这是整个项目的**信任根**：所有提问、判定、修改建议都必须携带一个能指回简历原文的
 * 字符区间。锚点由本模块建立，而本模块**只认逐字引用**——AI 报出的 start/end 一律不被信任，
 * 我们拿它的 quote 回到原文里重新定位。找不到就拒绝，并把拒绝原因留给前端展示。
 *
 * 这样做的直接效果：AI 无法提问一条简历里根本不存在的内容。
 */
import type { Anchor, TextSpan } from './domain.ts';

export interface RawAnchor {
  quote?: string;
  start?: number;
  end?: number;
}

export type AnchorRejection =
  | 'empty-quote'
  | 'quote-not-found'
  | 'too-short'
  | 'out-of-range';

export type AnchorResult =
  | { ok: true; anchor: Anchor }
  | { ok: false; reason: AnchorRejection; quote: string };

export const REJECTION_LABEL: Record<AnchorRejection, string> = {
  'empty-quote': '模型没有给出引用原文',
  'quote-not-found': '引用内容在简历原文中找不到（疑似编造）',
  'too-short': '引用过短，无法作为证据',
  'out-of-range': '给出的偏移量超出简历范围',
};

/** 归一化时做的标点统一，只为兜住全半角/中英标点差异，不改变语义 */
const PUNCT_MAP: Record<string, string> = {
  '\uFF0C': ',', '\u3002': '.', '\uFF1A': ':', '\uFF1B': ';',
  '\uFF08': '(', '\uFF09': ')', '\u201C': '"', '\u201D': '"',
  '\u2018': "'", '\u2019': "'", '\uFF01': '!', '\uFF1F': '?',
  '\u3001': ',', '\u2014': '-', '\u2013': '-', '\u3000': ' ', '\u00B7': '.',
};

/**
 * 归一化文本，并保留「归一化下标 -> 原文下标」的映射，
 * 这样命中后还能把区间还原回原文坐标（前端要高亮原文）。
 */
export function normalizeWithMap(s: string): { norm: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  let prevWasSpace = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (/\s/.test(ch)) {
      if (!prevWasSpace && chars.length > 0) { chars.push(' '); map.push(i); prevWasSpace = true; }
      continue;
    }
    prevWasSpace = false;
    const mapped = (PUNCT_MAP[ch] ?? ch).toLowerCase();
    for (let k = 0; k < mapped.length; k++) { chars.push(mapped.charAt(k)); map.push(i); }
  }
  return { norm: chars.join(''), map };
}

/**
 * 在原文里定位一段引用。先试逐字命中，失败再试归一化命中。
 * 返回原文坐标；彻底找不到返回 null。
 */
export function locateQuote(
  source: string,
  quote: string,
): { start: number; end: number; exact: boolean } | null {
  const q = quote.trim();
  if (!q) return null;

  const at = source.indexOf(q);
  if (at >= 0) return { start: at, end: at + q.length, exact: true };

  const src = normalizeWithMap(source);
  const qn = normalizeWithMap(q).norm.trim();
  if (!qn) return null;
  const hit = src.norm.indexOf(qn);
  if (hit < 0) return null;
  const start = src.map[hit];
  const endChar = src.map[hit + qn.length - 1];
  if (start === undefined || endChar === undefined) return null;
  return { start, end: endChar + 1, exact: false };
}

/**
 * 把模型给出的原始锚点解析成可信锚点。
 * @param minQuoteLength 引用短于该长度即拒绝——防止锚到「我」「的」这种无信息量片段
 */
export function resolveAnchor(source: string, raw: RawAnchor, minQuoteLength = 4): AnchorResult {
  const quote = (raw.quote ?? '').trim();
  if (!quote) return { ok: false, reason: 'empty-quote', quote };
  if (quote.length < minQuoteLength) return { ok: false, reason: 'too-short', quote };

  const located = locateQuote(source, quote);
  if (!located) return { ok: false, reason: 'quote-not-found', quote };

  if (located.start < 0 || located.end > source.length || located.start >= located.end) {
    return { ok: false, reason: 'out-of-range', quote };
  }

  return {
    ok: true,
    anchor: { start: located.start, end: located.end, quote: source.slice(located.start, located.end), exact: located.exact },
  };
}

/** 锚点当前是否仍然指向原文中同一段内容（原文被编辑后可能失效） */
export function isGrounded(source: string, anchor: Anchor): boolean {
  if (anchor.start < 0 || anchor.end > source.length || anchor.start >= anchor.end) return false;
  return source.slice(anchor.start, anchor.end) === anchor.quote;
}

/** 按当前原文重新取回锚点对应的文本；锚点失效返回 null */
export function sliceAnchor(source: string, anchor: Anchor): string | null {
  return isGrounded(source, anchor) ? anchor.quote : null;
}

export function spansOverlap(a: TextSpan, b: TextSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

/** 锚点落在哪个片段里（用于「这条主张属于哪段经历」） */
export function findContainingIndex<T extends TextSpan>(spans: readonly T[], anchor: TextSpan): number {
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (s && spansOverlap(s, anchor)) return i;
  }
  return -1;
}