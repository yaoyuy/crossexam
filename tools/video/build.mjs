// 帧序列 + 旁白 → 每段 mp4 → 合成总片
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { BEATS } from './lines.mjs';

const FF = 'D:/CZB/.tmp/vtools/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe';
const ROOT = 'D:/CZB/.tmp/video';
const OUT = ROOT + '/segments';
mkdirSync(OUT, { recursive: true });
mkdirSync(ROOT + '/captions', { recursive: true });
// 过滤器里的反斜杠会被当转义吃掉，字体路径一律用正斜杠
const FONT = 'C\\:/Windows/Fonts/msyh.ttc';

const probeDur = (file) => {
  const out = execFileSync(FF, ['-hide_banner', '-i', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(out);
  if (!m) throw new Error('读不出时长：' + file);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};
const probeDur2 = (file) => {
  try { return probeDur(file); } catch (err) {
    const text = String(err.stdout ?? '') + String(err.stderr ?? '');
    const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(text);
    if (!m) throw new Error('读不出时长：' + file);
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
};

const writeText = (name, text) => {
  mkdirSync(ROOT + '/captions', { recursive: true });
  writeFileSync(ROOT + '/captions/' + name + '.txt', text, 'utf8');
  // drawtext 的选项用冒号分隔，路径里带盘符会被截断；一律给相对路径（本脚本的 cwd 是 .tmp/video）
  return 'captions/' + name + '.txt';
};

/** 把帧的时间戳变成 concat 清单上的每帧时长；末帧补到本段总长 */
function frameList(beat, segment, tail = 0.35) {
  const dir = ROOT + '/frames/' + beat;
  const meta = JSON.parse(readFileSync(dir + '/meta.json', 'utf8'));
  const frames = meta.frames;
  const lines = [];
  for (let i = 0; i < frames.length; i += 1) {
    const next = i + 1 < frames.length ? frames[i + 1].t : segment * 1000 - tail * 1000;
    const d = Math.max(0.033, (next - frames[i].t) / 1000);
    // concat 解复用器会把清单里的相对路径拼到清单所在目录后面，所以清单放帧目录、只写文件名
    lines.push("file '" + frames[i].file.split(/[\\/]/).pop() + "'");
    lines.push('duration ' + d.toFixed(4));
  }
  // concat 解复用器要求最后一帧重复一次，否则会丢掉最后一帧
  lines.push("file '" + frames[frames.length - 1].file.split(/[\\/]/).pop() + "'");
  const file = dir + '/list.txt';
  writeFileSync(file, lines.join('\n'), 'utf8');
  return { list: file, span: frames[frames.length - 1].t / 1000 };
}

const only = process.argv.slice(2);
const built = [];
for (const beat of BEATS) {
  if (only.length > 0 && !only.includes(beat.id)) continue;
  const audio = ROOT + '/audio/' + beat.id + '.mp3';
  if (!existsSync(audio)) { console.log(beat.id, '跳过：没有旁白'); continue; }
  if (!existsSync(ROOT + '/frames/' + beat.id + '/meta.json')) { console.log(beat.id, '跳过：没有帧'); continue; }
  const audioDur = probeDur2(audio);
  const rough = frameList(beat.id, 1) // 只为拿到 span，下面按真实段长重算
  const span = rough.span;
  const segment = Math.max(span + 0.5, audioDur + 0.9);
  const { list } = frameList(beat.id, segment);

  // 章节标签不再烧进画面：它会压住应用顶栏与静态页的 kicker（同一句话写两遍还互相遮）
  const caption = writeText(beat.id + '-caption', beat.caption);
  const vf = [
    'fps=30',
    'scale=1920:1080:flags=bicubic',
    'setsar=1',
    "drawtext=fontfile='" + FONT + "':textfile='" + caption + "':fontcolor=white:fontsize=34:x=(w-text_w)/2:y=h-112:box=1:boxcolor=0x0b0f14@0.78:boxborderw=20",
    'format=yuv420p',
  ].join(',');
  const out = OUT + '/' + beat.id + '.mp4';
  try {
    execFileSync(FF, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', list,
      '-i', audio,
      '-vf', vf,
      '-af', 'apad',
      '-t', segment.toFixed(3),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-g', '60',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart',
      out,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    // ffmpeg 的真实报错在 stderr 里，必须打出来，否则只能看到 node 的调用栈
    console.log(beat.id, 'ffmpeg 失败：', String(err.stderr ?? '').slice(-1200));
    throw err;
  }
  const real = probeDur2(out);
  console.log(beat.id, 'span=' + span.toFixed(1) + 's audio=' + audioDur.toFixed(1) + 's → ' + real.toFixed(1) + 's');
  built.push({ id: beat.id, file: out, dur: real });
}
// 只重录一段时不要覆盖整份清单：先读旧的，按 BEATS 顺序合并
const manifestPath = ROOT + '/segments/manifest.json';
const prev = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
const merged = new Map(prev.map((s) => [s.id, s]));
for (const s of built) merged.set(s.id, s);
const ordered = BEATS.map((b) => merged.get(b.id)).filter(Boolean);
writeFileSync(manifestPath, JSON.stringify(ordered, null, 1));
console.log('done', built.length, 'manifest', ordered.length);
