import { useRef } from 'react';
import type { ReactNode } from 'react';
import { SESSION_STATUS_LABEL } from '../labels.ts';
import { IMPORT_ACCEPT } from '../api.ts';
import type { LlmMode, SessionSummary } from '../api.ts';
import { emptyJd, filledJds, jdDraftProblem, MAX_JDS } from '../jds.ts';
import type { JdDraft } from '../jds.ts';
import { Chip, Pane } from './Bits.tsx';

export interface IntakeDraft {
  resumeText: string;
  /** 目标岗位：1–8 份，整行留空的行不算一份 */
  jds: JdDraft[];
  jobTitle: string;
}

export const MIN_RESUME_CHARS = 30;

/** 导入结果提示：成功是绿的，失败是红的，都直接把服务端的话摊出来。 */
export interface ImportNote {
  tone: 'ok' | 'error';
  text: string;
}

export const PACE_CHOICES: { value: number; label: string; hint: string }[] = [
  { value: 0, label: '即时', hint: '事件来了就画，回放模式下整场不到一秒' },
  { value: 220, label: '慢放', hint: '按 220 毫秒一条播放，录演示视频时看得清过程；不改变任何结果' },
];

function shortId(id: string): string {
  return id.length <= 10 ? id : id.slice(0, 10);
}

/**
 * 左栏投料台：贴简历、贴 JD、挑面试官、开始质询。
 * 顺带把历史会话列在这里——评委复现时可以点开我们录好的那一场，不必自己跑。
 */
