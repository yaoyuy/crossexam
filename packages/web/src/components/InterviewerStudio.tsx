import { useState } from 'react';
import { Note } from './Bits.tsx';
import { Icon } from './Icon.tsx';
import { deleteInterviewer, draftInterviewer, saveInterviewer } from '../api.ts';
import type {
  DraftDiff,
  DraftResult,
  InterviewerDraft,
  InterviewerEntry,
  InterviewerLibrary,
  LlmMode,
} from '../api.ts';
import { personaLabelOf } from '../labels.ts';
import { DOMAIN_HINTS, DRAFT_LIMITS, DRAFT_SEEDS, SENIORITY_LABEL, TONE_LABEL, draftProblem, emptyDraft } from '../studio.ts';

/**
 * 面试官工作室。
 *
 * 用户的原话是「要能在页面里自己设置面试官，并通过 API 对自己设置的面试官契约进行优化，
 * 要求所有专业的人都能用」。所以这里刻意不是「填一张表单」，而是三步：
 *
 * 1. 用一句人话描述你要谁（不用懂我们的字段名）；
 * 2. 让模型把它补成结构化契约，或者只用本地规则（不联网也能走通）；
 * 3. 逐字段改到满意，看清「AI 改了什么」，再存进库、进面板。
 *
 * 界面上的每个字段都对应契约里的一个字段——没有隐藏设定，也没有「高级选项」抽屉。
 *
 * P16 起把三步做成三张带编号的卡：左栏「说你要谁」、右栏「逐字段改」、底部「库里有什么」，
 * 两栏各自滚动而不把整页拉成一条长表。
 */
