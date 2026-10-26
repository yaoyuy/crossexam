import { inflateRawSync } from 'node:zlib';

/**
 * 只读的 ZIP 解析：够读 .docx 就行。
 *
 * 为什么不引一个 zip 库：这里要处理的是「用户拖进来的一份 Word 文档」，
 * 需要的只是「按名字取一个条目」（.docx 里我们只关心 word/document.xml），
 * 而 zip 的中央目录格式二十年没变过。为一个函数引一棵依赖树，会让
 * 「npm install 之后就能跑」这条承诺多一个可能失败的点。
 *
 * 支持：store（0）与 deflate（8）两种方法、中央目录定位、UTF-8 文件名。
 * 不支持：Zip64（.docx 不会到 4 GB）、加密、跨卷。
 */

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export class ZipError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ZipError';
    this.code = code;
  }
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function looksLikeZip(buffer: Uint8Array): boolean {
  return buffer.length > 4 && readU32(buffer, 0) === SIG_LOCAL;
}

function readU16(buffer: Uint8Array, offset: number): number {
  return buffer[offset]! | (buffer[offset + 1]! << 8);
}

function readU32(buffer: Uint8Array, offset: number): number {
  return (
    (buffer[offset]! | (buffer[offset + 1]! << 8) | (buffer[offset + 2]! << 16)) +
    buffer[offset + 3]! * 0x1000000
  );
}

function findEocd(buffer: Uint8Array): number {
  const min = Math.max(0, buffer.length - 66_000);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (readU32(buffer, i) === SIG_EOCD) return i;
  }
  throw new ZipError('zip-no-eocd', '这个文件不像是 zip 容器（找不到中央目录）');
}

export function readZip(buffer: Uint8Array): ZipEntry[] {
  const eocd = findEocd(buffer);
  const count = readU16(buffer, eocd + 10);
  let cursor = readU32(buffer, eocd + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length || readU32(buffer, cursor) !== SIG_CENTRAL) {
      throw new ZipError('zip-bad-central', 'zip 中央目录读到一半坏了');
    }
    const method = readU16(buffer, cursor + 10);
    const compressedSize = readU32(buffer, cursor + 20);
    const nameLength = readU16(buffer, cursor + 28);
    const extraLength = readU16(buffer, cursor + 30);
    const commentLength = readU16(buffer, cursor + 32);
    const localOffset = readU32(buffer, cursor + 42);
    const name = new TextDecoder('utf-8').decode(
      buffer.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    cursor += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;
    if (readU32(buffer, localOffset) !== SIG_LOCAL) {
      throw new ZipError('zip-bad-local', '条目 ' + name + ' 的本地头对不上');
    }
    const localNameLength = readU16(buffer, localOffset + 26);
    const localExtraLength = readU16(buffer, localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    if (method === 0) {
      entries.push({ name, data: raw });
    } else if (method === 8) {
      entries.push({ name, data: new Uint8Array(inflateRawSync(raw)) });
    } else {
      throw new ZipError('zip-method', '不认识的压缩方法：' + String(method));
    }
  }

  return entries;
}

export function readZipEntry(buffer: Uint8Array, name: string): Uint8Array | null {
  for (const entry of readZip(buffer)) {
    if (entry.name === name) return entry.data;
  }
  return null;
}
