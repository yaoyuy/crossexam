import type { IconName } from './components/Icon.tsx';

/**
 * 左侧栏的页面清单。
 *
 * 把「有哪几页」抽成纯数据，理由与 help.ts 一样：导航是产品结构的一部分，
 * 少一页、多一页、改个名字都应该在测试里红，而不是等用户找不到功能。
 * 页面 id 同时是 data-shot 的后缀（nav-home / page-home），点测靠它认路。
 *
 * P16 起每页还带一个图标与一个强调色：界面里每张卡片、每个入口磁贴都用同一套配色，
 * 「投料台是天蓝、质询台是紫、报告是绿」这类对应关系只在这里写一次。
 */
export type PageId = 'home' | 'intake' | 'interview' | 'report' | 'history' | 'settings';

/** index.css 里的 .accent-* 名字，卡片左侧色条与图标底色都用它 */
export type Accent = 'ember' | 'sky' | 'violet' | 'mint' | 'teal' | 'slate';

export interface PageItem {
  id: PageId;
  label: string;
  /** 一句话说明这一页管什么：鼠标悬停与新手向导都用它 */
  blurb: string;
  icon: IconName;
  accent: Accent;
}

export const PAGE_ITEMS: PageItem[] = [
  { id: 'home', label: '首页', blurb: '这是什么、从哪开始', icon: 'home', accent: 'ember' },
  { id: 'intake', label: '投料台', blurb: '贴简历与岗位、挑面试官、开始质询', icon: 'intake', accent: 'sky' },
  { id: 'interview', label: '质询台', blurb: '实时过程、主张与判定、原文与改写', icon: 'interview', accent: 'violet' },
  { id: 'report', label: '报告', blurb: '五种带走方式与成长档案', icon: 'report', accent: 'mint' },
  { id: 'history', label: '历史', blurb: '跑过的每一场与跨场次仪表盘', icon: 'history', accent: 'teal' },
  { id: 'settings', label: '设置', blurb: '配色、隐私、启动方式', icon: 'settings', accent: 'slate' },
];

export const DEFAULT_PAGE: PageId = 'home';

/** 认不出的值一律回首页：页面 id 可能来自旧链接或手改的地址，不该白屏 */
export function pageOf(value: unknown): PageId {
  if (typeof value !== 'string') return DEFAULT_PAGE;
  const found = PAGE_ITEMS.find((item) => item.id === value);
  return found === undefined ? DEFAULT_PAGE : found.id;
}
