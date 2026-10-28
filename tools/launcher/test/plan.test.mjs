import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_WINDOW_SIZE,
  NODE_MIN,
  SHORTCUT_NAME,
  appBrowserCandidates,
  browserOpenArgs,
  chooseAppBrowser,
  compareVersions,
  desktopShortcutDir,
  launcherSteps,
  makeShortcutScript,
  nodeVersionOk,
  parseNodeVersion,
  psQuote,
  reuseNote,
} from '../src/plan.mjs';

describe('Node 版本判定', () => {
  it('认得 v 前缀与三段式，认不出就返回 null 而不是猜', () => {
    expect(parseNodeVersion('v24.14.0')).toEqual([24, 14, 0]);
    expect(parseNodeVersion(' 22.5.0')).toEqual([22, 5, 0]);
    expect(parseNodeVersion('24.14')).toBeNull();
    expect(parseNodeVersion('')).toBeNull();
    expect(parseNodeVersion(undefined)).toBeNull();
  });

  it('比较按数值而不是按字符串', () => {
    expect(compareVersions([24, 14, 0], [22, 5, 0])).toBeGreaterThan(0);
    expect(compareVersions([9, 0, 0], [22, 5, 0])).toBeLessThan(0);
    expect(compareVersions([22, 5, 0], [22, 5, 0])).toBe(0);
  });

  it('正好等于下限算通过，差一个补丁号也算通过', () => {
    expect(nodeVersionOk('v22.5.0')).toBe(true);
    expect(nodeVersionOk('v22.5.1')).toBe(true);
    expect(nodeVersionOk('v22.4.9')).toBe(false);
    expect(nodeVersionOk('v20.11.1')).toBe(false);
    expect(nodeVersionOk('unknown')).toBe(false);
    expect(NODE_MIN).toBe('22.5.0');
  });
});

describe('启动步骤', () => {
  it('第一次要装依赖与构建，之后只剩起服务与开浏览器', () => {
    const first = launcherSteps({ hasDependencies: false, hasWebBuild: false }).map((step) => step.id);
    expect(first).toEqual(['check-node', 'install', 'build', 'serve', 'open']);
    const again = launcherSteps({ hasDependencies: true, hasWebBuild: true }).map((step) => step.id);
    expect(again).toEqual(['check-node', 'serve', 'open']);
  });

  it('依赖在但界面没构建时，只补构建那一步', () => {
    const ids = launcherSteps({ hasDependencies: true, hasWebBuild: false }).map((step) => step.id);
    expect(ids).toEqual(['check-node', 'build', 'serve', 'open']);
  });
});

describe('PowerShell 引号', () => {
  it('单引号翻倍，路径里的空格与中文原样保留', () => {
    expect(psQuote('C:/plain')).toBe(String.fromCharCode(39) + 'C:/plain' + String.fromCharCode(39));
    expect(psQuote("C:/it's here/质询室.lnk")).toBe(String.fromCharCode(39) + 'C:/it' + String.fromCharCode(39, 39) + 's here/质询室.lnk' + String.fromCharCode(39));
  });
});

describe('桌面快捷方式脚本', () => {
  const script = makeShortcutScript({
    shortcutPath: 'C:/Users/me/Desktop/' + SHORTCUT_NAME,
    targetPath: 'D:/CZB/启动.cmd',
    workDir: 'D:/CZB',
  });

  it('指向启动脚本而不是 node 本体：以后改启动方式不用重建图标', () => {
    expect(script).toContain('$link.TargetPath');
    expect(script).toContain('D:/CZB/启动.cmd');
    expect(script).toContain('$link.WorkingDirectory');
  });

  it('没给图标就绝不写 IconLocation：写空字符串会让快捷方式显示成白纸', () => {
    expect(script).not.toContain('IconLocation');
    const withIcon = makeShortcutScript({ shortcutPath: 'a', targetPath: 'b', workDir: 'c', iconPath: 'D:/x.ico' });
    expect(withIcon).toContain('$link.IconLocation');
    expect(withIcon).not.toContain('IconLocation = ' + String.fromCharCode(39, 39));
  });

  it('最后一定要 Save 并回一句可判定的成功标记', () => {
    expect(script.trim().endsWith("Write-Output 'shortcut-ok'")).toBe(true);
    expect(script).toContain('$link.Save()');
  });
});

describe('打开浏览器与复用', () => {
  it('三个平台各一条系统自带命令', () => {
    expect(browserOpenArgs('http://127.0.0.1:8787', 'win32')).toEqual({ command: 'cmd', args: ['/c', 'start', '', 'http://127.0.0.1:8787'] });
    expect(browserOpenArgs('http://127.0.0.1:8787', 'darwin')).toEqual({ command: 'open', args: ['http://127.0.0.1:8787'] });
    expect(browserOpenArgs('http://127.0.0.1:8787', 'linux')).toEqual({ command: 'xdg-open', args: ['http://127.0.0.1:8787'] });
  });

  it('桌面目录跟家目录走，快捷方式名带中文', () => {
    // 用 join 拼期望值：这个函数返回的是平台原生分隔符，断言不该被分隔符绊倒
    expect(desktopShortcutDir('C:/Users/me', 'win32')).toBe(join('C:/Users/me', 'Desktop'));
    expect(SHORTCUT_NAME).toContain('CrossExam');
  });

  it('端口上已经有一个在跑时，说的是「直接打开浏览器」而不是「出错了」', () => {
    expect(reuseNote(8787)).toContain('8787');
    expect(reuseNote(8787)).toContain('直接打开浏览器');
  });
});

describe('应用窗口（没有地址栏的桌面窗口）', () => {
  const env = { ProgramFiles: 'C:/PF', 'ProgramFiles(x86)': 'C:/PF86', LOCALAPPDATA: 'C:/Local' };

  it('Windows 的候选里 Edge 排在最前：Windows 一定装着它', () => {
    const list = appBrowserCandidates('win32', env);
    expect(list[0]).toBe(join('C:/PF86', 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    expect(list).toContain(join('C:/PF', 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    expect(list).toContain(join('C:/Local', 'Google', 'Chrome', 'Application', 'chrome.exe'));
  });

  it('环境变量缺了就不编路径——宁可没有候选，也不要一条点不动的命令', () => {
    expect(appBrowserCandidates('win32', {})).toEqual([]);
  });

  it('取第一个真的存在的那个；一个都没有时返回 null，交给调用方退回默认浏览器', () => {
    expect(chooseAppBrowser('win32', env, () => false)).toBeNull();
    const hit = join('C:/PF', 'Google', 'Chrome', 'Application', 'chrome.exe');
    expect(chooseAppBrowser('win32', env, (p) => p === hit)).toBe(hit);
  });

  it('macOS 与 Linux 给的是惯常位置', () => {
    expect(appBrowserCandidates('darwin', {})).toContain('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    expect(appBrowserCandidates('linux', {})).toContain('/usr/bin/google-chrome');
  });

  it('给了浏览器就用 --app 开独立窗口，没给就还是老三样（行为与以前一字不差）', () => {
    const app = browserOpenArgs('http://127.0.0.1:8787', 'win32', 'C:/PF/msedge.exe');
    expect(app.command).toBe('C:/PF/msedge.exe');
    expect(app.args).toEqual(['--app=http://127.0.0.1:8787', '--window-size=' + APP_WINDOW_SIZE]);
    expect(browserOpenArgs('http://127.0.0.1:8787', 'win32', '')).toEqual({ command: 'cmd', args: ['/c', 'start', '', 'http://127.0.0.1:8787'] });
  });
});
