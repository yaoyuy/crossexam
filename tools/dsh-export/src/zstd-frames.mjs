/**
 * DSH 会话文件的读取与多帧 zstd 解压。
 *
 * 背景：DSH 把会话写进 session.v4.jsonl.zstd，而它是**多帧拼接**的 zstd
 * （每次追加一批事件就压一帧）。所以必须自己扫帧边界。
 *
 * 为什么不用 zstd CLI / 三方库：本项目的复现要求是「clone 后 npm i 即可」，
 * 不能要求评委额外装命令行工具。node:zlib 自带 zstd，零额外依赖。
 *
 * 为什么不靠「zstdDecompressSync 只解第一帧」：这条行为**依平台而异**。
 * Windows 的 Node 24 解到第一帧末尾就停，Linux 上同样版本的 Node
 * 会把后面拼接的帧一起解出来——于是「逐帧解压」在 Linux 上会把文本重复拼好几遍。
 * CI 在 Ubuntu 上一次就抓到了（见 findings F100）。所以这里按 RFC 8878 自己算帧长：
 * 先解出每一帧的**精确字节范围**，再逐帧解压，结果与平台无关。
 */
import zlib from 'node:zlib';

/** zstd 帧魔数 0x28 0xB5 0x2F 0xFD */
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** 扫描缓冲区里所有 zstd 帧的起始偏移（含压缩数据内部的假魔数）。 */
export function findFrameOffsets(buf) {
  const offsets = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.compare(MAGIC, 0, 4, i, i + 4) === 0) offsets.push(i);
  }
  return offsets;
}

/**
 * 读一帧的压缩长度（RFC 8878 §3.1 帧头 + §3.1.1 块头）。
 * @returns {number|null} 字节数（含帧头、块与可选校验和）；不是一帧完整数据时返回 null
 */
export function frameLength(buf, offset = 0) {
  let p = offset;
  const need = (n) => p + n <= buf.length;
  if (!need(4) || buf.compare(MAGIC, 0, 4, p, p + 4) !== 0) return null;
  p += 4;

  if (!need(1)) return null;
  const fhd = buf[p++];
  const fcsFlag = fhd >> 6;
  const singleSegment = (fhd >> 5) & 1;
  const checksum = (fhd >> 2) & 1;
  const dictFlag = fhd & 3;
  if ((fhd >> 4) & 1) return null; // Unused 位必须为 0
  if ((fhd >> 3) & 1) return null; // Reserved 位必须为 0

  if (!singleSegment) p += 1; // Window_Descriptor
  p += [0, 1, 2, 4][dictFlag]; // Dictionary_ID
  p += [singleSegment ? 1 : 0, 2, 4, 8][fcsFlag]; // Frame_Content_Size

  for (let guard = 0; guard < 1_000_000; guard++) {
    if (!need(3)) return null;
    const h = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
    p += 3;
    const last = h & 1;
    const type = (h >> 1) & 3;
    const size = h >> 3;
    if (type === 3) return null; // Reserved 块类型
    p += type === 1 ? 1 : size; // RLE 块只占 1 字节
    if (!need(0)) return null;
    if (last) break;
  }

  if (checksum) p += 4;
  if (p > buf.length) return null;
  return p - offset;
}

/**
 * 逐帧解压为 UTF-8 文本。
 * @returns {{ text: string, frameCount: number, failedFrames: number }}
 *   failedFrames > 0 说明有疑似魔数其实落在压缩数据内部，已被安全跳过。
 */
export function decompressFrames(buf) {
  const parts = [];
  let failedFrames = 0;

  for (const offset of findFrameOffsets(buf)) {
    const len = frameLength(buf, offset);
    if (len === null) {
      failedFrames++;
      continue;
    }
    try {
      // 只喂这一帧的字节：不依赖「解压到帧尾就停」这种平台相关的行为
      const chunk = zlib.zstdDecompressSync(buf.subarray(offset, offset + len)).toString('utf8');
      // 解出来若是乱码（非法 UTF-8 被替换成 U+FFFD），说明这个偏移是假魔数
      if (chunk.length > 0 && !chunk.includes('\uFFFD')) parts.push(chunk);
      else failedFrames++;
    } catch {
      failedFrames++;
    }
  }

  return { text: parts.join(''), frameCount: parts.length, failedFrames };
}