export function IntakePanel(props: {
  draft: IntakeDraft;
  onDraftChange: (patch: Partial<IntakeDraft>) => void;
  /** 这一场在场的面试官 id：预设是角色名，自定义是 custom-xxx */
  panel: string[];
  onToggleRole: (id: string) => void;
  /**
   * 面板上能挑的面试官。预设在前、自定义在后，由上层从契约算好——
   * 组件不该知道「有哪几位」这件事，否则加一位自定义面试官就要改两个文件。
   */
  interviewerChoices: { id: string; label: string; blurb: string; custom: boolean }[];
  /** 面板里躺着但库里已经没有的 id（面试官被删了），要指名道姓地提示 */
  missingInterviewers: string[];
  onOpenStudio: () => void;
  /**
   * 投料台最上方的岗位模板选择器。做成一个 ReactNode 而不是七八个 props：
   * 投料台不需要知道模板从哪来、怎么算，组装的事留给上层。
   */
  templatePicker: ReactNode;
  pace: number;
  onPaceChange: (pace: number) => void;
  /** 这一场用什么跑：离线回放 / 联网直连 / 联网录制 */
  runMode: LlmMode;
  onRunModeChange: (mode: LlmMode) => void;
  runModel: string;
  onRunModelChange: (value: string) => void;
  modeChoices: { value: LlmMode; label: string; hint: string }[];
  /** 模型下拉的候选（来自后端 /api/models）；空数组表示只能手填 */
  modelOptions: string[];
  /** 联网相关的一句提示：缺哪个环境变量、或清单为什么是空的 */
  runModeNote: string | null;
  /** 追问强度：gentle / normal / hard，由服务端给的清单决定有哪几档 */
  difficulty: string;
  difficultyChoices: { id: string; label: string; hint: string }[];
  onDifficultyChange: (id: string) => void;
  /** 改写风格：conservative / normal / bold，清单同样由服务端给 */
  style: string;
  styleChoices: { id: string; label: string; hint: string }[];
  onStyleChange: (id: string) => void;
  onUseDemo: () => void;
  onRun: () => void;
  onClear: () => void;
  busy: boolean;
  hint: string | null;
  onImportFile: (file: File) => void;
  importNote: ImportNote | null;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onLoadSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}) {
  const draft = props.draft;
  const tooShort = draft.resumeText.trim().length < MIN_RESUME_CHARS;
  const jdProblem = jdDraftProblem(draft.jds);
  const jdCount = filledJds(draft.jds).length;
  const fileRef = useRef<HTMLInputElement>(null);

  // JD 列表的增删改都在这里算好一次，投料台不需要上层为它多长三个回调
  const setJds = (next: JdDraft[]) => props.onDraftChange({ jds: next });
  const changeJd = (index: number, patch: Partial<JdDraft>) =>
    setJds(draft.jds.map((jd, at) => (at === index ? { ...jd, ...patch } : jd)));

  return (
    <Pane
      title="投料台"
      subtitle="简历 + 目标岗位"
      dataShot="intake"
      actions={
        <>
          <button type="button" data-shot="use-demo" className="btn btn-quiet px-2 py-1 text-[12px]" onClick={props.onUseDemo}>
            一键示例
          </button>
          <button type="button" className="btn btn-quiet px-2 py-1 text-[12px]" onClick={props.onClear}>
            清空
          </button>
        </>
      }
      bodyClassName="flex flex-col gap-3 p-3"
      className="max-h-[60vh] xl:max-h-[46vh]"
    >
      {props.templatePicker}

      <div className="flex flex-col gap-1">
        <span className="flex items-center justify-between gap-2 text-[11px] text-ink-400">
          <span>简历正文</span>
          <span className="flex items-center gap-1.5">
            <span>{draft.resumeText.length} 字</span>
            <button
              type="button"
              data-shot="import"
              title={'支持 ' + IMPORT_ACCEPT + '，单个文件不超过 8 MB；文件只在本机解析，不入库'}
              className="btn btn-quiet px-1.5 py-0.5 text-[11px]"
              disabled={props.busy}
              onClick={() => fileRef.current?.click()}
            >
              从文件导入
            </button>
          </span>
        </span>
        <textarea
          className="field"
          rows={7}
          value={draft.resumeText}
          placeholder="把简历正文贴进来，或点右上角「从文件导入」选一份 PDF / Word。所有提问与判定都会被锚定到这里的原文区间。"
          onChange={(event) => props.onDraftChange({ resumeText: event.target.value })}
        />
        <input
          ref={fileRef}
          data-shot="import-file"
          type="file"
          accept={IMPORT_ACCEPT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // 清掉 value：同一个文件连选两次也要能再触发一次 change
            event.target.value = '';
            if (file !== undefined) props.onImportFile(file);
          }}
        />
        {props.importNote === null ? null : (
          <p
            data-shot="import-note"
            className={
              'text-[11px] leading-relaxed ' + (props.importNote.tone === 'ok' ? 'text-mint-400' : 'text-rose-ink')
            }
          >
            {props.importNote.text}
          </p>
        )}
      </div>

      {/*
        目标岗位：1–8 份。做成列表而不是单个输入框，是为了让「同一份简历投不同岗位」
        变成一件可以摆在一起看的事——交叉出现的要求会被归并成一条，只在一份里出现的
        就只属于那一份。
      */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-ink-400">
            {"目标岗位 JD（1–" + String(MAX_JDS) + " 份，可只贴一份）"}
          </span>
          <span className="text-[11px] text-ink-500">{jdCount === 0 ? "还没贴" : "已填 " + String(jdCount) + " 份"}</span>
          <button
            type="button"
            data-shot="jd-add"
            className="btn btn-quiet ml-auto px-2 py-0.5 text-[11px]"
            disabled={props.busy || draft.jds.length >= MAX_JDS}
            title="再多贴一份 JD：面试官会把几份里的要求放在一起看"
            onClick={() => setJds([...draft.jds, emptyJd()])}
          >
            + 再加一份
          </button>
        </div>
        {draft.jds.map((jd, index) => (
          <div
            key={String(index)}
            data-shot={"jd-row-" + String(index + 1)}
            className="flex flex-col gap-1.5 rounded-xl border border-ink-800 bg-ink-900/30 p-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-400">{"第 " + String(index + 1) + " 份"}</span>
              <span className="text-[11px] text-ink-500">{String(jd.text.length) + " 字"}</span>
              {draft.jds.length <= 1 ? null : (
                <button
                  type="button"
                  data-shot={"jd-remove-" + String(index + 1)}
                  className="ml-auto px-1 text-[11px] text-ink-500 hover:text-rose-ink"
                  onClick={() => setJds(draft.jds.filter((_, at) => at !== index))}
                >
                  删掉
                </button>
              )}
            </div>
            <input
              className="field"
              data-shot={"jd-title-" + String(index + 1)}
              value={jd.title}
              placeholder="岗位名称（可留空，默认取 JD 第一行）"
              onChange={(event) => changeJd(index, { title: event.target.value })}
            />
            <textarea
              className="field"
              rows={4}
              data-shot={"jd-text-" + String(index + 1)}
              value={jd.text}
              placeholder="贴岗位描述：硬性要求、加分项、岗位职责……面试官会照着这里的原文追问，并注明是哪一条要求。"
              onChange={(event) => changeJd(index, { text: event.target.value })}
            />
          </div>
        ))}
        {jdProblem === null ? null : (
          <p data-shot="jd-problem" className="text-[11px] leading-relaxed text-amber-ink">
            {jdProblem}
          </p>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-400">岗位名称（可留空）</span>
        <input
          className="field"
          value={draft.jobTitle}
          placeholder="例如：高级后端工程师"
          onChange={(event) => props.onDraftChange({ jobTitle: event.target.value })}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-ink-400">面试官面板（默认三位，可增减）</span>
          <button
            type="button"
            className="btn btn-quiet ml-auto px-2 py-0.5 text-[11px]"
            data-shot="open-studio"
            title="配一位自己行业的面试官：不用懂技术，用一句话描述就行"
            onClick={props.onOpenStudio}
          >
            配置面试官
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {props.interviewerChoices.map((choice) => {
            const selected = props.panel.includes(choice.id);
            return (
              <button
                key={choice.id}
                type="button"
                data-shot={'role-' + choice.id}
                title={choice.blurb}
                className={'chip ' + (selected ? 'border-ember-500/50 text-ember-300' : 'opacity-70')}
                onClick={() => props.onToggleRole(choice.id)}
              >
                {selected ? '\u2713 ' : ''}
                {choice.label}
                {choice.custom ? ' ·自建' : ''}
              </button>
            );
          })}
        </div>
        {props.missingInterviewers.length === 0 ? null : (
          <p data-shot="panel-missing" className="text-[11px] leading-relaxed text-amber-ink">
            面板里有 {props.missingInterviewers.join('、')}，但它们已经从面试官库里删掉了。点掉它们，或者去工作室重建一位。
          </p>
        )}
      </div>

      {/*
        运行模式：回放是默认路径（不联网、可复现），联网两种要显式选。
        模型名用 input + datalist：既能下拉挑，也能直接手填——
        很多自建网关不提供 /models，手填必须是能走通的那条路。
      */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-ink-400">运行模式（这一场用什么跑）</span>
        <div className="flex flex-wrap gap-1.5">
          {props.modeChoices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              data-shot={'mode-' + choice.value}
              title={choice.hint}
              className={'chip ' + (props.runMode === choice.value ? 'border-ember-500/50 text-ember-300' : 'opacity-70')}
              onClick={() => props.onRunModeChange(choice.value)}
            >
              {props.runMode === choice.value ? '\u2713 ' : ''}
              {choice.label}
            </button>
          ))}
        </div>
        {props.runMode === 'replay' ? (
          <p data-shot="mode-note" className="text-[11px] leading-relaxed text-ink-500">
            {props.modeChoices.find((item) => item.value === 'replay')?.hint}
          </p>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-400">
              模型名{props.modelOptions.length === 0 ? '（手填）' : ''}
            </span>
            <input
              className="field"
              data-shot="model-input"
              list="crossexam-models"
              value={props.runModel}
              placeholder="例如 deepseek-chat；留空就用后端的 LLM_MODEL"
              onChange={(event) => props.onRunModelChange(event.target.value)}
            />
            <datalist id="crossexam-models">
              {props.modelOptions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {props.runModeNote === null ? null : (
              <p data-shot="mode-note" className="text-[11px] leading-relaxed text-amber-ink">
                {props.runModeNote}
              </p>
            )}
          </label>
        )}
      </div>

      {/*
        追问强度：三档**只有预算不同**——人设、手法、禁止项一个字都不改。
        这样「同一位面试官、同一份简历，只是问得更狠」才是可比的变量。
        预算写在渲染出的 system prompt 里，所以换档就是换契约指纹，界面上能看到它跟着变。
      */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-ink-400">追问强度（问多深）</span>
        <div className="flex flex-wrap gap-1.5">
          {props.difficultyChoices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              data-shot={'difficulty-' + choice.id}
              title={choice.hint}
              className={'chip ' + (props.difficulty === choice.id ? 'border-ember-500/50 text-ember-300' : 'opacity-70')}
              onClick={() => props.onDifficultyChange(choice.id)}
            >
              {props.difficulty === choice.id ? '\u2713 ' : ''}
              {choice.label}
            </button>
          ))}
        </div>
        {props.difficultyChoices.length === 0 ? null : (
          <p data-shot="difficulty-note" className="text-[11px] leading-relaxed text-ink-500">
            {
              (props.difficultyChoices.find((item) => item.id === props.difficulty) ?? props.difficultyChoices[0])
                ?.hint ?? ''
            }
          </p>
        )}
      </div>

      {/*
        改写风格：只改「建议改得多狠」，不改判定，也不改三条铁律（不许造数字、
        不许把参与写成主导、改前必须锚得回原文）。它不进契约指纹——契约描述谁在问，
        风格描述改得多狠——但会写进改写阶段的提示词，所以换档就是换卡带。
      */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-ink-400">改写风格（改多狠）</span>
        <div className="flex flex-wrap gap-1.5">
          {props.styleChoices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              data-shot={'style-' + choice.id}
              title={choice.hint}
              className={'chip ' + (props.style === choice.id ? 'border-ember-500/50 text-ember-300' : 'opacity-70')}
              onClick={() => props.onStyleChange(choice.id)}
            >
              {props.style === choice.id ? '\u2713 ' : ''}
              {choice.label}
            </button>
          ))}
        </div>
        {props.styleChoices.length === 0 ? null : (
          <p data-shot="style-note" className="text-[11px] leading-relaxed text-ink-500">
            {
              (props.styleChoices.find((item) => item.id === props.style) ?? props.styleChoices[0])
                ?.hint ?? ''
            }
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-ink-400">播放节奏</span>
        <div className="flex flex-wrap gap-1.5">
          {PACE_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              data-shot={choice.value === 0 ? 'pace-instant' : 'pace-slow'}
              title={choice.hint}
              className={'chip ' + (props.pace === choice.value ? 'border-ember-500/50 text-ember-300' : 'opacity-70')}
              onClick={() => props.onPaceChange(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        data-shot="run"
        className="btn btn-primary w-full"
        disabled={props.busy || tooShort || jdProblem !== null || props.panel.length === 0}
        onClick={props.onRun}
      >
        {props.busy ? '质询中…' : '开始质询'}
      </button>
      <p className="text-[11px] leading-relaxed text-ink-400">
        {tooShort
          ? '简历太短了：至少 ' + String(MIN_RESUME_CHARS) + ' 个字符，才有东西可追问。'
          : jdProblem !== null
            ? jdProblem
            : props.hint ?? '每个会话只跑一次：想换面试官或改简历，直接再点一次「开始质询」，会新建一场。'}
      </p>

      <div className="flex flex-col gap-1.5 border-t border-ink-800 pt-2.5">
        <span className="text-[11px] text-ink-400">历史会话 {props.sessions.length === 0 ? '' : '(' + String(props.sessions.length) + ')'}</span>
        {props.sessions.length === 0 ? (
          <p className="text-[11.5px] text-ink-500">还没有跑过。跑完一场就会出现在这里，可以随时翻回来重看过程。</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {props.sessions.map((session) => (
              <li
                key={session.id}
                className={
                  'flex items-center gap-2 rounded-lg border px-2 py-1.5 ' +
                  (session.id === props.activeSessionId ? 'border-ember-500/40 bg-ember-500/5' : 'border-ink-800 bg-ink-850/50')
                }
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => props.onLoadSession(session.id)}
                >
                  <span className="block truncate text-[12px] text-ink-100">{session.jobTitle}</span>
                  <span className="block truncate font-mono text-[10.5px] text-ink-500">
                    {shortId(session.id)} · {session.llmMode}
                  </span>
                </button>
                <Chip>{SESSION_STATUS_LABEL[session.status] ?? session.status}</Chip>
                <button
                  type="button"
                  title="删除这一场"
                  className="px-1 text-[13px] text-ink-500 hover:text-rose-ink"
                  onClick={() => props.onDeleteSession(session.id)}
                >
                  {'\u00d7'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Pane>
  );
}
