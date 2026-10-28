import { useState } from 'react';
import { applyNote, groupTemplates, usableIndustry } from '../templates.ts';
import type { AppliedTemplate, TemplateItem } from '../api.ts';
import { Note } from './Bits.tsx';
import { Icon } from './Icon.tsx';

/**
 * 岗位模板选择器（P9）。
 *
 * 12 个行业 × 3 个岗位，点一下就把 JD、示例简历、面试官阵容一起装好——
 * 不熟悉这个行业的人也能在十秒内得到一份「有东西可问」的料。
 * 这里只读不写：落库动作全在服务端那条 apply 上，界面不自己拼数据。
 *
 * P16 起行业用一排可点的胶囊、岗位用一行行带图标的小卡：
 * 同一个控件里「先选大类、再选小类」两级，比两排同款按钮更容易一眼看懂。
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
    <div data-shot="templates" className="flex flex-col gap-2.5">
      <p className="flex items-center gap-1.5 text-[11px] text-ink-400">
        <Icon name="info" size={13} className="text-ink-500" />
        <span>
          {'岗位模板（' + String(props.industries.length) + ' 个行业 × ' + String(current.items.length) + ' 个岗位）：点一下就把 JD 与示例简历一起填好'}
        </span>
      </p>

      <div className="flex flex-wrap gap-1.5">
        {groups.map((group) => (
          <button
            key={group.industry}
            type="button"
            data-shot={'tpl-industry-' + group.industry}
            className={
              'chip transition-colors hover:border-ember-500/60 hover:text-ember-300 ' +
              (group.industry === industry ? 'border-ember-500/50 bg-ember-500/10 text-ember-300' : 'opacity-70')
            }
            onClick={() => setPicked(group.industry)}
          >
            {group.industry}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        {current.items.map((item) => (
          <button
            key={item.id}
            type="button"
            data-shot={'tpl-' + item.id}
            title={item.hints.join('；')}
            className="row text-left disabled:cursor-not-allowed disabled:opacity-45"
            disabled={props.busy}
            onClick={() => props.onApply(item.id)}
          >
            <span className="tile-ico accent-slate">
              <Icon name="target" size={15} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[12.5px] font-semibold text-ink-100">{item.title}</span>
              <span className="truncate text-[11px] text-ink-500">{item.hints[0] ?? '点一下装进投料台'}</span>
            </span>
            <Icon name="chevron-right" size={14} className="text-ink-500" />
          </button>
        ))}
      </div>

      {props.error === null ? null : (
        <div data-shot="tpl-note">
          <Note tone="warn">{props.error}</Note>
        </div>
      )}
      {props.error !== null || props.applied === null ? null : (
        <div data-shot="tpl-note">
          <Note tone="info" icon="check">
            {applyNote(
              { title: props.applied.template.title, panel: props.applied.panel, created: props.applied.created },
              props.nameOf,
            )}
          </Note>
        </div>
      )}
    </div>
  );
}
