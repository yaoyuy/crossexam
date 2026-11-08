// 旁白切句与字幕时间轴：旁白逐句合成时留下逐片音频，这里把每片切成可读的字幕行，
// 片内按字数比例分配时间，片边界用实测时长——所以字幕与旁白的对齐是「锚点精确 + 片内近似」。

/** 与 narrate.mjs 完全一致的切句规则：先按句末标点切，太短的跟前一句合并（≤60 字） */
export function splitSentences(text) {
  return text
    .split(/(?<=[。？！；])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .reduce((acc, s) => {
      if (acc.length > 0 && (acc[acc.length - 1] + s).length <= 60) acc[acc.length - 1] += s;
      else acc.push(s);
      return acc;
    }, []);
}

// 只把中文标点当断句点：ASCII 的 . 会切开「2.4 秒」和「0.8 秒」
const BREAK = '，、：；。？！';
const isBreak = (ch) => BREAK.includes(ch);

/** 单行上限：40 px 字号下 24 字约 1 000 px，1920 宽两侧还留得下白 */
const MAX_LINE = 24;
const MIN_LINE = 10;

/** 英文单词与数字是不可切开的原子——否则 Prompt 会被断成「Pro / mpt」 */
function atoms(s) {
  const out = [];
  const re = /[A-Za-z0-9][A-Za-z0-9._%+#/-]*/g;
  let i = 0;
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (m && m.index === i) {
      out.push(m[0]);
      i += m[0].length;
    } else {
      out.push(s[i]);
      i += 1;
    }
  }
  return out;
}

/** 一句话切成若干条单行字幕：先按标点攒满一行，超长的再在标点/原子边界硬切 */
export function splitDisplayCues(sentence, { max = MAX_LINE, min = MIN_LINE } = {}) {
  const frags = [];
  let cur = '';
  for (const ch of sentence) {
    cur += ch;
    if (isBreak(ch)) {
      frags.push(cur);
      cur = '';
    }
  }
  if (cur) frags.push(cur);

  const packed = [];
  let buf = '';
  for (const f of frags) {
    if (buf === '') buf = f;
    else if (buf.length + f.length <= max) buf += f;
    else {
      packed.push(buf);
      buf = f;
    }
  }
  if (buf) packed.push(buf);

  const pieces = [];
  for (const f of packed) pieces.push(...hardSplit(f, { max, min }));

  // 太短或只剩标点的碎条并回上一条（宁可长一点，也不要闪一下）
  const cues = [];
  for (const p of pieces) {
    const prev = cues[cues.length - 1];
    if (prev !== undefined && (p.length < min || /^[，、：；。？！]+$/.test(p)) && prev.length + p.length <= max) {
      cues[cues.length - 1] = prev + p;
    } else {
      cues.push(p);
    }
  }
  return cues;
}

function hardSplit(fragment, { max, min }) {
  // 只超一点就整条留一行：40 px 字号 28 字约 1 100 px，比在词中间切一刀好看
  if (fragment.length <= max + 4) return [fragment];
  const cuts = [];
  let n = 0;
  for (const a of atoms(fragment)) {
    n += a.length;
    cuts.push(n);
  }
  const fits = (c) => c >= min && c < fragment.length && fragment.length - c >= min;
  // 首选句读处断（标点留在条尾），再退到原子边界，两者都不会把英文单词劈开
  let cut = -1;
  for (const c of cuts) if (c <= max && fits(c) && isBreak(fragment[c - 1])) cut = c;
  if (cut === -1) for (const c of cuts) if (c <= max && fits(c)) cut = c;
  if (cut === -1) for (const c of cuts) if (c <= max + 8 && fits(c)) cut = c;
  if (cut === -1) cut = Math.max(1, Math.min(fragment.length - 1, max));
  return [fragment.slice(0, cut), ...hardSplit(fragment.slice(cut), { max, min })];
}

/** 显示权重：标点与空格按 0.35 计，其余按 1 计——用来在片内按字数比例分配时间 */
export function weight(s) {
  let w = 0;
  for (const ch of s) w += isBreak(ch) || ch === ' ' ? 0.35 : 1;
  return w;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 秒 → ASS 时间 h:mm:ss.cc */
export function assTime(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return h + ':' + pad(m) + ':' + pad(s) + '.' + pad(cs % 100);
}

const STYLE = [
  'Style: CX,Microsoft YaHei,40,&H00FFFFFF,&H00FFFFFF,&H2E0B0F14,&H2E0B0F14,-1,0,0,0,100,100,0.4,0,3,8,0,2,120,120,64,1',
].join('');

/** 生成整段的 ASS：一条 Dialogue 一个字幕行，样式与原来画面底部的暗底白字一致 */
export function buildAss(cues) {
  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    STYLE,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = cues.map((c) => 'Dialogue: 0,' + assTime(c.start) + ',' + assTime(c.end) + ',CX,,0,0,0,,' + c.text.replace(/\n/g, '\\N'));
  return head.concat(events).join('\n') + '\n';
}

/**
 * 一片音频（一句话）→ 若干条字幕。片内按字数比例分配，保证与下一片的边界严丝合缝。
 * @param {string} sentence 这一片念的原文
 * @param {number} start 这一片的开始时间（秒）
 * @param {number} duration 这一片的实测时长（秒）
 */
export function cuesForChunk(sentence, start, duration) {
  const lines = splitDisplayCues(sentence);
  const ws = lines.map(weight);
  const total = ws.reduce((a, b) => a + b, 0);
  let acc = 0;
  return lines.map((text, i) => {
    const from = start + (duration * acc) / total;
    acc += ws[i];
    const to = start + (duration * acc) / total;
    return { text, start: from, end: to };
  });
}
