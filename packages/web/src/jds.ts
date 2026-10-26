import type { JobDescription } from './api.ts';

/**
 * 投料台上的「目标岗位 JD」列表。刻意与 shared 的 REQUIREMENT_LIMITS 同口径，
 * 但只在这里做**界面预检**：真正说了算的是服务端（它会再查一遍并回 400）。
 * 界面这一层的价值是「还没点开始就告诉你哪一份有问题」，不是当权威。
 */
export const MAX_JDS = 8;
export const MIN_JD_CHARS = 40;
export const MAX_JD_CHARS = 6000;

export interface JdDraft {
  /** 可留空：留空时标题取正文第一行，与服务端的兜底同一套规则 */
  title: string;
  text: string;
}

export function emptyJd(): JdDraft {
  return { title: '', text: '' };
}

export function emptyDraftList(): JdDraft[] {
  return [emptyJd()];
}

/** 正文只有空白的行整行不算一份——粘错了留一行空格不该算成一份 JD */
export function filledJds(jds: readonly JdDraft[]): JdDraft[] {
  return jds.filter((jd) => jd.text.trim().length > 0);
}

/** 交给服务端的形状：标题原样，正文不 trim（原文区间要能对上用户看到的那段字） */
export function jdPayload(jds: readonly JdDraft[]): { title: string; text: string }[] {
  return filledJds(jds).map((jd) => ({ title: jd.title.trim(), text: jd.text }));
}

/** 只报第一个问题：一次说清一件事，比糊一屏更好改 */
export function jdDraftProblem(jds: readonly JdDraft[]): string | null {
  const filled = filledJds(jds);
  if (filled.length > MAX_JDS) {
    return '最多 ' + String(MAX_JDS) + ' 份 JD，现在填了 ' + String(filled.length) + ' 份。';
  }
  for (let index = 0; index < jds.length; index += 1) {
    const text = jds[index] === undefined ? '' : jds[index]!.text.trim();
    if (text.length === 0) continue;
    const name = jds[index]!.title.trim();
    const label = name.length === 0 ? '第 ' + String(index + 1) + ' 份' : '《' + name + '》';
    if (text.length < MIN_JD_CHARS) {
      return label + ' JD 太短了：至少 ' + String(MIN_JD_CHARS) + ' 个字符，否则读不出要求。';
    }
    if (text.length > MAX_JD_CHARS) {
      return label + ' JD 太长了：最多 ' + String(MAX_JD_CHARS) + ' 个字符。';
    }
  }
  return null;
}

/** 正文第一行非空文本：服务端也用同一套兜底算标题 */
export function firstLineOf(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed !== '') return trimmed;
  }
  return '';
}

/**
 * 还没跑之前的 JD 视图：给右栏的「岗位要求原文」栏先画出用户贴进来的那几份。
 * id 用 J1..Jn，与跑起来之后服务端给的 id 同一套编号，所以「点要求跳原文」不会跳空。
 */
export function previewJds(jds: readonly JdDraft[]): JobDescription[] {
  return filledJds(jds).map((jd, index) => {
    const title = jd.title.trim();
    const first = firstLineOf(jd.text);
    return {
      id: 'J' + String(index + 1),
      ordinal: index + 1,
      title: title.length > 0 ? title : first.length > 0 ? first : '岗位 ' + String(index + 1),
      text: jd.text,
    };
  });
}

/**
 * 跑起来之后把服务端回的 {id,ordinal,title} 与刚提交的那几份正文对上。
 * 服务端按提交顺序编 J1..Jn，所以按下标对上就够；对不上就退回预览视图。
 */
export function materialJds(
  created: readonly { id: string; ordinal: number; title: string }[],
  jds: readonly JdDraft[],
): JobDescription[] {
  const filled = filledJds(jds);
  if (created.length === 0) return [];
  return created.map((item, index) => ({
    id: item.id,
    ordinal: item.ordinal,
    title: item.title,
    text: filled[index] === undefined ? '' : filled[index]!.text,
  }));
}
