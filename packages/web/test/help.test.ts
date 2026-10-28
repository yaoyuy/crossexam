import { describe, expect, it } from 'vitest';
import {
  FAQ,
  HELP_SEEN_KEY,
  HELP_STEPS,
  markHelpSeen,
  MODE_ROWS,
  PRIVACY_NOTE,
  shouldAutoOpenHelp,
} from '../src/help.ts';

function install(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

describe('新手教程', () => {
  it('四步上手，每一步都有标题和正文', () => {
    expect(HELP_STEPS.length).toBeGreaterThanOrEqual(4);
    for (const step of HELP_STEPS) {
      expect(step.title.length).toBeGreaterThan(4);
      expect(step.body.length).toBeGreaterThan(20);
    }
    expect(HELP_STEPS[0]?.title).toContain('简历');
  });

  it('三种模式都列了，且只有离线回放不需要 API Key', () => {
    expect(MODE_ROWS.map((row) => row.mode)).toEqual(['replay', 'record', 'live']);
    for (const row of MODE_ROWS) {
      expect(row.label.length).toBeGreaterThan(1);
      expect(row.what.length).toBeGreaterThan(8);
      expect(row.when.length).toBeGreaterThan(6);
      expect(row.needsKey).toBe(row.mode === 'replay' ? '不需要' : '需要');
    }
  });

  it('隐私口径同时说清「只落本地」与「联网会发给服务商」', () => {
    expect(PRIVACY_NOTE).toContain('SQLite');
    expect(PRIVACY_NOTE).toContain('不联网');
    expect(PRIVACY_NOTE).toContain('模型服务商');
  });

  it('常见问题不少于四条，每条都有问答', () => {
    expect(FAQ.length).toBeGreaterThanOrEqual(4);
    for (const item of FAQ) {
      expect(item.title.length).toBeGreaterThan(4);
      expect(item.body.length).toBeGreaterThan(20);
    }
  });

  it('FAQ 里的判定口径与服务端代码一致，不再说「一律改判无法回答」', () => {
    const answer = FAQ.find((item) => item.title.includes('判定'))?.body ?? '';
    // 这条真实发过：verdict.ts 早就把「全体未答」从 unanswerable 改成 unsupported，
    // 界面上却还写着「强制为无法回答」——文案漂移必须有测试钉住（见 findings F80）。
    expect(answer).toContain('证据缺失');
    expect(answer).not.toContain('所有追问都没答上来的强制为');
  });

  it('四步上手提得到后来落成的入口，否则新手找不到', () => {
    const all = HELP_STEPS.map((step) => step.body).join(' ');
    expect(all).toContain('打包分享');
    expect(all).toContain('一岗一版');
    expect(all).toContain('改完再跑一遍');
  });

  it('第一次打开自动弹教程，看过一次就不再弹', () => {
    install('localStorage', undefined);
    expect(shouldAutoOpenHelp()).toBe(false);

    const map = new Map<string, string>();
    install('localStorage', {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
    });
    expect(shouldAutoOpenHelp()).toBe(true);
    markHelpSeen();
    expect(map.get(HELP_SEEN_KEY)).toBe('1');
    expect(shouldAutoOpenHelp()).toBe(false);
  });

  it('存储不可用时既不弹也不抛错', () => {
    install('localStorage', {
      getItem: () => {
        throw new Error('无痕模式关掉了存储');
      },
      setItem: () => {
        throw new Error('无痕模式关掉了存储');
      },
    });
    expect(shouldAutoOpenHelp()).toBe(false);
    expect(() => markHelpSeen()).not.toThrow();
  });
});
