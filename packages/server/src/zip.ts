import { deflateRawSync } from "node:zlib";

/**
 * 极小的 ZIP 写入器：把一组「文件名 + 字节」打成 zip 容器。
 *
 * .xlsx 与 .docx 都是 zip 容器，而 Node 自带 zlib、不自带 zip 写入器。
 * 引一个 zip 库就多一个复现失败点（ADR-0007 砍掉老 .doc 解析是同一条纪律），
 * 而这里要的只有三件事：本地头、deflate、中央目录。
 *
 * 确定性：时间戳写死 1980-01-01（DOS 纪元的起点），同一份输入两次导出逐字节相同；
 * 否则每跑一次导出都会在版本库里留下一个「变了但其实没变」的文件。
 */

export interface ZipFile {
  name: string;
  data: Buffer;
}

/** 1980-01-01 00:00:00 的 DOS 时间戳：年 =(33>>9)+1980，月 =(33>>5)&15，日 =33&31 */
const DOS_TIME = 0;
const DOS_DATE = 33;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) >>> 0 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    const entry = CRC_TABLE[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0;
    crc = (entry ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value & 0xffff, 0);
  return out;
}

function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0, 0);
  return out;
}

export function zipArchive(files: readonly ZipFile[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const raw = file.data;
    const deflated = deflateRawSync(raw);
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(crc),
      u32(body.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
    ]);
    parts.push(local, name, body);
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(method),
        u16(DOS_TIME),
        u16(DOS_DATE),
        u32(crc),
        u32(body.length),
        u32(raw.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
      ]),
      name,
    );
    offset += local.length + name.length + body.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBuffer.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...parts, centralBuffer, end]);
}
