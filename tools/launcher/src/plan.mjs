/**
 * 零门槛启动器的判断逻辑。
 *
 * 这里刻意不碰文件系统、不起进程：能纯函数判定的东西就纯函数判定，
 * 于是「Node 版本够不够」「要不要装依赖」「快捷方式该放哪」全都能被单测覆盖；
 * 真正起进程的那一小段留给 launch.mjs，由 README 里的真机步骤守。
 */
import { join } from 'node:path';

/** 低于这个版本会死在 node:sqlite 与原生类型剥离上。 */
export const NODE_MIN = '22.5.0';

export const NODE_HELP = [
  '这台机器上的 Node 版本太旧或没装（需要 ' + NODE_MIN + ' 或更高）。',
  '装一个就行，装完重新双击本文件，不需要改任何选项：',
  '  https://nodejs.org/zh-cn/download',
  '（Windows 一路「下一步」；macOS 装 pkg 包即可）',
].join('\n');

/** 'v24.14.0' -> [24, 14, 0]；认不出就返回 null，不猜。 */
export function parseNodeVersion(text) {
  if (typeof text !== 'string') return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** a > b 返回正数，相等返回 0，a < b 返回负数。传进来的必须是三元数组。 */
export function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    const left = Number(a[i] ?? 0);
    const right = Number(b[i] ?? 0);
    if (left !== right) return left - right;
  }
  return 0;
}

export function nodeVersionOk(version, min = NODE_MIN) {
  const current = typeof version === 'string' ? parseNodeVersion(version) : version;
  const floor = typeof min === 'string' ? parseNodeVersion(min) : min;
  if (current === null || floor === null) return false;
  return compareVersions(current, floor) >= 0;
}

/**
 * 第一次跑要做哪些事。已经做过的步骤会被跳过——
 * 「第二次双击只花两秒」是能不能被非技术用户接受的关键。
 */
export function launcherSteps(state) {
  const steps = [{ id: 'check-node', label: '检查 Node 版本' }];
  if (state.hasDependencies !== true) {
    steps.push({ id: 'install', label: '安装依赖（第一次要几十秒，之后会跳过）' });
  }
  if (state.hasWebBuild !== true) {
    steps.push({ id: 'build', label: '构建界面（第一次要十几秒，之后会跳过）' });
  }
  steps.push({ id: 'serve', label: '启动本地服务' });
  steps.push({ id: 'open', label: '打开浏览器' });
  return steps;
}

export const SHORTCUT_NAME = '质询室 CrossExam.lnk';

/** 桌面目录：三个平台都叫 Desktop（中文系统里只是显示名被本地化，磁盘上是这个）。 */
export function desktopShortcutDir(home, platform = process.platform) {
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    return join(home, 'Desktop');
  }
  return join(home, 'Desktop');
}

/** 单引号在 PowerShell 里要写成两个单引号，否则脚本会被截断。 */
export function psQuote(text) {
  return "'" + String(text).split("'").join("''") + "'";
}

/**
 * 造一个 .lnk。用系统自带的 WScript.Shell，不引任何第三方依赖；
 * 快捷方式指向启动脚本而不是 node 本体，这样以后改启动方式不用重建图标。
 */
export function makeShortcutScript(input) {
  const lines = [
    '$ws = New-Object -ComObject WScript.Shell',
    '$link = $ws.CreateShortcut(' + psQuote(input.shortcutPath) + ')',
    '$link.TargetPath = ' + psQuote(input.targetPath),
    '$link.WorkingDirectory = ' + psQuote(input.workDir),
    '$link.Description = ' + psQuote(input.description ?? 'CrossExam 质询室 — 多 Agent 对抗式面试沙盘'),
  ];
  // 只有真的给了图标才写这一行：写一个空字符串会让快捷方式显示成白纸
  const icon = typeof input.iconPath === 'string' ? input.iconPath.trim() : '';
  if (icon !== '') {
    lines.push('$link.IconLocation = ' + psQuote(icon));
  }
  lines.push('$link.WindowStyle = 1');
  lines.push('$link.Save()');
  lines.push("Write-Output 'shortcut-ok'");
  return lines.join('\n');
}

/** 用系统默认浏览器打开一个地址：三个平台各一条命令，都是系统自带。 */
export function browserOpenArgs(url, platform = process.platform) {
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

/** 已经有一个实例在跑的时候，双击第二次应该只是把浏览器叫到前面来。 */
export function reuseNote(port) {
  return '已经有一个质询室在 ' + port + ' 端口上跑着，直接打开浏览器。';
}
