import { useState } from 'react';
import { channelLabel, personaBlurbOf, personaLabelOf, STAGE_HINT, STAGE_LABEL, VERDICT_LABEL } from '../labels.ts';
import type { ContractView, HealthInfo } from '../api.ts';
import { consistencyNote, contractLines } from '../contract.ts';
import type { SandboxState } from '../state.ts';
import { liveChannels, progressOf, readableStreamText, tailText, totalProbes, verdictCounts } from '../state.ts';
import { Chip, Dots, ErrorNotes, Pane, Stat } from './Bits.tsx';

/** 每位面试官一个固定的名字颜色，界面上扫一眼就知道这条追问是谁问的 */
const ROLE_ACCENT: Record<string, string> = {
  tech: 'text-ember-400',
  hr: 'text-mint-400',
  hiring_manager: 'text-ink-100',
  stress: 'text-rose-ink',
  domain_expert: 'text-ink-200',
};

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
}) {
  const state = props.state;
  const [openContract, setOpenContract] = useState<string | null>(null);
  const [openPrompt, setOpenPrompt] = useState<string | null>(null);
  const progress = progressOf(state);
  const counts = verdictCounts(state);
  const live = liveChannels(state);
  const panel = state.interviewers.length > 0 ? state.interviewers : props.panel;

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
      title="质询过程"
      dataShot="stage"
      subtitle={running ? '正在质询' : state.phase === 'done' ? '已完成' : state.phase === 'failed' ? '中断' : '待开始'}
      actions={running ? <Dots /> : null}
      bodyClassName="flex flex-col gap-4 p-3"
    >
      <div className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">面试官面板</h3>
        <ul className="flex flex-col gap-1.5">
          {panel.map((role) => {
            const asked = probeCountOf(state, role);
            const active = running && state.activeStage === 'probe';
            return (
              <li
                key={role}
                className={
                  'flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 ' +
                  (active ? 'border-ember-500/40 bg-ember-500/5' : 'border-ink-800 bg-ink-850/60')
                }
              >
                <div className="min-w-0">
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
              const tone =
                note.tone === 'ok'
                  ? 'border-mint-500/40 text-mint-400'
                  : note.tone === 'drift'
                    ? 'border-amber-ink/40 text-amber-ink'
                    : 'border-ink-700 text-ink-400';
              return (
                <li key={view.id} className="rounded-lg border border-ink-800 bg-ink-850/50">
                  <button
                    type="button"
                    data-shot="contract-toggle"
                    title="展开这位面试官的意图契约"
                    onClick={() => setOpenContract(expanded ? null : view.id)}
                    className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
                  >
                    <span className={'text-[12px] font-semibold ' + (ROLE_ACCENT[view.id] ?? 'text-ink-200')}>
                      {personaLabelOf(view.id, view.contract.persona.name)} · 契约 v{String(view.version)}
                    </span>
                    <span className="text-[11px] text-ink-400">{expanded ? '收起' : '展开'}</span>
                  </button>
                  {expanded ? (
                    <div className="flex flex-col gap-2 border-t border-ink-800 px-2.5 py-2">
                      <span className={'self-start rounded border px-2 py-0.5 text-[11px] ' + tone}>
                        {note.text}
                      </span>
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
                        className="self-start text-[11px] text-ember-300 underline decoration-dotted"
                      >
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

      <div className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">阶段时间线</h3>
        {state.stages.length === 0 ? (
          <p className="text-[12px] text-ink-400">还没开始。点左边「开始质询」，这里会一段一段亮起来。</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {state.stages.map((mark, index) => {
              const isLast = index === state.stages.length - 1;
              const active = running && isLast;
              return (
                <li key={String(index) + mark.stage} className="flex items-center gap-2 text-[12px]">
                  <span
                    className={
                      'h-2 w-2 shrink-0 rounded-full ' +
                      (active ? 'bg-ember-500 pulse-dot' : 'bg-ink-600')
                    }
                  />
                  <span className={active ? 'text-ink-100' : 'text-ink-300'}>
                    {STAGE_LABEL[mark.stage] ?? mark.stage}
                    {mark.round === null ? '' : ' · 第 ' + String(mark.round) + ' 轮'}
                  </span>
                  {active ? <span className="text-[11px] text-ink-400">{STAGE_HINT[mark.stage] ?? ''}</span> : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {live.length === 0 ? null : (
        <div className="flex flex-col gap-2" data-shot="live">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">实时输出</h3>
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
                  className="rounded-lg border border-ember-500/25 bg-ink-950/60 px-2.5 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-ember-300">
                      {channelLabel(buffer.channel, (id) => personaLabelOf(id, personaOf(id).name))}
                    </span>
                    <span className="text-[10px] text-ink-500">
                      {buffer.reasoning === '' ? '输出' : '思考 + 输出'}
                    </span>
                  </div>
                  {thought === '' ? null : (
                    <p
                      data-shot="live-reasoning"
                      className="mt-1 max-h-20 overflow-hidden whitespace-pre-wrap border-l-2 border-ink-700 pl-2 text-[11px] italic leading-relaxed text-ink-500"
                    >
                      {thought}
                    </p>
                  )}
                  <p className="mt-1 max-h-24 overflow-hidden whitespace-pre-wrap text-[11px] leading-relaxed text-ink-300">
                    {text === '' ? '…' : text}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 rounded-lg border border-ink-800 bg-ink-850/50 p-2.5">
        <Stat label="主张" value={progress.claims} hint="从简历里抽出的可追问主张" />
        <Stat label="被追问" value={progress.probed} />
        <Stat label="作答" value={progress.answered} hint="至少有一问给出了有依据的回答" />
        <Stat label="判定" value={progress.judged} />
        <Stat label="建议" value={progress.suggestions} />
        <Stat label="追问数" value={totalProbes(state)} hint="含被预算挡回的尝试之外的实际提问" />
      </div>

      {counts.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">判定分布</h3>
          <div className="flex flex-wrap gap-1.5">
            {counts.map((item) => (
              <span key={item.kind} className="chip">
                {VERDICT_LABEL[item.kind]} · {item.count}
              </span>
            ))}
          </div>
        </div>
      )}

      {state.budget === null ? null : (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">追问预算</h3>
          <p className="text-[12px] text-ink-300">
            已用 {state.budget.totalProbes} 次追问
            {state.budget.closed.length === 0
              ? '，还没有主张被关停'
              : '，' + String(state.budget.closed.length) + ' 条主张已关停（继续问也没有信息增量）'}
          </p>
        </div>
      )}

      {state.notices.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">过程提示</h3>
          <ul className="flex flex-col gap-1">
            {state.notices.map((notice, index) => (
              <li key={String(index) + notice} className="rounded-lg border border-ink-800 bg-ink-850/50 px-2.5 py-1.5 text-[12px] text-ink-300">
                {notice}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ErrorNotes errors={state.errors} />

      {props.health === null ? null : (
        <p className="mt-auto text-[11px] leading-relaxed text-ink-500">
          运行方式：{props.health.runMode}
          {' · '}
          模型：{props.health.model}
        </p>
      )}
    </Pane>
  );
}
