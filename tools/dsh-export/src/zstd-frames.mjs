/**
 * DSH 会话文件的读取与多帧 zstd 解压。
 *
 * 背景：DSH 把会话写进 session.v4.jsonl.zstd，而它是**多帧拼接**的 zstd
 * （每次追加一批事件就压一帧）。Node 的 zlib.zstdDecompressSync 只解第一帧，
 * 所以必须自己扫帧边界。
 *
 * 为什么不用 zstd CLI / 三方库：本项目的复现要求是「clone 后 npm i 即可」，
 * 不能要求评委额外装命令行工具。node:zlib 自带 zstd，零额外依赖。
 */
import zlib from 'node:zlib';

/** zstd 帧魔数 0x28 0xB5 0x2F 0xFD */
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * 扫描缓冲区里所有 zstd 帧的起始偏移。
 * 压缩数据内部理论上也可能出现魔数，所以调用方必须用「能否解压成功」再筛一遍。
 */
export function findFrameOffsets(buf) {
  const offsets = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.compare(MAGIC, 0, 4, i, i + 4) === 0) offsets.push(i);
  }
  return offsets;
}

/**
 * 逐帧解压为 UTF-8 文本。
 * @returns {{ text: string, frameCount: number, failedFrames: number }}
 *   failedFrames > 0 说明有疑似魔数其实落在压缩数据内部，已被安全跳过。
 */
export function decompressFrames(buf) {
  const offsets = findFrameOffsets(buf);
  const parts = [];
  let failedFrames = 0;

  for (const offset of offsets) {
    try {
      const chunk = zlib.zstdDecompressSync(buf.subarray(offset)).toString('utf8');
      // 解出来若是乱码（非法 UTF-8 被替换成 U+FFFD），说明这个偏移是假魔数
      if (chunk.length > 0 && !chunk.includes('\uFFFD')) parts.push(chunk);
      else failedFrames++;
    } catch {
      failedFrames++;
    }
  }

  return { text: parts.join(''), frameCount: parts.length, failedFrames };
}
