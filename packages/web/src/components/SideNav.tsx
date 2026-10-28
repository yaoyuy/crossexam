import { PAGE_ITEMS } from '../pages.ts';
import type { PageId } from '../pages.ts';
import { Icon } from './Icon.tsx';

/**
 * 左侧栏：六个页面各占一格。
 *
 * 为什么值得单独做成导航：原来一屏里同时塞着投料、实时直播、判定、原文、改写、
 * 历史、设置，第一次用的人得先猜「该从哪儿下手」。分开之后每一页只回答一个问题。
 * 小屏（窄于 xl）横向排一行，宽屏竖着摆在左边。
 *
 * P16 起每项带图标与强调色：图标的颜色跟着页面走（投料台天蓝、质询台紫……），
 * 与页面里卡片的左侧色条是同一套 accent，翻页时不会「换了地方像换了产品」。
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
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-ink-800 bg-ink-950/50 p-2 xl:w-[186px] xl:flex-col xl:gap-0.5 xl:overflow-visible xl:border-b-0 xl:border-r xl:p-3"
      data-shot="nav"
      aria-label="页面导航"
    >
      <p className="nav-group hidden xl:block">页面</p>
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
            className={'nav-item ' + (active ? 'nav-item-on ' : '') + 'shrink-0 xl:shrink'}
            onClick={() => props.onPick(item.id)}
          >
            <Icon name={item.icon} size={17} className={'nav-ico accent-' + item.accent} />
            <span className="whitespace-nowrap">{item.label}</span>
            {badge === undefined ? null : (
              <span
                className={
                  'ml-auto hidden rounded-full px-1.5 font-mono text-[10.5px] leading-[16px] xl:inline-block ' +
                  (active ? 'bg-ember-500/20 text-ember-300' : 'bg-ink-800 text-ink-400')
                }
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
      <p className="mt-auto hidden px-2.5 pb-1 pt-3 text-[10.5px] leading-relaxed text-ink-600 xl:block">
        全部数据只在本机
      </p>
    </nav>
  );
}
