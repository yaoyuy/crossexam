import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ApiError,
  createSession,
  deleteSession,
  fetchContracts,
  fetchDemo,
  fetchHealth,
  fetchInterviewers,
  fetchModels,
  fetchStats,
  getSession,
  importResumeFile,
  listSessions,
  reportDocUrl,
  reportHtmlUrl,
  reportUrl,
  streamRun,
} from './api.ts';
import type {
  ContractView,
  DemoInfo,
  HealthInfo,
  InterviewerLibrary,
  LlmMode,
  SessionSummary,
  SseEvent,
} from './api.ts';
import { nextPanel, PANEL_ORDER } from './contract.ts';
import { personaBlurbOf, personaLabelOf } from './labels.ts';
import { markHelpSeen, shouldAutoOpenHelp } from './help.ts';
import { applyTheme, nextTheme, readStoredTheme, saveTheme, THEME_LABEL } from './theme.ts';
import type { Theme } from './theme.ts';
import { allAnchors, initialSandbox, sandboxReducer, stateFromHistory, totalProbes } from './state.ts';
import { Chip } from './components/Bits.tsx';
import { ClaimBoard } from './components/ClaimBoard.tsx';
import { HelpPanel } from './components/HelpPanel.tsx';
import { IntakePanel } from './components/IntakePanel.tsx';
import { InterviewerStudio } from './components/InterviewerStudio.tsx';
import type { ImportNote, IntakeDraft } from './components/IntakePanel.tsx';
import { ResumePane } from './components/ResumePane.tsx';
import { StageRail } from './components/StageRail.tsx';

const EMPTY_DRAFT: IntakeDraft = { resumeText: '', jdText: '', jobTitle: '' };
const DEFAULT_PANEL: string[] = ['tech', 'hr', 'hiring_manager'];
// 慢放模式下分片的节拍：40 ms 吐 3 片，约合每秒 75 片。
// 比阶段事件（220 ms）快得多，所以字是连着出来的，而阶段仍在慢慢推进。
const STREAM_TICK_MS = 40;
const STREAM_BATCH = 3;

/** 投料台上的运行模式三选一。文案与新手教程里的模式对照表同一套口径。 */
const MODE_CHOICES: { value: LlmMode; label: string; hint: string }[] = [
  {
    value: 'replay',
    label: '离线回放',
    hint: '读仓库里已经录好的卡带，全程不联网、不需要 API Key：评委克隆下来就能跑，结果可复现。',
  },
  {
    value: 'live',
    label: '联网直连',
    hint: '真调模型，什么都不落盘：需要后端配好 LLM_BASE_URL 与 LLM_API_KEY。',
  },
  {
    value: 'record',
    label: '联网录制',
    hint: '真调模型，并把这一场的提示词与回复存成新卡带：下次就能用回放模式原样重演。',
  },
];

