import { describe, expect, it } from 'vitest';
import { isPendingNote, MODEL_NOTE_PENDING, modelNoteOf } from '../src/runmode.ts';
import type { ModelList } from '../src/api.ts';

const list = (over: Partial<ModelList> = {}): ModelList => ({
  ready: true,
  models: ['deepseek-chat', 'deepseek-reasoner'],
  defaultModel: 'deepseek-chat',
  error: null,
  missing: [],
  ...over,
});

describe('模型清单折成一句提示', () => {
  it('拉到清单且没有问题时不提示', () => {
    expect(modelNoteOf(list())).toBeNull();
  });

  it('没配好时点名缺哪个变量', () => {
    const note = modelNoteOf(list({ ready: false, models: [], defaultModel: '', missing: ['LLM_API_KEY', 'LLM_MODEL'] }));
    expect(note).not.toBeNull();
    expect(note as string).toContain('LLM_API_KEY');
    expect(note as string).toContain('LLM_MODEL');
    expect(note as string).toContain('刷新页面');
  });

  it('连缺哪些变量都没拿到时也给出下一步，而不是空白', () => {
    const note = modelNoteOf(list({ ready: false, models: [], defaultModel: '', missing: [] }));
    expect(note as string).toContain('LLM_BASE_URL');
  });

  it('后端报错时原样转述，不吞掉', () => {
    expect(modelNoteOf(list({ error: '401 未授权' }))).toBe('401 未授权');
  });

  it('清单是空的不算错，只是手填', () => {
    expect(modelNoteOf(list({ models: [], defaultModel: '' }))).toContain('手填');
  });

  it('「还在路上」与「已经得出结论」必须能分开', () => {
    expect(isPendingNote(MODEL_NOTE_PENDING)).toBe(true);
    expect(isPendingNote(modelNoteOf(list()))).toBe(false);
    expect(isPendingNote(modelNoteOf(list({ ready: false, models: [], defaultModel: '', missing: ['LLM_API_KEY'] })))).toBe(false);
    expect(isPendingNote(null)).toBe(false);
  });
});