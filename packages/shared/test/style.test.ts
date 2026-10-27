import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REWRITE_STYLE,
  REWRITE_STYLES,
  REWRITE_STYLE_GUIDE,
  REWRITE_STYLE_HINT,
  REWRITE_STYLE_LABEL,
  isRewriteStyle,
  rewriteStyleOf,
  rewriteStyleViews,
} from '../src/style.ts';

describe('改写风格档位', () => {
  it('三档的顺序与默认档都写死，不靠字典序', () => {
    expect([...REWRITE_STYLES]).toEqual(['conservative', 'normal', 'bold']);
    expect(DEFAULT_REWRITE_STYLE).toBe('normal');
  });

  it('每一档都有中文名、一句人话说明、一段提示词指南：漏一个界面上就会出现空白', () => {
    for (const id of REWRITE_STYLES) {
      expect(REWRITE_STYLE_LABEL[id].length).toBeGreaterThan(0);
      expect(REWRITE_STYLE_HINT[id].length).toBeGreaterThan(20);
      expect(REWRITE_STYLE_GUIDE[id].length).toBeGreaterThan(30);
    }
  });

  it('三档的说明与指南各不相同：一样的话，档位就只是个装饰', () => {
    const hints = REWRITE_STYLES.map((id) => REWRITE_STYLE_HINT[id]);
    const guides = REWRITE_STYLES.map((id) => REWRITE_STYLE_GUIDE[id]);
    expect(new Set(hints).size).toBe(REWRITE_STYLES.length);
    expect(new Set(guides).size).toBe(REWRITE_STYLES.length);
  });

  it('保守档明说只做减法，敢改档明说不许新增事实', () => {
    expect(REWRITE_STYLE_GUIDE.conservative).toContain('只做减法');
    expect(REWRITE_STYLE_GUIDE.bold).toContain('不新增任何事实');
  });

  it('只有三档字符串算数，别的都当默认档', () => {
    expect(isRewriteStyle('bold')).toBe(true);
    expect(isRewriteStyle('BOLD')).toBe(false);
    expect(isRewriteStyle('')).toBe(false);
    expect(isRewriteStyle(null)).toBe(false);
    expect(isRewriteStyle(42)).toBe(false);
    expect(rewriteStyleOf('conservative')).toBe('conservative');
    expect(rewriteStyleOf('狂野')).toBe('normal');
    expect(rewriteStyleOf(undefined)).toBe('normal');
  });

  it('给界面的视图与常量同源：默认档、名字、说明一个字都不用界面再抄一份', () => {
    const views = rewriteStyleViews();
    expect(views.map((view) => view.id)).toEqual([...REWRITE_STYLES]);
    for (const view of views) {
      expect(view.label).toBe(REWRITE_STYLE_LABEL[view.id]);
      expect(view.hint).toBe(REWRITE_STYLE_HINT[view.id]);
    }
  });
});