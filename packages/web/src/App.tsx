import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  ApiError,
  createSession,
  deleteSession,
  fetchContracts,
  fetchDemo,
  fetchHealth,
  fetchStats,
  getSession,
  listSessions,
  reportUrl,
  streamRun,
} from './api.ts';
import type {
  ContractView,
  DemoInfo,
  HealthInfo,
  InterviewerRole,
  SessionSummary,
  SseEvent,
} from './api.ts';
import { allAnchors, initialSandbox, sandboxReducer, stateFromHistory, totalProbes } from './state.ts';
import { Chip } from './components/Bits.tsx';
import { ClaimBoard } from './components/ClaimBoard.tsx';
import { IntakePanel } from './components/IntakePanel.tsx';
import type { IntakeDraft } from './components/IntakePanel.tsx';
import { ResumePane } from './components/ResumePane.tsx';
import { StageRail } from './components/StageRail.tsx';

const EMPTY_DRAFT: IntakeDraft = { resumeText: '', jdText: '', jobTitle: '' };
const DEFAULT_PANEL: InterviewerRole[] = ['tech', 'hr', 'hiring_manager'];
// 慢放模式下分片的节拍：40 ms 吐 3 片，约合每秒 75 片。
// 比阶段事件（220 ms）快得多，所以字是连着出来的，而阶段仍在慢慢推进。
const STREAM_TICK_MS = 40;
const STREAM_BATCH = 3;

function modeChip(health: HealthInfo | null): { text: string; className: string } {
  if (health === null) return { text: '连接本地服务中…', className: 'opacity-70' };
  if (health.mode === 'replay') {
    return { text: '离线回放 · 不联网、不需要 API Key', className: 'border-mint-500/40 text-mint-400' };
  }
  if (health.mode === 'record') return { text: '联网录制中 · 会把这一场存成卡带', className: 'border-amber-ink/40 text-amber-ink' };
  return { text: '联网直连 · 用你自己的模型跑', className: 'border-ember-500/40 text-ember-300' };
}

function numberText(value: number): string {
  return value.toLocaleString('zh-CN');
}

