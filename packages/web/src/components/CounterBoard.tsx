import { Badge, Empty, Pane } from './Bits.tsx';
import { COUNTER_KIND_LABEL, COUNTER_SOURCE_LABEL } from '../labels.ts';
import { describeRange } from '../highlight.ts';
import type { Anchor, CounterQuestion, CounterKind, JobDescription, RejectedCounter } from '../api.ts';
import type { Accent } from '../pages.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';

/**
 * 反问的五种用途各配一个图标与强调色，一眼分得清哪句该在什么时候问。
 * 键取自 shared/domain.ts 的 CounterKind —— 多一种用途而这里没配，
 * 会退回默认的 ember 聊天图标，而不是白屏。
 */
const KIND_STYLE: Record<CounterKind, { icon: IconName; accent: Accent }> = {
  team: { icon: 'users', accent: 'teal' },
  tech: { icon: 'gear', accent: 'sky' },
  growth: { icon: 'trending', accent: 'mint' },
  business: { icon: 'target', accent: 'violet' },
  process: { icon: 'clock', accent: 'ember' },
};

const DEFAULT_KIND: { icon: IconName; accent: Accent } = { icon: 'chat', accent: 'ember' };

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
      title={
        <span className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] bg-teal-500/15 text-teal-400">
            <Icon name="chat" size={14} />
          </span>
          <span className="truncate">轮到你了（可以反问）</span>
        </span>
      }
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
          icon="chat"
          title='还没有可以反问的话'
          hint='跑完一场之后，这里会给出几句你可以反问 HR 的话——每一句都锚在简历原话或岗位要求原文上，点一下就能看到出处。'
        />
      ) : (
        <div className='flex flex-col gap-3'>
          {props.counters.map((item) => {
            const style = KIND_STYLE[item.kind] ?? DEFAULT_KIND;
            return (
              <article
                key={item.id}
                data-shot={'counter-' + item.id}
                className={'card accent-bar accent-' + style.accent + ' flex flex-col gap-2 p-3'}
              >
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='flex items-center gap-1.5'>
                    <span
                      className={
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px]' +
                        (style.accent === 'teal'
                          ? ' bg-teal-500/15 text-teal-400'
                          : style.accent === 'sky'
                            ? ' bg-sky-500/15 text-sky-400'
                            : style.accent === 'mint'
                              ? ' bg-mint-500/15 text-mint-400'
                              : style.accent === 'violet'
                                ? ' bg-violet-500/15 text-violet-400'
                                : ' bg-ember-500/15 text-ember-400')
                      }
                    >
                      <Icon name={style.icon} size={13} />
                    </span>
                    <Badge tone='ember'>{COUNTER_KIND_LABEL[item.kind]}</Badge>
                  </span>
                  <Badge tone='muted'>{COUNTER_SOURCE_LABEL[item.source]}</Badge>
                  <span className='ml-auto font-mono text-[11px] text-ink-500'>{item.id}</span>
                </div>
                <p className='text-[13px] leading-relaxed text-ink-100'>{item.text}</p>
                <button
                  type='button'
                  data-shot={'counter-quote-' + item.id}
                  onClick={() => (item.source === 'jd' ? props.onFocusJd(item.anchor) : props.onFocus(item.anchor))}
                  title={'依据原文 ' + describeRange(item.anchor)}
                  className='quote flex cursor-pointer items-start gap-1.5 text-left hover:brightness-110'
                >
                  <Icon name="external" size={11} className="mt-0.5 shrink-0" />
                  <span>
                    {'「' + item.anchor.quote + '」（来自' + (item.source === 'jd' ? '《' + titleOfJd(item.jdId) + '》' : '简历') + '）'}
                  </span>
                </button>
                <div className='flex flex-col gap-1 border-t border-ink-800 pt-2'>
                  <p className='flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-400'>
                    <Icon name="bulb" size={11} className="mt-0.5 shrink-0 text-amber-ink" />
                    <span>为什么值得问：{item.reason}</span>
                  </p>
                  <p className='flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-400'>
                    <Icon name="user" size={11} className="mt-0.5 shrink-0 text-ink-500" />
                    <span>
                      对方大概会答：{item.reply}
                      <span className='text-ink-500'>（沙盘模拟，不是真 HR 在答）</span>
                    </span>
                  </p>
                </div>
              </article>
            );
          })}
          {props.rejected.length === 0 ? null : (
            <details data-shot='counter-rejected'>
              <summary className='flex cursor-pointer select-none items-center gap-1.5 text-[12px] text-ink-300'>
                <Icon name="x" size={12} className="text-rose-ink" />
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
