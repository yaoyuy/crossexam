import { Badge, Empty, Note, Pane, Stat } from './Bits.tsx';
import { MATCH_LABEL, MATCH_TONE, REQUIREMENT_KIND_LABEL } from '../labels.ts';
import { describeRange } from '../highlight.ts';
import { matchConclusionOf } from '../state.ts';
import type { Accent } from '../pages.ts';
import { Icon } from './Icon.tsx';
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
const GROUPS: { status: MatchStatus; title: string; hint: string; accent: Accent }[] = [
  { status: 'hit', title: '答得上', hint: '简历里有主张对上了这条要求', accent: 'mint' },
  { status: 'weak', title: '答得含糊', hint: '沾边但没写清楚，面试官会照这条要求原文加压', accent: 'ember' },
  { status: 'missing', title: '简历里没写', hint: '不生成追问：没写过的经历，逼问没有意义', accent: 'slate' },
];


/**
 * 「答得上」占全部要求的百分比。
 * 只拿 hit 除以 total，不把 weak 折半算进去——那种折中算法在界面上没法解释，
 * 而这一栏的每个数字都要能被用户拿去对报告。
 */
function hitPercentOf(summary: MatchSummary): number {
  if (summary.total === 0) return 0;
  return Math.round((summary.hit / summary.total) * 100);
}

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
      title={
        <span className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] bg-sky-500/15 text-sky-400">
            <Icon name="clipboard" size={14} />
          </span>
          <span className="truncate">岗位要求对照</span>
        </span>
      }
      dataShot='requirements'
      className={props.className}
      subtitle={matchConclusionOf(props.summary, props.jds.length)}
    >
      {props.requirements.length === 0 ? (
        <Empty
          icon="clipboard"
          title={props.jds.length === 0 ? '这场没有上传岗位要求' : '还没有抽出岗位要求'}
          hint={
            props.jds.length === 0
              ? '在左边贴 1–8 份 JD，就能看到每条要求对简历的对照结果：「答得上」「答得含糊」「简历里没写」。'
              : '跑一场之后，这里会列出每条岗位要求与简历主张的对照结果。'
          }
        />
      ) : (
        <div className='flex flex-col gap-4'>
          <div className="grid grid-cols-3 gap-2">
            {GROUPS.map((group) => {
              const count = props.requirements.filter(
                (item) => (matchOf(item.id)?.status ?? 'missing') === group.status,
              ).length;
              return (
                <Stat
                  key={group.status}
                  accent={group.accent}
                  label={group.title}
                  value={count}
                  hint={group.hint}
                />
              );
            })}
          </div>
          {props.summary === null || props.summary.total === 0 ? null : (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px] text-ink-400">
                <span>答得上的比例（只算「对上了主张」的那几条）</span>
                <span>{String(hitPercentOf(props.summary))}%</span>
              </div>
              <div className={'progress accent-mint'}>
                <span className="progress-fill" style={{ width: String(hitPercentOf(props.summary)) + '%' }} />
              </div>
            </div>
          )}

          {GROUPS.map((group) => {
            const items = props.requirements.filter(
              (item) => (matchOf(item.id)?.status ?? 'missing') === group.status,
            );
            if (items.length === 0) return null;
            return (
              <section key={group.status} className={'flex flex-col gap-2'} data-shot={'req-group-' + group.status}>
                <div className="flex items-center gap-2">
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
                      className={
                        'accent-bar accent-' +
                        group.accent +
                        ' flex flex-col gap-1.5 rounded-[10px] border border-ink-800 bg-ink-900/40 p-2.5'
                      }
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
                          <Icon name="external" size={10} />
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
                        <p className='flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-400'>
                          <Icon name="funnel" size={11} className="mt-0.5 shrink-0 text-ink-500" />
                          <span>为什么这么判：{match.reason}</span>
                        </p>
                      )}
                      {claimId === null ? null : (
                        <button
                          type='button'
                          data-shot={'req-claim-' + item.id}
                          onClick={() => props.onFocusClaim(claimId)}
                          className='chip max-w-full cursor-pointer truncate text-left transition-colors hover:border-ember-500 hover:text-ink-100'
                          title='跳到这条主张'
                        >
                          <Icon name="target" size={10} />
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
            <details data-shot='req-rejected'>
              <summary className='flex cursor-pointer select-none items-center gap-1.5 text-[12px] text-ink-300'>
                <Icon name="x" size={12} className="text-rose-ink" />
                锚不到 JD 原文、被丢掉的 {String(props.rejected.length)} 条要求
              </summary>
              <div className="mt-2">
                <Note tone="warn" icon="alert">
                  <ul className='flex flex-col gap-1.5'>
                    {props.rejected.map((item) => (
                      <li key={item.key} className='text-[11px] leading-relaxed text-ink-400'>
                        <span className='text-ink-300'>{item.text.length === 0 ? item.quote : item.text}</span> ·{' '}
                        {item.reason}
                      </li>
                    ))}
                  </ul>
                </Note>
              </div>
            </details>
          )}
        </div>
      )}
    </Pane>
  );
}
