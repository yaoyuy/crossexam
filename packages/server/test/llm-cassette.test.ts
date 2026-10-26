import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CASSETTE_VERSION, digestFor, listCassettes, readCassette, writeCassette } from '../src/llm/cassette.ts';
import { baseRequest, cleanup, codeOf, entryFor, newTempDir } from './llm-helpers.ts';
import type { LlmRequest } from '../src/llm/types.ts';

let dir = '';

beforeEach(function () {
  dir = newTempDir();
});

afterEach(function () {
  cleanup(dir);
});

describe('卡带指纹', function () {
  it('同样的提示词永远得到同样的指纹', function () {
    const req = baseRequest();
    expect(digestFor(req)).toBe(digestFor(req));
    expect(digestFor(req)).toHaveLength(24);
  });

  it('用途标签不参与指纹——它只是给人看的备注', function () {
    const req = baseRequest();
    expect(digestFor({ ...req, purpose: '换个说法' })).toBe(digestFor(req));
  });

  it('提示词里任何一个字变了，指纹就变', function () {
    const req = baseRequest();
    const changed: LlmRequest = {
      ...req,
      messages: [{ role: 'user', content: '简历正文：负责重构订单系统。' }],
    };
    expect(digestFor(changed)).not.toBe(digestFor(req));
  });

  it('采样温度变了也算另一条记录', function () {
    const req = baseRequest();
    expect(digestFor({ ...req, temperature: 0.9 })).not.toBe(digestFor(req));
  });
});

describe('卡带读写', function () {
  it('写进去再读出来，文本与用途一致', function () {
    const req = baseRequest();
    const entry = entryFor(req, '{"claims":[]}');
    writeCassette(dir, entry);
    const back = readCassette(dir, entry.digest);
    expect(back).not.toBeNull();
    expect(back?.response.text).toBe('{"claims":[]}');
    expect(back?.purpose).toBe('抽取主张');
  });

  it('没有的记录返回 null，而不是抛错', function () {
    expect(readCassette(dir, 'a'.repeat(24))).toBeNull();
  });

  it('版本不符的卡带被明确拒绝，而不是被误读', function () {
    const digest = 'b'.repeat(24);
    writeFileSync(
      join(dir, digest + '.json'),
      JSON.stringify({ version: 99, digest: digest, response: { text: 'x' } }),
      'utf8',
    );
    expect(codeOf(function () { readCassette(dir, digest); })).toBe('cassette-version');
  });

  it('内容与文件名对不上时判损坏', function () {
    const digest = 'c'.repeat(24);
    writeFileSync(
      join(dir, digest + '.json'),
      JSON.stringify({ version: CASSETTE_VERSION, digest: 'd'.repeat(24), response: { text: 'x' } }),
      'utf8',
    );
    expect(codeOf(function () { readCassette(dir, digest); })).toBe('cassette-corrupt');
  });

  it('listCassettes 给出可读的清单', function () {
    writeCassette(dir, entryFor(baseRequest(), '{"claims":[]}'));
    const list = listCassettes(dir);
    expect(list).toHaveLength(1);
    expect(list[0]?.purpose).toBe('抽取主张');
    expect(list[0]?.model).toBe('demo-model');
  });
});
