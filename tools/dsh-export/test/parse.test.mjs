import { describe, it, expect } from 'vitest';
import { buildTimeline, extractMeta } from '../src/parse.mjs';

const EVENTS = [
  { type: 'session', id: 'sess-1', cwd: 'D:\\CZB', createdAt: 1000, version: 4 },
  { type: 'session/title', data: { title: '搭导出器' }, time: 1000 },
  { type: 'request/context', data: { provider: 'deepseek', model: 'v4', contextWindow: 128000 }, time: 1000 },
  { type: 'turn/start', data: { turn: 1 }, time: 1001 },
  { type: 'user/message', data: { turn: 1, content: [{ type: 'text', text: '帮我导出 Prompt 链' }], source: { kind: 'user' } }, time: 1002 },
  { type: 'user/message', data: { turn: 1, content: [{ type: 'text', text: 'RUNTIME CONTEXT...' }], source: { kind: 'runtime-context' } }, time: 1003 },
  { type: 'assistant/message', data: {
    turn: 1,
    message: { content: [
      { type: 'reasoning', text: '先看会话文件格式' },
      { type: 'text', text: '我来读一下会话文件' },
      { type: 'tool-call', id: 'call-1', name: 'run_code', arguments: { description: '读会话' } },
    ] },
    usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, reasoningTokens: 7 },
  }, time: 1004 },
  { type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-1', name: 'run_code', arguments: '{"description":"读会话","code":"1"}' }, time: 1004 },
  { type: 'tool/result', data: { message: { toolCallId: 'call-1', content: [{ type: 'text', text: '109 条事件' }], isError: false } }, time: 1005 },
  { type: 'tool/ptc-dispatch', data: { rootCallId: 'call-1', name: 'read', arguments: { file_path: 'a.txt' }, isError: false }, time: 1005 },
  { type: 'tool/ptc-dispatch', data: { rootCallId: 'call-1', name: 'grep', arguments: { pattern: 'zstd' }, isError: false }, time: 1005 },
  { type: 'turn/end', data: { turn: 1 }, time: 1006 },
  { type: 'turn/start', data: { turn: 2 }, time: 2000 },
  { type: 'user/message', data: { turn: 2, content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } }, time: 2001 },
];

describe('时间线还原', () => {
  const { turns, usage } = buildTimeline(EVENTS, { maxResultChars: 1200 });

  it('按 turn 分组', () => {
    expect(turns.length).toBe(2);
    expect(turns[0].index).toBe(1);
    expect(turns[1].index).toBe(2);
  });

  it('只把 source.kind=user 当真人提问，系统注入被丢弃', () => {
    const users = turns.flatMap((t) => t.entries).filter((e) => e.kind === 'user');
    expect(users.length).toBe(2);
    expect(users.every((u) => u.isHuman)).toBe(true);
    expect(users.map((u) => u.text)).toEqual(['帮我导出 Prompt 链', '继续']);
  });

  it('--keep-injected 时保留系统注入并标注来源', () => {
    const kept = buildTimeline(EVENTS, { keepInjected: true });
    const users = kept.turns.flatMap((t) => t.entries).filter((e) => e.kind === 'user');
    expect(users.length).toBe(3);
    expect(users[1].isHuman).toBe(false);
    expect(users[1].sourceKind).toBe('runtime-context');
  });

  it('推理、正文、工具调用按内容块原顺序保留', () => {
    const kinds = turns[0].entries.map((e) => e.kind);
    expect(kinds).toEqual(['user', 'reasoning', 'assistant', 'tool']);
  });

  it('tool/call 事件的参数覆盖 assistant 内容块里的参数', () => {
    const tool = turns[0].entries.find((e) => e.kind === 'tool');
    expect(tool.name).toBe('run_code');
    expect(JSON.parse(tool.rawArgs).code).toBe('1');
  });

  it('工具结果按 callId 回填', () => {
    const tool = turns[0].entries.find((e) => e.kind === 'tool');
    expect(tool.isError).toBe(false);
    expect(tool.result.text).toBe('109 条事件');
  });

  it('run_code 内部的 PTC 子调用挂在父调用上', () => {
    const tool = turns[0].entries.find((e) => e.kind === 'tool');
    expect(tool.subCalls.map((s) => s.name)).toEqual(['read', 'grep']);
  });

  it('累计 token 用量', () => {
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(20);
    expect(usage.cacheReadTokens).toBe(50);
    expect(usage.reasoningTokens).toBe(7);
  });
});

describe('元信息提取', () => {
  const meta = extractMeta(EVENTS);
  it('取出会话、标题、模型与时间范围', () => {
    expect(meta.id).toBe('sess-1');
    expect(meta.cwd).toBe('D:\\CZB');
    expect(meta.title).toBe('搭导出器');
    expect(meta.model).toBe('v4');
    expect(meta.humanMessageCount).toBe(2);
    expect(meta.createdAt).toBe(1000);
    expect(meta.updatedAt).toBe(2001);
  });
});
