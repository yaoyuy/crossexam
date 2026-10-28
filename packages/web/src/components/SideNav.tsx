import { PAGE_ITEMS } from '../pages.ts';
import type { PageId } from '../pages.ts';

/**
 * 左侧栏：六个页面各占一格。
 *
 * 为什么值得单独做成导航：原来一屏里同时塞着投料、实时直播、判定、原文、改写、
 * 历史、设置，第一次用的人得先猜「该从哪儿下手」。分开之后每一页只回答一个问题。
 * 小屏（窄于 xl）横向排一行，宽屏竖着摆在左边。
 */
export function SideNav(props: {
  page: PageId;
  onPick: (page: PageId) => void;
  /** 每页的小角标：例如历史有几场、质询台跑过没有 */
  badges?: Partial<Record<PageId, string>>;
}) {
  const badges = props.badges ?? {};
  return (
    <nav
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-ink-800 bg-ink-950/60 p-2 xl:flex-col xl:overflow-visible xl:border-b-0 xl:border-r xl:p-2.5"
      data-shot="nav"
      aria-label="页面导航"
    >
      {PAGE_ITEMS.map((item) => {
        const active = item.id === props.page;
        const badge = badges[item.id];
        return (
          <button
            key={item.id}
            type="button"
            data-shot={'nav-' + item.id}
            title={item.blurb}
            aria-current={active ? 'page' : undefined}
            className={
              'flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] transition-colors ' +
              (active
                ? 'border-ember-500/40 bg-ember-500/10 text-ember-200'
                : 'border-transparent text-ink-300 hover:border-ink-700 hover:text-ink-100')
            }
            onClick={() => props.onPick(item.id)}
          >
            <span className="whitespace-nowrap">{item.label}</span>
            {badge === undefined ? null : (
              <span className="font-mono text-[10.5px] text-ink-500">{badge}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
