// 分段合成：一句一段，逐段写 mp3，再用 ffmpeg 拼起来（一次性喂长文本会被 Edge 掐断）
import { mkdirSync, readdirSync, statSync, writeFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { BEATS } from '../video/lines.mjs';

const ROOT = 'D:/CZB/.tmp/video/audio';
const RAW = ROOT + '/raw';
mkdirSync(RAW, { recursive: true });

const split = (text) => text
  .split(/(?<=[。？！；])/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .reduce((acc, s) => {
    // 太短的句子跟前一句合并，避免一句话被切成两个气口
    if (acc.length > 0 && (acc[acc.length - 1] + s).length <= 60) acc[acc.length - 1] += s;
    else acc.push(s);
    return acc;
  }, []);

const only = process.argv.slice(2);
for (const beat of BEATS) {
  if (only.length > 0 && !only.includes(beat.id)) continue;
  const dir = RAW + '/' + beat.id;
  rmSync(dir, { recursive: true, force: true });
  const parts = split(beat.text);
  const files = [];
  for (let i = 0; i < parts.length; i += 1) {
    const sub = dir + '/' + String(i).padStart(3, '0');
    mkdirSync(sub, { recursive: true });
    let ok = false;
    for (let attempt = 1; attempt <= 4 && !ok; attempt += 1) {
      const tts = new MsEdgeTTS();
      try {
        await tts.setMetadata('zh-CN-XiaoxiaoNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        await tts.toFile(sub, parts[i]);
        const size = statSync(sub + '/audio.mp3').size;
        if (size > 1000) ok = true;
      } catch (err) {
        console.log(beat.id, i, 'attempt', attempt, String(err.message).slice(0, 60));
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    if (!ok) throw new Error('合成失败：' + beat.id + ' #' + i + ' ' + parts[i].slice(0, 20));
    files.push(sub + '/audio.mp3');
    console.log(beat.id, i + '/' + parts.length, statSync(sub + '/audio.mp3').size);
  }
  writeFileSync(dir + '/list.txt', files.map((f) => "file '" + f.replaceAll("'", "'\\''") + "'").join('\n'));
  console.log(beat.id, 'chunks', files.length);
}
process.exit(0);
