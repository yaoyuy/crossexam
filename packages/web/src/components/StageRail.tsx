import { useState } from 'react';
import {
  CLAIM_CATEGORY_LABEL,
  channelLabel,
  personaBlurbOf,
  personaLabelOf,
  STAGE_HINT,
  STAGE_LABEL,
  VERDICT_LABEL,
} from '../labels.ts';
import type { ContractView, HealthInfo } from '../api.ts';
import { consistencyNote, contractLines } from '../contract.ts';
import type { SandboxState } from '../state.ts';
import {
  liveChannels,
  progressOf,
  readableStreamText,
  shortfallOf,
  tailText,
  totalProbes,
  verdictCounts,
} from '../state.ts';
import type { Accent } from '../pages.ts';
import { Badge, Chip, Dots, ErrorNotes, Note, Pane, Stat } from './Bits.tsx';
import type { Tone } from './Bits.tsx';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';
import type { VerdictKind } from '../api.ts';

/** 每位面试官一个固定的名字颜色，界面上扫一眼就知道这条追问是谁问的 */
const ROLE_ACCENT: Record<string, string> = {
  tech: 'text-ember-400',
  hr: 'text-mint-400',
  hiring_manager: 'text-ink-100',
  stress: 'text-rose-ink',
  domain_expert: 'text-ink-200',
};

/** 面试官面板左侧那枚小图标：用一个人形，颜色跟着上面那张表走 */
const ROLE_ICON: IconName = 'users';

/** 判定分布用哪种徽章色：与 VERDICT_TONE 同一套语义，只是补上了名字 */
const VERDICT_BADGE: Record<VerdictKind, Tone> = {
  solid: 'solid',
  overstated: 'warn',
  unsupported: 'danger',
  contradicts: 'danger',
  unanswerable: 'muted',
};

/**
 * 判定分布那条进度条的颜色：绿=站得住，橙=有过问题，灰=干脆没答上来。
 * 只用这三档是刻意的——判定有五种，但「好／要改／没声音」只有三档，
 * 五种徽章已经各自说清了，进度条再分五色只会让人去数颜色。
 */
const VERDICT_BAR: Record<VerdictKind, Accent> = {
  solid: 'mint',
  overstated: 'ember',
  unsupported: 'ember',
  contradicts: 'ember',
  unanswerable: 'slate',
};

const CATEGORY_ACCENT: Record<string, Accent> = {
  metric: 'sky',
  achievement: 'mint',
  ownership: 'violet',
  experience: 'teal',
  skill: 'ember',
  timeline: 'slate',
  other: 'slate',
};

/** 当前那一段在做什么：说给用户听的一句话，别让步骤条只挂一排阶段名 */
function activeStageHint(stage: string | null): string {
  if (stage === null) return '鼠标停在某一段上能看它这一步在做什么。';
  const hint = STAGE_HINT[stage] ?? '';
  if (hint === '') return '鼠标停在某一段上能看它这一步在做什么。';
  return '正在进行的是「' + (STAGE_LABEL[stage] ?? stage) + '」：' + hint + '。';
}

function probeCountOf(state: SandboxState, interviewerId: string): number {
  let count = 0;
  for (const item of state.claims) {
    for (const probeView of item.probes) {
      if (probeView.probe.interviewerId === interviewerId) count += 1;
    }
  }
  return count;
}

/**
 * 左中栏之间的「过程可见性」面板：
 * 谁在问、问到哪一步、判定分布如何，以及被机制拦下来的东西。
 * 比赛评分里「思考可视化」是明写的加分项，所以这里不做折叠隐藏。
 */
