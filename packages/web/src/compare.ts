/**
 * 版本对比在界面这一侧的说法（P11 · C1）。
 *
 * 对比的计算全在服务端（@crossexam/shared 的 compare.ts），这里只做一件事：
 * 把 CompareView 翻译成界面要显示的那几句话。刻意做成纯函数，
 * 因为「第一版」「上一版被删了」「简历没改」这三种状态在界面上要说不同的话，
 * 而这类判断散在 JSX 里就一定会有一处漏掉。
 */
import type { ComparePair, CompareView } from './api.ts';
import type { ShiftKind } from './api.ts';
import { VERDICT_LABEL } from './labels.ts';

export const SHIFT_LABEL: Record<ShiftKind, string> = {
  better: '变好',
  same: '没变',
  worse: '变差',
  unjudged: '没判定',
};

export type ShiftTone = 'solid' | 'warn' | 'danger' | 'muted';

export const SHIFT_TONE: Record<ShiftKind, ShiftTone> = {
  better: 'solid',
  same: 'muted',
  worse: 'danger',
  unjudged: 'muted',
};

/** 一条对比结果在界面上的一句话：中文判定名 + 变了什么 */
export function shiftDetailOf(pair: ComparePair): string {
  const before = pair.prev.verdict === null ? '未判定' : VERDICT_LABEL[pair.prev.verdict];
  const after = pair.next.verdict === null ? '未判定' : VERDICT_LABEL[pair.next.verdict];
  return before + ' → ' + after + '（' + SHIFT_LABEL[pair.shift] + '）';
}

export interface CompareRow {
  /** 这一版里的主张 id（C1..Cn 每场重编，所以列表按这一版读） */
  id: string;
  text: string;
  /** 「上次为什么样 → 这次什么样」 */
  detail: string;
  shift: ShiftKind;
}

export interface CompareFacts {
  /** 这一栏的标题下那句话 */
  status: string;
  /** 摘要那一段（headline 或解释为什么没有 headline） */
  headline: string | null;
  /** 一行行事实：上一版是谁、简历改没改、追问几次 */
  facts: string[];
  /** 变好 / 变差的那几条 */
  rows: CompareRow[];
  /** 新增 / 不在上一版里的主张：它们不是「变好变差」，要分开说 */
  added: string[];
  removed: string[];
}

/**
 * 把 CompareView 翻成界面文案。view 为 null 表示还没取到（刚开跑），
 * 与「取到了但没有上一版」是两件事，所以这里不把 null 当成 first。
 */
export function compareFactsOf(view: CompareView | null): CompareFacts | null {
  if (view === null) return null;
  if (view.first) {
    return {
      status: '这是第一版',
      headline: '改完再跑一遍，这里会告诉你每一条主张的判定变了没有。',
      facts: [],
      rows: [],
      added: [],
      removed: [],
    };
  }
  if (view.parentMissing) {
    return {
      status: '上一版不在了',
      headline: '记着上一版是哪一场，但那一场已经被删掉了，比不了。',
      facts: [],
      rows: [],
      added: [],
      removed: [],
    };
  }
  const comparison = view.comparison;
  if (comparison === null) {
    return {
      status: '没有可比的判定',
      headline: '上一版一条判定都没有，先跑完一场再比。',
      facts: [],
      rows: [],
      added: [],
      removed: [],
    };
  }
  const facts: string[] = [];
  if (view.parent !== null) {
    facts.push('上一版：' + view.parent.jobTitle + '（' + view.parent.createdAt + '）');
  }
  facts.push(
    view.resumeChanged
      ? '简历内容改过了：两份的指纹不同，判定变化可以归到改动上。'
      : '与上一版完全相同：判定若有变化，是这一场看到的追问不同，不是你改了简历。',
  );
  if (comparison.probesBefore !== null && comparison.probesAfter !== null) {
    facts.push('追问 ' + String(comparison.probesBefore) + ' → ' + String(comparison.probesAfter) + ' 次');
  }
  const rows: CompareRow[] = [];
  for (const pair of comparison.pairs) {
    if (pair.shift === 'same' || pair.shift === 'unjudged') continue;
    rows.push({ id: pair.next.id, text: pair.next.text, detail: shiftDetailOf(pair), shift: pair.shift });
  }
  return {
    status: '比上次',
    headline: comparison.headline,
    facts: facts,
    rows: rows,
    added: comparison.added.map((claim) => claim.text),
    removed: comparison.removed.map((claim) => claim.text),
  };
}
