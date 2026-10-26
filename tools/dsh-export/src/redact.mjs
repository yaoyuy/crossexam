/**
 * 密钥脱敏。
 *
 * 会话日志里可能出现用户手滑粘贴的 API Key。导出物是要提交到公开仓库的，
 * 所以**在落盘前**统一扫描并替换，而不是靠人肉检查。发现即计数并打印警告。
 */

const RULES = [
  { kind: 'openai-key', re: /sk-[A-Za-z0-9_-]{16,}/g },
  { kind: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{16,}/g },
  { kind: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/g },
  { kind: 'bearer-token', re: /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/g },
  {
    kind: 'assigned-secret',
    re: /(api[_-]?key|apikey|access[_-]?token|secret[_-]?key|client[_-]?secret|password)\s*[:=]\s*['"]?([A-Za-z0-9_\-.]{16,})['"]?/gi,
    replace: (_m, name) => name + '=<REDACTED:assigned-secret>',
  },
];

/**
 * @returns {{ text: string, hits: Array<{kind: string, count: number}> }}
 */
export function redactSecrets(text) {
  let out = text;
  const hits = [];
  for (const rule of RULES) {
    let count = 0;
    if (rule.replace) {
      out = out.replace(rule.re, (...args) => { count++; return rule.replace(...args); });
    } else {
      out = out.replace(rule.re, () => { count++; return '<REDACTED:' + rule.kind + '>'; });
    }
    if (count > 0) hits.push({ kind: rule.kind, count });
  }
  return { text: out, hits };
}
