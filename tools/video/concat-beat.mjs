// 把某一段的分句 mp3 拼成一个旁白文件（concat 清单必须写相对路径）
import { readdirSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FF = 'D:/CZB/.tmp/vtools/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe';
const beat = process.argv[2];
if (!beat) throw new Error('用法：node concat-beat.mjs b10');
const dir = 'D:/CZB/.tmp/video/audio/raw/' + beat;
const parts = readdirSync(dir).filter((d) => /^\d{3}$/.test(d)).sort();
const list = parts.map((p) => "file '" + p + "/audio.mp3'").join('\n');
writeFileSync(dir + '/list-rel.txt', list, 'utf8');
const out = 'D:/CZB/.tmp/video/audio/' + beat + '.mp3';
execFileSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list-rel.txt', '-c', 'copy', '../../' + beat + '.mp3'], { cwd: dir, stdio: 'inherit' });
console.log(beat, parts.length + ' 句 →', (statSync(out).size / 1024).toFixed(0) + ' KB');
