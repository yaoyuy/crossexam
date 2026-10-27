import { Badge, Empty, Pane } from './Bits.tsx';
import { COUNTER_KIND_LABEL, COUNTER_SOURCE_LABEL } from '../labels.ts';
import { describeRange } from '../highlight.ts';
import type { Anchor, CounterQuestion, JobDescription, RejectedCounter } from '../api.ts';

/**
 * 「轮到你了」栏：跑完一场之后可以拿去反问 HR 的几句话。
 *
 * 三件事必须摆在明面上：
 * 一是每句都带依据（简历原话或岗位要求原文），点引文就跳回出处；
 * 二是回答是沙盘模拟出来的，不是真 HR 在答——不写清楚就是骗人；
 * 三是锚不回材料的句子不进这一栏，只在下面说明为什么被丢掉。
 */
export function CounterBoard(props: {
  counters: CounterQuestion[];
  rejected: RejectedCounter[];
  jds: JobDescription[];
  onFocus: (anchor: Anchor) => void;
  onFocusJd: (anchor: Anchor) => void;
  className?: string;
}) {
  const titleOfJd = (jdId: string | null): string =>
    jdId === null ? '简历' : (props.jds.find((jd) => jd.id === jdId)?.title ?? jdId);
  return (
    <Pane
      title='轮到你了（可以反问）'
      dataShot='counters'
      className={props.className}
      subtitle={
        props.counters.length === 0
          ? '跑完一场才有反问'
          : '这 ' + String(props.counters.length) + ' 句都带原文依据，点引文看出处'
      }
    >
      {props.counters.length === 0 ? (
        <Empty
          title='还没有可以反问的话'
          hint='跑完一场之后，这里会给出几句你可以反问 HR 的话——每一句都锚在简历原话或岗位要求原文上，点一下就能看到出处。'
        />
      ) : (
        <div className='flex flex-col gap-3'>
          {props.counters.map((item) => (
            <article
              key={item.id}
              data-shot={'counter-' + item.id}
              className='flex flex-col gap-1.5 rounded-xl border border-ink-800 bg-ink-900/40 p-2.5'
            >
              <div className='flex flex-wrap items-center gap-2'>
                <Badge tone='ember'>{COUNTER_KIND_LABEL[item.kind]}</Badge>
                <Badge tone='muted'>{COUNTER_SOURCE_LABEL[item.source]}</Badge>
                <span className='text-[11px] text-ink-400'>{item.id}</span>
              </div>
              <p className='text-[13px] leading-relaxed text-ink-100'>{item.text}</p>
              <button
                type='button'
                data-shot={'counter-quote-' + item.id}
                onClick={() => (item.source === 'jd' ? props.onFocusJd(item.anchor) : props.onFocus(item.anchor))}
                title={'依据原文 ' + describeRange(item.anchor)}
                className='quote cursor-pointer text-left hover:brightness-110'
              >
                {'「' + item.anchor.quote + '」（来自' + (item.source === 'jd' ? '《' + titleOfJd(item.jdId) + '》' : '简历') + '）'}
              </button>
              <p className='text-[11px] leading-relaxed text-ink-400'>为什么值得问：{item.reason}</p>
              <p className='text-[11px] leading-relaxed text-ink-400'>
                对方大概会答：{item.reply}
                <span className='text-ink-500'>（沙盘模拟，不是真 HR 在答）</span>
              </p>
            </article>
          ))}
          {props.rejected.length === 0 ? null : (
            <details className='rounded-xl border border-ink-800 bg-ink-900/30 p-2.5' data-shot='counter-rejected'>
              <summary className='cursor-pointer text-[12px] text-ink-300'>
                {'锚不回材料、被丢掉的 ' + String(props.rejected.length) + ' 句反问'}
              </summary>
              <ul className='mt-2 flex flex-col gap-1.5'>
                {props.rejected.map((item, index) => (
                  <li key={String(index) + item.text} className='text-[11px] leading-relaxed text-ink-400'>
                    <span className='text-ink-300'>{item.text.length === 0 ? '（空）' : item.text}</span> · {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Pane>
  );
}
