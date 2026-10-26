import { useRef } from 'react';
import { PERSONA_BLURB, PERSONA_LABEL, SESSION_STATUS_LABEL } from '../labels.ts';
import { PANEL_ORDER } from '../contract.ts';
import { IMPORT_ACCEPT } from '../api.ts';
import type { InterviewerRole, SessionSummary } from '../api.ts';
import { Chip, Pane } from './Bits.tsx';

export interface IntakeDraft {
  resumeText: string;
  jdText: string;
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
  panel: InterviewerRole[];
  onToggleRole: (role: InterviewerRole) => void;
  pace: number;
  onPaceChange: (pace: number) => void;
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
  const fileRef = useRef<HTMLInputElement>(null);

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

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-400">目标岗位 JD</span>
        <textarea
          className="field"
          rows={4}
          value={draft.jdText}
          placeholder="贴岗位描述，面试官会据此决定往哪个方向追问。"
          onChange={(event) => props.onDraftChange({ jdText: event.target.value })}
        />
      </label>

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
        <span className="text-[11px] text-ink-400">面试官面板（默认三位，可增减）</span>
        <div className="flex flex-wrap gap-1.5">
          {PANEL_ORDER.map((role) => {
            const selected = props.panel.includes(role);
            return (
              <button
                key={role}
                type="button"
                title={PERSONA_BLURB[role]}
                className={'chip ' + (selected ? 'border-ember-500/50 text-ember-300' : 'opacity-70')}
                onClick={() => props.onToggleRole(role)}
              >
                {selected ? '\u2713 ' : ''}
                {PERSONA_LABEL[role]}
              </button>
            );
          })}
        </div>
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
        disabled={props.busy || tooShort || props.panel.length === 0}
        onClick={props.onRun}
      >
        {props.busy ? '质询中…' : '开始质询'}
      </button>
      <p className="text-[11px] leading-relaxed text-ink-400">
        {tooShort
          ? '简历太短了：至少 ' + String(MIN_RESUME_CHARS) + ' 个字符，才有东西可追问。'
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
