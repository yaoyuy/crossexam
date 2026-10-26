import { describe, it, expect } from 'vitest';
import { summarizeToolArgs, renderMarkdown, renderIndex } from '../src/render.mjs';

describe('工具参数摘要', () => {
  it('认得 run_code 的 description 与代码', () => {
    const lines = summarizeToolArgs('run_code', JSON.stringify({ description: '读会话文件', code: 'const a = 1;' }), 600);
    const joined = lines.join('\n');
    expect(joined).toContain('读会话文件');
    expect(joined).toContain('const a = 1;');
  });

  it('认得 bash 的命令与工作目录', () => {
    const joined = summarizeToolArgs('ops_bash', JSON.stringify({ command: 'npm run verify', description: '跑门禁', workdir: 'D:\\CZB' }), 600).join('\n');
    expect(joined).toContain('npm run verify');
    expect(joined).toContain('D:\\CZB');
  });

  it('认不出的工具退化成紧凑 JSON，不丢信息', () => {
    const joined = summarizeToolArgs('weird_tool', JSON.stringify({ alpha: 1, beta: 2 }), 600).join('\n');
    expect(joined).toContain('alpha');
  });

  it('超长参数被截断并标注', () => {
    const joined = summarizeToolArgs('run_code', JSON.stringify({ code: 'x'.repeat(5000) }), 200).join('\n');
    expect(joined).toContain('省略');
  });

  it('参数不是 JSON 时不抛异常', () => {
    expect(() => summarizeToolArgs('x', '这不是 json', 100)).not.toThrow();
  });
});

describe('Markdown 渲染', () => {
  const session = {
    meta: { id: 's1', cwd: 'D:\\CZB', provider: 'deepseek', model: 'v4', createdAt: 1000, updatedAt: 2000, humanMessageCount: 1, eventCount: 10, title: '测试会话' },
    usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, reasoningTokens: 1 },
    turns: [{ index: 1, startedAt: 1001, endedAt: 2000, entries: [
      { kind: 'user', at: 1002, text: '帮我做导出器', isHuman: true, sourceKind: 'user' },
      { kind: 'reasoning', at: 1003, text: '先探格式' },
      { kind: 'assistant', at: 1004, text: '好的' },
      { kind: 'tool', at: 1005, callId: 'c1', name: 'read', rawArgs: '{"file_path":"a.txt"}', result: { text: '内容', truncated: false, fullLength: 2 }, isError: false, subCalls: [{ name: 'glob', rawArgs: '{}', isError: false }] },
    ] }],
  };
  const md = renderMarkdown(session, { maxArgChars: 600, maxResultChars: 1200 });

  it('包含用户提问原文（不做截断）', () => {
    expect(md).toContain('帮我做导出器');
  });
  it('包含思考过程与回复', () => {
    expect(md).toContain('先探格式');
    expect(md).toContain('好的');
  });
  it('包含工具调用与子操作', () => {
    expect(md).toContain('a.txt');
    expect(md).toContain('glob');
  });
  it('渲染出统计表头', () => {
    expect(md).toContain('测试会话');
    expect(md).toContain('真人提问');
  });
});

describe('截断只发生一次（回归）', () => {
  it('长结果在渲染时截断一次，且不出现嵌套的省略提示', () => {
    const long = 'A'.repeat(5000);
    const md = renderMarkdown({
      meta: { id: 's', title: 't' },
      usage: {},
      turns: [{ index: 1, entries: [
        { kind: 'user', at: 1, text: 'q', isHuman: true, sourceKind: 'user' },
        { kind: 'tool', at: 2, name: 'read', rawArgs: '{}', result: { text: long, fullLength: long.length }, isError: false, subCalls: [] },
      ] }],
    }, { maxResultChars: 100 });
    expect(md).toContain('原始 5000 字符');
    expect(md.split('此处省略').length - 1).toBe(1);
  });
});

describe('索引渲染', () => {
  it('生成可点击的相对链接', () => {
    const md = renderIndex([{ fileName: '2026-10-26-x.md', title: 'T', date: '2026-10-26', humanMessageCount: 3 }]);
    expect(md).toContain('[2026-10-26-x.md](./2026-10-26-x.md)');
    expect(md).toContain('| 3 |');
  });
});