/** 顶部那枚 chip 说的是「这一场实际会怎么跑」，所以它看的是页面选的模式，不是服务端启动模式。 */
function modeChip(mode: LlmMode | null, health: HealthInfo | null): { text: string; className: string } {
  if (health === null || mode === null) return { text: '连接本地服务中…', className: 'opacity-70' };
  if (mode === 'replay') {
    return { text: '离线回放 · 不联网、不需要 API Key', className: 'border-mint-500/40 text-mint-400' };
  }
  if (mode === 'record') return { text: '联网录制 · 会把这一场存成卡带', className: 'border-amber-ink/40 text-amber-ink' };
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
  // 面板里存的是 id 字符串：预设是角色名，自定义是 custom-xxx，两者同一个数组
  const [panel, setPanel] = useState<string[]>(DEFAULT_PANEL);
  // 面试官库（预设 + 自建）。它决定面板上能挑谁，也决定「这一位是不是已经删了」
  const [library, setLibrary] = useState<InterviewerLibrary | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [pace, setPace] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<ImportNote | null>(null);
  const [material, setMaterial] = useState<{ resumeText: string; title: string }>({ resumeText: '', title: '' });
  const [contracts, setContracts] = useState<ContractView[] | null>(null);
  // 这一场用什么跑：默认跟随服务端启动时的模式，页面上可以逐场改。
  const [runMode, setRunMode] = useState<LlmMode>('replay');
  const [runModel, setRunModel] = useState('');
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelNote, setModelNote] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  // 第一次打开自动弹一次教程；点过「知道了」之后就不再打扰
  const [helpOpen, setHelpOpen] = useState(() => shouldAutoOpenHelp());
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

  const refreshLibrary = useCallback(async () => {
    try {
      setLibrary(await fetchInterviewers());
    } catch {
      // 面试官库拉不到不影响预设阵容：面板照旧能用，只是少了自建的那几位
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [loadedHealth, loadedDemo] = await Promise.all([fetchHealth(), fetchDemo()]);
        setHealth(loadedHealth);
        setDemo(loadedDemo);
        // 页面默认选中的模式 = 服务端当前的模式，先让两边说的是同一件事。
        setRunMode(loadedHealth.mode);
      } catch (error) {
        setHint(error instanceof Error ? error.message : '连不上本地服务，请先 npm run dev');
      }
      await Promise.all([refreshSessions(), refreshLibrary()]);
    })();
  }, [refreshSessions, refreshLibrary]);

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
        mode: runMode,
        ...(runMode === 'replay' || runModel.trim() === '' ? {} : { model: runModel.trim() }),
        // 阵容随会话落库：跑完之后再改面板，也不会把历史会话的面试官换掉
        interviewers: panel,
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
  }, [busy, draft, panel, runMode, runModel, pushEvent, drain, refreshSessions]);

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
      // 先从列表里摘掉，再发请求：这一行在请求回来之前就点了第二下的话，
      // 第二次会打到一个已经不存在的会话上（服务端如实回 404，控制台就留下一条报错）。
      setSessions((current) => current.filter((item) => item.id !== id));
      try {
        await deleteSession(id);
        if (sandbox.sessionId === id) dispatch({ type: 'reset' });
        await refreshSessions();
      } catch (error) {
        setHint(error instanceof Error ? error.message : '删不掉这条会话');
        await refreshSessions();
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

  /**
   * 从 PDF / Word / 文本导入简历：服务端解出纯文字，直接填进输入框。
   * 这里刻意不自动开跑——导入的排版常有意外，先让人看一眼再决定。
   */
  const handleImportFile = useCallback((file: File) => {
    setImportNote({ tone: 'ok', text: '正在解析「' + file.name + '」…' });
    void importResumeFile(file)
      .then((imported) => {
        setDraft((current) => ({ ...current, resumeText: imported.text }));
        const kindLabel = imported.kind === 'pdf' ? 'PDF' : imported.kind === 'docx' ? 'Word' : '文本';
        setImportNote({
          tone: 'ok',
          text:
            '已从「' + imported.name + '」解析出 ' + String(imported.chars) + ' 字（' + kindLabel + '）。' +
            imported.notes.join(''),
        });
        setHint('导入的简历只写在这台机器上，随时可以改；确认无误再点「开始质询」。');
      })
      .catch((error: unknown) => {
        setImportNote({ tone: 'error', text: error instanceof Error ? error.message : '导入失败' });
      });
  }, []);

  /**
   * 切到联网模式时才向后端要一次模型清单：默认的离线路径一个网络包都不发。
   * 后端没配好也照样给出下一步（缺哪个环境变量），而不是静默失败。
   */
  const handleRunModeChange = useCallback((mode: LlmMode) => {
    setRunMode(mode);
    setModelOptions([]);
    setModelNote(null);
    if (mode === 'replay') return;
    setModelNote('正在向后端要模型清单…');
    void fetchModels()
      .then((list) => {
        setModelOptions(list.models);
        setRunModel((current) => (current === '' ? list.defaultModel : current));
        if (!list.ready) {
          setModelNote('后端还没配好联网：缺 ' + list.missing.join('、') + '。补上 .env 里的这些变量再刷新页面。');
        } else if (list.error !== null) {
          setModelNote(list.error);
        } else if (list.models.length === 0) {
          setModelNote('后端没报错，但清单是空的：直接手填模型名即可。');
        }
      })
      .catch((error: unknown) => {
        setModelNote(error instanceof Error ? error.message : '模型清单没拉下来');
      });
  }, []);

  const handleToggleRole = useCallback((id: string) => {
    setPanel((current) => nextPanel(current, id));
  }, []);

  const handleCloseStudio = useCallback(() => setStudioOpen(false), []);

  const handleClear = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setMaterial({ resumeText: '', title: '' });
    dispatch({ type: 'reset' });
    setHint(null);
    setImportNote(null);
  }, []);

  const handleCloseHelp = useCallback(() => {
    setHelpOpen(false);
    markHelpSeen();
  }, []);

  const handleToggleTheme = useCallback(() => {
    // 只改 <html data-theme>，颜色全是 CSS 变量的事；顺手把选择记住
    setTheme((current) => {
      const next = nextTheme(current);
      applyTheme(next);
      saveTheme(next);
      return next;
    });
  }, []);

  /**
   * 面板上能挑谁：预设按固定顺序在前，自建按建库顺序在后。
   * 名字与简介一律从契约里取——自建面试官的中文名不在前端枚举里。
   */
  const interviewerChoices = useMemo(() => {
    // 库还没到（或者拉失败）时也要有预设可挑：面板不能因为一次请求而空掉。
    const byId = new Map<string, ContractView>();
    for (const view of library?.presets ?? []) byId.set(view.id, view);
    for (const view of library?.custom ?? []) byId.set(view.id, view);
    const presets = PANEL_ORDER.map((id) => {
      const view = byId.get(id);
      return {
        id,
        label: personaLabelOf(id, view?.contract.persona.name),
        blurb: personaBlurbOf(id, view?.contract.persona.blurb),
        custom: false,
      };
    });
    const custom = (library?.custom ?? []).map((view) => ({
      id: view.id,
      label: view.contract.persona.name,
      blurb: view.contract.persona.blurb,
      custom: true,
    }));
    return [...presets, ...custom];
  }, [library]);

  const missingInterviewers = useMemo(() => {
    if (library === null) return [];
    const known = interviewerChoices.map((item) => item.id);
    return panel.filter((id) => !known.includes(id));
  }, [library, interviewerChoices, panel]);

  /** 自建面试官的中文名：面板、追问列表、实时输出三处共用同一张表 */
  const interviewerName = useCallback(
    (id: string): string | undefined => {
      const found = interviewerChoices.find((item) => item.id === id);
      return found === undefined ? undefined : found.label;
    },
    [interviewerChoices],
  );

  const mode = modeChip(health === null ? null : runMode, health);
  const hasReport = sandbox.sessionId !== null && sandbox.claims.length > 0;
  const reportHref = hasReport && sandbox.sessionId !== null ? reportUrl(sandbox.sessionId) : null;
  const reportPrintHref = hasReport && sandbox.sessionId !== null ? reportHtmlUrl(sandbox.sessionId, true) : null;
  const reportDocHref = hasReport && sandbox.sessionId !== null ? reportDocUrl(sandbox.sessionId) : null;
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
          <button
            type="button"
            className="chip cursor-pointer transition-colors hover:border-ember-500 hover:text-ink-100"
            onClick={() => setHelpOpen(true)}
            title="四步上手、三种模式区别、隐私口径"
            data-shot="help-open"
          >
            新手教程
          </button>
          <button
            type="button"
            className="chip cursor-pointer transition-colors hover:border-ember-500 hover:text-ink-100"
            onClick={handleToggleTheme}
            title="切换深色 / 浅色配色，选择会记住"
            data-shot="theme"
          >
            配色 {THEME_LABEL[theme]}
          </button>
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
            <span className="flex items-center gap-1.5">
              <a className="btn px-2.5 py-1 text-[12px]" href={reportHref} download data-shot="report-md">
                报告 .md
              </a>
              <a
                className="btn px-2.5 py-1 text-[12px]"
                href={reportPrintHref ?? reportHref}
                target="_blank"
                rel="noreferrer"
                title="打开可打印的报告页并调起打印对话框，选「另存为 PDF」即可"
                data-shot="report-pdf"
              >
                报告 PDF
              </a>
              <a
                className="btn px-2.5 py-1 text-[12px]"
                href={reportDocHref ?? reportHref}
                title="同一份报告，Word 能直接打开"
                data-shot="report-doc"
              >
                报告 Word
              </a>
            </span>
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
            interviewerChoices={interviewerChoices}
            missingInterviewers={missingInterviewers}
            onOpenStudio={() => setStudioOpen(true)}
            pace={pace}
            onPaceChange={setPace}
            onUseDemo={handleUseDemo}
            onRun={() => void handleRun()}
            onClear={handleClear}
            busy={busy}
            hint={hint}
            onImportFile={handleImportFile}
            importNote={importNote}
            sessions={sessions}
            activeSessionId={sandbox.sessionId}
            onLoadSession={(id) => void handleLoadSession(id)}
            onDeleteSession={(id) => void handleDeleteSession(id)}
            runMode={runMode}
            onRunModeChange={handleRunModeChange}
            runModel={runModel}
            onRunModelChange={setRunModel}
            modeChoices={MODE_CHOICES}
            modelOptions={modelOptions}
            runModeNote={modelNote}
          />
          <StageRail state={sandbox} panel={panel} health={health} contracts={contracts} />
        </aside>

        <ClaimBoard
          state={sandbox}
          onFocus={(anchor) => dispatch({ type: 'focus', anchor })}
          interviewerName={interviewerName}
        />

        <ResumePane
          text={material.resumeText}
          title={material.title}
          focus={sandbox.focus}
          hits={allAnchors(sandbox)}
        />
      </main>

      <HelpPanel open={helpOpen} onClose={handleCloseHelp} />
      <InterviewerStudio
        open={studioOpen}
        onClose={handleCloseStudio}
        library={library}
        runMode={runMode}
        runModel={runModel}
        onChanged={() => void refreshLibrary()}
      />
    </div>
  );
}
