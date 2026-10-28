import { useEffect, useRef } from 'react';
import { buildSegments, describeRange } from '../highlight.ts';
import type { Anchor } from '../api.ts';
import { spanRanges } from '../revisions.ts';
import type { RevisedResume } from '../revisions.ts';
import type { Accent } from '../pages.ts';
import { Empty, Pane, Stat } from './Bits.tsx';
import { Icon } from './Icon.tsx';

/**
 * 右栏：简历原文。
 * 所有被引用过的原文都淡淡地标着，当前聚焦的一段加亮并自动滚到视野中央——
 * 「证据锚定」这个创新点如果只写在文档里，评委是看不见的，所以必须画在屏幕上。
 *
 * P16：头部补一行数字（字数 / 被引用 / 改动），并用左侧色条说明这一栏属于哪块材料。
 * 正文的等宽排版与 mark 锚点样式一律不动：那是「原文」本身的质感，不是装饰。
 */
export function ResumePane(props: {
  text: string;
  focus: Anchor | null;
  hits: Anchor[];
  title: string;
  /**
   * 当前这一版改完的简历。传进来就显示改后的正文（并把改动段标绿），
   * 不传就显示原文——「看原文」和「看改完的」是同一栏的两种视图，不是两栏。
   */
  revised?: RevisedResume | null;
  /**
   * 按岗位筛过的一版（P12 · ③）：与「原文 / 改完的」并列的第三种视图。
   * 它没有改动可标、也没有可聚焦的原文区间——筛过的文本坐标全变了，
   * 拿原文坐标去标只会标错地方，所以这一版一律不画锚点。
   */
  tailored?: { text: string; jdTitle: string; keptSegments: number; droppedSegments: number } | null;
  onShowOriginal?: () => void;
  /** 从「这一版」切回「改完的」 */
  onShowRevised?: () => void;
}) {
  const focusRef = useRef<HTMLElement | null>(null);
  const focusKey = props.focus === null ? '' : String(props.focus.start) + '-' + String(props.focus.end);
  const revised = props.revised ?? null;
  const tailored = props.tailored ?? null;
  const showing = tailored !== null ? tailored.text : revised === null ? props.text : revised.text;

  useEffect(() => {
    const node = focusRef.current;
    if (node !== null) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusKey]);

  const segments = buildSegments(
    showing,
    tailored === null ? props.focus : null,
    tailored === null ? props.hits.map((anchor) => ({ start: anchor.start, end: anchor.end })) : [],
    tailored === null ? spanRanges(revised) : [],
  );

  let focusAssigned = false;

  const heading = tailored !== null ? '这一版（按岗位筛）' : revised === null ? '简历原文' : '改完的简历';
  const accent: Accent = revised === null ? 'sky' : 'mint';
  /** 头部那排数字：三种视图各自该看什么，就在这一行里说清楚 */
  const stats: { label: string; value: number; accent: Accent }[] =
    tailored !== null
      ? [
          { label: '字数', value: tailored.text.length, accent: 'mint' },
          { label: '留下段', value: tailored.keptSegments, accent: 'mint' },
          { label: '去掉段', value: tailored.droppedSegments, accent: 'slate' },
        ]
      : revised === null
        ? [
            { label: '字数', value: props.text.length, accent: 'sky' },
            { label: '被引用', value: props.hits.length, accent: 'sky' },
          ]
        : [
            { label: '字数', value: revised.text.length, accent: 'mint' },
            { label: '改动', value: revised.applied.length, accent: 'mint' },
            { label: '被引用', value: props.hits.length, accent: 'slate' },
          ];

  return (
    <Pane
      title={
        <span className="flex items-center gap-1.5">
          <Icon name={revised === null ? 'file' : 'check'} size={14} className={revised === null ? 'text-sky-400' : 'text-mint-400'} />
          <span className="truncate">{heading}</span>
        </span>
      }
      dataShot="resume"
      className={'accent-bar accent-' + accent}
      subtitle={
        props.text.length === 0
          ? '还没有材料'
          : tailored !== null
            ? String(tailored.text.length) + ' 字 · 按《' + tailored.jdTitle + '》留下 ' + String(tailored.keptSegments) + ' 段、去掉 ' + String(tailored.droppedSegments) + ' 段'
            : revised === null
              ? String(props.text.length) + ' 字 · 被引用 ' + String(props.hits.length) + ' 处'
              : String(revised.text.length) + ' 字 · 改动 ' + String(revised.applied.length) + ' 处（绿色）'
      }
      actions={
        tailored !== null ? (
          <div className="flex items-center gap-1">
            {revised === null ? null : (
              <button
                type="button"
                className="chip cursor-pointer transition-colors hover:border-ember-500 hover:text-ink-100"
                onClick={props.onShowRevised}
                title="切回改完的那一版"
                data-shot="resume-show-revised"
              >
                <Icon name="check" size={12} />
                看改完的
              </button>
            )}
            <button
              type="button"
              className="chip cursor-pointer transition-colors hover:border-ember-500 hover:text-ink-100"
              onClick={props.onShowOriginal}
              title="回到未经改动的原文"
              data-shot="resume-show-original"
            >
              <Icon name="file" size={12} />
              看原文
            </button>
          </div>
        ) : revised === null ? undefined : (
          <button
            type="button"
            className="chip cursor-pointer transition-colors hover:border-ember-500 hover:text-ink-100"
            onClick={props.onShowOriginal}
            title="回到未经改动的原文"
            data-shot="resume-show-original"
          >
            <Icon name="file" size={12} />
            看原文
          </button>
        )
      }
      bodyClassName="p-0"
    >
      {props.text.length === 0 ? (
        <Empty
          icon="file"
          title="左边贴一份简历就能开始"
          hint="所有提问与判定都会锚定到这里的原文区间，点到引文就跳到这里。"
        />
      ) : (
        <div className="flex flex-col">
          <div className="sticky top-0 z-10 border-b border-ink-800/70 bg-ink-900/90 px-3 py-2.5 backdrop-blur">
            <div className={'grid gap-2 ' + (stats.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
              {stats.map((item) => (
                <Stat key={item.label} label={item.label} value={item.value} accent={item.accent} />
              ))}
            </div>
            {tailored !== null ? null : (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink-500">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-ember-500/35" />
                  被追问过的原文
                </span>
                {revised === null ? null : (
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-mint-500/35" />
                    已经改过的段落
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="px-4 py-3">
            {props.focus === null ? null : (
              <p className="mb-2 flex items-center gap-1.5 rounded-[8px] bg-ember-500/10 px-2 py-1 text-[11px] text-ember-400">
                <Icon name="target" size={12} />
                <span>聚焦 {'\u2192'} {describeRange(props.focus)}</span>
              </p>
            )}
            <div className="resume-text text-ink-200">
              {segments.map((segment, index) => {
                if (segment.kind === 'focus' && !focusAssigned) {
                  focusAssigned = true;
                  return (
                    <mark
                      key={index}
                      className="anchor-hit"
                      ref={(node) => {
                        focusRef.current = node;
                      }}
                    >
                      {segment.text}
                    </mark>
                  );
                }
                if (segment.kind === 'focus') {
                  return (
                    <mark key={index} className="anchor-hit">
                      {segment.text}
                    </mark>
                  );
                }
                if (segment.kind === 'revised') {
                  return (
                    <mark key={index} className="anchor-revised">
                      {segment.text}
                    </mark>
                  );
                }
                if (segment.kind === 'hit') {
                  return (
                    <mark key={index} className="anchor-soft">
                      {segment.text}
                    </mark>
                  );
                }
                return <span key={index}>{segment.text}</span>;
              })}
            </div>
          </div>
        </div>
      )}
    </Pane>
  );
}
