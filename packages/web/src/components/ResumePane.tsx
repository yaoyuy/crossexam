import { useEffect, useRef } from 'react';
import { buildSegments, describeRange } from '../highlight.ts';
import type { Anchor } from '../api.ts';
import { spanRanges } from '../revisions.ts';
import type { RevisedResume } from '../revisions.ts';
import { Empty, Pane } from './Bits.tsx';

/**
 * 右栏：简历原文。
 * 所有被引用过的原文都淡淡地标着，当前聚焦的一段加亮并自动滚到视野中央——
 * 「证据锚定」这个创新点如果只写在文档里，评委是看不见的，所以必须画在屏幕上。
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

  return (
    <Pane
      title={tailored !== null ? '这一版（按岗位筛）' : revised === null ? '简历原文' : '改完的简历'}
      dataShot="resume"
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
            看原文
          </button>
        )
      }
      bodyClassName="p-0"
    >
      {props.text.length === 0 ? (
        <Empty title="左边贴一份简历就能开始" hint="所有提问与判定都会锚定到这里的原文区间，点到引文就跳到这里。" />
      ) : (
        <div className="px-4 py-3">
          {props.focus === null ? null : (
            <p className="mb-2 text-[11px] text-ember-400">聚焦 {'\u2192'} {describeRange(props.focus)}</p>
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
      )}
    </Pane>
  );
}
