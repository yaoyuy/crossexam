import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { findFrameOffsets, frameLength, decompressFrames } from '../src/zstd-frames.mjs';

/** DSH 的会话文件是「多帧拼接」的 zstd，用真实压缩器造测试数据比手写字节靠谱 */
function multiFrame(chunks) {
  return Buffer.concat(chunks.map((c) => zlib.zstdCompressSync(Buffer.from(c, 'utf8'))));
}

describe('zstd 多帧解压', () => {
  it('能定位每一帧的起点', () => {
    const f1 = zlib.zstdCompressSync(Buffer.from('aaa'));
    const f2 = zlib.zstdCompressSync(Buffer.from('bbb'));
    const buf = Buffer.concat([f1, f2]);
    expect(findFrameOffsets(buf)).toEqual([0, f1.length]);
  });

  // 这条**不能**断言「zstdDecompressSync 只解第一帧」：那是平台行为。
  // Windows 的 Node 24 解到第一帧末尾就停，Linux 上会把后面拼接的帧一起解出来，
  // CI 因此在 Ubuntu 红过一次（findings F100）。所以断言我们自己算出来的帧长。
  it('能算出每一帧的精确字节数（与平台无关）', () => {
    const f1 = zlib.zstdCompressSync(Buffer.from('第一帧\n'));
    const f2 = zlib.zstdCompressSync(Buffer.from('第二帧\n'));
    const buf = Buffer.concat([f1, f2]);
    expect(frameLength(buf, 0)).toBe(f1.length);
    expect(frameLength(buf, f1.length)).toBe(f2.length);
    expect(frameLength(buf, f1.length + f2.length)).toBeNull();
  });

  it('逐帧扫描能把全部内容拼回来', () => {
    const buf = multiFrame(['第一帧\n', '第二帧\n', '第三帧\n']);
    const r = decompressFrames(buf);
    expect(r.text).toBe('第一帧\n第二帧\n第三帧\n');
    expect(r.frameCount).toBe(3);
    expect(r.failedFrames).toBe(0);
  });

  it('压缩数据内部出现的假魔数会被安全跳过，不会污染输出', () => {
    const real = zlib.zstdCompressSync(Buffer.from('真实内容'));
    // 在真实帧后面塞一段「带魔数但解不开」的垃圾
    const junk = Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), Buffer.alloc(16, 0x41)]);
    const r = decompressFrames(Buffer.concat([real, junk]));
    expect(r.text).toBe('真实内容');
    expect(r.failedFrames).toBe(1);
  });

  it('空缓冲区不炸', () => {
    const r = decompressFrames(Buffer.alloc(0));
    expect(r.text).toBe('');
    expect(r.frameCount).toBe(0);
  });
});
