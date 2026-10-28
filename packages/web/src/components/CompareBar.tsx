/**
 * 「比上次」：把改完的简历再跑一遍，这一版比上一版怎么样。
 *
 * 这一栏刻意做成**可以收起来**的一条：
 * - 收起时只留一句话（status + headline），因为它常常是「0 → 1 条」这种一句话结论；
 * - 展开才把逐条变化摆出来，因为逐条列表会占掉右栏本来就不多的竖向空间。
 *
 * 四种状态（还没取到 / 第一版 / 上一版被删 / 真比出来了）的文案全在 compare.ts 里，
 * 这个组件只负责画。把判断留在纯函数里，是因为「第一版」与「上一版被删」
 * 在界面上必须说两句不一样的话，散在 JSX 里就一定会有一处写成同一个空状态。
 *
 * P16 只动外观：从 Pane 换成 SectionCard（文档流、跟着右栏滚、左边缘 mint 色条），
 * 状态用徽章与分段控件表达；四种状态各有各的脸。
 */
import { useEffect, useState } from 'react';
import type { CompareView } from '../api.ts';
import { compareFactsOf, SHIFT_TONE } from '../compare.ts';
import { Badge, SectionCard } from './Bits.tsx';
import { Icon } from './Icon.tsx';

export function CompareBar(props: { view: CompareView | null; onOpenGrowth?: (() => void) | null }) {
  const facts = compareFactsOf(props.view);
  const [open, setOpen] = useState(false);
  const rowCount = facts === null ? 0 : facts.rows.length;

  // 真比出了变好 / 变差的时候默认摊开：这正是点「改完再跑一遍」想看的东西。
  // 其他三种状态保持收起，免得一栏空话占着位置。
  useEffect(() => {
    if (rowCount > 0) setOpen(true);
  }, [rowCount]);

  if (facts === null) return null;

  // 四种状态：加载中（还没取到，整栏不渲染）/ 第一版 / 上一版被删 / 真比出来了
  const isFirst = props.view !== null && props.view.first;
  const isMissing = props.view !== null && props.view.parentMissing === true;
  const compared = !isFirst && !isMissing && facts.rows.length > 0;
  const improved = facts.rows.filter((row) => row.shift === 'better').length;
  const worsened = facts.rows.filter((row) => row.shift === 'worse').length;

  return (
    <SectionCard
      title="比上次"
      desc={compared ? '这一版与上一版逐条比过一遍的结果' : '改完再跑一遍，这一栏才会真比出东西'}
      icon="trending"
      accent="mint"
      dataShot="compare"
      bodyClassName="flex flex-col gap-2.5"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {props.view !== null && props.view.first === false && props.onOpenGrowth != null ? (
            <button
              type="button"
              className="chip cursor-pointer transition-colors hover:border-ember-500 hover:text-ink-100"
              onClick={props.onOpenGrowth}
              title="这一条版本链上每一版都判了什么"
              data-shot="compare-growth"
            >
              <Icon name="layers" size={12} />
              看全部版本
            </button>
          ) : null}
          {improved === 0 ? null : <Badge tone="solid">变好 {improved}</Badge>}
          {worsened === 0 ? null : <Badge tone="danger">变差 {worsened}</Badge>}
          <button
            type="button"
            className="icon-btn"
            onClick={() => setOpen((prev) => !prev)}
            title={open ? '收起逐条变化' : '展开逐条变化'}
            aria-label={open ? '收起逐条变化' : '展开逐条变化'}
            data-shot="compare-toggle"
          >
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={15} />
          </button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={compared ? 'solid' : isMissing ? 'warn' : 'sky'}>{facts.status}</Badge>
        {isFirst ? <span className="text-[11px] text-ink-500">这一版之前没有可比的场次</span> : null}
        {isMissing ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-ink">
            <Icon name="alert" size={12} />
            记着上一版是哪一场，但那一场已被删掉
          </span>
        ) : null}
      </div>

      {facts.headline === null ? null : (
        <p className="text-[12.5px] leading-relaxed text-ink-200" data-shot="compare-headline">
          {facts.headline}
        </p>
      )}

      {facts.facts.length === 0 ? null : <FactsList list={facts.facts} />}

      {open === false ? null : (
        <div className="flex max-h-[220px] flex-col gap-2.5 overflow-auto pr-0.5">
          {facts.rows.length === 0 ? (
            <p className="text-[11.5px] leading-relaxed text-ink-400">
              逐条比过一遍：没有哪一条的判定变了。
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5" data-shot="compare-rows">
              {facts.rows.map((row) => (
                <li key={row.id + row.shift} className="row">
                  <span className="shrink-0 font-mono text-[11px] text-ink-500">{row.id}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <Badge tone={SHIFT_TONE[row.shift]}>{row.detail}</Badge>
                    <p className="text-[11.5px] leading-relaxed text-ink-300">{row.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {facts.added.length === 0 ? null : (
            <ChangeList
              title="这一版新出现的主张（上一版没有，所以不算变好变差）："
              items={facts.added}
              icon="plus"
              className="text-sky-400"
            />
          )}

          {facts.removed.length === 0 ? null : (
            <ChangeList
              title="上一版有、这一版没了的主张（往往就是改掉的那几句）："
              items={facts.removed}
              icon="x"
              className="text-ink-500"
            />
          )}
        </div>
      )}
    </SectionCard>
  );
}

/** 一行行事实（上一版是谁、简历改没改、追问几次）：灰底小卡，不要跟正文抢 */
function FactsList(props: { list: string[] }) {
  return (
    <ul className="flex flex-col gap-0.5 rounded-[10px] border border-ink-800 bg-ink-850/40 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-ink-400">
      {props.list.map((line) => (
        <li key={line} className="flex items-start gap-1.5">
          <Icon name="chevron-right" size={11} className="mt-[4px] shrink-0 text-ink-500" />
          <span className="min-w-0">{line}</span>
        </li>
      ))}
    </ul>
  );
}

function ChangeList(props: { title: string; items: string[]; icon: 'plus' | 'x'; className: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11.5px] text-ink-400">{props.title}</p>
      <ul className="flex flex-col gap-0.5 text-[11.5px] leading-relaxed text-ink-300">
        {props.items.map((text) => (
          <li key={text} className="flex items-start gap-1.5">
            <Icon name={props.icon} size={12} className={'mt-[3px] shrink-0 ' + props.className} />
            <span className="min-w-0">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}