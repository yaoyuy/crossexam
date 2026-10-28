import { useState } from 'react';

import { CLAIM_CATEGORY_LABEL, personaLabelOf, VERDICT_CRITERIA, VERDICT_LABEL } from '../labels.ts';
import type { Anchor, Requirement, VerdictOutcome } from '../api.ts';
import type { ClaimView, SandboxState } from '../state.ts';
import { liveText } from '../state.ts';
import { Badge, Chip, Empty, Note, Pane, Quote, VerdictBadge, WeightBar } from './Bits.tsx';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';

/**
 * 主张卡片左边缘那条色条按判定走：
 * 站得住是绿、说过头是黄、站不住是红、没答上来是灰；还没判的时候用中性蓝，
 * 一眼扫下来就能看出「这一栏里最扎眼的是哪几张卡」。
 */
function accentOfVerdict(item: ClaimView): string {
  if (item.verdict === null) return 'sky';
  const kind = item.verdict.verdict.kind;
  if (kind === 'solid') return 'mint';
  if (kind === 'overstated') return 'amber';
  if (kind === 'unanswerable') return 'slate';
  return 'rose';
}

/**
 * 正在流动的模型输出。它刻意画得比结论轻：
 * 这是过程观感（还能被中断、也不会落库），不要让人误以为它已经是判定结果。
 */
function LiveLine(props: { label: string; text: string }) {
  return (
    <div className="rounded-md border border-ember-500/20 bg-ink-950/50 px-2 py-1.5">
      <p className="flex items-center gap-1 text-[10.5px] uppercase tracking-wide text-ember-300/80">
        <Icon name="zap" size={10} />
        {props.label}
      </p>
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
        className="chip max-w-full cursor-pointer truncate text-left transition-colors hover:border-violet-500 hover:text-ink-100"
        onClick={() => props.onFocus?.(props.anchor)}
      >
        <Icon name="clipboard" size={11} />
        {'照 ' + props.requirementId + ' 问 · 点开要求原文'}
      </button>
      <span className="text-[11px] text-ink-400">{'「' + props.anchor.quote + '」'}</span>
    </div>
  );
}

