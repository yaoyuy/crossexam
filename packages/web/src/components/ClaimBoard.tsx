import { CLAIM_CATEGORY_LABEL, personaLabelOf, VERDICT_CRITERIA, VERDICT_LABEL } from '../labels.ts';
import type { Anchor, Requirement, VerdictOutcome } from '../api.ts';
import type { ClaimView, SandboxState } from '../state.ts';
import { liveText } from '../state.ts';
import { Badge, Chip, Empty, Pane, Quote, VerdictBadge, WeightBar } from './Bits.tsx';

/**
 * 正在流动的模型输出。它刻意画得比结论轻：
 * 这是过程观感（还能被中断、也不会落库），不要让人误以为它已经是判定结果。
 */
function LiveLine(props: { label: string; text: string }) {
  return (
    <div className="rounded-md border border-ember-500/20 bg-ink-950/50 px-2 py-1.5">
      <p className="text-[10.5px] uppercase tracking-wide text-ember-300/80">{props.label}</p>
      <p className="mt-0.5 max-h-24 overflow-hidden whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-400">
        {props.text}
        <span className="text-ember-400">▌</span>
      </p>
    </div>
  );
}

/**
 * 追问的第二个锚点：这条追问是照着哪条岗位要求问的。
 * 它不替代简历锚点，而是与它并排——「证据锚定」在多 JD 之后有了两处来源，
 * 只画出简历那一半，等于把新加的证据藏起来。
 */
function JdAnchorNote(props: {
  probeId: string;
  requirementId: string;
  anchor: Anchor;
  /** 要求的正文，用来当悬浮说明；查不到就只显示编号 */
  text: string | null;
  onFocus?: (anchor: Anchor) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        data-shot={'jd-anchor-' + props.probeId}
        title={'这条追问照着岗位要求问：' + (props.text ?? props.requirementId)}
        className="chip max-w-full cursor-pointer truncate text-left transition-colors hover:border-ember-500 hover:text-ink-100"
        onClick={() => props.onFocus?.(props.anchor)}
      >
        {'照 ' + props.requirementId + ' 问 · 点开要求原文'}
      </button>
      <span className="text-[11px] text-ink-400">{'「' + props.anchor.quote + '」'}</span>
    </div>
  );
}

function VerdictBlock(props: { outcome: VerdictOutcome; onFocus: (anchor: Anchor) => void }) {
  const verdict = props.outcome.verdict;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-ink-800 bg-ink-900/60 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictBadge kind={verdict.kind} adjusted={props.outcome.adjusted} />
        <span className="text-[11px] text-ink-400">
          置信度 {Math.round(verdict.confidence * 100)}% · 依据 {verdict.probeIds.length} 次追问
        </span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-200">{verdict.rationale}</p>
      <p className="rounded-md border border-ink-800 bg-ink-850/60 px-2 py-1.5 text-[11.5px] leading-relaxed text-ink-400">
        <span className="text-ink-300">为什么这样判：</span>
        {VERDICT_CRITERIA[verdict.kind].rule}
      </p>
      <details className="text-[11px] text-ink-500">
        <summary className="cursor-pointer select-none hover:text-ink-300">判据展开</summary>
        <p className="mt-1 leading-relaxed">{VERDICT_CRITERIA[verdict.kind].basis}</p>
      </details>
      {props.outcome.adjusted && props.outcome.adjustmentReason !== null ? (
        <p className="text-[11.5px] leading-relaxed text-amber-ink">
          这条判定不是模型直接给的：{props.outcome.adjustmentReason}
        </p>
      ) : null}
      {verdict.evidence.length === 0 ? (
        <p className="text-[11.5px] text-ink-400">没有可援引的简历原文——这正是它被判为「{VERDICT_LABEL[verdict.kind]}」的原因。</p>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-400">援引的原文</span>
          {verdict.evidence.map((anchor, index) => (
            <Quote key={String(index) + anchor.quote} anchor={anchor} onFocus={props.onFocus} />
          ))}
        </div>
      )}
      {props.outcome.droppedEvidence.length === 0 ? null : (
        <p className="text-[11px] text-ink-400">
          还有 {props.outcome.droppedEvidence.length} 条证据定位不到简历原文，已丢弃。
        </p>
      )}
    </div>
  );
}

