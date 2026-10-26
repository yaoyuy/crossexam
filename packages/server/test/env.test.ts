import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDotEnv } from '../src/env.ts';

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
