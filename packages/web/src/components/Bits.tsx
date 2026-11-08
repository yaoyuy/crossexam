import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';
import type { Accent } from '../pages.ts';
import { VERDICT_GLOSS, VERDICT_LABEL, VERDICT_TONE } from '../labels.ts';
import { describeRange } from '../highlight.ts';
import type { Anchor, VerdictKind } from '../api.ts';

/**
 * 页头：每个页面顶上那一行「标题 + 一句话说明 + 右侧动作」。
 *
 * 参考物里每一页都是这个结构（标题下面一行灰字说清楚这页干什么），
 * 所以抽成组件而不是每页各写一遍——不然六页会长出六种字号。
 */
export function PageHead(props: {
  icon: IconName;
  title: string;
  sub?: ReactNode;
  accent?: Accent;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head" data-shot="page-head">
      <div className="min-w-0">
        <h1 className="page-title">
          <IconTile icon={props.icon} accent={props.accent} size={18} />
          <span className="truncate">{props.title}</span>
        </h1>
        {props.sub === undefined ? null : <p className="page-sub">{props.sub}</p>}
      </div>
      {props.actions === undefined ? null : <div className="page-head-actions">{props.actions}</div>}
    </header>
  );
}

/** 图标磁片：页头、首页磁贴、卡片标题共用同一个形状与底色规则 */
export function IconTile(props: { icon: IconName; accent?: Accent; size?: number }) {
  return (
    <span
      className={'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ' + accentBox(props.accent ?? 'ember')}
    >
      <Icon name={props.icon} size={props.size ?? 16} />
    </span>
  );
}

/** 图标底色的三种例子都写成静态类名，Tailwind 才不会把动态拼出来的类名扫掉 */
function accentBox(accent: Accent): string {
  if (accent === 'sky') return 'bg-sky-500/15 text-sky-400';
  if (accent === 'violet') return 'bg-violet-500/15 text-violet-400';
  if (accent === 'mint') return 'bg-mint-500/15 text-mint-400';
  if (accent === 'teal') return 'bg-teal-500/15 text-teal-400';
  if (accent === 'slate') return 'bg-ink-700/40 text-ink-300';
  return 'bg-ember-500/15 text-ember-400';
}

/**
 * 文档流里的卡片（不是固定高度的 pane）：页面滚动时它跟着滚。
 *
 * 左边缘那条色条是参考物里最显眼的一处：一眼能看出这张卡属于哪个板块。
 */
export function SectionCard(props: {
  title: ReactNode;
  desc?: ReactNode;
  icon?: IconName;
  accent?: Accent;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  dataShot?: string;
  /** 关掉左侧色条（默认开着） */
  plain?: boolean;
  /** 额外的类名（首页主视觉卡用它掺底色） */
  className?: string;
}) {
  const accent = props.accent ?? 'ember';
  return (
    <section
      data-shot={props.dataShot}
      className={
        'card ' + (props.plain === true ? '' : 'accent-bar accent-' + accent) + (props.className === undefined ? '' : ' ' + props.className)
      }
    >
      <div className="card-head">
        <div className="min-w-0">
          <h2 className="card-title flex items-center gap-2">
            {props.icon === undefined ? null : <Icon name={props.icon} size={16} className="text-ink-400" />}
            <span className="truncate">{props.title}</span>
          </h2>
          {props.desc === undefined ? null : <p className="card-desc">{props.desc}</p>}
        </div>
        {props.actions === undefined ? null : <div className="flex shrink-0 items-center gap-2">{props.actions}</div>}
      </div>
      <div className={'card-pad ' + (props.bodyClassName ?? '')}>{props.children}</div>
    </section>
  );
}

/** 固定高度的分栏（质询台那种）：头部简朴、正文自己滚 */
export function Pane(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** 给自动化截图用的稳定锚点，界面上不可见（tools/ui-shots 按它定位要滚动的栏）。 */
  dataShot?: string;
}) {
  return (
    <section data-shot={props.dataShot} className={'pane flex min-h-0 flex-col ' + (props.className ?? '')}>
      <header className="pane-head">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink-100">{props.title}</h2>
          {props.subtitle === undefined ? null : (
            <p className="truncate text-[11px] text-ink-400">{props.subtitle}</p>
          )}
        </div>
        {props.actions === undefined ? null : <div className="flex shrink-0 items-center gap-2">{props.actions}</div>}
      </header>
      <div className={'min-h-0 flex-1 overflow-auto ' + (props.bodyClassName ?? 'p-3')}>{props.children}</div>
    </section>
  );
}

export type Tone = 'solid' | 'warn' | 'danger' | 'muted' | 'ember' | 'sky' | 'violet' | 'teal';

export function Badge(props: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={'badge badge-' + props.tone} title={props.title}>
      {props.children}
    </span>
  );
}

export function Chip(props: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span className={'chip ' + (props.className ?? '')} title={props.title}>
      {props.children}
    </span>
  );
}

