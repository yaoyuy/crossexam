import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDotEnv, parsePanelSize } from '../src/env.ts';

const touched = ['CROSSEXAM_TEST_ENV_VALUE', 'CROSSEXAM_TEST_ENV_SECOND'];

function newDir(): string {
  return mkdtempSync(join(tmpdir(), 'crossexam-env-'));
}

afterEach(() => {
  for (const key of touched) delete process.env[key];
});

describe('loadDotEnv', () => {
  it('文件不存在时返回 null，且不抛错', () => {
    const dir = newDir();
    try {
      expect(loadDotEnv(join(dir, '.env'))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('把键值写进 process.env，并返回绝对路径', () => {
    const dir = newDir();
    try {
      const file = join(dir, '.env');
      writeFileSync(file, 'CROSSEXAM_TEST_ENV_VALUE=loaded' + String.fromCharCode(10) + 'CROSSEXAM_TEST_ENV_SECOND=2' + String.fromCharCode(10));
      const loaded = loadDotEnv(file);
      expect(loaded).toBe(resolve(file));
      expect(process.env['CROSSEXAM_TEST_ENV_VALUE']).toBe('loaded');
      expect(process.env['CROSSEXAM_TEST_ENV_SECOND']).toBe('2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('注释行与空行不会变成环境变量', () => {
    const dir = newDir();
    try {
      const file = join(dir, '.env');
      writeFileSync(file, '# 注释' + String.fromCharCode(10) + String.fromCharCode(10) + 'CROSSEXAM_TEST_ENV_VALUE=ok' + String.fromCharCode(10));
      loadDotEnv(file);
      expect(process.env['CROSSEXAM_TEST_ENV_VALUE']).toBe('ok');
      expect(process.env['CROSSEXAM_TEST_ENV_SECOND']).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe('parsePanelSize', () => {
  it('没设或空串时返回 undefined，表示不限制', () => {
    expect(parsePanelSize(undefined)).toBeUndefined();
    expect(parsePanelSize('')).toBeUndefined();
    expect(parsePanelSize('   ')).toBeUndefined();
  });

  it('1-6 的整数照原样认', () => {
    for (const size of [1, 2, 3, 4, 5, 6]) {
      expect(parsePanelSize(String(size))).toBe(size);
    }
    expect(parsePanelSize(' 4 ')).toBe(4);
  });

  it('非法值当没设，而不是悄悄把面板压成 1 位', () => {
    // 0 与负数如果被当成上限，会让沙盘一位面试官都不剩；7 以上超出可选角色数
    for (const bad of ['0', '-1', '7', '4.5', 'four', 'NaN', '3 4']) {
      expect(parsePanelSize(bad)).toBeUndefined();
    }
  });
});
