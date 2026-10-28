import type { Accent, PageId } from '../pages.ts';
import { Empty, Note, PageHead, SectionCard } from './Bits.tsx';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';

/**
 * 报告页：把这一场的结论摊开，并且直接能带走。
 *
 * 排版顺序是「先给结论、再给五种带走方式、最后是全文预览」：
 * 用户来这一页的目的通常是拿走东西，不是在这里读八页报告。
 *
 * P16 起五张卡改成磁贴：每张一个图标、一个强调色、一句「这份文件拿来干什么」，
 * 下载按钮压在同一张卡里。参考物里一屏能扫完的入口，靠的就是这种「一卡一件事」。
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
      <div className="flex flex-col gap-3" data-shot="report-page">
        <PageHead
          icon="report"
          accent="mint"
          title="报告"
          sub="跑完一场之后，五种带走方式与全文预览都摆在这一页"
        />
        <SectionCard
          title="还没有可以带走的结论"
          desc="先跑一场质询，报告页会在这里列出五种带走方式，并且把全文直接嵌在下面。"
          icon="report"
          accent="mint"
        >
          <Empty
            icon="file"
            title="这一页还空着"
            hint="去投料台贴一份简历与目标岗位，跑完一场再回来：五个入口会一起出现在这里，内容同源，点一下就能下载。"
          />
          <div className="flex justify-center">
            <button
              type="button"
              className="btn btn-primary px-3 py-1.5 text-[12.5px]"
              onClick={() => props.onOpenPage('intake')}
              data-shot="report-to-intake"
            >
              去投料台
            </button>
          </div>
        </SectionCard>
      </div>
    );
  }

  const cards: {
    shot: string;
    title: string;
    body: string;
    href: string | null;
    download: boolean;
    icon: IconName;
    accent: Accent;
    /** 三张一排、最后两张各占半排：五张卡正好铺满，右下角不会留一个空洞 */
    span: string;
  }[] = [
    {
      shot: 'report-page-md',
      title: 'Markdown（.md）',
      body: '纯文本归档：便于 git 收进来、也便于二次加工。',
      href: props.hrefs.md,
      download: true,
      icon: 'file',
      accent: 'sky',
      span: 'xl:col-span-2',
    },
    {
      shot: 'report-page-pdf',
      title: 'PDF（打印）',
      body: '打开可打印页并调起打印对话框，选「另存为 PDF」即可。',
      href: props.hrefs.print,
      download: false,
      icon: 'monitor',
      accent: 'violet',
      span: 'xl:col-span-2',
    },
    {
      shot: 'report-page-docx',
      title: '真 Word（.docx）',
      body: '段落挂 Word 内置样式，打开就能继续编辑，不是改后缀的网页。',
      href: props.hrefs.docx,
      download: true,
      icon: 'report',
      accent: 'teal',
      span: 'xl:col-span-2',
    },
    {
      shot: 'report-page-bundle',
      title: '打包分享（单文件 HTML）',
      body: '报告 + 简历原文 + 改动 + 事件时间线合成一个文件，没有外链，断网双击就能看。',
      href: props.hrefs.bundle,
      download: true,
      icon: 'rocket',
      accent: 'ember',
      span: 'xl:col-span-3',
    },
    {
      shot: 'report-page-ledger',
      title: '台账 Excel（.xlsx）',
      body: '五张表：这一场、判定台账、追问明细、岗位对照、被拦下的。方便排序筛选、逐条改简历。',
      href: props.hrefs.ledger,
      download: true,
      icon: 'table',
      accent: 'mint',
      span: 'xl:col-span-3',
    },
  ];

  return (
    <div className="flex flex-col gap-3" data-shot="report-page">
      <PageHead
        icon="report"
        accent="mint"
        title="报告"
        sub={props.jobTitle + ' · 五种格式，内容同源'}
        actions={
          <button
            type="button"
            className="btn px-2.5 py-1 text-[12px]"
            onClick={props.onOpenGrowth}
            data-shot="report-growth"
          >
            <Icon name="trending" size={14} />
            成长档案
          </button>
        }
      />

      <SectionCard
        title="带走这一场"
        desc="五个入口、同一份内容：挑一种你现在要用的格式，下载按钮就在卡片上。"
        icon="layers"
        accent="mint"
        dataShot="report-export"
      >
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-6">
          {cards.map((card) => (
            <article
              key={card.shot}
              className={'card accent-bar accent-' + card.accent + ' flex flex-col gap-2 p-4 ' + card.span}
            >
              <span className={'tile-ico accent-' + card.accent}>
                <Icon name={card.icon} size={18} />
              </span>
              <h3 className="text-[13px] font-semibold leading-snug text-ink-100">{card.title}</h3>
              <p className="text-[11.5px] leading-relaxed text-ink-400">{card.body}</p>
              <a
                className="btn mt-auto self-start px-3 py-1.5 text-[12px]"
                href={card.href ?? '#'}
                data-shot={card.shot}
                download={card.download}
                target={card.download ? undefined : '_blank'}
                rel={card.download ? undefined : 'noreferrer'}
              >
                <Icon name="download" size={14} />
                下载
              </a>
            </article>
          ))}
        </div>
        {props.hasReport ? null : (
          <div className="mt-3">
            <Note tone="warn">这一场还没有主张，所以报告还是空的——先去质询台跑完。</Note>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="报告全文预览"
        desc="与下载的是同一份内容：先在这里读一遍，再决定带走哪一种格式。"
        icon="monitor"
        accent="slate"
        dataShot="report-preview"
        bodyClassName="p-2"
      >
        {props.hrefs.html === null ? (
          <Empty icon="file" title="还没有可以预览的报告。" hint="这一场跑完之后，报告全文会直接嵌在这里，不需要先下载。" />
        ) : (
          <iframe
            title="报告全文预览"
            className="h-[70vh] w-full rounded-lg border border-ink-800 bg-white"
            src={props.hrefs.html}
          />
        )}
      </SectionCard>
    </div>
  );
}