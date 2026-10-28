// 把每段 mp4 拼成总片，加淡入淡出，输出到 docs/video/
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FF = 'D:/CZB/.tmp/vtools/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe';
const ROOT = 'D:/CZB/.tmp/video';
const segs = JSON.parse(readFileSync(ROOT + '/segments/manifest.json', 'utf8'));
if (segs.length === 0) throw new Error('没有已生成的段');

const listFile = ROOT + '/final-list.txt';
// 清单放在 .tmp/video 下，条目写相对路径（concat 会把清单目录拼在前面）
writeFileSync(listFile, segs.map((s) => "file 'segments/" + s.id + ".mp4'").join('\n'), 'utf8');

const total = segs.reduce((a, s) => a + s.dur, 0);
const fadeOut = Math.max(0, total - 0.9).toFixed(2);
mkdirSync('D:/CZB/docs/video', { recursive: true });
const out = 'D:/CZB/docs/video/crossexam-demo.mp4';

execFileSync(FF, [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'concat', '-safe', '0', '-i', listFile,
  '-vf', 'fade=t=in:st=0:d=0.6,fade=t=out:st=' + fadeOut + ':d=0.9',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-g', '60', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
  '-movflags', '+faststart',
  out,
], { stdio: 'inherit' });

console.log('总片', out, (statSync(out).size / 1048576).toFixed(1) + ' MB', '时长约', (total / 60).toFixed(2) + ' 分钟');
