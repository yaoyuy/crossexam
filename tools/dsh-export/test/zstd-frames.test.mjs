import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { findFrameOffsets, decompressFrames } from '../src/zstd-frames.mjs';

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

  it('单帧调用只能拿到第一帧——这正是必须自己扫帧的原因', () => {
    const buf = multiFrame(['第一帧\n', '第二帧\n']);
    expect(zlib.zstdDecompressSync(buf).toString('utf8')).toBe('第一帧\n');
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
