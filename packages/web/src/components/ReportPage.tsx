import type { PageId } from '../pages.ts';
import { Pane } from './Bits.tsx';

/**
 * 报告页：把这一场的结论摊开，并且直接能带走。
 *
 * 排版顺序是「先给结论、再给五种带走方式、最后是全文预览」：
 * 用户来这一页的目的通常是拿走东西，不是在这里读八页报告。
 */
export function ReportPage(props: {
  sessionId: string | null;
  jobTitle: string;
  hasReport: boolean;
  hrefs: {
    md: string | null;
    print: string | null;
    docx: string | null;
    bundle: string | null;
    ledger: string | null;
    html: string | null;
  };
  onOpenGrowth: () => void;
  onOpenPage: (page: PageId) => void;
}) {
  if (props.sessionId === null) {
    return (
      <Pane title="报告" dataShot="report-page" subtitle="还没有可以带走的结论">
        <p className="text-[12px] leading-relaxed text-ink-400">
          先跑一场质询，报告页会在这里列出五种带走方式，并且把全文直接嵌在下面。
        </p>
        <button
          type="button"
          className="btn btn-primary mt-3 px-3 py-1.5 text-[12.5px]"
          onClick={() => props.onOpenPage('intake')}
          data-shot="report-to-intake"
        >
          去投料台
        </button>
      </Pane>
    );
  }

  const cards: { shot: string; title: string; body: string; href: string | null; download: boolean }[] = [
    {
      shot: 'report-page-md',
      title: 'Markdown（.md）',
      body: '纯文本归档：便于 git 收进来、也便于二次加工。',
      href: props.hrefs.md,
      download: true,
    },
    {
      shot: 'report-page-pdf',
      title: 'PDF（打印）',
      body: '打开可打印页并调起打印对话框，选「另存为 PDF」即可。',
      href: props.hrefs.print,
      download: false,
    },
    {
      shot: 'report-page-docx',
      title: '真 Word（.docx）',
      body: '段落挂 Word 内置样式，打开就能继续编辑，不是改后缀的网页。',
      href: props.hrefs.docx,
      download: true,
    },
    {
      shot: 'report-page-bundle',
      title: '打包分享（单文件 HTML）',
      body: '报告 + 简历原文 + 改动 + 事件时间线合成一个文件，没有外链，断网双击就能看。',
      href: props.hrefs.bundle,
      download: true,
    },
    {
      shot: 'report-page-ledger',
      title: '台账 Excel（.xlsx）',
      body: '五张表：这一场、判定台账、追问明细、岗位对照、被拦下的。方便排序筛选、逐条改简历。',
      href: props.hrefs.ledger,
      download: true,
    },
  ];

  return (
    <div className="flex flex-col gap-3" data-shot="report-page">
      <Pane
        title="带走这一场"
        dataShot="report-export"
        subtitle={props.jobTitle + ' · 五种格式，内容同源'}
        actions={
          <button
            type="button"
            className="btn px-2.5 py-1 text-[12px]"
            onClick={props.onOpenGrowth}
            data-shot="report-growth"
          >
            成长档案
          </button>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <div key={card.shot} className="flex flex-col gap-1.5 rounded-lg border border-ink-800 bg-ink-900/60 p-3">
              <span className="text-[12.5px] font-semibold text-ink-100">{card.title}</span>
              <span className="text-[11.5px] leading-relaxed text-ink-400">{card.body}</span>
              <a
                className="btn mt-auto self-start px-2.5 py-1 text-[12px]"
                href={card.href ?? '#'}
                data-shot={card.shot}
                download={card.download}
                target={card.download ? undefined : '_blank'}
                rel={card.download ? undefined : 'noreferrer'}
              >
                下载
              </a>
            </div>
          ))}
        </div>
        {props.hasReport ? null : (
          <p className="mt-2 text-[11.5px] text-ink-500">
            这一场还没有主张，所以报告还是空的——先去质询台跑完。
          </p>
        )}
      </Pane>

      <Pane title="报告全文预览" dataShot="report-preview" subtitle="与下载的是同一份内容" bodyClassName="p-2">
        {props.hrefs.html === null ? (
          <p className="p-2 text-[12px] text-ink-400">还没有可以预览的报告。</p>
        ) : (
          <iframe
            title="报告全文预览"
            className="h-[70vh] w-full rounded-lg border border-ink-800 bg-white"
            src={props.hrefs.html}
          />
        )}
      </Pane>
    </div>
  );
}