function ClaimCard(props: {
  item: ClaimView;
  state: SandboxState;
  onFocus: (anchor: Anchor) => void;
  /** 点开「这条追问照着哪条岗位要求问」时，把右栏切到 JD 原文的那一段 */
  onFocusJd?: (anchor: Anchor) => void;
  /** 按编号取岗位要求：拿它的正文当悬浮说明 */
  requirementOf?: (id: string) => Requirement | null;
  interviewerName?: (id: string) => string | undefined;
  /** 这条建议这一批勾上了没有；没有改写建议的主张一律 false */
  chosen?: boolean;
  onToggleChoose?: (claimId: string) => void;
  /** 勾过却改不动时的理由，由上层从「改完的简历」那份清单里查 */
  skippedReason?: string | null;
}) {
  const item = props.item;
  const answeredCount = item.probes.filter((pv) => pv.answer !== null && pv.answer.answered).length;

  return (
    <article className="card-in flex flex-col gap-3 rounded-xl border border-ink-800 bg-ink-900/70 p-3.5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-ink-300">{item.claim.id}</span>
          <Chip>{CLAIM_CATEGORY_LABEL[item.claim.category] ?? item.claim.category}</Chip>
          <WeightBar value={item.claim.weight} />
          {item.closed ? <Chip title="追问预算已关停这条主张">已关停</Chip> : null}
          <span className="ml-auto text-[11px] text-ink-400">
            {String(item.probes.length)} 问 · {String(answeredCount)} 答
          </span>
        </div>
        <p className="text-[14px] font-semibold leading-relaxed text-ink-100">{item.claim.text}</p>
        <Quote anchor={item.claim.anchor} onFocus={props.onFocus} label="简历里的原话" />
      </header>

      {item.probes.length === 0 ? (
        <p className="text-[12px] text-ink-400">这条主张没有被追问到（预算或轮次用完了）。</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {item.probes.map((pv) => (
            <li key={pv.probe.id} className="flex flex-col gap-1.5 border-l-2 border-ink-700 pl-3">
              <div className="flex flex-wrap items-center gap-2">
                <Chip className="border-ember-500/30 text-ember-300">
                  {personaLabelOf(pv.probe.interviewerId, props.interviewerName?.(pv.probe.interviewerId))}
                </Chip>
                <span className="text-[11px] text-ink-400">
                  {pv.probe.id} · 第 {pv.probe.round} 轮
                  {pv.probe.parentProbeId === null ? '' : ' · 追问自 ' + pv.probe.parentProbeId}
                </span>
              </div>
              <p className="text-[13px] leading-relaxed text-ink-100">{pv.probe.question}</p>
              {pv.probe.rationale.length === 0 ? null : (
                <p className="text-[11.5px] leading-relaxed text-ink-400">问这个是因为：{pv.probe.rationale}</p>
              )}
              <Quote anchor={pv.probe.anchor} onFocus={props.onFocus} label="这条提问锚定的原文" />
              {pv.probe.jdAnchor == null || pv.probe.requirementId == null ? null : (
                <JdAnchorNote
                  probeId={pv.probe.id}
                  requirementId={pv.probe.requirementId}
                  anchor={pv.probe.jdAnchor}
                  text={props.requirementOf?.(pv.probe.requirementId)?.text ?? null}
                  onFocus={props.onFocusJd}
                />
              )}

              {pv.answerError !== null ? (
                <p className="text-[11.5px] text-amber-ink">这一问没拿到回答：{pv.answerError}</p>
              ) : pv.answer === null ? (
                liveText(props.state, 'answer:' + pv.probe.id) === null ? (
                  <p className="text-[11.5px] text-ink-500">等待作答…</p>
                ) : (
                  <LiveLine label="求职者正在作答" text={liveText(props.state, 'answer:' + pv.probe.id) as string} />
                )
              ) : (
                <div className="flex flex-col gap-1.5 rounded-lg bg-ink-850/70 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={pv.answer.answered ? 'muted' : 'danger'}>
                      {pv.answer.answered ? '求职者作答' : '答不上来'}
                    </Badge>
                    {pv.answer.answer.citedAnchors.length === 0 ? null : (
                      <span className="text-[11px] text-ink-400">援引原文 {pv.answer.answer.citedAnchors.length} 处</span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-200">{pv.answer.answer.text}</p>
                  {pv.answer.answer.citedAnchors.map((anchor, index) => (
                    <Quote key={String(index) + anchor.quote} anchor={anchor} onFocus={props.onFocus} />
                  ))}
                  {pv.answer.droppedCitations.length === 0 ? null : (
                    <p className="text-[11px] text-amber-ink">
                      {String(pv.answer.droppedCitations.length)} 条引用在简历里查无实据，已被丢弃（不允许编造原文）。
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {item.verdict === null ? (
        liveText(props.state, 'verdict:' + item.claim.id) === null ? null : (
          <LiveLine label="正在给这条主张定级" text={liveText(props.state, 'verdict:' + item.claim.id) as string} />
        )
      ) : (
        <VerdictBlock outcome={item.verdict} onFocus={props.onFocus} />
      )}

      {item.suggestion === null ? null : item.suggestion.suggestion === null ? (
        <p className="text-[11.5px] text-ink-400">
          {item.suggestion.reason ?? (item.suggestion.status === 'not-needed' ? '这条主张不需要改写。' : '没能给出改写建议。')}
        </p>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-ember-500/25 bg-ember-500/5 p-2.5">
          <div className="flex items-center gap-2">
            <Badge tone="ember">改写建议</Badge>
            <span className="text-[11px] text-ink-400">{item.suggestion.suggestion.problem}</span>
            {props.onToggleChoose === undefined ? null : (
              <label
                className="ml-auto flex cursor-pointer select-none items-center gap-1.5 text-[11.5px] text-ink-300"
                title="勾上之后点「确认采纳」，简历会被真的改掉"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-ember-500)]"
                  checked={props.chosen === true}
                  onChange={() => props.onToggleChoose?.(item.claim.id)}
                  data-shot={'choose-' + item.claim.id}
                />
                采纳
              </label>
            )}
          </div>
          {props.skippedReason === undefined || props.skippedReason === null ? null : (
            <p className="text-[11.5px] leading-relaxed text-rose-ink">勾了但没改成：{props.skippedReason}</p>
          )}
          <div className="flex flex-col gap-1">
            <p className="text-[12px] leading-relaxed text-ink-300 line-through decoration-rose-ink/60">{item.suggestion.suggestion.before}</p>
            <p className="text-[12.5px] leading-relaxed text-mint-400">{item.suggestion.suggestion.after}</p>
          </div>
          <p className="text-[11.5px] leading-relaxed text-ink-400">为什么：{item.suggestion.suggestion.why}</p>
        </div>
      )}
    </article>
  );
}

export function ClaimBoard(props: {
  state: SandboxState;
  onFocus: (anchor: Anchor) => void;
  /** 自定义面试官的中文名不在前端枚举里，得由上层从契约里查出来给过来 */
  interviewerName?: (id: string) => string | undefined;
  /** 点开「这条追问照着哪条岗位要求问」时，把右栏切到 JD 原文的那一段 */
  onFocusJd?: (anchor: Anchor) => void;
  /** 按编号取岗位要求：拿它的正文当悬浮说明 */
  requirementOf?: (id: string) => Requirement | null;
  /** 这一批勾上的改写建议 */
  chosen?: readonly string[];
  onToggleChoose?: (claimId: string) => void;
  skippedReason?: (claimId: string) => string | null;
}) {
  const state = props.state;
  const notices = state.rejectedProbes;

  return (
    <Pane
      title="主张与追问"
      dataShot="claims"
      subtitle={
        state.claims.length === 0
          ? '还没有主张'
          : String(state.claims.length) +
            ' 条主张 · 已判定 ' +
            String(state.claims.filter((c) => c.verdict !== null).length) +
            ' 条'
      }
      bodyClassName="flex flex-col gap-3 p-3"
    >
      {state.phase === 'idle' ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-10 text-center">
          <p className="text-base font-semibold text-ink-100">四条机制，一条一条看得见</p>
          <ul className="flex max-w-xl flex-col gap-2 text-left text-[12.5px] leading-relaxed text-ink-300">
            <li>
              <span className="text-ember-400">证据锚定</span>
              ：面试官的每一句提问都必须带上简历原文的字符区间，锚不到原文的提问会被前端拒显。
            </li>
            <li>
              <span className="text-ember-400">追问预算</span>
              ：每位面试官、每条主张、每一轮都有额度，超额直接被代码挡回来，死循环在结构上不成立。
            </li>
            <li>
              <span className="text-ember-400">意图契约</span>
              ：每位面试官的人设、目标、禁区都是结构化契约，可版本化、可 diff。
            </li>
            <li>
              <span className="text-ember-400">可复现回放</span>
              ：每个模型调用都落成本地卡带，没有 API Key 也能把整场跑完，且结果逐字节可复现。
            </li>
          </ul>
          <p className="text-[12px] text-ink-400">左边点「一键示例」再点「开始质询」，就能看到这四条同时生效。</p>
        </div>
      ) : state.claims.length === 0 ? (
        <Empty
          title={state.phase === 'running' ? '正在从简历里抽主张…' : '还没有可追问的主张'}
          hint="抽取阶段会把简历里值得被追问的话挑出来，并逐条锚定到原文；锚不到原文的一律丢弃，不会出现在这里。"
        />
      ) : (
        state.claims.map((item) => (
          <ClaimCard
            key={item.claim.id}
            item={item}
            state={state}
            onFocus={props.onFocus}
            onFocusJd={props.onFocusJd}
            requirementOf={props.requirementOf}
            interviewerName={props.interviewerName}
            chosen={(props.chosen ?? []).indexOf(item.claim.id) >= 0}
            onToggleChoose={props.onToggleChoose}
            skippedReason={props.skippedReason?.(item.claim.id) ?? null}
          />
        ))
      )}

      {notices.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">被拦下的追问</h3>
          <ul className="flex flex-col gap-1">
            {notices.map((item, index) => (
              <li key={String(index) + item.question} className="rounded-lg border border-ink-800 bg-ink-850/50 px-2.5 py-1.5 text-[12px] text-ink-300">
                <span className="text-ink-100">{item.question}</span>
                <span className="text-ink-400"> —— {item.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.rejectedClaims.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">被锚定机制拦下的主张</h3>
          <ul className="flex flex-col gap-1">
            {state.rejectedClaims.map((item, index) => (
              <li key={String(index) + item.quote} className="rounded-lg border border-ink-800 bg-ink-850/50 px-2.5 py-1.5 text-[12px]">
                <p className="text-ink-100">{item.text}</p>
                <p className="text-[11.5px] text-ink-400">
                  引文：{item.quote} —— {item.reason}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Pane>
  );
}
