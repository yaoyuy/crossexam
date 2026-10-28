import { useRef } from 'react';
import type { ReactNode } from 'react';
import { IMPORT_ACCEPT } from '../api.ts';
import type { ContractView, LlmMode } from '../api.ts';
import { budgetText, digestText } from '../contract.ts';
import { emptyJd, filledJds, jdDraftProblem, MAX_JDS } from '../jds.ts';
import type { JdDraft } from '../jds.ts';
import { Note, PageHead, SectionCard } from './Bits.tsx';
import { Icon } from './Icon.tsx';

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

/**
 * 投料台这一页：贴简历、贴 JD、挑面试官、选这一场怎么跑，然后开始质询。
 *
 * 它刻意只做「喂材料与定档位」这一件事：历史会话与跨场次统计搬去了历史页
 * （它们不是投料的一部分，摆在下面还会把「开始质询」挤出屏幕）。
 *
 * P16 起改成文档流里的五张卡：模板库（slate）／材料（sky）／面试官（violet）／
 * 这一场怎么跑（teal）／开始（ember）。原来的裸 Pane 是「一整条长长的表单」，
 * 五张卡各自带图标与一句说明之后，第一次用的人能一眼看出「这一页分几件事」。
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
  /**
   * 当前阵容第一位的契约。把预算与指纹摆在两个旋钮下面：
   * 换追问强度它会变、换改写风格它不该变——这件事要在选档的地方看得见，
   * 而不是等跑到质询台展开契约卡才发现。
   */
  contractView: ContractView | null;
  onUseDemo: () => void;
  onRun: () => void;
  onClear: () => void;
  busy: boolean;
  hint: string | null;
  onImportFile: (file: File) => void;
  importNote: ImportNote | null;
  /** 从文件导入岗位要求：一次可以选多个文件，选中的顺序就是 J1..Jn 的顺序 */
  onImportJds: (files: File[]) => void;
  jdImportNote: ImportNote | null;
}) {
  const draft = props.draft;
  const tooShort = draft.resumeText.trim().length < MIN_RESUME_CHARS;
  const jdProblem = jdDraftProblem(draft.jds);
  const jdCount = filledJds(draft.jds).length;
  const fileRef = useRef<HTMLInputElement>(null);
  const jdFileRef = useRef<HTMLInputElement>(null);

  // JD 列表的增删改都在这里算好一次，投料台不需要上层为它多长三个回调
  const setJds = (next: JdDraft[]) => props.onDraftChange({ jds: next });
  const changeJd = (index: number, patch: Partial<JdDraft>) =>
    setJds(draft.jds.map((jd, at) => (at === index ? { ...jd, ...patch } : jd)));

  return (
    <div className="flex flex-col gap-3" data-shot="intake">
      <PageHead
        icon="intake"
        accent="sky"
        title="投料台"
        sub="简历 + 目标岗位：贴材料、挑面试官、定这一场的档位，然后开始质询"
        actions={
          <>
            <button
              type="button"
              data-shot="use-demo"
              className="btn px-2.5 py-1 text-[12px]"
              onClick={props.onUseDemo}
            >
              <Icon name="rocket" size={14} />
              一键示例
            </button>
            <button
              type="button"
              data-shot="clear"
              className="btn btn-quiet px-2.5 py-1 text-[12px] text-ink-400"
              onClick={props.onClear}
            >
              <Icon name="trash" size={14} />
              清空
            </button>
          </>
        }
      />

      <SectionCard
        title="岗位模板库"
        desc="不熟悉这个行业也能十秒上手：点一下就把 JD、示例简历与面试官阵容一起装好。"
        icon="book"
        accent="slate"
        dataShot="intake-templates"
      >
        {props.templatePicker}
      </SectionCard>

      <SectionCard
        title="简历与目标岗位"
        desc="贴一份简历、配 1–8 份岗位要求：所有提问与判定都会被锚定到这里的原文区间。"
        icon="clipboard"
        accent="sky"
        actions={
          <>
            <span className="text-[11px] text-ink-500">{draft.resumeText.length} 字</span>
            <button
              type="button"
              data-shot="import"
              title={'支持 ' + IMPORT_ACCEPT + '，单个文件不超过 8 MB；文件只在本机解析，不入库'}
              className="btn btn-quiet px-2 py-1 text-[11.5px]"
              disabled={props.busy}
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="file" size={13} />
              从文件导入
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-400">简历正文</span>
            <textarea
              className="field"
              rows={7}
              value={draft.resumeText}
              placeholder="把简历正文贴进来，或点右上角「从文件导入」选一份 PDF / Word。所有提问与判定都会被锚定到这里的原文区间。"
              onChange={(event) => props.onDraftChange({ resumeText: event.target.value })}
            />
          </label>
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

          {/*
            目标岗位：1–8 份。做成列表而不是单个输入框，是为了让「同一份简历投不同岗位」
            变成一件可以摆在一起看的事——交叉出现的要求会被归并成一条，只在一份里出现的
            就只属于那一份。
          */}
          <hr className="divider" />

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-ink-300">
              {"目标岗位 JD（1–" + String(MAX_JDS) + " 份，可只贴一份）"}
            </span>
            <span className="chip opacity-80">{jdCount === 0 ? "还没贴" : "已填 " + String(jdCount) + " 份"}</span>
            <span className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                data-shot="jd-import"
                title={'一次可选多份，支持 ' + IMPORT_ACCEPT + '；文件只在本机解析、不入库，标题默认取文件名'}
                className="btn btn-quiet px-2 py-0.5 text-[11px]"
                disabled={props.busy || jdCount >= MAX_JDS}
                onClick={() => jdFileRef.current?.click()}
              >
                <Icon name="file" size={12} />
                从文件导入
              </button>
              <button
                type="button"
                data-shot="jd-add"
                className="btn btn-quiet px-2 py-0.5 text-[11px]"
                disabled={props.busy || draft.jds.length >= MAX_JDS}
                title="再多贴一份 JD：面试官会把几份里的要求放在一起看"
                onClick={() => setJds([...draft.jds, emptyJd()])}
              >
                <Icon name="plus" size={12} />
                再加一份
              </button>
            </span>
          </div>

          {draft.jds.map((jd, index) => (
            <div
              key={String(index)}
              data-shot={"jd-row-" + String(index + 1)}
              className="flex flex-col gap-1.5 rounded-[10px] border border-ink-800 bg-ink-850/30 p-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="badge badge-sky">{'第 ' + String(index + 1) + ' 份'}</span>
                <span className="text-[11px] text-ink-500">{String(jd.text.length) + " 字"}</span>
                {draft.jds.length <= 1 ? null : (
                  <button
                    type="button"
                    data-shot={"jd-remove-" + String(index + 1)}
                    className="icon-btn ml-auto"
                    title="删掉这份 JD"
                    onClick={() => setJds(draft.jds.filter((_, at) => at !== index))}
                  >
                    <Icon name="trash" size={14} />
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
          <input
            ref={jdFileRef}
            data-shot="jd-import-file"
            type="file"
            multiple
            accept={IMPORT_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              // 清掉 value：同一批文件连选两次也要能再触发一次 change
              event.target.value = '';
              if (files.length > 0) props.onImportJds(files);
            }}
          />
          {props.jdImportNote === null ? null : (
            <p
              data-shot="jd-import-note"
              className={
                'text-[11px] leading-relaxed ' +
                (props.jdImportNote.tone === 'ok' ? 'text-mint-400' : 'text-rose-ink')
              }
            >
              {props.jdImportNote.text}
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-400">岗位名称（可留空）</span>
            <input
              className="field"
              value={draft.jobTitle}
              placeholder="例如：高级后端工程师"
              onChange={(event) => props.onDraftChange({ jobTitle: event.target.value })}
            />
          </label>
        </div>
      </SectionCard>

      <SectionCard
        title="面试官面板"
        desc="默认三位，可增减：同一套契约为准，加一位自己行业的面试官也不用懂技术。"
        icon="users"
        accent="violet"
        actions={
          <button
            type="button"
            className="btn btn-quiet px-2 py-1 text-[11.5px]"
            data-shot="open-studio"
            title="配一位自己行业的面试官：不用懂技术，用一句话描述就行"
            onClick={props.onOpenStudio}
          >
            <Icon name="wand" size={13} />
            配置面试官
          </button>
        }
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {props.interviewerChoices.map((choice) => {
              const selected = props.panel.includes(choice.id);
              return (
                <button
                  key={choice.id}
                  type="button"
                  data-shot={'role-' + choice.id}
                  title={choice.blurb}
                  className={
                    'chip ' +
                    (selected
                      ? 'border-violet-500/50 bg-violet-500/12 text-violet-400'
                      : 'opacity-70 hover:opacity-100')
                  }
                  onClick={() => props.onToggleRole(choice.id)}
                >
                  {selected ? <Icon name="check" size={12} /> : null}
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
      </SectionCard>

      {/*
        运行模式：回放是默认路径（不联网、可复现），联网两种要显式选。
        模型名用 input + datalist：既能下拉挑，也能直接手填——
        很多自建网关不提供 /models，手填必须是能走通的那条路。
      */}
      <SectionCard
        title="这一场怎么跑"
        desc="先选运行模式，再定追问强度与改写风格：换强度会换契约指纹，换风格不会。"
        icon="zap"
        accent="teal"
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-ink-400">运行模式（这一场用什么跑）</span>
            <div className="seg self-start" role="group" aria-label="运行模式">
              {props.modeChoices.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  data-shot={'mode-' + choice.value}
                  title={choice.hint}
                  className={props.runMode === choice.value ? 'seg-on' : undefined}
                  onClick={() => props.onRunModeChange(choice.value)}
                >
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

          <hr className="divider" />

          {/*
            追问强度：三档**只有预算不同**——人设、手法、禁止项一个字都不改。
            这样「同一位面试官、同一份简历，只是问得更狠」才是可比的变量。
            预算写在渲染出的 system prompt 里，所以换档就是换契约指纹，界面上能看到它跟着变。
          */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-ink-400">追问强度（问多深）</span>
            <div className="seg self-start" role="group" aria-label="追问强度">
              {props.difficultyChoices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  data-shot={'difficulty-' + choice.id}
                  title={choice.hint}
                  className={props.difficulty === choice.id ? 'seg-on' : undefined}
                  onClick={() => props.onDifficultyChange(choice.id)}
                >
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
            <div className="seg self-start" role="group" aria-label="改写风格">
              {props.styleChoices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  data-shot={'style-' + choice.id}
                  title={choice.hint}
                  className={props.style === choice.id ? 'seg-on' : undefined}
                  onClick={() => props.onStyleChange(choice.id)}
                >
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

          {props.contractView === null ? null : (
            <div className="flex flex-col gap-1 rounded-[10px] border border-ink-800 bg-ink-850/40 px-2.5 py-2">
              <span className="flex items-center gap-1.5 text-[11px] text-ink-400">
                <Icon name="shield" size={13} className="text-teal-400" />
                这一档的契约（换追问强度会跟着换，换改写风格不会）
              </span>
              <p data-shot="intake-contract" className="text-[11px] leading-relaxed text-ink-300">
                {budgetText(props.contractView) + ' · 指纹 ' + digestText(props.contractView.digest)}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-ink-400">播放节奏</span>
            <div className="seg self-start" role="group" aria-label="播放节奏">
              {PACE_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  data-shot={choice.value === 0 ? 'pace-instant' : 'pace-slow'}
                  title={choice.hint}
                  className={props.pace === choice.value ? 'seg-on' : undefined}
                  onClick={() => props.onPaceChange(choice.value)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="开始这一场"
        desc="材料够了就开跑：每个会话只跑一次，想换面试官或改简历，直接再点一次就是新的一场。"
        icon="play"
        accent="ember"
      >
        <div className="flex flex-col gap-2">
          <button
            type="button"
            data-shot="run"
            className="btn btn-primary w-full py-2.5 text-[14px]"
            disabled={props.busy || tooShort || jdProblem !== null || props.panel.length === 0}
            onClick={props.onRun}
          >
            <Icon name="play" size={16} />
            {props.busy ? '质询中…' : '开始质询'}
          </button>
          {tooShort || jdProblem !== null ? (
            <Note tone="warn">
              {tooShort
                ? '简历太短了：至少 ' + String(MIN_RESUME_CHARS) + ' 个字符，才有东西可追问。'
                : jdProblem}
            </Note>
          ) : props.hint === null ? (
            <p className="text-[11px] leading-relaxed text-ink-400">
              {'每个会话只跑一次：想换面试官或改简历，直接再点一次「开始质询」，会新建一场。'}
            </p>
          ) : (
            <Note tone="info">{props.hint}</Note>
          )}
        </div>
      </SectionCard>
    </div>
  );
}