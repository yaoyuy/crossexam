/**
 * 采纳改写与导出。
 *
 * 这一栏只做三件事：让你看见「改了几条、还剩几条、哪几条改不动」，
 * 把勾好的提交上去，然后把改完的简历导出去。
 *
 * 一个刻意的设计：导出按钮只在**真的采纳过**之后才出现。
 * 没改过的简历本来就能从原文复制，摆一个「导出」在这里只会让人以为已经改好了。
 */
import { useState } from 'react';
import { resumeDocxUrl, resumeHtmlUrl, resumeTextUrl } from '../api.ts';
import type { RevisedResume } from '../revisions.ts';
import { revisionSummary } from '../revisions.ts';
import { Pane } from './Bits.tsx';

export function RevisionBar(props: {
  sessionId: string | null;
  revised: RevisedResume | null;
  /** 当前勾着的主张 id */
  chosen: string[];
  /** 有改写建议、可以勾的主张 id */
  candidates: string[];
  busy: boolean;
  note: string | null;
  onToggle: (claimId: string) => void;
  onAcceptAll: () => void;
  onClear: () => void;
  onSubmit: () => void;
  onDiscard: () => void;
  onShowOriginal: () => void;
  /** 把改完的这一版当成新简历再质询一遍；只有真的采纳过才传得进来 */
  onRerun?: (() => void) | null;
  /** 离线回放时提醒一句：卡带只录了演示那一条路，改别处再跑会找不到（详见 ADR-0004 卡带按提示词指纹寻址） */
  rerunHint?: string | null;
}) {
  const revised = props.revised;
  // 并排对照默认收起：它是「想核对一下」时才展开的东西，不该占着这一栏的地方
  const [showDiff, setShowDiff] = useState(false);
  const summary = revisionSummary(revised, props.chosen);
  // 导出地址由 api.ts 统一拼（三个入口的查询串各不一样，散在组件里迟早对不上）
  const id = props.sessionId ?? '';
  const canSubmit = props.sessionId !== null && props.chosen.length > 0 && !props.busy;
  const dirty = revised !== null && props.chosen.slice().sort().join(',') !== revised.accepted.slice().sort().join(',');

  return (
    <Pane
      title="采纳改写"
      dataShot="revisions"
      subtitle={
        props.sessionId === null
          ? '跑完一场才有改写建议'
          : revised === null
            ? '勾选想采纳的建议，确认后自动改简历'
            : '已改 ' + String(summary.accepted) + ' 处 · 还有 ' + String(summary.pending) + ' 处没动'
      }
      bodyClassName="flex flex-col gap-2.5 p-3"
    >
      {props.sessionId === null ? (
        <p className="text-[12px] leading-relaxed text-ink-400">
          质询跑完之后，每一条「站不住」的主张都会给出一条改写建议。在这里勾选、确认，简历会当场改好，再导出 PDF 或 Word。
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="chip" title="已经写进简历的改写">
              已改 {summary.accepted}
            </span>
            <span className="chip" title="有建议但还没采纳">
              待定 {summary.pending}
            </span>
            <span className="chip" title="勾了但改不动的，会说明理由">
              改不动 {summary.skipped}
            </span>
            <span className="chip border-ember-500/40 text-ember-300" title="这一批勾了几条">
              本次勾选 {summary.chosen}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="btn px-2.5 py-1 text-[12px]"
              onClick={props.onAcceptAll}
              disabled={props.candidates.length === 0 || props.busy}
              data-shot="revision-accept-all"
            >
              全部采纳（{props.candidates.length}）
            </button>
            <button
              type="button"
              className="btn px-2.5 py-1 text-[12px]"
              onClick={props.onClear}
              disabled={props.chosen.length === 0 || props.busy}
              data-shot="revision-clear"
            >
              清空勾选
            </button>
            <button
              type="button"
              className="btn btn-primary px-2.5 py-1 text-[12px]"
              onClick={props.onSubmit}
              disabled={!canSubmit}
              title="按这次勾选的清单重算简历；取消勾选的那条会从改完的简历里消失"
              data-shot="revision-submit"
            >
              确认采纳
            </button>
          </div>

          {revised === null ? null : (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <a
                  className="btn px-2.5 py-1 text-[12px]"
                  href={resumeTextUrl(id)}
                  download
                  data-shot="resume-txt"
                >
                  改完的简历 .txt
                </a>
                <a
                  className="btn px-2.5 py-1 text-[12px]"
                  href={resumeHtmlUrl(id, { print: true, marks: true })}
                  target="_blank"
                  rel="noreferrer"
                  title="打开可打印的简历页并调起打印对话框，选「另存为 PDF」即可"
                  data-shot="resume-pdf"
                >
                  导出 PDF
                </a>
                <a
                  className="btn px-2.5 py-1 text-[12px]"
                  href={resumeDocxUrl(id, true)}
                  title="真正的 Word 文件（.docx）：打开就能继续编辑，不是网页换了个后缀"
                  data-shot="resume-docx"
                >
                  导出 Word (.docx)
                </a>
                <button
                  type="button"
                  className="btn px-2.5 py-1 text-[12px]"
                  onClick={() => setShowDiff((prev) => !prev)}
                  title="在下面把每一条改动并排列出来：左边是简历原文里的那一段，右边是改完后的那一段"
                  data-shot="revision-diff-toggle"
                >
                  {showDiff ? '收起对照' : '并排看改动'}
                </button>
                {props.onRerun === null || props.onRerun === undefined ? null : (
                  <button
                    type="button"
                    className="btn btn-primary px-2.5 py-1 text-[12px]"
                    onClick={props.onRerun}
                    disabled={props.busy}
                    title="把改完的这一版当成新简历再质询一遍，然后回来比一比判定变了没有"
                    data-shot="revision-rerun"
                  >
                    改完再跑一遍
                  </button>
                )}
                <button
                  type="button"
                  className="chip cursor-pointer transition-colors hover:border-rose-ink hover:text-ink-100"
                  onClick={props.onDiscard}
                  disabled={props.busy}
                  title="撤销全部采纳，回到原文"
                  data-shot="revision-discard"
                >
                  全部撤销
                </button>
              </div>
              {props.onRerun !== null && props.onRerun !== undefined && props.rerunHint !== null && props.rerunHint !== undefined ? (
                <p className="text-[11px] leading-relaxed text-ink-400" data-shot="revision-rerun-hint">
                  {props.rerunHint}
                </p>
              ) : null}
              {showDiff ? (
                <div className="flex flex-col gap-1 rounded-md border border-ink-800 bg-ink-850/40 p-2">
                  <p className="text-[11.5px] leading-relaxed text-ink-400">
                    左边是简历原文里的那一段，右边是改完后的那一段。空着的「原文」表示这一处是新增的一行。
                  </p>
                  <table className="w-full border-collapse text-[11.5px]" data-shot="revision-diff">
                    <thead>
                      <tr className="text-ink-400">
                        <th className="w-[64px] border border-ink-800 px-1.5 py-1 text-left font-normal">主张</th>
                        <th className="border border-ink-800 px-1.5 py-1 text-left font-normal">原文</th>
                        <th className="border border-ink-800 px-1.5 py-1 text-left font-normal">改后</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revised.applied.map((item) => (
                        <tr key={item.claimId + String(item.start)}>
                          <td className="border border-ink-800 px-1.5 py-1 align-top font-mono text-ink-400">{item.claimId}</td>
                          <td className="border border-ink-800 px-1.5 py-1 align-top text-ink-400">{item.before === '' ? '（新增一行）' : item.before}</td>
                          <td className="border border-ink-800 px-1.5 py-1 align-top text-emerald-ink">{item.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {dirty ? (
                <p className="text-[11.5px] leading-relaxed text-amber-ink">
                  勾选与当前这一版不一致：点「确认采纳」才会重算简历。
                </p>
              ) : null}
              {revised.skipped.length === 0 ? null : (
                <ul className="flex flex-col gap-1">
                  {revised.skipped.map((item) => (
                    <li
                      key={item.claimId + item.reason}
                      className="rounded-md border border-ink-800 bg-ink-850/50 px-2 py-1 text-[11.5px] text-ink-300"
                    >
                      <span className="font-mono text-ink-400">{item.claimId}</span> 没改成：{item.reason}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {props.note === null ? null : (
            <p className="text-[11.5px] leading-relaxed text-ink-400" data-shot="revision-note">
              {props.note}
            </p>
          )}
        </>
      )}
    </Pane>
  );
}