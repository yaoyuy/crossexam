import { useEffect, useRef } from 'react';
import { buildSegments, describeRange } from '../highlight.ts';
import type { Anchor, JobDescription } from '../api.ts';
import { Empty, Note, Pane, Stat } from './Bits.tsx';
import { Icon } from './Icon.tsx';

/**
 * 「岗位要求原文」栏，与「简历原文」栏并排。
 *
 * 为什么要单独一栏：多 JD 驱动之后，一条追问的锚点可能落在简历上，也可能落在岗位要求上。
 * 只画出左半边的锚点，等于把新加的那一半证据藏起来——「证据锚定」这个创新点必须看得见。
 *
 * 切分逻辑复用 highlight.ts 的同一套（与简历栏一致）：聚焦 > 被引用过 > 普通。
 *
 * P16：这一栏归「投料台」的天蓝一系（与简历栏同页不同色，蓝=材料本身）。
 * 多份 JD 时用分段控件（.seg）切换当前看的是哪一份，而不是一排同款小按钮。
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
      <Pane
        title={
          <span className='flex items-center gap-1.5'>
            <Icon name='clipboard' size={14} className='text-sky-400' />
            <span className='truncate'>岗位要求原文</span>
          </span>
        }
        dataShot='jd'
        className={'accent-bar accent-teal ' + (props.className ?? '')}
        subtitle='还没有上传 JD'
        bodyClassName='p-0'
      >
        <Empty
          icon='clipboard'
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
      title={
        <span className='flex items-center gap-1.5'>
          <Icon name='clipboard' size={14} className='text-sky-400' />
          <span className='truncate'>岗位要求原文</span>
        </span>
      }
      dataShot='jd'
      className={'accent-bar accent-teal ' + (props.className ?? '')}
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
              <Icon name={props.tailoring === true ? 'clock' : 'target'} size={12} />
              {props.tailoring === true ? '正在筛…' : '按这个岗位出一版'}
            </button>
          )}
          {props.jds.length > 1 ? (
            <div className='seg max-w-full flex-wrap' role='group' aria-label='切换岗位要求'>
              {props.jds.map((jd) => (
                <button
                  key={jd.id}
                  type='button'
                  data-shot={'jd-pick-' + jd.id}
                  title={jd.title}
                  onClick={() => props.onPick(jd.id)}
                  className={'max-w-[9rem] truncate ' + (jd.id === active.id ? 'seg-on' : '')}
                >
                  {jd.id + ' · ' + jd.title}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      }
      bodyClassName='p-0'
    >
      <div className='flex flex-col'>
        <div className='sticky top-0 z-10 border-b border-ink-800/70 bg-ink-900/90 px-3 py-2.5 backdrop-blur'>
          <div className='grid grid-cols-2 gap-2'>
            <Stat label='字数' value={active.text.length} accent='sky' />
            <Stat
              label='抽出要求'
              value={props.hits.length}
              hint={props.hits.length === 0 ? '还没抽' : '每条都锚在这份原文上'}
              accent={props.hits.length === 0 ? 'slate' : 'sky'}
            />
          </div>
          <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink-500'>
            <span className='flex items-center gap-1'>
              <span className='inline-block h-2.5 w-2.5 rounded-[3px] bg-ember-500/35' />
              被抽成要求的位置
            </span>
            <span className='flex items-center gap-1'>
              <Icon name='layers' size={11} />
              {props.jds.length > 1 ? '共 ' + String(props.jds.length) + ' 份 JD，上面可切换' : '这一场只用这一份 JD'}
            </span>
          </div>
          {props.hits.length > 0 ? null : (
            <div className='mt-2'>
              <Note tone='info' icon='bulb'>
                这份岗位还没被抽成要求：跑完一场之后，每条要求都会锚回这里的某一句原文，点它就能跳回去。
              </Note>
            </div>
          )}
        </div>
        <div className='px-4 py-3'>
          {props.focus === null ? null : (
            <p className='mb-2 flex items-center gap-1.5 rounded-[8px] bg-ember-500/10 px-2 py-1 text-[11px] text-ember-400'>
              <Icon name='target' size={12} />
              <span>聚焦 {'\u2192'} {describeRange(props.focus)}</span>
            </p>
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
      </div>
    </Pane>
  );
}