function VerdictBlock(props: { outcome: VerdictOutcome; onFocus: (anchor: Anchor) => void }) {
  const verdict = props.outcome.verdict;
  const confidence = Math.round(verdict.confidence * 100);
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-ink-800 bg-ink-900/50 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictBadge kind={verdict.kind} adjusted={props.outcome.adjusted} />
        <span className="text-[11px] text-ink-400">置信度 {confidence}% · 依据 {verdict.probeIds.length} 次追问</span>
        <span className="ml-auto flex w-16 shrink-0 items-center" title={'置信度 ' + String(confidence) + '%'}>
          <span className="progress block w-full accent-mint">
            <span className="progress-fill" style={{ width: String(confidence) + '%' }} />
          </span>
        </span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-200">{verdict.rationale}</p>
      <p className="flex items-start gap-1.5 rounded-md border border-ink-800 bg-ink-850/60 px-2 py-1.5 text-[11.5px] leading-relaxed text-ink-400">
        <Icon name="funnel" size={12} className="mt-0.5 text-ink-500" />
        <span>
          <span className="text-ink-300">为什么这样判：</span>
          {VERDICT_CRITERIA[verdict.kind].rule}
        </span>
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
          <span className="flex items-center gap-1 text-[11px] text-ink-400">
            <Icon name="book" size={11} />
            援引的原文
          </span>
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

/**
 * 补一句真话。改写建议是模型写的，这一句是**用户自己写的**。
 * 两者都只在点「确认采纳」之后才会进简历，所以共用同一个勾选动作——
 * 只把它当备注收着，用户会以为写进去的已经写进去了。
 */
function SupplementBlock(props: {
  claimId: string;
  text: string | null;
  note?: string | null;
  onSave?: (claimId: string, text: string) => void;
  onDelete?: (claimId: string) => void;
}) {
  const [draft, setDraft] = useState(props.text ?? "");
  const [editing, setEditing] = useState(false);
  const has = props.text !== null;
  const open = !has || editing;
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-mint-400/25 bg-mint-400/5 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="solid">补一句真话</Badge>
        <span className="text-[11px] text-ink-400">
          {has
            ? '这句是你写的，采纳之后会作为新的一行加进简历。'
            : '简历里没写、但你确实做过的事写在这里，它会变成简历里新的一行。'}
        </span>
        {has ? (
          <button
            type="button"
            data-shot={'supplement-edit-' + props.claimId}
            className="ml-auto flex cursor-pointer items-center gap-1 text-[11px] text-ink-300 underline decoration-dotted"
            onClick={() => {
              setDraft(props.text ?? "");
              setEditing(true);
            }}
          >
            <Icon name="wand" size={11} />
            改一句
          </button>
        ) : null}
      </div>
      {has && !editing ? (
        <p data-shot={'supplement-text-' + props.claimId} className="text-[12.5px] leading-relaxed text-mint-300">
          {props.text}
        </p>
      ) : null}
      {open ? (
        <>
          <textarea
            data-shot={'supplement-input-' + props.claimId}
            rows={2}
            value={draft}
            placeholder="例如：日订单 30 万，峰值 QPS 5000。"
            className="w-full resize-none rounded-md border border-ink-700 bg-ink-900/70 px-2 py-1.5 text-[12px] text-ink-100 outline-none focus:border-mint-400/60"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-shot={'supplement-save-' + props.claimId}
              className="flex cursor-pointer items-center gap-1 rounded-md border border-mint-400/40 px-2 py-0.5 text-[11.5px] text-mint-300 transition-colors hover:bg-mint-400/10"
              onClick={() => props.onSave?.(props.claimId, draft)}
            >
              <Icon name="check" size={11} />
              存下这句
            </button>
            {has ? (
              <button
                type="button"
                data-shot={'supplement-delete-' + props.claimId}
                className="flex cursor-pointer items-center gap-1 text-[11.5px] text-rose-ink underline decoration-dotted"
                onClick={() => props.onDelete?.(props.claimId)}
              >
                <Icon name="trash" size={11} />
                删掉
              </button>
            ) : null}
            {editing ? (
              <button
                type="button"
                className="cursor-pointer text-[11.5px] text-ink-400"
                onClick={() => setEditing(false)}
              >
                收起
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {props.note == null ? null : (
        <p data-shot={'supplement-note-' + props.claimId} className="text-[11.5px] leading-relaxed text-amber-ink">
          {props.note}
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
  /** 用户自己给这条主张补的那句真话（还没补就是 null） */
  supplement?: { text: string } | null;
  /** 有没有东西可勾：改写建议与补充说明都算 */
  canChoose?: boolean;
  /** 存那句补充说明。没传就整块不渲染（比如直播还没跑完） */
  onSaveSupplement?: (claimId: string, text: string) => void;
  onDeleteSupplement?: (claimId: string) => void;
  /** 上一次存这句的结果或错误，原样显示 */
  supplementNote?: string | null;
}) {
  const item = props.item;
  const answeredCount = item.probes.filter((pv) => pv.answer !== null && pv.answer.answered).length;

  return (
    <article className={'card-in card accent-bar accent-' + accentOfVerdict(item) + ' flex flex-col gap-3 p-3.5'}>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-ink-300">{item.claim.id}</span>
          <Chip>{CLAIM_CATEGORY_LABEL[item.claim.category] ?? item.claim.category}</Chip>
          <WeightBar value={item.claim.weight} />
          {item.closed ? (
            <Chip title="追问预算已关停这条主张">
              <Icon name="lock" size={10} />
              已关停
            </Chip>
          ) : null}
          {props.canChoose === true && props.onToggleChoose !== undefined ? (
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
          ) : null}
          <span className={(props.canChoose === true ? "" : "ml-auto ") + "text-[11px] text-ink-400"}>
            {String(item.probes.length)} 问 · {String(answeredCount)} 答
          </span>
        </div>
        <p className="text-[14px] font-semibold leading-relaxed text-ink-100">{item.claim.text}</p>
        <Quote anchor={item.claim.anchor} onFocus={props.onFocus} label="简历里的原话" />
      </header>

      {item.probes.length === 0 ? (
        <p className="flex items-center gap-1.5 text-[12px] text-ink-400">
          <Icon name="info" size={12} className="text-ink-500" />
          这条主张没有被追问到（预算或轮次用完了）。
        </p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {item.probes.map((pv, index) => (
            <li key={pv.probe.id} className="row">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink-700 bg-ink-850 font-mono text-[10px] text-ink-300">
                    {String(index + 1)}
                  </span>
                  <Chip className="border-ember-500/30 text-ember-300">
                    <Icon name="user" size={10} />
                    {personaLabelOf(pv.probe.interviewerId, props.interviewerName?.(pv.probe.interviewerId))}
                  </Chip>
                  <span className="text-[11px] text-ink-400">
                    {pv.probe.id} · 第 {pv.probe.round} 轮
                    {pv.probe.parentProbeId === null ? '' : ' · 追问自 ' + pv.probe.parentProbeId}
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed text-ink-100">{pv.probe.question}</p>
                {pv.probe.rationale.length === 0 ? null : (
                  <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-ink-400">
                    <Icon name="bulb" size={11} className="mt-0.5 shrink-0 text-ink-500" />
                    <span>问这个是因为：{pv.probe.rationale}</span>
                  </p>
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
                  <Note tone="warn" icon="alert">
                    这一问没拿到回答：{pv.answerError}
                  </Note>
                ) : pv.answer === null ? (
                  liveText(props.state, 'answer:' + pv.probe.id) === null ? (
                    <p className="flex items-center gap-1.5 text-[11.5px] text-ink-500">
                      <Icon name="clock" size={11} />
                      等待作答…
                    </p>
                  ) : (
                    <LiveLine label="求职者正在作答" text={liveText(props.state, 'answer:' + pv.probe.id) as string} />
                  )
                ) : (
                  <div className="flex flex-col gap-1.5 rounded-[10px] bg-ink-850/70 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={pv.answer.answered ? 'muted' : 'danger'}>
                        {pv.answer.answered ? '求职者作答' : '答不上来'}
                      </Badge>
                      {pv.answer.answer.citedAnchors.length === 0 ? null : (
                        <span className="text-[11px] text-ink-400">援引原文 {pv.answer.answer.citedAnchors.length} 处</span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-200">{pv.answer.answer.text}</p>
                    {pv.answer.answer.citedAnchors.map((anchor, citationIndex) => (
                      <Quote key={String(citationIndex) + anchor.quote} anchor={anchor} onFocus={props.onFocus} />
                    ))}
                    {pv.answer.droppedCitations.length === 0 ? null : (
                      <p className="text-[11px] text-amber-ink">
                        {String(pv.answer.droppedCitations.length)} 条引用在简历里查无实据，已被丢弃（不允许编造原文）。
                      </p>
                    )}
                  </div>
                )}
              </div>
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
        <p className="flex items-center gap-1.5 text-[11.5px] text-ink-400">
          <Icon name="info" size={11} className="text-ink-500" />
          {item.suggestion.reason ?? (item.suggestion.status === 'not-needed' ? '这条主张不需要改写。' : '没能给出改写建议。')}
        </p>
      ) : (
        <div className="flex flex-col gap-2 rounded-[10px] border border-ember-500/25 bg-ember-500/5 p-2.5">
          <div className="flex items-center gap-2">
            <Badge tone="ember">改写建议</Badge>
            <span className="text-[11px] text-ink-400">{item.suggestion.suggestion.problem}</span>
          </div>
          {props.skippedReason === undefined || props.skippedReason === null ? null : (
            <p className="text-[11.5px] leading-relaxed text-rose-ink">勾了但没改成：{props.skippedReason}</p>
          )}
          <div className="flex flex-col gap-1">
            <p className="text-[12px] leading-relaxed text-ink-300 line-through decoration-rose-ink/60">{item.suggestion.suggestion.before}</p>
            <p className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-mint-400">
              <Icon name="check" size={12} className="mt-0.5 shrink-0" />
              <span>{item.suggestion.suggestion.after}</span>
            </p>
          </div>
          <p className="text-[11.5px] leading-relaxed text-ink-400">为什么：{item.suggestion.suggestion.why}</p>
        </div>
      )}

      {props.onSaveSupplement === undefined ? null : (
        <SupplementBlock
          claimId={item.claim.id}
          text={props.supplement === undefined || props.supplement === null ? null : props.supplement.text}
          note={props.supplementNote ?? null}
          onSave={props.onSaveSupplement}
          onDelete={props.onDeleteSupplement}
        />
      )}
    </article>
  );
}

/** 空台面上那四条机制：每条一个图标 + 一个专属颜色，别摊成一串正文 */
const MECHANISMS: { icon: IconName; name: string; text: string; box: string }[] = [
  {
    icon: 'target',
    name: '证据锚定',
    text: '面试官的每一句提问都必须带上简历原文的字符区间，锚不到原文的提问会被前端拒显。',
    box: 'bg-ember-500/15 text-ember-400',
  },
  {
    icon: 'shield',
    name: '追问预算',
    text: '每位面试官、每条主张、每一轮都有额度，超额直接被代码挡回来，死循环在结构上不成立。',
    box: 'bg-violet-500/15 text-violet-400',
  },
  {
    icon: 'clipboard',
    name: '意图契约',
    text: '每位面试官的人设、目标、禁区都是结构化契约，可版本化、可 diff。',
    box: 'bg-sky-500/15 text-sky-400',
  },
  {
    icon: 'layers',
    name: '可复现回放',
    text: '每个模型调用都落成本地卡带，没有 API Key 也能把整场跑完，且结果逐字节可复现。',
    box: 'bg-mint-500/15 text-mint-400',
  },
];

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
  /** 用户自己补的那些真话（按主张 id 一条） */
  supplements?: readonly { claimId: string; text: string }[];
  onSaveSupplement?: (claimId: string, text: string) => void;
  onDeleteSupplement?: (claimId: string) => void;
  supplementNoteFor?: (claimId: string) => string | null;
}) {
  const state = props.state;
  const notices = state.rejectedProbes;

  return (
    <Pane
      title={
        <span className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] bg-violet-500/15 text-violet-400">
            <Icon name="interview" size={14} />
          </span>
          <span className="truncate">主张与追问</span>
        </span>
      }
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
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-10 text-center">
          <span className="empty-art">
            <Icon name="interview" size={26} />
          </span>
          <p className="text-base font-semibold text-ink-100">四条机制，一条一条看得见</p>
          <ul className="grid w-full max-w-2xl grid-cols-1 gap-2 text-left sm:grid-cols-2">
            {MECHANISMS.map((item) => (
              <li key={item.name} className="row">
                <span className={'flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-[8px] ' + item.box}>
                  <Icon name={item.icon} size={14} />
                </span>
                <span className="text-[12.5px] leading-relaxed text-ink-300">
                  <span className="font-semibold text-ink-100">{item.name}</span>：{item.text}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ink-400">左边点「一键示例」再点「开始质询」，就能看到这四条同时生效。</p>
        </div>
      ) : state.claims.length === 0 ? (
        <Empty
          title={state.phase === 'running' ? '正在从简历里抽主张…' : '还没有可追问的主张'}
          icon="interview"
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
            supplement={(props.supplements ?? []).find((row) => row.claimId === item.claim.id) ?? null}
            canChoose={
              props.onToggleChoose !== undefined &&
              ((item.suggestion !== null && item.suggestion.suggestion !== null) ||
                (props.supplements ?? []).some((row) => row.claimId === item.claim.id))
            }
            onSaveSupplement={props.onSaveSupplement}
            onDeleteSupplement={props.onDeleteSupplement}
            supplementNote={props.supplementNoteFor?.(item.claim.id) ?? null}
          />
        ))
      )}

      {notices.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            <Icon name="shield" size={12} className="text-amber-ink" />
            被拦下的追问
          </h3>
          <ul className="flex flex-col gap-1">
            {notices.map((item, index) => (
              <li key={String(index) + item.question} className="note">
                <Icon name="alert" size={14} className="note-ico text-amber-ink" />
                <span className="min-w-0 text-[12px] leading-relaxed text-ink-300">
                  <span className="text-ink-100">{item.question}</span>
                  <span className="text-ink-400"> —— {item.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.rejectedClaims.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            <Icon name="shield" size={12} className="text-rose-ink" />
            被锚定机制拦下的主张
          </h3>
          <ul className="flex flex-col gap-1">
            {state.rejectedClaims.map((item, index) => (
              <li key={String(index) + item.quote} className="note">
                <Icon name="x" size={14} className="note-ico text-rose-ink" />
                <span className="min-w-0">
                  <span className="block text-[12px] text-ink-100">{item.text}</span>
                  <span className="block text-[11.5px] text-ink-400">
                    引文：{item.quote} —— {item.reason}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Pane>
  );
}
