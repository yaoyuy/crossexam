import { useState } from 'react';
import { applyNote, groupTemplates, usableIndustry } from '../templates.ts';
import type { AppliedTemplate, TemplateItem } from '../api.ts';

/**
 * 岗位模板选择器（P9）。
 *
 * 12 个行业 × 3 个岗位，点一下就把 JD、示例简历、面试官阵容一起装好——
 * 不熟悉这个行业的人也能在十秒内得到一份「有东西可问」的料。
 * 这里只读不写：落库动作全在服务端那条 apply 上，界面不自己拼数据。
 */
export function TemplatePicker(props: {
  industries: string[];
  templates: TemplateItem[];
  onApply: (id: string) => void;
  applied: AppliedTemplate | null;
  nameOf: (id: string) => string;
  busy: boolean;
  error: string | null;
}) {
  const groups = groupTemplates(props.industries, props.templates);
  const [picked, setPicked] = useState('');
  const industry = usableIndustry(groups, picked);
  const current = groups.find((group) => group.industry === industry);
  if (current === undefined) return null;

  return (
    <div data-shot="templates" className="flex flex-col gap-1.5">
      <span className="text-[11px] text-ink-400">
        岗位模板（{props.industries.length} 个行业 × {current.items.length} 个岗位）：点一下就把 JD 与示例简历一起填好
      </span>
      <div className="flex flex-wrap gap-1">
        {groups.map((group) => (
          <button
            key={group.industry}
            type="button"
            data-shot={'tpl-industry-' + group.industry}
            className={'chip ' + (group.industry === industry ? 'border-ember-500/50 text-ember-300' : 'opacity-70')}
            onClick={() => setPicked(group.industry)}
          >
            {group.industry}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {current.items.map((item) => (
          <button
            key={item.id}
            type="button"
            data-shot={'tpl-' + item.id}
            title={item.hints.join('；')}
            className="btn btn-quiet px-2 py-0.5 text-[11.5px]"
            disabled={props.busy}
            onClick={() => props.onApply(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>
      {props.error === null ? null : (
        <p data-shot="tpl-note" className="text-[11px] leading-relaxed text-rose-ink">
          {props.error}
        </p>
      )}
      {props.error !== null || props.applied === null ? null : (
        <p data-shot="tpl-note" className="text-[11px] leading-relaxed text-mint-400">
          {applyNote(
            { title: props.applied.template.title, panel: props.applied.panel, created: props.applied.created },
            props.nameOf,
          )}
        </p>
      )}
    </div>
  );
}
