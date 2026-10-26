import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../src/redact.mjs';

describe('密钥脱敏', () => {
  it('替换 OpenAI 风格密钥', () => {
    const r = redactSecrets('key = sk-abcdefghijklmnopqrstuvwxyz0123');
    expect(r.text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123');
    expect(r.hits.map((h) => h.kind)).toContain('openai-key');
  });

  it('替换赋值形式的密钥，但保留变量名', () => {
    const r = redactSecrets('LLM_API_KEY=abcdefghijklmnop123456');
    expect(r.text).toContain('LLM_API_KEY');
    expect(r.text).not.toContain('abcdefghijklmnop123456');
  });

  it('替换 GitHub token 与 AWS AK', () => {
    const r = redactSecrets('ghp_0123456789abcdefghijklmnopqrstuvwx AKIAIOSFODNN7EXAMPLE');
    expect(r.text).not.toContain('ghp_0123456789abcdefghijklmnopqrstuvwx');
    expect(r.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('正常文本不误伤', () => {
    const src = '这是一段普通的中文说明，提到 node:sqlite 和 vitest。';
    const r = redactSecrets(src);
    expect(r.text).toBe(src);
    expect(r.hits.length).toBe(0);
  });
});
