/** 文本截断与摘要的小工具（渲染层和解析层共用） */

/** 截断字符串并标注原始长度；max <= 0 表示不截断 */
export function truncateText(s, max) {
  const str = typeof s === 'string' ? s : String(s ?? '');
  if (!max || max <= 0 || str.length <= max) {
    return { text: str, truncated: false, fullLength: str.length };
  }
  return {
    text: str.slice(0, max) + '\n…（此处省略 ' + (str.length - max) + ' 字符，原始长度 ' + str.length + '）',
    truncated: true,
    fullLength: str.length,
  };
}

/** 把字节数格式化成人类可读 */
export function humanBytes(n) {
  if (!Number.isFinite(n)) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
}

/** 文件名安全化（Windows 保留字符 + 长度限制） */
export function safeFileName(s, fallback) {
  const cleaned = String(s || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 60);
  return cleaned || (fallback || 'untitled');
}
