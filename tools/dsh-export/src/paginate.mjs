/**
 * 分页：Prompt 链快照会长到几十万甚至上百万字符。
 *
 * 现实：本次比赛开发过程的会话到 P4 时已经 330 万字符（单轮就有 140 万）。
 * 一次性写成一个文件，网页端超过 1 MB 就只给下载、不给渲染——而这份快照的读者是评委。
 * 所以在**条目**边界（用户提问 / AI 回复 / 思考 / 一次工具调用）分页，
 * 每一页自带标题、元信息表与轮次头，单独打开也能读懂。
 *
 * 两条不妥协：
 * 1. 内容一个字都不删，分页只加说明行。
 * 2. 单个条目本身超过上限时，它自己独占一页（宁可这一页超标，也不切断一条完整证据）。
 */
import {
  renderEntry,
  renderMetaTable,
  renderTitle,
  renderTurnHeader,
  turnHasContent,
} from './render.mjs';

export const DEFAULT_MAX_CHARS_PER_FILE = 400000;

/** 每页固定的开销：标题 + 元信息表 + 分隔线（分页说明另算，见下方 note） */
export function pageOverhead(session) {
  const lines = [renderTitle(session.meta), '', ...renderMetaTable(session), '', '---', ''];
  return lines.join('\n').length + 1;
}

/**
 * @param {{ meta: object, turns: any[], usage: object }} session
 * @param {{ maxArgChars?: number, maxResultChars?: number, maxChars?: number }} [opts]
 *        maxChars 为 0 或负数表示不分页（返回单页）。
 * @returns {{ lines: string[], fromTurn: number|null, toTurn: number|null, chars: number }[]}
 *        chars 是「本页正文 + 固定开销」的估算字符数（分页说明的几百字符不在内）。
 */
export function paginateSession(session, opts) {
  const o = opts || {};
  const cap = typeof o.maxChars === 'number' && o.maxChars > 0 ? o.maxChars : DEFAULT_MAX_CHARS_PER_FILE;
  const turns = (session.turns || []).filter(turnHasContent);
  const overhead = pageOverhead(session);

  if (turns.length === 0) {
    return [{ lines: [], fromTurn: null, toTurn: null, chars: overhead }];
  }

  const parts = [];
  const openPart = (turnIndex) => {
    const part = { lines: [], fromTurn: turnIndex, toTurn: turnIndex, chars: overhead };
    parts.push(part);
    return part;
  };

  let cur = null;
  for (const turn of turns) {
    const headerPlain = renderTurnHeader(turn).join('\n').length + 1;
    const headerCont = renderTurnHeader(turn, { continued: true }).join('\n').length + 1;
    let wroteHeader = false;
    let inTurn = 0;
    for (const entry of turn.entries || []) {
      const eLines = renderEntry(entry, o);
      const eLen = eLines.join('\n').length + 1;
      const cont = inTurn > 0;
      const headerLen = cont ? headerCont : headerPlain;
      const need = (wroteHeader ? 0 : headerLen) + eLen;
      // 换页条件：这一页已经有内容，再加就超了。单个条目超标时独占一页，不切断条目。
      if (cur === null || (cur.lines.length > 0 && cur.chars + need > cap)) {
        cur = openPart(turn.index);
        wroteHeader = false;
      }
      if (!wroteHeader) {
        cur.lines.push(...renderTurnHeader(turn, { continued: cont }));
        wroteHeader = true;
      }
      cur.lines.push(...eLines);
      cur.chars += eLen;
      cur.toTurn = turn.index;
      inTurn++;
    }
    if (wroteHeader) {
      cur.lines.push('---');
      cur.lines.push('');
      cur.chars += 5;
    }
  }

  return parts.filter((p) => p.lines.length > 0);
}
