/**
 * 脱敏：密钥 + 个人信息。
 *
 * 会话日志里可能出现两类不能公开的东西：用户手滑粘贴的 API Key，以及用户自己的
 * 真实个人信息（手机号、邮箱、身份证号、简历原文）。导出物要提交到公开仓库，
 * 所以**在落盘前**统一扫描替换，而不是靠人肉检查。发现即计数并打印警告。
 *
 * 姓名这类没法用正则识别的信息，用仓库根目录的 `.redact-local.txt`（已 gitignore）
 * 逐字替换：一行一条，导出时读到就替换成 <REDACTED:local>。
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
  // 个人信息：中国大陆手机号、身份证号、邮箱。这三类一律替换，
  // 不区分「看起来像真人还是像演示数据」——演示数据被替换掉不影响可读性。
  { kind: 'phone', re: /(?<![0-9])1[3-9][0-9]{9}(?![0-9])/g },
  { kind: 'idcard', re: /(?<![0-9])[1-9][0-9]{16}[0-9Xx](?![0-9])/g },
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
];

/**
 * @param {string} text
 * @param {string[]} [localLiterals] 需要逐字替换的本地字符串（如真实姓名）
 * @returns {{ text: string, hits: Array<{kind: string, count: number}> }}
 */
export function redactSecrets(text, localLiterals = []) {
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
  for (const lit of localLiterals) {
    if (!lit) continue;
    const parts = out.split(lit);
    if (parts.length > 1) {
      hits.push({ kind: 'local', count: parts.length - 1 });
      out = parts.join('<REDACTED:local>');
    }
  }
  return { text: out, hits };
}

/** 读取本地脱敏词表：一行一条，# 开头是注释，空行忽略 */
export function parseLiteralList(raw) {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}
