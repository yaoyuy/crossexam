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
  it('替换真实个人信息：手机号 / 邮箱 / 身份证', () => {
    const r = redactSecrets('联系 13800001111 或 me@example.org，证件 110101199003071234');
    expect(r.text).not.toContain('13800001111');
    expect(r.text).not.toContain('me@example.org');
    expect(r.text).not.toContain('110101199003071234');
    expect(r.hits.map((h) => h.kind)).toEqual(expect.arrayContaining(['phone', 'email', 'idcard']));
  });

  it('按本地词表逐字替换姓名', () => {
    const r = redactSecrets('候选人：张三，19 岁', ['张三']);
    expect(r.text).toBe('候选人：<REDACTED:local>，19 岁');
    expect(r.hits.map((h) => h.kind)).toContain('local');
  });
});
