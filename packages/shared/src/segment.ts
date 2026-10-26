/**
 * 简历结构化切分（确定性算法，不调用 LLM）。
 *
 * 为什么必须确定性：如果连「这条主张属于哪段经历」都由模型现编，
 * 那么后面所有的锚点、判定、修改建议都会随模型心情漂移，复现性无从谈起。
 * 切分是纯函数，同一份简历永远得到同一套区间。
 */
import type { TextSpan } from './domain.ts';

export type SegmentKind = 'header' | 'bullet' | 'paragraph';

export interface ResumeSegment extends TextSpan {
  index: number;
  kind: SegmentKind;
  text: string;
  /** 所属小节标题；出现在任何标题之前的内容为 null */
  section: string | null;
}

export interface ResumeOutline {
  text: string;
  segments: ResumeSegment[];
  sections: { title: string; start: number; end: number }[];
}

const CN_HEADINGS = new Set([
  '个人信息', '基本信息', '求职意向', '联系方式',
  '教育背景', '教育经历', '学历',
  '工作经历', '工作经验', '职业经历', '实习经历', '实习经验',
  '项目经历', '项目经验', '科研经历', '研究成果',
  '专业技能', '技能特长', '技能', '技术栈',
  '获奖情况', '荣誉奖项', '所获奖励', '获奖经历',
  '校园经历', '社团经历', '学生工作',
  '自我评价', '个人评价', '个人总结',
  '论文发表', '专利', '证书', '语言能力', '兴趣爱好', '其他',
]);

const EN_HEADINGS = new Set([
  'summary', 'objective', 'profile', 'about', 'about me',
  'education', 'experience', 'work experience', 'internship',
  'internship experience', 'projects', 'project experience',
  'skills', 'technical skills', 'awards', 'honors', 'publications',
  'certifications', 'languages', 'interests', 'others',
]);

/** 形如 -xxx / 圆点 xxx / 1. xxx / （2）xxx 的行首标记 */
const BULLET_RE = new RegExp(
  '^[\\s]*(?:[-*' + String.fromCharCode(0x2022, 0x00B7, 0x25CF, 0x25CB, 0x25AA, 0x25E6, 0x2023, 0x2013, 0x2014) +
  ']|[0-9]{1,2}[\\s]*[.' + String.fromCharCode(0x3001) + ')]|[' + String.fromCharCode(0xFF08) +
  '(][0-9]{1,2}[' + String.fromCharCode(0xFF09) + ')])\\s*',
);

function headingOf(rawLine: string): string | null {
  const t = rawLine.trim().replace(/[:\uFF1A]\s*$/, '').trim();
  if (!t || t.length > 24) return null;
  if (CN_HEADINGS.has(t)) return t;
  const lower = t.toLowerCase();
  if (EN_HEADINGS.has(lower)) return t;
  for (const h of CN_HEADINGS) {
    if (t.startsWith(h) && t.length - h.length <= 12) return h;
  }
  for (const h of EN_HEADINGS) {
    if (lower.startsWith(h) && lower.length - h.length <= 12) return t;
  }
  return null;
}

/** 按行扫描，保留每一段的原文区间。兼容 CRLF / LF / CR 三种换行 */
export function segmentResume(text: string): ResumeOutline {
  const segments: ResumeSegment[] = [];
  const sections: { title: string; start: number; end: number }[] = [];
  let section: string | null = null;
  let cursor = 0;

  for (;;) {
    let eol = text.indexOf(String.fromCharCode(10), cursor);
    if (eol < 0) eol = text.length;
    let raw = text.slice(cursor, eol);
    const rawEnd = eol;
    if (raw.endsWith(String.fromCharCode(13))) raw = raw.slice(0, -1);

    const trimmed = raw.trim();
    if (trimmed) {
      const leading = raw.length - raw.trimStart().length;
      const start = cursor + leading;
      const end = start + trimmed.length;
      const heading = headingOf(trimmed);
      let kind: SegmentKind;
      if (heading !== null) {
        kind = 'header';
        section = heading;
        sections.push({ title: heading, start, end });
      } else if (BULLET_RE.test(raw)) {
        kind = 'bullet';
      } else {
        kind = 'paragraph';
      }
      segments.push({ index: segments.length, kind, text: trimmed, start, end, section });
    }

    if (eol >= text.length) break;
    cursor = rawEnd + 1;
  }

  for (let i = 0; i < sections.length; i++) {
    const cur = sections[i];
    const nxt = sections[i + 1];
    if (cur) cur.end = nxt ? nxt.start : text.length;
  }

  return { text, segments, sections };
}

/** 渲染成给 LLM 看的带编号清单——编号即后续引用的定位手段 */
export function outlineForPrompt(outline: ResumeOutline, maxCharsPerSegment = 200): string {
  return outline.segments
    .map((s) => {
      const tag = s.kind === 'header' ? '[小节]' : s.kind === 'bullet' ? '[条目]' : '[段落]';
      const body = s.text.length > maxCharsPerSegment ? s.text.slice(0, maxCharsPerSegment) + '…' : s.text;
      return '#' + s.index + ' ' + tag + ' ' + body;
    })
    .join(String.fromCharCode(10));
}