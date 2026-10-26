import { describe, expect, it } from 'vitest';
import {
  applyTheme,
  DEFAULT_THEME,
  nextTheme,
  parseTheme,
  readStoredTheme,
  saveTheme,
  THEME_LABEL,
  THEME_STORAGE_KEY,
} from '../src/theme.ts';

/** 把全局对象换成测试用的假货：node 环境下本来没有 document 与 localStorage */
function install(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

describe('配色主题', () => {
  it('只认 light，其余一律回默认', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme(null)).toBe(DEFAULT_THEME);
    expect(parseTheme(undefined)).toBe(DEFAULT_THEME);
    expect(parseTheme('')).toBe(DEFAULT_THEME);
    expect(parseTheme('LIGHT')).toBe(DEFAULT_THEME);
    expect(parseTheme('{}')).toBe(DEFAULT_THEME);
  });

  it('两档来回切', () => {
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
  });

  it('两档都有中文标签', () => {
    expect(THEME_LABEL.dark).toBe('深色');
    expect(THEME_LABEL.light).toBe('浅色');
  });

  it('没有 localStorage 时用默认值', () => {
    install('localStorage', undefined);
    expect(readStoredTheme()).toBe(DEFAULT_THEME);
  });

  it('读得出上一次存的浅色', () => {
    install('localStorage', {
      getItem: (key: string) => (key === THEME_STORAGE_KEY ? 'light' : null),
    });
    expect(readStoredTheme()).toBe('light');
  });

  it('localStorage 读的时候抛异常也回默认，不把界面带崩', () => {
    install('localStorage', {
      getItem: () => {
        throw new Error('无痕模式关掉了存储');
      },
    });
    expect(readStoredTheme()).toBe(DEFAULT_THEME);
  });

  it('applyTheme 只改 html 上的 data-theme', () => {
    const dataset: Record<string, string> = {};
    install('document', { documentElement: { dataset } });
    applyTheme('light');
    expect(dataset['theme']).toBe('light');
    applyTheme('dark');
    expect(dataset['theme']).toBe('dark');
  });

  it('没有 document 时 applyTheme 也不抛错', () => {
    install('document', undefined);
    expect(() => applyTheme('light')).not.toThrow();
  });

  it('saveTheme 把选择写进存储，写不进去也不抛错', () => {
    const written: string[] = [];
    install('localStorage', {
      setItem: (key: string, value: string) => {
        written.push(key + '=' + value);
      },
    });
    saveTheme('light');
    expect(written).toEqual([THEME_STORAGE_KEY + '=light']);

    install('localStorage', {
      setItem: () => {
        throw new Error('配额满了');
      },
    });
    expect(() => saveTheme('light')).not.toThrow();
  });
});
