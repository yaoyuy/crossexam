import { Badge, Empty, Pane } from './Bits.tsx';
import { MATCH_LABEL, MATCH_TONE, REQUIREMENT_KIND_LABEL } from '../labels.ts';
import { describeRange } from '../highlight.ts';
import { matchConclusionOf } from '../state.ts';
import type {
  Anchor,
  JobDescription,
  MatchStatus,
  MatchSummary,
  RejectedRequirement,
  Requirement,
  RequirementMatch,
} from '../api.ts';

/**
 * 「岗位要求对照」栏：每条要求对一次简历，三态分开摆。
 *
 * 三态的分组顺序是刻意的：「简历里没写」放在最后，而且它**不生成追问**——
 * 没写过的经历，逼问没有意义。这一栏的价值是让候选人看见缺口，不是再逼他一遍。
 */
const GROUPS: { status: MatchStatus; title: string; hint: string }[] = [
  { status: 'hit', title: '答得上', hint: '简历里有主张对上了这条要求' },
  { status: 'weak', title: '答得含糊', hint: '沾边但没写清楚，面试官会照这条要求原文加压' },
  { status: 'missing', title: '简历里没写', hint: '不生成追问：没写过的经历，逼问没有意义' },
];

export function RequirementBoard(props: {
  requirements: Requirement[];
  matches: RequirementMatch[];
  rejected: RejectedRequirement[];
  summary: MatchSummary | null;
  jds: JobDescription[];
  /** 按主张 id 取那句主张的话，用来显示「这条要求对上了哪句」 */
  claimText: (claimId: string) => string | null;
  onFocusJd: (anchor: Anchor) => void;
  onFocusClaim: (claimId: string) => void;
  className?: string;
}) {
  const matchOf = (id: string): RequirementMatch | null =>
    props.matches.find((match) => match.requirementId === id) ?? null;
  const titleOfJd = (jdId: string): string => props.jds.find((jd) => jd.id === jdId)?.title ?? jdId;

  return (
    <Pane
      title='岗位要求对照'
      dataShot='requirements'
      className={props.className}
      subtitle={matchConclusionOf(props.summary, props.jds.length)}
    >
      {props.requirements.length === 0 ? (
        <Empty
          title={props.jds.length === 0 ? '这场没有上传岗位要求' : '还没有抽出岗位要求'}
          hint={
            props.jds.length === 0
              ? '在左边贴 1–8 份 JD，就能看到每条要求对简历的对照结果：「答得上」「答得含糊」「简历里没写」。'
              : '跑一场之后，这里会列出每条岗位要求与简历主张的对照结果。'
          }
        />
      ) : (
        <div className='flex flex-col gap-4'>
          {GROUPS.map((group) => {
            const items = props.requirements.filter(
              (item) => (matchOf(item.id)?.status ?? 'missing') === group.status,
            );
            if (items.length === 0) return null;
            return (
              <section key={group.status} className='flex flex-col gap-2' data-shot={'req-group-' + group.status}>
                <div className='flex items-center gap-2'>
                  <Badge tone={MATCH_TONE[group.status]}>{group.title}</Badge>
                  <span className='text-[11px] text-ink-400'>
                    {group.hint} · {String(items.length)} 条
                  </span>
                </div>
                {items.map((item) => {
                  const match = matchOf(item.id);
                  const claimId = match === null ? null : match.claimId;
                  return (
                    <article
                      key={item.id}
                      data-shot={'req-' + item.id}
                      className='flex flex-col gap-1.5 rounded-xl border border-ink-800 bg-ink-900/40 p-2.5'
                    >
                      <div className='flex flex-wrap items-center gap-2'>
                        <Badge tone={MATCH_TONE[group.status]}>
                          {REQUIREMENT_KIND_LABEL[item.kind] + ' · ' + MATCH_LABEL[group.status]}
                        </Badge>
                        <span className='text-[11px] text-ink-400'>{item.id}</span>
                        <button
                          type='button'
                          data-shot={'req-jd-' + item.id}
                          onClick={() => props.onFocusJd(item.anchor)}
                          title={'跳到岗位要求原文 ' + describeRange(item.anchor)}
                          className='chip ml-auto max-w-[12rem] cursor-pointer truncate transition-colors hover:border-ember-500 hover:text-ink-100'
                        >
                          {'来自《' + titleOfJd(item.jdId) + '》'}
                        </button>
                      </div>
                      <p className='text-[13px] leading-relaxed text-ink-100'>{item.text}</p>
                      <button
                        type='button'
                        data-shot={'req-quote-' + item.id}
                        onClick={() => props.onFocusJd(item.anchor)}
                        title={'岗位要求原文 ' + describeRange(item.anchor)}
                        className='quote cursor-pointer text-left hover:brightness-110'
                      >
                        {'「' + item.anchor.quote + '」'}
                      </button>
                      {match === null ? null : (
                        <p className='text-[11px] leading-relaxed text-ink-400'>为什么这么判：{match.reason}</p>
                      )}
                      {claimId === null ? null : (
                        <button
                          type='button'
                          data-shot={'req-claim-' + item.id}
                          onClick={() => props.onFocusClaim(claimId)}
                          className='chip max-w-full cursor-pointer truncate text-left transition-colors hover:border-ember-500 hover:text-ink-100'
                          title='跳到这条主张'
                        >
                          {'对应主张 ' + claimId + ' · ' + (props.claimText(claimId) ?? '（不在本次主张里）')}
                        </button>
                      )}
                    </article>
                  );
                })}
              </section>
            );
          })}
          {props.rejected.length === 0 ? null : (
            <details className='rounded-xl border border-ink-800 bg-ink-900/30 p-2.5' data-shot='req-rejected'>
              <summary className='cursor-pointer text-[12px] text-ink-300'>
                锚不到 JD 原文、被丢掉的 {String(props.rejected.length)} 条要求
              </summary>
              <ul className='mt-2 flex flex-col gap-1.5'>
                {props.rejected.map((item) => (
                  <li key={item.key} className='text-[11px] leading-relaxed text-ink-400'>
                    <span className='text-ink-300'>{item.text.length === 0 ? item.quote : item.text}</span> ·{' '}
                    {item.reason}
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
