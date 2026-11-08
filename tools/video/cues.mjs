// 逐句字幕时间轴：读 narrate.mjs 留下的逐片音频，实测每片时长，切出可读的字幕行，写成 ASS。
// 用法（cwd 必须是 .tmp/video）：node ../../tools/video/cues.mjs [b1 b2 ...]
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { BEATS } from './lines.mjs';
import { splitSentences, cuesForChunk, buildAss } from './subtitles.mjs';

const FF = 'D:/CZB/.tmp/vtools/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe';
const ROOT = 'D:/CZB/.tmp/video';
const OUT = ROOT + '/captions';
mkdirSync(OUT, { recursive: true });

/** 时长靠解码成 24 kHz 单声道 PCM 的字节数算——比正则抓 Duration 可靠（片长 <2 s 时 ffmpeg 不打印 Duration） */
const duration = (file) => {
  const buf = execFileSync(FF, ['-v', 'error', '-i', file, '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '24000', '-ac', '1', '-'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return buf.length / 48000;
};

const only = process.argv.slice(2).filter((a) => a.startsWith('b'));
const rows = [];
for (const beat of BEATS) {
  if (only.length > 0 && !only.includes(beat.id)) continue;
  const rawDir = ROOT + '/audio/raw/' + beat.id;
  if (!existsSync(rawDir)) throw new Error(beat.id + '：没有逐句音频，先跑 narrate.mjs');
  const chunks = readdirSync(rawDir).filter((n) => /^\d+$/.test(n)).sort();
  const sentences = splitSentences(beat.text);
  // 旁白改过却只重录了几段，是这套管线最容易犯的错：片数对不上就直接停，别生成错位的字幕
  if (chunks.length !== sentences.length) {
    throw new Error(beat.id + '：逐句音频 ' + chunks.length + ' 片，当前旁白切出 ' + sentences.length + ' 句——旁白改过但没重录，先跑 narrate.mjs');
  }
  const durations = chunks.map((c) => duration(rawDir + '/' + c + '/audio.mp3'));
  const cues = [];
  let t = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    for (const cue of cuesForChunk(sentences[i], t, durations[i])) cues.push(cue);
    t += durations[i];
  }
  // 自检：没丢字——字幕拼回去必须等于旁白原文（否则就是切句丢了字，观众一定看得出来）
  const joined = cues.map((c) => c.text).join('');
  const expected = sentences.join('');
  if (joined !== expected) throw new Error(beat.id + '：字幕拼回 ' + joined.length + ' 字，旁白 ' + expected.length + ' 字，不一致');
  // 自检：不漏、不叠、不闪
  for (let i = 0; i < cues.length; i += 1) {
    const d = cues[i].end - cues[i].start;
    if (d < 0.5) console.log('  警告', beat.id, '第' + i + '条只有 ' + d.toFixed(2) + 's：「' + cues[i].text + '」');
    if (i > 0 && Math.abs(cues[i].start - cues[i - 1].end) > 0.02) console.log('  警告', beat.id, '第' + i + '条与上一条不接续');
  }
  writeFileSync(OUT + '/' + beat.id + '.ass', buildAss(cues), 'utf8');
  writeFileSync(OUT + '/' + beat.id + '.cues.json', JSON.stringify({ id: beat.id, audioDur: +t.toFixed(3), cues }, null, 1), 'utf8');
  const audioDur = duration(ROOT + '/audio/' + beat.id + '.mp3');
  const longest = Math.max(...cues.map((c) => c.text.length));
  rows.push({ id: beat.id, sentences: sentences.length, cues: cues.length, audio: +audioDur.toFixed(2), timeline: +t.toFixed(2), longest });
  console.log(beat.id, sentences.length + '句 → ' + cues.length + '条字幕', 'timeline=' + t.toFixed(2) + 's', 'audio=' + audioDur.toFixed(2) + 's', '最长' + longest + '字');
}
console.log('done', rows.length, 'beats,', rows.reduce((a, r) => a + r.cues, 0), 'cues');