export function InterviewerStudio(props: {
  open: boolean;
  onClose: () => void;
  library: InterviewerLibrary | null;
  runMode: LlmMode;
  runModel: string;
  /** 存/删之后让上层重取清单（面板 chip 要跟着变） */
  onChanged: () => void;
}) {
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<InterviewerDraft>(emptyDraft());
  const [result, setResult] = useState<DraftResult | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  if (!props.open) return null;

  const problem = draftProblem(draft);
  const hasDraft = draft.name.trim().length > 0;
  const presets = props.library?.presets ?? [];
  const custom = props.library?.custom ?? [];

  const patch = (next: Partial<InterviewerDraft>): void => {
    setDraft((current) => ({ ...current, ...next }));
    setNote(null);
  };

  const setTactic = (index: number, text: string): void => {
    setDraft((current) => {
      const tactics = current.tactics.slice();
      tactics[index] = text;
      return { ...current, tactics };
    });
    setNote(null);
  };

  const addTactic = (): void => {
    setDraft((current) => {
      if (current.tactics.length >= DRAFT_LIMITS.tacticsMax) return current;
      return { ...current, tactics: [...current.tactics, ''] };
    });
  };

  const removeTactic = (index: number): void => {
    setDraft((current) => ({ ...current, tactics: current.tactics.filter((_, at) => at !== index) }));
  };

  const loadEntry = (entry: InterviewerEntry): void => {
    const contract = entry.contract;
    setDraft({
      name: contract.persona.name,
      domain: entry.domain,
      seniority: contract.persona.seniority,
      tone: contract.persona.tone,
      blurb: contract.persona.blurb,
      goal: contract.goal,
      tactics: contract.tactics.slice(),
    });
    setEditingId(entry.id);
    setResult(null);
    setDescription('');
    setNote('已载入「' + contract.persona.name + '」，改完再点保存就是更新这一位。');
    setError(null);
  };

  const handleDraft = async (useModel: boolean): Promise<void> => {
    if (description.trim().length === 0) {
      setError('先用一句话说清你要一位什么样的面试官。比如「想找一位懂医院药房流程、会追问细节的主管」。');
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const next = await draftInterviewer({
        description: description.trim(),
        before: hasDraft ? draft : undefined,
        id: editingId === null ? undefined : editingId,
        useModel,
        mode: props.runMode,
        model: props.runModel.trim().length === 0 ? undefined : props.runModel.trim(),
      });
      setDraft(next.draft);
      setResult(next);
      if (next.id.length > 0) setEditingId(next.id);
      setNote(
        next.source === 'llm'
          ? '模型已把这段描述补成契约，逐字段改到满意再保存。'
          : '这次没有走模型：' + (next.fallbackReason === null ? '你选了只用本地规则。' : next.fallbackReason),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (problem !== null) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await saveInterviewer({
        draft,
        id: editingId === null ? undefined : editingId,
        source: result === null ? undefined : result.source,
      });
      setEditingId(saved.interviewer.id);
      setNote('已保存「' + saved.interviewer.contract.persona.name + '」，它会出现在面试官面板里。');
      props.onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await deleteInterviewer(id);
      if (editingId === id) setEditingId(null);
      setNote('已删除这一位。已经跑过的会话不受影响：它们的契约冻结在会话记录里。');
      props.onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-ink-950/80 p-4 backdrop-blur-sm"
      data-shot="studio"
      role="dialog"
      aria-modal="true"
      aria-label="面试官工作室"
      onClick={props.onClose}
    >
      <section
        className="card accent-bar accent-ember my-4 w-full max-w-4xl p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex flex-wrap items-center gap-2">
          <span className="tile-ico accent-ember">
            <Icon name="users" size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold leading-tight text-ink-100">面试官工作室</h2>
            <p className="text-[11px] text-ink-500">任何行业都能配一位自己的面试官</p>
          </div>
          <button
            type="button"
            className="btn btn-quiet ml-auto px-2.5 py-1 text-[12px]"
            onClick={props.onClose}
            data-shot="studio-close"
          >
            <Icon name="x" size={14} />
            收起
          </button>
        </header>

        <p className="mt-3 text-[12px] leading-relaxed text-ink-400">
          自定义面试官和内置的五位共用同一套契约结构：人设、目标、追问手法、硬约束、禁止项。区别只在于字段由你填，或者由模型替你补。
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="card card-pad accent-bar accent-sky flex flex-col gap-2.5">
            <div className="steps">
              <span className="step step-on">
                <span className="step-num">1</span>
                第一步 · 用一句话说你要谁
              </span>
              <span className="step-line" />
            </div>
            <textarea
              className="field min-h-[84px]"
              data-shot="studio-desc"
              value={description}
              placeholder="例如：我要面一位临床护士，简历写「熟练各项护理操作」「参与多起抢救」，我想问清具体场景和职责边界。"
              onChange={(event) => setDescription(event.target.value)}
            />
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-500">不知道怎么写？挑一个例子：</span>
              <div className="flex flex-wrap gap-1.5">
                {DRAFT_SEEDS.map((seed) => (
                  <button
                    key={seed.label}
                    type="button"
                    className="chip opacity-80 transition-colors hover:border-ember-500/60 hover:text-ember-300 hover:opacity-100"
                    data-shot={'studio-seed-' + seed.label}
                    title={seed.text}
                    onClick={() => setDescription(seed.text)}
                  >
                    {seed.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className="btn btn-primary px-3 py-1.5 text-[12.5px]"
                data-shot="studio-ai"
                disabled={busy}
                onClick={() => void handleDraft(true)}
              >
                <Icon name="sparkles" size={14} />
                {busy ? '正在整理…' : '用 AI 补成契约'}
              </button>
              <button
                type="button"
                className="btn btn-quiet px-3 py-1.5 text-[12.5px]"
                data-shot="studio-local"
                disabled={busy}
                onClick={() => void handleDraft(false)}
              >
                <Icon name="shield" size={14} />
                只用本地规则（不联网）
              </button>
            </div>
            {props.runMode === 'replay' ? (
              <p className="text-[11px] leading-relaxed text-ink-500">
                当前是离线回放模式：点「用 AI 补成契约」会去查卡带，查不到就自动退回本地规则，不会偷偷联网。想真调模型，先在左边把运行模式切成联网。
              </p>
            ) : null}
            {note === null ? null : (
              <div data-shot="studio-note">
                <Note tone="info" icon="check">
                  {note}
                </Note>
              </div>
            )}
            {error === null ? null : (
              <div data-shot="studio-error">
                <Note tone="warn">{error}</Note>
              </div>
            )}
          </div>

          <div className="card card-pad accent-bar accent-violet flex flex-col gap-2.5">
            <div className="steps">
              <span className="step step-on">
                <span className="step-num">2</span>
                第二步 · 逐字段改到满意
              </span>
              <span className="step-line" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-ink-400">名称（界面上要能指名道姓）</span>
                <input className="field" data-shot="studio-name" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-ink-400">方向 / 行业</span>
                <input
                  className="field"
                  data-shot="studio-domain"
                  list="crossexam-domains"
                  value={draft.domain}
                  onChange={(event) => patch({ domain: event.target.value })}
                />
                <datalist id="crossexam-domains">
                  {DOMAIN_HINTS.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-ink-400">资历</span>
                <select className="field" data-shot="studio-seniority" value={draft.seniority} onChange={(event) => patch({ seniority: event.target.value })}>
                  {SENIORITY_LABEL.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-ink-400">语气</span>
                <select className="field" data-shot="studio-tone" value={draft.tone} onChange={(event) => patch({ tone: event.target.value })}>
                  {TONE_LABEL.map((item) => (
                    <option key={item.value} value={item.value} title={item.hint}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-400">一句话简介（显示在面试官卡片上）</span>
              <input className="field" data-shot="studio-blurb" value={draft.blurb} onChange={(event) => patch({ blurb: event.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-400">它到底要问出什么（目标）</span>
              <textarea
                className="field min-h-[64px]"
                data-shot="studio-goal"
                value={draft.goal}
                onChange={(event) => patch({ goal: event.target.value })}
              />
            </label>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-ink-400">追问手法（{String(draft.tactics.length)}/{String(DRAFT_LIMITS.tacticsMax)}）</span>
                <button type="button" className="btn btn-quiet ml-auto px-2 py-0.5 text-[11px]" data-shot="studio-add-tactic" onClick={addTactic}>
                  <Icon name="plus" size={12} />
                  加一条
                </button>
              </div>
              {draft.tactics.map((tactic, index) => (
                <div key={String(index)} className="flex items-start gap-1.5">
                  <textarea
                    className="field min-h-[40px] flex-1"
                    data-shot={'studio-tactic-' + String(index)}
                    value={tactic}
                    onChange={(event) => setTactic(index, event.target.value)}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    title="删掉这一条"
                    onClick={() => removeTactic(index)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {result === null || result.diff.length === 0 ? null : (
          <div className="mt-4 flex flex-col gap-1.5">
            <h3 className="card-title flex items-center gap-2">
              <Icon name="wand" size={15} className="text-ember-400" />
              AI 改了什么
            </h3>
            <ul className="flex flex-col gap-1">
              {result.diff.map((item: DraftDiff) => (
                <li key={item.field} className="row text-[12px]">
                  <span className="chip opacity-80">{item.field}</span>
                  <span className="text-ink-400">：{item.before.length === 0 ? '（空）' : item.before}</span>
                  <span className="text-ember-300"> → {item.after}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary px-3 py-1.5 text-[12.5px]"
            data-shot="studio-save"
            disabled={busy || problem !== null}
            title={problem ?? '存进库并出现在面板里'}
            onClick={() => void handleSave()}
          >
            <Icon name="check" size={14} />
            {editingId === null ? '存进面试官库' : '更新这一位'}
          </button>
          {editingId === null ? null : (
            <button
              type="button"
              className="btn btn-quiet px-3 py-1.5 text-[12.5px]"
              data-shot="studio-delete"
              disabled={busy}
              onClick={() => void handleDelete(editingId)}
            >
              <Icon name="trash" size={14} />
              从库里删掉
            </button>
          )}
          {problem === null ? null : <span className="text-[11.5px] text-ink-400">{problem}</span>}
          {result === null ? null : (
            <button
              type="button"
              className="btn btn-quiet ml-auto px-2.5 py-1 text-[11.5px]"
              data-shot="studio-prompt-toggle"
              onClick={() => setShowPrompt((value) => !value)}
            >
              <Icon name={showPrompt ? 'chevron-down' : 'chevron-right'} size={13} />
              {showPrompt ? '收起渲染出的 System Prompt' : '看渲染出的 System Prompt'}
            </button>
          )}
        </div>

        {result === null || !showPrompt ? null : (
          <pre
            data-shot="studio-prompt"
            className="mt-2 max-h-64 overflow-auto rounded-[10px] border border-ink-800 bg-ink-950/70 p-3 text-[11px] leading-relaxed text-ink-300"
          >
            {result.systemPrompt}
          </pre>
        )}

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <h3 className="card-title flex items-center gap-2">
              <Icon name="lock" size={15} className="text-ink-400" />
              内置面试官（只读）
            </h3>
            <ul className="flex flex-col gap-1">
              {presets.map((item) => (
                <li key={item.id} className="row text-[12px]">
                  <span className="tile-ico accent-slate">
                    <Icon name="user" size={14} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-ink-100">{personaLabelOf(item.id, item.contract.persona.name)}</span>
                    <span className="truncate text-[11px] text-ink-400">{item.contract.persona.blurb}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="card-title flex items-center gap-2">
              <Icon name="users" size={15} className="text-violet-400" />
              我配的面试官（{String(custom.length)}/{String(props.library?.limit ?? 0)}）
            </h3>
            {custom.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-ink-400">还没有。左边挑个例子点「用 AI 补成契约」，或者只用本地规则也行。</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {custom.map((entry) => (
                  <li key={entry.id} className="row text-[12px]">
                    <span className="tile-ico accent-violet">
                      <Icon name="user" size={14} />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-medium text-ink-100">{entry.contract.persona.name}</span>
                      <span className="truncate text-[11px] text-ink-400">
                        {entry.domain.length === 0 ? '未填方向' : entry.domain} · {entry.source === 'llm' ? 'AI 补全' : '本地规则'}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-quiet ml-auto px-2 py-0.5 text-[11px]"
                      data-shot={'studio-edit-' + entry.id}
                      onClick={() => loadEntry(entry)}
                    >
                      改
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="从库里删掉这位"
                      data-shot={'studio-remove-' + entry.id}
                      onClick={() => void handleDelete(entry.id)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
