import { Badge, Pane } from './Bits.tsx';
import { tailoredDocUrl, tailoredHtmlUrl, tailoredTextUrl } from '../api.ts';
import type { TailorView } from '../api.ts';

/**
 * 一岗一版栏（P12 · ③）。
 *
 * 它长在右栏、紧挨着简历与岗位原文：这个动作的输入就是「这份简历 × 这份岗位」，
 * 所以结论摆在这两份原文旁边最省事。红线也写在这儿——这一版只做「留下 / 不留下」，
 * 不新增一句、不改一个字；每条留下的主张都标着它靠哪条要求留下，没人被要求相信一个黑箱。
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
  return (
    <Pane
      title="一岗一版"
      dataShot="tailor"
      className="shrink-0"
      subtitle={view.headline}
      actions={
        <button
          type="button"
          className="chip cursor-pointer transition-colors hover:border-ember-500 hover:text-ink-100"
          onClick={props.showing ? props.onHide : props.onShow}
          title="在右栏的「原文 / 改完的」之外，多一个按岗位筛出来的视图"
          data-shot="tailor-toggle"
        >
          {props.showing ? '正在看这一版' : '看这一版'}
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-[11.5px] leading-relaxed text-ink-300" data-shot="tailor-note">
          {view.note ??
            '这一版只做「留下 / 不留下」：不新增一句、不改任何一个字；每一条留下的主张都标着它靠哪条要求留下。'}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="solid">留下 {String(view.keptClaims.length)} 条主张</Badge>
          <Badge tone={view.droppedClaims.length === 0 ? 'muted' : 'warn'}>
            去掉 {String(view.droppedClaims.length)} 条
          </Badge>
          <Badge tone="muted">
            留下 {String(view.keptSegments)} 段 · 去掉 {String(view.droppedSegments)} 段
          </Badge>
          {view.missingRequirements === 0 ? null : (
            <Badge tone="danger">另有 {String(view.missingRequirements)} 条要求简历里没写</Badge>
          )}
        </div>
        {view.droppedClaims.length === 0 ? null : (
          <p className="text-[11px] leading-relaxed text-ink-400" data-shot="tailor-dropped">
            {'去掉的是 ' + view.droppedClaims.join('、') + '：它们对不上《' + view.jdTitle + '》的任何一条要求。'}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <a
            className="btn px-2.5 py-1 text-[12px]"
            href={tailoredTextUrl(id, view.jdId)}
            download
            data-shot="tailor-txt"
          >
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
            href={tailoredDocUrl(id, view.jdId)}
            title="同一份简历，Word 能直接打开并继续改"
            data-shot="tailor-doc"
          >
            导出 Word
          </a>
        </div>
        {view.ok ? null : (
          <p className="text-[11px] text-ink-400" data-shot="tailor-fallback">
            这一版没筛：交回去的仍是原文，一个字都没动。
          </p>
        )}
      </div>
    </Pane>
  );
}