export function Dots() {
  return (
    <span className="dots inline-flex items-end gap-[1px] text-ember-400" aria-label="进行中">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}

export function VerdictBadge(props: { kind: VerdictKind; adjusted?: boolean }) {
  return (
    <Badge tone={VERDICT_TONE[props.kind]} title={VERDICT_GLOSS[props.kind]}>
      {VERDICT_LABEL[props.kind]}
      {props.adjusted === true ? ' · 代码收敛' : ''}
    </Badge>
  );
}

export function Quote(props: { anchor: Anchor; onFocus?: (anchor: Anchor) => void; label?: string }) {
  const clickable = props.onFocus !== undefined;
  return (
    <div className="flex flex-col gap-1">
      {props.label === undefined ? null : <span className="text-[11px] text-ink-400">{props.label}</span>}
      <button
        type="button"
        className={'quote text-left ' + (clickable ? 'cursor-pointer hover:brightness-110' : 'cursor-default')}
        title={'简历原文 ' + describeRange(props.anchor) + (props.anchor.exact ? '（逐字命中）' : '（标点归一化后命中）')}
        onClick={() => props.onFocus?.(props.anchor)}
      >
        {props.anchor.quote}
      </button>
    </div>
  );
}

export function WeightBar(props: { value: number }) {
  const percent = Math.round(Math.max(0, Math.min(1, props.value)) * 100);
  return (
    <span className="inline-flex items-center gap-2" title={'追问价值 ' + String(percent) + '%'}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-800">
        <span className="block h-full rounded-full bg-ember-500" style={{ width: String(percent) + '%' }} />
      </span>
      <span className="text-[11px] text-ink-400">{percent}%</span>
    </span>
  );
}

/** 空状态：一句说明 + 一行提示，带一张「虚线插画」的位置（参考物里都是这个形状） */
export function Empty(props: { title: string; hint?: string; icon?: IconName }) {
  return (
    <div className="empty">
      <span className="empty-art">
        <Icon name={props.icon ?? 'file'} size={26} />
      </span>
      <p className="empty-title">{props.title}</p>
      {props.hint === undefined ? null : <p className="empty-hint">{props.hint}</p>}
    </div>
  );
}

/** 提示条：蓝=说明、黄=注意 */
export function Note(props: { tone?: 'info' | 'warn' | 'plain'; icon?: IconName; children: ReactNode }) {
  const tone = props.tone ?? 'plain';
  const cls = tone === 'info' ? 'note note-info' : tone === 'warn' ? 'note note-warn' : 'note';
  const icon: IconName = props.icon ?? (tone === 'warn' ? 'alert' : 'info');
  return (
    <div className={cls}>
      <Icon name={icon} size={15} className="note-ico" />
      <div className="min-w-0">{props.children}</div>
    </div>
  );
}

/** 一条错误在界面上的人话版本。开发者文案只留作「技术细节」，不直接怼给用户。 */
export interface RunErrorExplain {
  title: string;
  detail: string;
  /** 照着点/照着做就能往下走的动作，按顺序排 */
  steps: string[];
  /** 服务端原话，收在「技术细节」里 */
  raw: string;
  fatal: boolean;
}

/**
 * 错误对象的界面口径。旧服务端只推 message + fatal，结构化改造之后才会多推 code 与 hint，
 * 所以这两个字段一律当「有就用、没有就按文案猜」处理，不能硬依赖。
 */
export interface RunErrorLike {
  message: string;
  fatal: boolean;
  code?: string | null;
  hint?: string | null;
}

/** 没卡带时最省事的那条出口：一键示例那份简历是仓库里唯一录过卡带的材料。 */
export const DEMO_EXIT_STEP =
  '回投料台点「一键示例」，用内置演示简历跑一遍：它是唯一录过卡带的材料';

/** 「想联网跑真实模型」的三步。与 README 同一套口径，界面上照抄即可。 */
export const LIVE_CONFIG_STEPS: string[] = [
  '在仓库根目录建一份配置：cp .env.example .env（Windows 下用 copy .env.example .env）',
  '填 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 三项：任何 OpenAI 兼容端点都可以',
  '重启 npm run dev，再在投料台把运行模式切到「联网直连」',
];

/**
 * 把错误翻成人话。
 * 为什么要有这一层：离线回放撞上 cassette-missing 时，服务端原样推的是
 * 「用途「xxx」的指纹是 digest，请用 CROSSEXAM_MODE=record 联网跑一次把它录下来」——
 * 这句话是说给开发者听的，评委既看不懂，也不知道下一步该点哪里。
 * 判定顺序：先看结构化 code，再退回关键词——旧服务端只会给文案。
 */
export function explainRunError(error: RunErrorLike): RunErrorExplain {
  const raw = error.message;
  const code = (error.code ?? '').trim();
  const said = raw + ' ' + (error.hint ?? '');
  const has = (...keys: string[]): boolean => keys.some((key) => said.indexOf(key) >= 0);

  if (code === 'cassette-missing' || has('cassette-missing', '回放模式找不到这一条记录', '找不到卡带')) {
    return {
      title: '这一场没有录好的卡带，离线状态下跑不了',
      detail:
        '这台机器现在是离线回放模式：它只重放仓库里已经录好的卡带。内置演示简历有卡带，自己贴的简历、换过的模板、改过的档位都还没有。',
      steps: [DEMO_EXIT_STEP, '或者按下面的三步配一个 API Key，用你自己的模型跑这一场', ...LIVE_CONFIG_STEPS.slice(0, 2)],
      raw,
      fatal: error.fatal,
    };
  }

  if (code === 'cassette-corrupt' || code === 'cassette-version' || has('cassette-corrupt', 'cassette-version', '卡带坏了', '卡带版本')) {
    return {
      title: '卡带文件坏了，或者与这一版程序对不上',
      detail: '录好的卡带是上一版程序写下的格式，这一版读不了它。重新生成一次即可，不影响别的功能。',
      steps: ['跑一次 npm run seed:demo，重新生成内置演示卡带', '或者切到「联网直连」，这一场就真调模型'],
      raw,
      fatal: error.fatal,
    };
  }

  if (code === 'not-configured' || has('not-configured', 'LLM_API_KEY', 'LLM_BASE_URL', '没有配置')) {
    return {
      title: '联网模式还没有配好模型',
      detail: '选了联网直连（或联网录制），但服务端还没有拿到模型地址与 Key，所以这一场没能开始。',
      steps: LIVE_CONFIG_STEPS,
      raw,
      fatal: error.fatal,
    };
  }

  if (has('Failed to fetch', 'NetworkError', 'ERR_CONNECTION', '请求失败（HTTP 5')) {
    return {
      title: '连不上本地服务',
      detail: '界面没能和后端说上话：服务可能已经退出，或者端口被别的东西占了。',
      steps: ['确认 npm run dev 还在运行（终端里没有报错）', '刷新一次页面，再点一次「开始质询」'],
      raw,
      fatal: error.fatal,
    };
  }

  return {
    title: error.fatal ? '这一场没能跑完' : '有一处没能完成，其余部分照常',
    // 认不出来的那种，说明是没归类过的毛病：这时把服务端那句话原样摆在正文里。
    // 它多半本来就是中文短句、是给用户看的（例如「第 1 份 JD…太短了」），
    // 藏进「技术细节」等于让人自己猜哪儿错了；标题与下一步仍然是人话。
    detail: (error.hint ?? '').trim().length > 0 ? (error.hint as string) : raw,
    steps: error.fatal
      ? ['先点「开始质询」重试一次：多数中断重跑一遍就好', '还不行就把「技术细节」那段原样发给开发者']
      : ['这一处不挡其余部分：先接着往下走，回头看这一条', '重复出现就把「技术细节」那段原样发给开发者'],
    raw,
    fatal: error.fatal,
  };
}

/**
 * 错误条：一律先翻成人话再上屏，原始文案折叠进「技术细节」。
 * actions 只由调用方给（质询台那一栏用不上按钮），所以这一层不知道「用演示简历跑一遍」是谁的事。
 */
export function ErrorNotes(props: {
  errors: RunErrorLike[];
  actions?: { label: string; onClick: () => void; primary?: boolean; dataShot?: string }[];
}) {
  if (props.errors.length === 0) return null;
  const actions = props.actions ?? [];
  return (
    // data-shot 供点测定位：这一块可能同时出现在质询台左栏与投料台横幅上，所以按「哪一块里有按钮」找
    <div className="flex flex-col gap-1.5" data-shot="error-notes">
      <ul className="flex flex-col gap-1">
        {props.errors.map((error, index) => {
          const explained = explainRunError(error);
          return (
            <li
              key={String(index) + error.message}
              className={
                'rounded-lg border px-2.5 py-1.5 text-[12px] leading-relaxed ' +
                (error.fatal
                  ? 'border-rose-ink/40 bg-rose-ink/10 text-rose-ink'
                  : 'border-amber-ink/30 bg-amber-ink/10 text-amber-ink')
              }
            >
              <p className="font-semibold">{explained.title}</p>
              <p className="mt-0.5 opacity-90">{explained.detail}</p>
              {explained.steps.length === 0 ? null : (
                <ol className="mt-1 list-decimal pl-4 opacity-90">
                  {explained.steps.map((step, stepIndex) => (
                    <li key={String(stepIndex) + step}>{step}</li>
                  ))}
                </ol>
              )}
              <details className="mt-1 opacity-75">
                <summary className="cursor-pointer select-none">技术细节</summary>
                <p className="mt-0.5 break-words">{explained.raw}</p>
              </details>
            </li>
          );
        })}
      </ul>
      {actions.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-1.5">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={
                'btn px-2.5 py-1 text-[12px] ' +
                (action.primary === true ? '!border-rose-ink/60 !text-rose-ink' : '')
              }
              data-shot={action.dataShot}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 统计小卡：参考物里每页顶部那排数字块 */
export function Stat(props: { label: string; value: ReactNode; hint?: string; accent?: Accent }) {
  return (
    <div className={'stat-card accent-' + (props.accent ?? 'ember')} title={props.hint}>
      <span className="stat-label">{props.label}</span>
      <span className="stat-value">{props.value}</span>
      {props.hint === undefined ? null : <span className="stat-hint">{props.hint}</span>}
    </div>
  );
}
