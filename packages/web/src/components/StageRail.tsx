import { PERSONA_BLURB, PERSONA_LABEL, STAGE_HINT, STAGE_LABEL, VERDICT_LABEL } from '../labels.ts';
import type { HealthInfo, InterviewerRole } from '../api.ts';
import type { SandboxState } from '../state.ts';
import { progressOf, totalProbes, verdictCounts } from '../state.ts';
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
export function StageRail(props: { state: SandboxState; panel: InterviewerRole[]; health: HealthInfo | null }) {
  const state = props.state;
  const progress = progressOf(state);
  const counts = verdictCounts(state);
  const panel = state.interviewers.length > 0 ? (state.interviewers as InterviewerRole[]) : props.panel;
  const running = state.phase === 'running';

  return (
    <Pane
      title="质询过程"
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
                    {PERSONA_LABEL[role] ?? role}
                  </p>
                  <p className="truncate text-[11px] text-ink-400">{PERSONA_BLURB[role] ?? ''}</p>
                </div>
                <Chip title="这位面试官提出的追问条数">{String(asked)} 问</Chip>
              </li>
            );
          })}
        </ul>
      </div>

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
