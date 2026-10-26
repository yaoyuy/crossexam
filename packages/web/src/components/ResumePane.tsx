import { useEffect, useRef } from 'react';
import { buildSegments, describeRange } from '../highlight.ts';
import type { Anchor } from '../api.ts';
import { Empty, Pane } from './Bits.tsx';

/**
 * 右栏：简历原文。
 * 所有被引用过的原文都淡淡地标着，当前聚焦的一段加亮并自动滚到视野中央——
 * 「证据锚定」这个创新点如果只写在文档里，评委是看不见的，所以必须画在屏幕上。
 */
export function ResumePane(props: { text: string; focus: Anchor | null; hits: Anchor[]; title: string }) {
  const focusRef = useRef<HTMLElement | null>(null);
  const focusKey = props.focus === null ? '' : String(props.focus.start) + '-' + String(props.focus.end);

  useEffect(() => {
    const node = focusRef.current;
    if (node !== null) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusKey]);

  const segments = buildSegments(
    props.text,
    props.focus,
    props.hits.map((anchor) => ({ start: anchor.start, end: anchor.end })),
  );

  let focusAssigned = false;

  return (
    <Pane
      title="简历原文"
      dataShot="resume"
      subtitle={props.text.length === 0 ? '还没有材料' : String(props.text.length) + ' 字 · 被引用 ' + String(props.hits.length) + ' 处'}
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