export function StageRail(props: {
  state: SandboxState;
  panel: string[];
  health: HealthInfo | null;
  contracts: ContractView[] | null;
  /** 点一下短板名单里的主张，右栏简历滚到它的原文位置 */
  onFocusClaim?: (claimId: string) => void;
}) {
  const state = props.state;
  const [openContract, setOpenContract] = useState<string | null>(null);
  const [openPrompt, setOpenPrompt] = useState<string | null>(null);
  const progress = progressOf(state);
  const counts = verdictCounts(state);
  const plan = shortfallOf(state);
  const live = liveChannels(state);
  const panel = state.interviewers.length > 0 ? state.interviewers : props.panel;
  const judged = counts.reduce((sum, item) => sum + item.count, 0);

  /**
   * 自定义面试官的中文名只能从契约里取（库里存的就是它），
   * 所以这里建一张 id → 人设 的表，界面各处共用。
   */
  const personaOf = (id: string): { name?: string; blurb?: string } => {
    const view = props.contracts?.find((item) => item.id === id);
    if (view === undefined) return {};
    return { name: view.contract.persona.name, blurb: view.contract.persona.blurb };
  };
  const running = state.phase === 'running';

  return (
    <Pane
      title={
        <span className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] bg-ember-500/15 text-ember-400">
            <Icon name="monitor" size={14} />
          </span>
          <span className="truncate">质询过程</span>
        </span>
      }
      dataShot="stage"
      subtitle={
        <span className="flex items-center gap-2">
          <span
            className={
              'inline-block h-1.5 w-1.5 rounded-full ' +
              (running
                ? 'bg-ember-500 pulse-dot'
                : state.phase === 'done'
                  ? 'bg-mint-500'
                  : state.phase === 'failed'
                    ? 'bg-rose-ink'
                    : 'bg-ink-600')
            }
          />
          {running ? '正在质询' : state.phase === 'done' ? '已完成' : state.phase === 'failed' ? '中断' : '待开始'}
        </span>
      }
      actions={running ? <Dots /> : null}
      bodyClassName="flex flex-col gap-4 p-3"
    >
      {/* ---------- 面试官面板：谁在问 ---------- */}
      <div className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">面试官面板</h3>
        <ul className="flex flex-col gap-1.5">
          {panel.map((role) => {
            const asked = probeCountOf(state, role);
            const active = running && state.activeStage === 'probe';
            return (
              <li key={role} className={'row ' + (active ? 'row-on' : '')}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-ink-800 bg-ink-850">
                  <Icon name={ROLE_ICON} size={15} className={ROLE_ACCENT[role] ?? 'text-ink-300'} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={'truncate text-[13px] font-semibold ' + (ROLE_ACCENT[role] ?? 'text-ink-100')}>
                    {personaLabelOf(role, personaOf(role).name)}
                  </p>
                  <p className="truncate text-[11px] text-ink-400">{personaBlurbOf(role, personaOf(role).blurb)}</p>
                </div>
                <Chip title="这位面试官提出的追问条数">{String(asked)} 问</Chip>
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] leading-relaxed text-ink-500">
          每位面试官都有自己的意图契约：谁问什么、问到哪为止，都由契约决定，不靠模型临场发挥。
        </p>
      </div>

      {props.contracts === null || props.contracts.length === 0 ? null : (
        <div className="flex flex-col gap-2" data-shot="contracts">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">意图契约</h3>
          <p className="text-[11px] leading-relaxed text-ink-500">
            每位面试官的目标、手法、禁区、预算都是结构化数据，System Prompt 由它确定性渲染；
            指纹可与会话里落库的那一份对账——改了契约却忘了重跑，这里会直接报漂移。
          </p>
          <ul className="flex flex-col gap-1.5">
            {props.contracts.map((view) => {
              const note = consistencyNote(view);
              const expanded = openContract === view.id;
              return (
                <li
                  key={view.id}
                  className={
                    'rounded-[10px] border bg-ink-900/40 ' + (expanded ? 'border-ink-700' : 'border-ink-800')
                  }
                >
                  <button
                    type="button"
                    data-shot="contract-toggle"
                    title="展开这位面试官的意图契约"
                    aria-expanded={expanded}
                    onClick={() => setOpenContract(expanded ? null : view.id)}
                    className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={'truncate text-[12px] font-semibold ' + (ROLE_ACCENT[view.id] ?? 'text-ink-200')}>
                        {personaLabelOf(view.id, view.contract.persona.name)} · 契约 v{String(view.version)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Badge tone={note.tone === 'ok' ? 'solid' : note.tone === 'drift' ? 'warn' : 'muted'}>
                        {note.tone === 'ok' ? '一致' : note.tone === 'drift' ? '漂移' : '未对账'}
                      </Badge>
                      <span className="text-[11px] text-ink-400">{expanded ? '收起' : '展开'}</span>
                      <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={13} className="text-ink-500" />
                    </span>
                  </button>
                  {expanded ? (
                    <div className="flex flex-col gap-2 border-t border-ink-800 px-2.5 py-2.5">
                      <Note tone={note.tone === 'drift' ? 'warn' : 'info'} icon={note.tone === 'drift' ? 'alert' : 'shield'}>
                        {note.text}
                      </Note>
                      <dl className="flex flex-col gap-1">
                        {contractLines(view).map((line) => (
                          <div key={line.label} className="flex gap-2 text-[11px] leading-relaxed">
                            <dt className="w-[62px] shrink-0 text-ink-500">{line.label}</dt>
                            <dd className="min-w-0 flex-1 text-ink-300">{line.value}</dd>
                          </div>
                        ))}
                      </dl>
                      <button
                        type="button"
                        data-shot="contract-prompt"
                        onClick={() => setOpenPrompt(openPrompt === view.id ? null : view.id)}
                        className="flex items-center gap-1.5 self-start text-[11px] text-ember-300 underline decoration-dotted"
                      >
                        <Icon name="file" size={12} />
                        {openPrompt === view.id ? '收起 System Prompt' : '看这位面试官实际拿到的 System Prompt'}
                      </button>
                      {openPrompt === view.id ? (
                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-ink-800 bg-ink-950/80 p-2 text-[11px] leading-relaxed text-ink-300">
                          {view.systemPrompt}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ---------- 阶段：真正的步骤条 ---------- */}
      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
          <Icon name="list" size={12} className="text-ink-500" />
          阶段时间线
        </h3>
        {state.stages.length === 0 ? (
          <p className="text-[12px] text-ink-400">还没开始。点左边「开始质询」，这里会一段一段亮起来。</p>
        ) : (
          <ol className="steps">
            {state.stages.map((mark, index) => {
              const isLast = index === state.stages.length - 1;
              const active = running && isLast;
              const hint = STAGE_HINT[mark.stage] ?? '';
              return (
                <li
                  key={String(index) + mark.stage}
                  className={
                    'step rounded-full border py-1 pl-1 pr-2.5 ' +
                    (active
                      ? 'step-on border-ember-500/45 bg-ember-500/10'
                      : 'border-ink-800 bg-ink-900/40')
                  }
                  title={hint}
                >
                  {active ? (
                    <span className="step-num pulse-dot">{String(index + 1)}</span>
                  ) : (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-mint-500/40 bg-mint-500/15 text-mint-400">
                      <Icon name="check" size={11} />
                    </span>
                  )}
                  <span className="text-[11.5px]">
                    {STAGE_LABEL[mark.stage] ?? mark.stage}
                  </span>
                  <span className={'text-[10.5px] ' + (active ? 'text-ember-300' : 'text-ink-500')}>
                    {mark.round === null ? (active ? '进行中' : '已完成') : '第 ' + String(mark.round) + ' 轮'}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {state.stages.length === 0 ? null : (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-500">
            <Icon name="info" size={11} className="mt-0.5 shrink-0 text-ink-600" />
            <span>
              绿色勾是已经走完的段，橙色是高亮着的那一段；
              {activeStageHint(state.activeStage)}
            </span>
          </p>
        )}
      </div>

      {/* ---------- 实时输出 ---------- */}
      {live.length === 0 ? null : (
        <div className="flex flex-col gap-2" data-shot="live">
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            <Icon name="zap" size={12} className="text-ember-400" />
            实时输出
          </h3>
          <p className="text-[11px] leading-relaxed text-ink-500">
            模型正在一个字一个字地写。斜体那行是它「想」的（只有会思考的模型才给），正下方是它「说」的——
            分片不进事件日志、刷新就没了，能断线续传的只有上面那条阶段时间线。
          </p>
          <ul className="flex flex-col gap-1.5">
            {live.map((buffer) => {
              const thought = tailText(readableStreamText(buffer.reasoning), 220);
              const text = tailText(readableStreamText(buffer.text), 240);
              return (
                <li
                  key={buffer.channel}
                  className="flex flex-col gap-1 rounded-[10px] border border-ember-500/25 bg-ink-950/60 px-2.5 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ember-300">
                      <Icon name="sparkles" size={11} />
                      {channelLabel(buffer.channel, (id) => personaLabelOf(id, personaOf(id).name))}
                    </span>
                    <span className="text-[10px] text-ink-500">
                      {buffer.reasoning === '' ? '输出' : '思考 + 输出'}
                    </span>
                  </div>
                  {thought === '' ? null : (
                    <p
                      data-shot="live-reasoning"
                      className="max-h-20 overflow-hidden whitespace-pre-wrap border-l-2 border-ink-700 pl-2 text-[11px] italic leading-relaxed text-ink-500"
                    >
                      {thought}
                    </p>
                  )}
                  <p className="max-h-24 overflow-hidden whitespace-pre-wrap text-[11px] leading-relaxed text-ink-300">
                    {text === '' ? '…' : text}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ---------- 六个数字 ---------- */}
      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
          <Icon name="trending" size={12} className="text-ink-500" />
          这一场的进度
        </h3>
        <div className="grid grid-cols-3 gap-2">
          <Stat accent="violet" label="主张" value={progress.claims} hint="从简历里抽出的可追问主张" />
          <Stat accent="sky" label="被追问" value={progress.probed} hint="至少被追问过一次的主张" />
          <Stat accent="mint" label="作答" value={progress.answered} hint="至少有一问给出了有依据的回答" />
          <Stat accent="teal" label="判定" value={progress.judged} hint="已经给出结论的主张" />
          <Stat accent="ember" label="建议" value={progress.suggestions} hint="生成了改写建议的主张" />
          <Stat accent="slate" label="追问数" value={totalProbes(state)} hint="含被预算挡回的尝试之外的实际提问" />
        </div>
      </div>

      {/* ---------- 判定分布 ---------- */}
      {counts.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            <Icon name="funnel" size={12} className="text-ink-500" />
            判定分布
          </h3>
          <ul className="flex flex-col gap-1.5">
            {counts.map((item) => {
              const percent = judged === 0 ? 0 : Math.round((item.count / judged) * 100);
              return (
                <li key={item.kind} className="flex items-center gap-2">
                  <span className="shrink-0">
                    <Badge tone={VERDICT_BADGE[item.kind]}>{VERDICT_LABEL[item.kind]}</Badge>
                  </span>
                  <div className={'progress flex-1 accent-' + VERDICT_BAR[item.kind]}>
                    <span className="progress-fill" style={{ width: String(percent) + '%' }} />
                  </div>
                  <span className="w-12 shrink-0 text-right text-[11px] text-ink-400">
                    {String(item.count)} 条
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-ink-500">
            共判定 {String(judged)} 条；绿色是站得住的，橙色是还得改的，灰色是没答上来的。
          </p>
        </div>
      )}

      {/* ---------- 短板 ---------- */}
      {plan.judged === 0 ? null : (
        <div className="flex flex-col gap-2" data-shot="shortfall">
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            <Icon name="alert" size={12} className="text-amber-ink" />
            按类别看短板
          </h3>
          <Note tone="warn" icon="bulb">
            {plan.headline}
          </Note>
          <ul className="flex flex-col gap-1">
            {plan.stats.map((item) => {
              const percent = item.judged === 0 ? 0 : Math.round((item.weak / item.judged) * 100);
              return (
                <li
                  key={item.category}
                  data-shot={'shortfall-cat-' + item.category}
                  className="flex flex-col gap-1 rounded-[10px] border border-ink-800 bg-ink-900/40 px-2.5 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5">
                      <Icon
                        name="layers"
                        size={11}
                        className={item.weak > 0 ? 'text-amber-ink' : 'text-ink-500'}
                      />
                      <span className="text-[12px] text-ink-200">{item.label}</span>
                    </span>
                    <span className={'ml-auto text-[11px] ' + (item.weak > 0 ? 'text-amber-ink' : 'text-ink-500')}>
                      欠证据 {String(item.weak)} / {String(item.judged)}
                    </span>
                  </div>
                  <div className={'progress accent-' + CATEGORY_ACCENT[item.category]}>
                    <span className="progress-fill" style={{ width: String(percent) + '%' }} />
                  </div>
                  <span className="text-[11px] leading-relaxed text-ink-400">
                    {item.judged === 0
                      ? '这一类共 ' + String(item.total) + ' 条，一条都还没判。'
                      : String(item.total) + ' 条里有 ' + String(item.judged) + ' 条已经判过，' + (item.weak > 0 ? '先把欠证据的这几条补上。' : '这一类全部站得住。')}
                  </span>
                </li>
              );
            })}
          </ul>
          {plan.weakest.length === 0 ? null : (
            <div className="flex flex-col gap-1">
              <p className="text-[11px] text-ink-500">
                最该先补的 {plan.weakest.length} 处（点一下在简历原文里定位）：
              </p>
              {plan.weakest.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-shot={'shortfall-' + item.id}
                  title="在简历原文里定位这条主张"
                  onClick={() => props.onFocusClaim?.(item.id)}
                  className="row w-full text-left"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-ember-500/15 font-mono text-[10px] font-semibold text-ember-300">
                    {String(plan.weakest.length - plan.weakest.indexOf(item))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[12px] leading-relaxed text-ink-200">
                      <span className="font-semibold text-ember-300">{item.id}</span>
                      {' · '}
                      {item.verdict === null ? '未判定' : VERDICT_LABEL[item.verdict]}
                      {' · '}
                      {CLAIM_CATEGORY_LABEL[item.category]}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-500">{item.text}</span>
                  </span>
                  <Icon name="chevron-right" size={13} className="text-ink-500" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- 追问预算 ---------- */}
      {state.budget === null ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            <Icon name="shield" size={12} className="text-ember-400" />
            追问预算
          </h3>
          <div className="row">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-ember-500/30 bg-ember-500/10">
              <Icon name="target" size={15} className="text-ember-400" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] leading-relaxed text-ink-300">
                已用 {state.budget.totalProbes} 次追问
                {state.budget.closed.length === 0
                  ? '，还没有主张被关停'
                  : '，' + String(state.budget.closed.length) + ' 条主张已关停（继续问也没有信息增量）'}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-500">
                额度由代码守：每位面试官、每条主张、每一轮各有上限，死循环在结构上不成立。
              </p>
            </div>
            <Chip title="还在追问中的主张">
              {String(state.budget.open.length)} 条在问
            </Chip>
          </div>
        </div>
      )}

      {/* ---------- 过程提示 ---------- */}
      {state.notices.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            <Icon name="info" size={12} className="text-ink-500" />
            过程提示
          </h3>
          <ul className="flex flex-col gap-1">
            {state.notices.map((notice, index) => (
              <li key={String(index) + notice} className="note">
                <Icon name="info" size={14} className="note-ico text-ink-400" />
                <span className="min-w-0 text-[12px] text-ink-300">{notice}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ErrorNotes errors={state.errors} />

      {props.health === null ? null : (
        <p className="mt-auto flex items-center gap-1.5 text-[11px] leading-relaxed text-ink-500">
          <Icon name="monitor" size={11} />
          运行方式：{props.health.runMode}
          {' · '}
          模型：{props.health.model}
        </p>
      )}
    </Pane>
  );
}
