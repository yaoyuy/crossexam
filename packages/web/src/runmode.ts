import type { ModelList } from './api.ts';

/**
 * 「模型清单拉到之后该写什么提示」这件事**从组件里搬出来**，做成纯函数。
 *
 * 原因不体面但很实在：界面点测里那条「切到联网后给出结论」失败过两次，
 * 两次都不是产品坏了，而是脚本抓到了中间态（「正在向后端要模型清单…」）。
 * 中间态与结论态在同一个元素上渲染，靠肉眼和靠断言都容易认错，
 * 所以把「有哪些态、每个态说什么」变成可枚举、可单测的返回值。
 */
export const MODEL_NOTE_PENDING = '正在向后端要模型清单…';

/** 把一份清单折成一句话。null 表示「不用提示」——离线回放不联网，没什么可说的。 */
export function modelNoteOf(list: ModelList): string | null {
  if (!list.ready) {
    const missing = list.missing.filter((item) => item !== '');
    if (missing.length === 0) return '后端还没配好联网：缺的变量名字没拿到。补上 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 再刷新页面。';
    return '后端还没配好联网：缺 ' + missing.join('、') + '。补上 .env 里的这些变量再刷新页面。';
  }
  if (list.error !== null && list.error !== '') return list.error;
  if (list.models.length === 0) return '后端没报错，但清单是空的：直接手填模型名即可。';
  return null;
}

/** 提示是不是「还在路上」。脚本与界面都用它区分中间态和结论态。 */
export function isPendingNote(note: string | null): boolean {
  return note !== null && note.indexOf(MODEL_NOTE_PENDING) >= 0;
}