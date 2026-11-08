import { useState } from 'react';
import { LIVE_CONFIG_STEPS } from './Bits.tsx';
import { Icon } from './Icon.tsx';
import type { LlmMode } from '../api.ts';

/**
 * 顶部模式横幅：永远说清两件事——这一场怎么跑、里面有没有合成数据。
 *
 * 为什么单独拉一条横幅而不是复用头部那枚 chip：chip 只有六个字，放不下
 * 「离线时只有内置演示简历有卡带」这句关键前提；而这句前提正是评委贴自己简历时
 * 最会撞上的那堵墙。合成条数同理：它不能藏在某个抽屉里，必须常驻可见。
 */
export function ModeBanner(props: {
  /** 还没连上服务端时是 null */
  mode: LlmMode | null;
  /** 本场的合成兜底条数；null = 服务端还没说，不能显示成 0 */
  synthesized: number | null;
  /** 离线模式的卡带目录，只在悬停提示里露出，平时不占地方 */
  cassetteDir?: string;
  /** 联网就绪状态：缺哪个环境变量由服务端点名 */
  live?: { ready: boolean; missing: string[] };
}) {
  const mode = props.mode;
  const offline = mode === 'replay';
  const headline =
    mode === null
      ? '正在连接本地服务…'
      : offline
        ? '离线回放'
        : mode === 'record'
          ? '真实调用 · 联网录制'
          : '真实调用 · 联网直连';
  const detail =
    mode === null
      ? '界面正在读服务端的运行模式与卡带目录。'
      : offline
        ? '这一场不联网、不需要 API Key：只重放仓库里录好的卡带。内置演示简历有卡带；自己贴的简历没有卡带，跑下去会由离线兜底按提示词合成（不是真实模型的判断，条数见右侧）。'
        : mode === 'record'
          ? '这一场真调模型，并把提示词与回复存成新卡带：下次可以离线原样重演。'
          : props.live !== undefined && !props.live.ready
            ? '这一场真调模型，但服务端还没读到 ' + props.live.missing.join('、') + '：现在跑会报「还没配好」。'
            : '这一场真调模型：调用次数与 token 都记在顶部仪表里。';
  const tone =
    mode === null
      ? 'text-ink-400'
      : offline
        ? 'text-mint-400'
        : props.live !== undefined && !props.live.ready
          ? 'text-amber-ink'
          : 'text-ember-300';

  // 合成条数三态：说了几条 / 说了 0 条 / 没说。三态必须分开显示——
  // 把「没说」当 0 显示，等于替服务端保证这一场全是模型真实产出。
  const synthText =
    props.synthesized === null
      ? '合成数据：服务端未标注'
      : props.synthesized > 0
        ? '本场含 ' + String(props.synthesized) + ' 条合成兜底数据'
        : '本场没有合成兜底数据';
  const synthTone =
    props.synthesized === null
      ? 'border-ink-700 text-ink-400'
      : props.synthesized > 0
        ? 'border-amber-ink/40 text-amber-ink'
        : 'border-mint-500/40 text-mint-400';
  const synthTitle =
    props.synthesized === null
      ? '这一版服务端还没有回报合成条数：界面不替它保证「全是模型真实产出」'
      : props.synthesized > 0
        ? '这些条目不是模型真实产出，是本地规则顶上的兜底数据：报告与台账里逐条可查'
        : '服务端回报这一场没有用到合成兜底数据';

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-800 bg-ink-900/40 px-4 py-2 text-[12px]"
      data-shot="mode-banner"
      title={props.cassetteDir ?? ''}
    >
      <span className={'inline-flex items-center gap-1.5 font-semibold ' + tone}>
        <Icon name={mode === null ? 'info' : offline ? 'check' : 'alert'} size={13} />
        {headline}
      </span>
      <span className="min-w-0 flex-1 text-ink-400">{detail}</span>
      {mode === null ? null : (
        <span className={'chip ' + synthTone} data-shot="synth-note" title={synthTitle}>
          {synthText}
        </span>
      )}
    </div>
  );
}

/**
 * 开跑前的离线预检闸门。
 *
 * 只在「预检说这一场没有卡带」时出现。它不是拦路石，而是开跑前的一次知情选择：
 * 服务端现在会用离线兜底把没录过的响应合成出来，跑是跑得完的，代价是那一场里
 * 有一部分结论不是真实模型给的。所以这里既不吓唬人「跑不了」，也不让人稀里糊涂地跑：
 * 换演示简历、去配 Key、以及「我知道会用合成，照样跑」三条路都摆出来。
 * 第三个出口必须有——预检只是一次快速判断，判错了不能把人锁死。
 */
export function PrecheckGate(props: {
  mode: LlmMode;
  /** 服务端给的一句话：有就优先显示，没有用界面自己组织的口径 */
  message?: string;
  /** 演示简历加载好了没：没好时第一个按钮是灰的 */
  demoReady: boolean;
  onUseDemo: () => void;
  onRunAnyway: () => void;
  /** 切到联网直连。服务端没配 Key 时不给这个按钮——切了也跑不起来 */
  onSwitchLive: (() => void) | null;
}) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const offline = props.mode === 'replay';
  const title = offline ? '离线回放：这一场没有录制卡带' : '这一场按现在的配置跑不起来';
  const fallback = offline
    ? '这台机器现在不联网，只重放仓库里录好的卡带。你这份材料没有卡带，跑下去会用「离线兜底」按提示词确定性合成：那一部分不是真实模型的判断，横幅与报告里会写明条数。想要真结果，就换演示简历，或者配一个 API Key。'
    : '服务端说这一场缺必要的配置。';
  return (
    <div
      className="rounded-xl border border-amber-ink/40 bg-amber-ink/10 p-3 text-[12px] text-amber-ink"
      data-shot="precheck-gate"
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1 opacity-90">{props.message ?? fallback}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="btn px-2.5 py-1 text-[12px]"
          disabled={!props.demoReady}
          onClick={props.onUseDemo}
          data-shot="gate-use-demo"
          title="换成内置演示简历并立刻跑一遍：它是唯一录过卡带的材料"
        >
          用演示简历跑一遍
        </button>
        <button
          type="button"
          className="btn px-2.5 py-1 text-[12px]"
          onClick={() => setStepsOpen(!stepsOpen)}
          data-shot="gate-live-config"
          title="用你自己的模型跑这一场：三步，五分钟内能配上"
        >
          配一个 API Key 走真实模型
        </button>
        <button
          type="button"
          className="btn px-2.5 py-1 text-[12px] opacity-80"
          onClick={props.onRunAnyway}
          data-shot="gate-run-anyway"
          title="知道这一场会用离线兜底合成，仍然要跑：预检只是一次快速判断，判错了不该把你锁在原地"
        >
          仍然跑这一场（走离线兜底）
        </button>
      </div>
      {stepsOpen ? (
        <div className="mt-2 rounded-lg border border-amber-ink/30 bg-ink-950/50 p-2 text-ink-300" data-shot="gate-live-steps">
          <p className="opacity-90">配好之后这一场就真调模型；README 的「想联网跑真实模型」一节是同一套步骤。</p>
          <ol className="mt-1 list-decimal pl-4 opacity-90">
            {LIVE_CONFIG_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {props.onSwitchLive === null ? (
            <p className="mt-1 opacity-75">服务端还没读到 Key：重启 npm run dev 之后这个按钮才会出现。</p>
          ) : (
            <button
              type="button"
              className="btn mt-1.5 px-2.5 py-1 text-[12px]"
              onClick={props.onSwitchLive}
              data-shot="gate-switch-live"
            >
              已经配好了，切到联网直连
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
