import { describe, it, expect } from 'vitest';
import { DEFAULT_MAX_CHARS_PER_FILE, pageOverhead, paginateSession } from '../src/paginate.mjs';
import { renderMarkdown, renderMetaTable, renderTitle } from '../src/render.mjs';

const NL = String.fromCharCode(10);

function meta(over) {
  return Object.assign({ id: 's1', cwd: 'D:/CZB', provider: 'deepseek', model: 'v4', title: '分页测试' }, over || {});
}

/** 造一场会话：每轮一个用户提问 + AI 回复 + 可选的一次工具调用 */
function session(turnCount, opts) {
  const o = opts || {};
  const turns = [];
  for (let i = 1; i <= turnCount; i++) {
    const entries = [
      { kind: 'user', at: 1000 + i, text: o.userPrefix ? o.userPrefix + i : '第 ' + i + ' 轮的提问', isHuman: true, sourceKind: 'user' },
      { kind: 'assistant', at: 1001 + i, text: '第 ' + i + ' 轮的回复' },
    ];
    if (o.toolText) {
      entries.push({ kind: 'tool', at: 1002 + i, callId: 'c' + i, name: 'read', rawArgs: '{"file_path":"f' + i + '.txt"}',
        result: { text: o.toolText, fullLength: o.toolText.length }, isError: false, subCalls: [] });
    }
    turns.push({ index: i, startedAt: 1000 + i, endedAt: 1100 + i, entries });
  }
  return { meta: meta(o.meta), usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, reasoningTokens: 0 }, turns };
}

/** 把一页拼成完整文件文本——与 bin/dsh-export.mjs 的 composePage 同规则（单页时等于 renderMarkdown 的输出） */
function compose(sess, part, index, parts, names) {
  const L = [renderTitle(sess.meta), ''];
  if (parts.length > 1) {
    L.push('> 本文件是分页快照的第 ' + (index + 1) + '/' + parts.length + ' 部分。');
    L.push('');
  }
  L.push(...renderMetaTable(sess));
  L.push('');
  L.push('---');
  L.push('');
  L.push(...part.lines);
  return L.join(NL);
}

describe('分页与不分页的一致性', () => {
  it('上限足够大时只有一页，且与 renderMarkdown 逐字节相同', () => {
    const s = session(3, { toolText: '工具输出' });
    const parts = paginateSession(s, { maxArgChars: 600, maxResultChars: 1200, maxChars: 1000000 });
    expect(parts.length).toBe(1);
    expect(compose(s, parts[0], 0, parts, ['x.md'])).toBe(renderMarkdown(s, { maxArgChars: 600, maxResultChars: 1200 }));
  });

  it('maxChars 为 0 时不分页', () => {
    const s = session(5, { toolText: 'x'.repeat(500) });
    const parts = paginateSession(s, { maxChars: 0 });
    expect(parts.length).toBe(1);
    expect(compose(s, parts[0], 0, parts, ['x.md'])).toBe(renderMarkdown(s, {}));
  });

  it('默认上限是 400000 字符', () => {
    expect(DEFAULT_MAX_CHARS_PER_FILE).toBe(400000);
  });
});

describe('按条目分页', () => {
  const s = session(4, { toolText: 'y'.repeat(3000) });
  const cap = 1500; // 故意设小，让切页发生在一条轮次内部
  const parts = paginateSession(s, { maxArgChars: 600, maxResultChars: 1200, maxChars: cap });

  it('切成了多页', () => {
    expect(parts.length).toBeGreaterThan(1);
  });

  it('每页都在上限附近（允许分页说明的几百字符）', () => {
    for (const p of parts) {
      expect(p.chars).toBeLessThanOrEqual(cap + 800);
    }
  });

  it('内容一个字都没丢：每轮提问、每轮回复、每次工具调用都还在', () => {
    const all = parts.map((p) => p.lines.join(NL)).join(NL);
    for (let i = 1; i <= 4; i++) {
      expect(all).toContain('第 ' + i + ' 轮的提问');
      expect(all).toContain('第 ' + i + ' 轮的回复');
      expect(all).toContain('f' + i + '.txt');
    }
  });

  it('每页都带标题行，跨页的同一条轮次标注「续」', () => {
    const heads = parts.map((p) => p.lines[0]);
    for (const h of heads) expect(h.startsWith('## Turn ')).toBe(true);
    const cont = heads.filter((h) => h.indexOf('（续）') >= 0);
    expect(cont.length).toBeGreaterThan(0);
    expect(cont[0].indexOf('## Turn 1（续）')).toBe(0);
  });

  it('轮次范围覆盖到首尾，且单调不回退', () => {
    expect(parts[0].fromTurn).toBe(1);
    expect(parts[parts.length - 1].toTurn).toBe(4);
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].fromTurn).toBeGreaterThanOrEqual(parts[i - 1].fromTurn);
      expect(parts[i].toTurn).toBeGreaterThanOrEqual(parts[i - 1].toTurn);
    }
  });

  it('单页开销随元信息表变化，但远小于上限', () => {
    const head = pageOverhead(s);
    expect(head).toBeGreaterThan(100);
    expect(head).toBeLessThan(2000);
  });
});

describe('边界情形', () => {
  it('单个条目本身就超过上限时，它独占一页，不切断条目', () => {
    const huge = 'z'.repeat(20000);
    const s = {
      meta: meta(),
      usage: {},
      turns: [
        { index: 1, entries: [
          { kind: 'user', at: 1, text: huge, isHuman: true, sourceKind: 'user' },
          { kind: 'assistant', at: 2, text: '收到' },
        ] },
      ],
    };
    const parts = paginateSession(s, { maxChars: 1000 });
    expect(parts.length).toBe(2);
    expect(parts[0].chars).toBeGreaterThan(1000);
    expect(parts[0].lines.join(NL)).toContain(huge);
    expect(parts[1].lines.join(NL)).toContain('收到');
  });

  it('只有 note 的轮次不占篇幅', () => {
    const s = { meta: meta(), usage: {}, turns: [{ index: 1, entries: [{ kind: 'note', at: 1, text: '这是导出器自己的提示' }] }] };
    const parts = paginateSession(s, { maxChars: 500 });
    expect(parts.length).toBe(1);
    expect(parts[0].lines.length).toBe(0);
    expect(parts[0].fromTurn).toBe(null);
  });

  it('空会话也能返回一页，不抛异常', () => {
    const parts = paginateSession({ meta: meta(), usage: {}, turns: [] }, { maxChars: 500 });
    expect(parts.length).toBe(1);
    expect(parts[0].chars).toBe(pageOverhead({ meta: meta(), usage: {}, turns: [] }));
  });
});
