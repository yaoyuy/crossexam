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

/** 导入 JD 时默认标题最多留这么多字，超了截断加省略号——标题要显示在报告里 */
export const JD_TITLE_MAX = 24;

export interface JdFileDraft {
  /** 文件名（含扩展名）：标题默认取它，用户在界面上还能改 */
  name: string;
  text: string;
}

export interface JdImportResult {
  jds: JdDraft[];
  added: number;
  /** 读出空白的文件：扫描件 PDF、加密文档都会落到这里 */
  skippedEmpty: number;
  /** 因为超过 MAX_JDS 没进来的 */
  skippedLimit: number;
}

/** 文件名去扩展名当标题；去掉后空了就兜底，太长了截断 */
export function jdTitleFromFileName(name: string): string {
  const cut = name.lastIndexOf('.');
  const base = (cut > 0 ? name.slice(0, cut) : name).trim();
  if (base === '') return '导入的岗位';
  return base.length > JD_TITLE_MAX ? base.slice(0, JD_TITLE_MAX) + '…' : base;
}

/** 换行归一 + 去两端空白。正文不截断：太长了该由预检如实报出来，不该悄悄切掉尾巴 */
export function normalizeJdText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

/**
 * 从文件导入 JD。已填的那几份原样留在前面，导入的按选中顺序接在后面；
 * 空文件跳过、超出 MAX_JDS 的不进——两件事都记在返回值里，好让界面说清发生了什么。
 */
export function importJdFiles(
  existing: readonly JdDraft[],
  files: readonly JdFileDraft[],
): JdImportResult {
  const base = filledJds(existing);
  const room = Math.max(0, MAX_JDS - base.length);
  const imported: JdDraft[] = [];
  let skippedEmpty = 0;
  let skippedLimit = 0;
  for (const file of files) {
    const text = normalizeJdText(file.text);
    if (text === '') {
      skippedEmpty += 1;
      continue;
    }
    if (imported.length >= room) {
      skippedLimit += 1;
      continue;
    }
    imported.push({ title: jdTitleFromFileName(file.name), text });
  }
  return { jds: [...base, ...imported], added: imported.length, skippedEmpty, skippedLimit };
}

/** 导入之后说一句人话：进来几份、为什么有的没进来 */
export function jdImportNote(result: JdImportResult): string {
  const parts: string[] = [];
  if (result.added > 0) {
    parts.push('已导入 ' + String(result.added) + ' 份岗位要求（标题取文件名，可以改）。');
  }
  if (result.skippedEmpty > 0) {
    parts.push(
      result.added > 0
        ? '另有 ' + String(result.skippedEmpty) + ' 个文件没读到文字。'
        : '这些文件里没有读到文字：扫描件 PDF 先用 OCR 转成文字再导入。',
    );
  }
  if (result.skippedLimit > 0) {
    parts.push(
      (result.added > 0 ? '还有 ' : '') +
        String(result.skippedLimit) +
        ' 份没进来：最多 ' + String(MAX_JDS) + ' 份 JD。',
    );
  }
  if (parts.length === 0) return '没有读到可用的岗位要求。';
  return parts.join('');
}