export function App() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [demo, setDemo] = useState<DemoInfo | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [draft, setDraft] = useState<IntakeDraft>(EMPTY_DRAFT);
  const [panel, setPanel] = useState<InterviewerRole[]>(DEFAULT_PANEL);
  const [pace, setPace] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [material, setMaterial] = useState<{ resumeText: string; title: string }>({ resumeText: '', title: '' });
  const [contracts, setContracts] = useState<ContractView[] | null>(null);
  const [sandbox, dispatch] = useReducer(sandboxReducer, initialSandbox);

  const queueRef = useRef<SseEvent[]>([]);
  const timerRef = useRef<number | null>(null);
  // 流式分片单独一条队列：它一秒可能来几十片，跟阶段事件同一个节拍会把人看睡
  const streamQueueRef = useRef<SseEvent[]>([]);
  const streamTimerRef = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const streamingRef = useRef(false);
  const paceRef = useRef(pace);

  useEffect(() => {
    paceRef.current = pace;
  }, [pace]);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await listSessions(20));
    } catch {
      // 历史列表拉不到不影响主流程，界面照样能跑新的质询
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [loadedHealth, loadedDemo] = await Promise.all([fetchHealth(), fetchDemo()]);
        setHealth(loadedHealth);
        setDemo(loadedDemo);
      } catch (error) {
        setHint(error instanceof Error ? error.message : '连不上本地服务，请先 npm run dev');
      }
      await refreshSessions();
    })();
  }, [refreshSessions]);

  /**
   * 契约随面板变化重取：它是纯确定性接口，不调模型、不消耗预算。
   * 跑完一场之后再用会话里那份覆盖一次，就能看到「与运行时一致」的对账结论。
   */
  useEffect(() => {
    let alive = true;
    void fetchContracts(panel)
      .then((data) => {
        if (alive) setContracts(data.contracts);
      })
      .catch(() => {
        if (alive) setContracts(null);
      });
    return () => {
      alive = false;
    };
  }, [panel]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      if (streamTimerRef.current !== null) window.clearInterval(streamTimerRef.current);
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    },
    [],
  );

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /**
   * 事件泵：SSE 事件先排队，再按选定节奏放出去。
   * 「慢放」只是播放速度，不改变服务端算出来的任何结果；
   * 之所以需要它，是因为离线回放整场不到一秒，录演示视频时人眼跟不过来。
   */
  const drain = useCallback(() => {
    const next = queueRef.current.shift();
    if (next === undefined) {
      if (!streamingRef.current) stopTimer();
      return;
    }
    dispatch({ type: 'sse', name: next.event, data: next.data });
    if (paceRef.current === 0) drain();
  }, [stopTimer]);

  /** 每拍吐一小撮分片再排下一拍；队列空了就停表，不留空转的定时器 */
  const drainStream = useCallback(() => {
    const batch = streamQueueRef.current.splice(0, STREAM_BATCH);
    for (const chunk of batch) dispatch({ type: 'sse', name: chunk.event, data: chunk.data });
    if (streamQueueRef.current.length === 0 && streamTimerRef.current !== null) {
      window.clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
  }, []);

  const pushEvent = useCallback(
    (event: SseEvent) => {
      // 分片走自己那条更快的队列：即时模式下直接上屏，慢放模式下按小批次吐，
      // 这样离线回放也能看见字一个一个出来（整场回放本来不到一秒，人眼根本跟不上）。
      if (event.event === 'stream') {
        if (paceRef.current === 0) {
          dispatch({ type: 'sse', name: event.event, data: event.data });
          return;
        }
        streamQueueRef.current.push(event);
        if (streamTimerRef.current === null) {
          streamTimerRef.current = window.setInterval(drainStream, STREAM_TICK_MS);
        }
        return;
      }
      queueRef.current.push(event);
      if (paceRef.current === 0) {
        drain();
        return;
      }
      if (timerRef.current === null) timerRef.current = window.setInterval(drain, paceRef.current);
    },
    [drain],
  );

  const handleRun = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setHint(null);
    let sessionId: string | null = null;

    try {
      const jobTitle = draft.jobTitle.trim();
      const created = await createSession({
        resumeText: draft.resumeText,
        jdText: draft.jdText,
        ...(jobTitle.length > 0 ? { jobTitle } : {}),
      });
      sessionId = created.id;
      setMaterial({ resumeText: draft.resumeText, title: created.jobTitle });
      queueRef.current = [];
      streamingRef.current = true;
      dispatch({ type: 'begin', sessionId: created.id });
      void refreshSessions();

      const id = created.id;
      pollRef.current = window.setInterval(() => {
        void fetchStats(id)
          .then((stats) => dispatch({ type: 'telemetry', stats }))
          .catch(() => undefined);
      }, 800);

      await streamRun(id, { panel }, pushEvent);
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error ? error.message : '质询没能开始';
      dispatch({ type: 'sse', name: 'fatal', data: { message } });
    } finally {
      streamingRef.current = false;
      if (paceRef.current === 0) drain();
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setBusy(false);
      void refreshSessions();
      if (sessionId !== null) {
        void fetchStats(sessionId)
          .then((stats) => dispatch({ type: 'telemetry', stats }))
          .catch(() => undefined);
        void getSession(sessionId)
          .then((view) => {
            if (view.contracts.length > 0) setContracts(view.contracts);
          })
          .catch(() => undefined);
      }
    }
  }, [busy, draft, panel, pushEvent, drain, refreshSessions]);

  const handleLoadSession = useCallback(async (id: string) => {
    setBusy(true);
    setHint(null);
    try {
      const view = await getSession(id);
      setMaterial({ resumeText: view.session.resumeText, title: view.session.jobTitle });
      setDraft({ resumeText: view.session.resumeText, jdText: view.session.jdText, jobTitle: view.session.jobTitle });
      dispatch({ type: 'load', state: stateFromHistory(id, view.events, view.notices) });
      if (view.contracts.length > 0) setContracts(view.contracts);
      setHint('这是历史会话：过程由事件表重放，和当时直播看到的是同一条代码路径。');
    } catch (error) {
      setHint(error instanceof Error ? error.message : '打不开这条会话');
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDeleteSession = useCallback(
    async (id: string) => {
      try {
        await deleteSession(id);
        if (sandbox.sessionId === id) dispatch({ type: 'reset' });
        await refreshSessions();
      } catch (error) {
        setHint(error instanceof Error ? error.message : '删不掉这条会话');
      }
    },
    [sandbox.sessionId, refreshSessions],
  );

  const handleUseDemo = useCallback(() => {
    if (demo === null) {
      setHint('示例简历还没加载好，稍等一下再点。');
      return;
    }
    setDraft({ resumeText: demo.resume, jdText: demo.jd, jobTitle: demo.title });
    setHint('已填入内置示例简历。这是合成素材，刻意留了两处「经不起追问」的表述给面试官抓。');
  }, [demo]);

  const handleToggleRole = useCallback((role: InterviewerRole) => {
    setPanel((current) =>
      current.includes(role) ? current.filter((item) => item !== role) : [...current, role],
    );
  }, []);

  const handleClear = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setMaterial({ resumeText: '', title: '' });
    dispatch({ type: 'reset' });
    setHint(null);
  }, []);

  const mode = modeChip(health);
  const reportHref =
    sandbox.sessionId === null || sandbox.claims.length === 0 ? null : reportUrl(sandbox.sessionId);
  const telemetry = sandbox.telemetry;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-800 bg-ink-950/70 px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold tracking-wide text-ink-100">
            CrossExam 质询室
            <span className="ml-2 text-[12px] font-normal text-ink-400">
              多 Agent 对抗式面试沙盘 · 把简历放到火上烤一遍
            </span>
          </h1>
          <p className="text-[11px] text-ink-500">
            提问必须锚定简历原文，追问有预算上限，判定可以被代码改写，整场可以离线回放。
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Chip className={mode.className} title={health === null ? '' : health.cassetteDir}>
            {mode.text}
          </Chip>
          {telemetry === null ? null : (
            <Chip title="模型调用次数与 token（回放模式下全部来自本地卡带）">
              调用 {telemetry.calls} 次 · 回放 {telemetry.replayedCalls} · token{' '}
              {numberText(telemetry.inputTokens + telemetry.outputTokens)}
            </Chip>
          )}
          <Chip title="已呈现的事件条数">事件 {sandbox.eventCount}</Chip>
          <Chip title="实际提出的追问条数">追问 {totalProbes(sandbox)}</Chip>
          {reportHref === null ? null : (
            <a className="btn px-2.5 py-1 text-[12px]" href={reportHref} download>
              下载报告
            </a>
          )}
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 xl:grid-cols-[330px_minmax(0,1fr)_minmax(0,430px)] xl:overflow-hidden">
        <aside className="flex min-h-0 flex-col gap-3">
          <IntakePanel
            draft={draft}
            onDraftChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            panel={panel}
            onToggleRole={handleToggleRole}
            pace={pace}
            onPaceChange={setPace}
            onUseDemo={handleUseDemo}
            onRun={() => void handleRun()}
            onClear={handleClear}
            busy={busy}
            hint={hint}
            sessions={sessions}
            activeSessionId={sandbox.sessionId}
            onLoadSession={(id) => void handleLoadSession(id)}
            onDeleteSession={(id) => void handleDeleteSession(id)}
          />
          <StageRail state={sandbox} panel={panel} health={health} contracts={contracts} />
        </aside>

        <ClaimBoard state={sandbox} onFocus={(anchor) => dispatch({ type: 'focus', anchor })} />

        <ResumePane
          text={material.resumeText}
          title={material.title}
          focus={sandbox.focus}
          hits={allAnchors(sandbox)}
        />
      </main>
    </div>
  );
}
