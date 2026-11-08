import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * 四个弹层（新手教程 / 新手向导 / 面试官工作室 / 成长档案）共用的键盘与焦点行为。
 *
 * 为什么把监听挂在 document 上、而不是弹层自己的根节点：这四处都声明了 aria-modal="true"，
 * 即对读屏器而言焦点只该留在弹层里；但它们是 App.tsx 直接渲染的兄弟节点，打开那一刻
 * 焦点还在背后的触发按钮上，挂在弹层内部的监听收不到那一下按键。不碰 App.tsx 的唯一
 * 办法就是 document 级监听，自己维护一个「谁在最上面」的栈。
 *
 * 一次覆盖四件事：
 * 1. Esc 关掉最上面那一层——两层同时开着时，一次按键不该把两层一起关掉；
 * 2. 打开时把焦点送进弹层里的第一个可聚焦元素，关闭后还回打开前那一个；
 * 3. Tab / Shift+Tab 在弹层内循环，不会跑到背后的页面上；
 * 4. 锁住 body 滚动，免得滚轮把背后那一页滚走，关掉后按原样还回去。
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** 打开中的弹层栈：后进先出，只有栈顶那层响应 Esc 与 Tab。用 Symbol 认身份，两层同类弹层也不会串 */
const openStack: symbol[] = [];

/** 滚动锁是全局的（同一时刻可能开着两层），所以用计数而不是各自存一份 */
let scrollLocks = 0;
let savedOverflow = '';

function lockScroll(): void {
  scrollLocks += 1;
  if (scrollLocks > 1) return;
  savedOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
}

function unlockScroll(): void {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks > 0) return;
  // 还原成打开前的原样，而不是一律清空：别的代码也可能正占着这个属性
  document.body.style.overflow = savedOverflow;
  savedOverflow = '';
}

/** 只算真正占了位置的那些：display:none / 未展开的按钮不该进 Tab 循环 */
function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (item) => item.getClientRects().length > 0,
  );
}

export function useModal(open: boolean, onClose: () => void): RefObject<HTMLDivElement | null> {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const idRef = useRef<symbol | null>(null);
  if (idRef.current === null) idRef.current = Symbol('cx-modal');
  const id = idRef.current;

  // onClose 多半是内联箭头函数（App.tsx 里就有两处），直接写进依赖会让监听器每次渲染
  // 都拆装一遍；用 ref 转一手，监听器就只在开 / 关弹层时挂一次
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openStack.push(id);
    lockScroll();

    // 焦点进弹层。一个可聚焦元素都没有时（空态、还在加载），退而把弹层根节点变成落点，
    // 否则 Tab 会直接跳到背后的页面上，aria-modal 就成了空话。
    const first = root === null ? undefined : focusablesIn(root)[0];
    if (first !== undefined) first.focus();
    else if (root !== null) {
      root.tabIndex = -1;
      root.focus();
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (openStack[openStack.length - 1] !== id) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || root === null) return;
      const items = focusablesIn(root);
      const current = document.activeElement;
      const index = current instanceof HTMLElement ? items.indexOf(current) : -1;
      if (index === -1) {
        // 焦点已经落在弹层外（点过遮罩、或弹层刚换过内容）：先把它按回弹层里
        event.preventDefault();
        const fallback = event.shiftKey ? items[items.length - 1] : items[0];
        if (fallback !== undefined) fallback.focus();
        return;
      }
      if (items.length === 1) {
        event.preventDefault();
        return;
      }
      // 没走到边界就交给浏览器默认行为：Tab 顺序跟着 DOM，也就跟着视觉顺序
      if (event.shiftKey ? index !== 0 : index !== items.length - 1) return;
      event.preventDefault();
      const next = event.shiftKey ? items[items.length - 1] : items[0];
      if (next !== undefined) next.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const at = openStack.lastIndexOf(id);
      if (at >= 0) openStack.splice(at, 1);
      unlockScroll();
      // 焦点还回原处。触发元素可能已经不在文档里了（向导会把页面切走），
      // 那就什么都不做，免得把焦点甩到一个已被摘掉的节点上
      if (before !== null && before.isConnected) before.focus();
    };
  }, [open, id]);

  return rootRef;
}
