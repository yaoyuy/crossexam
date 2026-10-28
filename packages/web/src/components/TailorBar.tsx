import { Badge, Note, Pane, Stat } from './Bits.tsx';
import { tailoredDocxUrl, tailoredHtmlUrl, tailoredTextUrl } from '../api.ts';
import type { TailorLine, TailorView } from '../api.ts';
import { Icon } from './Icon.tsx';

/**
 * 一岗一版栏（P12 · ③）。
 *
 * 它长在右栏、紧挨着简历与岗位原文：这个动作的输入就是「这份简历 × 这份岗位」，
 * 所以结论摆在这两份原文旁边最省事。红线也写在这儿——这一版只做「留下 / 不留下」，
 * 不新增一句、不改一个字；每条留下的主张都标着它靠哪条要求留下，没人被要求相信一个黑箱。
 *
 * P16：把「筛前 / 筛后」并排摆出来。左边是留下来的行，右边是被去掉的行（灰掉并划掉），
 * 让人一眼看出这一版到底动了哪几行，而不是只读一串数字。
 */
export function TailorBar(props: {
  view: TailorView;
  sessionId: string;
  /** 右栏现在显示的是不是这一版 */
  showing: boolean;
  onShow: () => void;
  onHide: () => void;
}) {
  const view = props.view;
  const id = props.sessionId;
  const keptLines = view.lines.filter((line) => line.keep);
  const droppedLines = view.lines.filter((line) => !line.keep);
  const reasonOf = (line: TailorLine): string => {
    if (line.header) return '小节标题：删了读者就不知道下面是什么';
    if (line.reason === 'matched') return '对上 ' + line.requirementIds.join('、');
    if (line.reason === 'no-claim') return '这一行没有可被追问的主张，任何岗位都留着';
    return '对不上这个岗位的任何一条要求';
  };

  return (
    <Pane
      title={
        <span className="flex items-center gap-1.5">
          <Icon name="funnel" size={14} className="text-mint-400" />
          <span className="truncate">一岗一版</span>
        </span>
      }
      dataShot="tailor"
      className="shrink-0 accent-bar accent-mint"
      subtitle={view.headline}
      actions={
        <button
          type="button"
          className={
            'chip cursor-pointer transition-colors ' +
            (props.showing ? 'border-mint-500/60 text-mint-400 hover:brightness-110' : 'hover:border-ember-500 hover:text-ink-100')
          }
          onClick={props.showing ? props.onHide : props.onShow}
          title="在右栏的「原文 / 改完的」之外，多一个按岗位筛出来的视图"
          data-shot="tailor-toggle"
        >
          <Icon name={props.showing ? 'check' : 'external'} size={12} />
          {props.showing ? '正在看这一版' : '看这一版'}
        </button>
      }
    >
      <div className="flex flex-col gap-2.5">
        <p className="text-[11.5px] leading-relaxed text-ink-300" data-shot="tailor-note">
          {view.note ??
            '这一版只做「留下 / 不留下」：不新增一句、不改任何一个字；每一条留下的主张都标着它靠哪条要求留下。'}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="solid">留下 {String(view.keptClaims.length)} 条主张</Badge>
          <Badge tone={view.droppedClaims.length === 0 ? 'muted' : 'warn'}>
            去掉 {String(view.droppedClaims.length)} 条
          </Badge>
          {view.missingRequirements === 0 ? null : (
            <Badge tone="danger">另有 {String(view.missingRequirements)} 条要求简历里没写</Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Stat label="留下段" value={view.keptSegments} accent="mint" />
          <Stat label="去掉段" value={view.droppedSegments} accent={view.droppedSegments === 0 ? 'slate' : 'ember'} />
        </div>

        {view.droppedClaims.length === 0 ? null : (
          <p className="text-[11px] leading-relaxed text-ink-400" data-shot="tailor-dropped">
            {'去掉的是 ' + view.droppedClaims.join('、') + '：它们对不上《' + view.jdTitle + '》的任何一条要求。'}
          </p>
        )}

        {view.lines.length === 0 ? null : (
          <div className="grid grid-cols-2 gap-2">
            <section className="flex min-w-0 flex-col gap-1">
              <h3 className="flex items-center gap-1 text-[10.5px] uppercase tracking-wide text-ink-500">
                <Icon name="check" size={11} className="text-mint-400" />
                留在这一版
              </h3>
              <ul className="flex max-h-[92px] flex-col gap-1 overflow-auto pr-0.5">
                {keptLines.slice(0, 12).map((line) => (
                  <li key={line.index} className="row items-start gap-1.5 px-2 py-1.5" title={reasonOf(line)}>
                    <Icon name={line.header ? 'list' : 'check'} size={11} className="mt-0.5 text-mint-400" />
                    <span className="line-clamp-2 min-w-0 text-[11px] leading-relaxed text-ink-300">{line.text}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="flex min-w-0 flex-col gap-1">
              <h3 className="flex items-center gap-1 text-[10.5px] uppercase tracking-wide text-ink-500">
                <Icon name="x" size={11} />
                被去掉的行
              </h3>
              {droppedLines.length === 0 ? (
                <p className="rounded-[10px] border border-dashed border-ink-800 px-2 py-3 text-center text-[11px] text-ink-400">
                  没有去掉任何一行
                </p>
              ) : (
                <ul className="flex max-h-[92px] flex-col gap-1 overflow-auto pr-0.5">
                  {droppedLines.slice(0, 12).map((line) => (
                    <li key={line.index} className="row items-start gap-1.5 px-2 py-1.5 opacity-70" title={reasonOf(line)}>
                      <Icon name="x" size={11} className="mt-0.5 text-rose-ink" />
                      <span className="line-clamp-2 min-w-0 text-[11px] leading-relaxed text-ink-400 line-through decoration-rose-ink/50">
                        {line.text}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <a className="btn px-2.5 py-1 text-[12px]" href={tailoredTextUrl(id, view.jdId)} download data-shot="tailor-txt">
            这一版 .txt
          </a>
          <a
            className="btn px-2.5 py-1 text-[12px]"
            href={tailoredHtmlUrl(id, view.jdId, true)}
            target="_blank"
            rel="noreferrer"
            title="打开可打印的这一版并调起打印对话框，选「另存为 PDF」即可"
            data-shot="tailor-pdf"
          >
            导出 PDF
          </a>
          <a
            className="btn px-2.5 py-1 text-[12px]"
            href={tailoredDocxUrl(id, view.jdId)}
            title="真正的 Word 文件（.docx）：打开就能继续编辑"
            data-shot="tailor-docx"
          >
            导出 Word (.docx)
          </a>
        </div>

        {view.ok ? null : (
          <Note tone="warn" icon="alert">
            <span data-shot="tailor-fallback">这一版没筛：交回去的仍是原文，一个字都没动。</span>
          </Note>
        )}
      </div>
    </Pane>
  );
}
