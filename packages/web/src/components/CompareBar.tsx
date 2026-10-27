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
 */
import { useEffect, useState } from 'react';
import type { CompareView } from '../api.ts';
import { compareFactsOf, SHIFT_TONE } from '../compare.ts';
import { Badge, Pane } from './Bits.tsx';

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

  const improved = facts.rows.filter((row) => row.shift === 'better').length;
  const worsened = facts.rows.filter((row) => row.shift === 'worse').length;

  return (
    <Pane
      title="比上次"
      dataShot="compare"
      className="max-h-[240px] shrink-0"
      subtitle={facts.status}
      actions={
        <>
          {props.view !== null && props.view.first === false && props.onOpenGrowth != null ? (
            <button
              type="button"
              className="chip cursor-pointer transition-colors hover:border-ember-500 hover:text-ink-100"
              onClick={props.onOpenGrowth}
              title="这一条版本链上每一版都判了什么"
              data-shot="compare-growth"
            >
              看全部版本
            </button>
          ) : null}
          {improved === 0 ? null : <Badge tone="solid">变好 {improved}</Badge>}
          {worsened === 0 ? null : <Badge tone="danger">变差 {worsened}</Badge>}
          <button
            type="button"
            className="chip cursor-pointer transition-colors hover:border-ember-500 hover:text-ink-100"
            onClick={() => setOpen((prev) => !prev)}
            title="展开逐条变化"
            data-shot="compare-toggle"
          >
            {open ? '收起' : '展开'}
          </button>
        </>
      }
      bodyClassName="flex flex-col gap-2 p-3"
    >
      {facts.headline === null ? null : (
        <p className="text-[12px] leading-relaxed text-ink-200" data-shot="compare-headline">
          {facts.headline}
        </p>
      )}

      {facts.facts.length === 0 ? null : (
        <ul className="flex flex-col gap-0.5 text-[11.5px] leading-relaxed text-ink-400">
          {facts.facts.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {open === false ? null : (
        <>
          {facts.rows.length === 0 ? (
            <p className="text-[11.5px] leading-relaxed text-ink-400">
              逐条比过一遍：没有哪一条的判定变了。
            </p>
          ) : (
            <ul className="flex flex-col gap-1" data-shot="compare-rows">
              {facts.rows.map((row) => (
                <li
                  key={row.id + row.shift}
                  className="rounded-md border border-ink-800 bg-ink-850/40 px-2 py-1 text-[11.5px] leading-relaxed"
                >
                  <span className="font-mono text-ink-400">{row.id}</span>{' '}
                  <Badge tone={SHIFT_TONE[row.shift]}>{row.detail}</Badge>
                  <p className="mt-0.5 text-ink-300">{row.text}</p>
                </li>
              ))}
            </ul>
          )}

          {facts.added.length === 0 ? null : (
            <div className="flex flex-col gap-0.5">
              <p className="text-[11.5px] text-ink-400">这一版新出现的主张（上一版没有，所以不算变好变差）：</p>
              <ul className="flex flex-col gap-0.5 text-[11.5px] leading-relaxed text-ink-300">
                {facts.added.map((text) => (
                  <li key={text}>· {text}</li>
                ))}
              </ul>
            </div>
          )}

          {facts.removed.length === 0 ? null : (
            <div className="flex flex-col gap-0.5">
              <p className="text-[11.5px] text-ink-400">上一版有、这一版没了的主张（往往就是改掉的那几句）：</p>
              <ul className="flex flex-col gap-0.5 text-[11.5px] leading-relaxed text-ink-300">
                {facts.removed.map((text) => (
                  <li key={text}>· {text}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Pane>
  );
}
