/**
 * 配色主题：深色是默认（发布出来的样子），浅色给白天、投影仪、打印稿看。
 *
 * 这里刻意只做一件事：把 data-theme 写到 <html> 上。
 * 颜色本身全在 index.css 的 :root[data-theme='light'] 里覆盖了同一套 --color-ink-* 变量，
 * 所以界面代码里一个「深色分支」都不需要写——写分支迟早会漏掉某个组件。
 */
export type Theme = 'dark' | 'light';

export const DEFAULT_THEME: Theme = 'dark';
export const THEME_STORAGE_KEY = 'crossexam.theme';
export const THEME_LABEL: Record<Theme, string> = { dark: '深色', light: '浅色' };

/** 认不出来的值一律当默认，不抛错：localStorage 里可能还留着上一个版本写的东西 */
export function parseTheme(raw: string | null | undefined): Theme {
  return raw === 'light' ? 'light' : DEFAULT_THEME;
}

export function nextTheme(current: Theme): Theme {
  return current === 'light' ? 'dark' : 'light';
}

export function readStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return DEFAULT_THEME;
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset['theme'] = theme;
}

export function saveTheme(theme: Theme): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 无痕模式下写不进去，不该因此用不了界面
  }
}
