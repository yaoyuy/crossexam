import { useEffect, useRef } from 'react';
import { buildSegments, describeRange } from '../highlight.ts';
import type { Anchor, JobDescription } from '../api.ts';
import { Empty, Pane } from './Bits.tsx';

/**
 * 「岗位要求原文」栏，与「简历原文」栏并排。
 *
 * 为什么要单独一栏：多 JD 驱动之后，一条追问的锚点可能落在简历上，也可能落在岗位要求上。
 * 只画出左半边的锚点，等于把新加的那一半证据藏起来——「证据锚定」这个创新点必须看得见。
 *
 * 切分逻辑复用 highlight.ts 的同一套（与简历栏一致）：聚焦 > 被引用过 > 普通。
 */
export function JdPane(props: {
  jds: JobDescription[];
  /** 当前看的是哪一份 JD；为 null 时看第一份 */
  activeId: string | null;
  onPick: (id: string) => void;
  focus: Anchor | null;
  /** 这一份 JD 上被抽成要求的位置 */
  hits: Anchor[];
  /**
   * 按当前这份 JD 出一版简历（P12 · ③）。按钮长在「岗位要求原文」栏里，
   * 因为这个动作的输入就是这一栏正开着的那份 JD——入口贴着它的输入，用户不用猜是拿哪份在筛。
   */
  onTailor?: ((jdId: string) => void) | null;
  tailoring?: boolean;
  className?: string;
}) {
  const focusRef = useRef<HTMLElement | null>(null);
  const focusKey = props.focus === null ? '' : String(props.focus.start) + '-' + String(props.focus.end);
  const active = props.jds.find((jd) => jd.id === props.activeId) ?? props.jds[0] ?? null;

  useEffect(() => {
    const node = focusRef.current;
    if (node !== null) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusKey]);

  if (active === null) {
    return (
      <Pane title='岗位要求原文' dataShot='jd' className={props.className} subtitle='还没有上传 JD' bodyClassName='p-0'>
        <Empty
          title='还没有上传岗位要求'
          hint='左边可以贴 1–8 份 JD。没有 JD 也能跑：面试官按各自的经验追问，只是不会有「岗位要求对照」这一栏。'
        />
      </Pane>
    );
  }

  const segments = buildSegments(active.text, props.focus, props.hits);
  let focusAssigned = false;

  return (
    <Pane
      title='岗位要求原文'
      dataShot='jd'
      className={props.className}
      subtitle={
        active.title +
        ' · ' +
        String(active.text.length) +
        ' 字 · ' +
        (props.hits.length === 0 ? '还没抽出要求' : '抽成 ' + String(props.hits.length) + ' 条要求')
      }
      actions={
        <div className='flex flex-wrap items-center justify-end gap-1'>
          {props.onTailor === undefined || props.onTailor === null ? null : (
            <button
              type='button'
              data-shot='jd-tailor'
              title={'按《' + active.title + '》把简历筛一版：只保留对得上这份岗位的主张，一个字都不改'}
              disabled={props.tailoring === true}
              onClick={() => props.onTailor?.(active.id)}
              className='chip cursor-pointer border-ember-500 text-ink-100 transition-colors hover:brightness-110 disabled:cursor-default disabled:opacity-50'
            >
              {props.tailoring === true ? '正在筛…' : '按这个岗位出一版'}
            </button>
          )}
          {props.jds.length > 1 ? (
            props.jds.map((jd) => (
              <button
                key={jd.id}
                type='button'
                data-shot={'jd-pick-' + jd.id}
                title={jd.title}
                onClick={() => props.onPick(jd.id)}
                className={
                  'chip max-w-[9rem] cursor-pointer truncate transition-colors hover:border-ember-500 ' +
                  (jd.id === active.id ? 'border-ember-500 text-ink-100' : '')
                }
              >
                {jd.id + ' · ' + jd.title}
              </button>
            )))
              : null}
        </div>
      }
      bodyClassName='p-0'
    >
      <div className='px-4 py-3'>
        {props.focus === null ? null : (
          <p className='mb-2 text-[11px] text-ember-400'>聚焦 {'\u2192'} {describeRange(props.focus)}</p>
        )}
        <div className='resume-text text-ink-200'>
          {segments.map((segment, index) => {
            if (segment.kind === 'focus' && !focusAssigned) {
              focusAssigned = true;
              return (
                <mark
                  key={index}
                  className='anchor-hit'
                  ref={(node) => {
                    focusRef.current = node;
                  }}
                >
                  {segment.text}
                </mark>
              );
            }
            if (segment.kind === 'focus') {
              return (
                <mark key={index} className='anchor-hit'>
                  {segment.text}
                </mark>
              );
            }
            if (segment.kind === 'hit') {
              return (
                <mark key={index} className='anchor-soft'>
                  {segment.text}
                </mark>
              );
            }
            return <span key={index}>{segment.text}</span>;
          })}
        </div>
      </div>
    </Pane>
  );
}
