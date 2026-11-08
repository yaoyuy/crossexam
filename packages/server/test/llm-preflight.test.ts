/**
 * 预检与「合成标注」的测试。
 *
 * 预检要回答的是产品问题：「我这份简历，现在这台机器上跑得完吗？」——必须在**开跑之前**答，
 * 而且答错比不答更糟：说能跑却跑到一半炸掉，用户会以为是自己简历的问题。
 * 所以这里既测「演示简历必须说能跑」，也测「自建简历在空卡带下必须如实说跑不完」，
 * 以及「预检本身是只读的」——它空跑一场，但不许留下会话、不许往卡带目录写东西。
 *
 * 后半段测的是同一件事的另一面：兜底真的开跑时，界面上必须看得见「这一场有合成」，
 * 报告里也必须写在最前面。静默造假是这个项目里最不能接受的一种失败。
 */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.ts';
import { createReplayClient } from '../src/llm/replay.ts';
import { FALLBACK_ENV } from '../src/llm/synth-demo.ts';
import type { SessionView } from '../src/pipeline.ts';

/** 会话详情：SessionView 再加上这一场的合成标注（字段恒定存在） */
type SessionDetail = SessionView & { synthetic: { count: number; stages: string[] } };
import { closeDatabase, openDatabase } from '../src/store/index.ts';
import type { Db } from '../src/store/index.ts';

/** 仓库里已提交的卡带目录（本文件在 packages/server/test 下，往上是仓库根） */
const FIXTURE_DIR = fileURLToPath(new URL('../../../fixtures/llm', import.meta.url));

const NL = String.fromCharCode(10);

/** 卡带里没有的简历：它跑起来必然要靠兜底 */
const OWN_RESUME = [
  '项目经历',
  '负责公司内部的报表系统，把生成耗时从 40 分钟压到 6 分钟，覆盖 12 个业务方。',
  '熟悉 Python 与 SQL，维护过一套数据同步脚本，每天跑 300 次。',
].join(NL);

interface Preflight {
  mode: string;
  coverable: boolean;
  reason: string;
}

const tempDirs: string[] = [];

function newTempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'crossexam-preflight-' + tag + '-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function rig(cassetteDir: string): { app: ReturnType<typeof createApp>; db: Db } {
  const db = openDatabase({ path: ':memory:' });
  const app = createApp({ db, client: createReplayClient(cassetteDir), cassetteDir });
  return { app, db };
}

async function post(app: ReturnType<typeof createApp>, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 把环境变量临时改掉再还原：兜底开关是进程级的，测完不能留给别的用例 */
async function withEnv<T>(overrides: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    saved.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('POST /api/preflight', () => {
  it('演示简历在真卡带下必须说「能跑」，并且说清能跑到哪一步', async () => {
    const { app, db } = rig(FIXTURE_DIR);
    try {
      const res = await post(app, '/api/preflight', { useDemo: true });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Preflight;
      expect(body.mode).toBe('replay');
      expect(body.coverable).toBe(true);
      expect(body.reason).toContain('原样回放');
      expect(body.reason).toContain('条主张');
    } finally {
      closeDatabase(db);
    }
  });

  it('自建简历 + 空卡带必须如实说「跑不完」，并给出两条出路', async () => {
    const dir = newTempDir('empty');
    const { app, db } = rig(dir);
    try {
      const res = await post(app, '/api/preflight', { resumeText: OWN_RESUME });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Preflight;
      expect(body.mode).toBe('replay');
      expect(body.coverable).toBe(false);
      // 点名缺哪些阶段，而不是笼统说「跑不了」
      expect(body.reason).toContain('这些阶段');
      expect(body.reason).toContain('extract');
      // 两条出路都要写清楚：改用演示简历 / 配上 API Key
      expect(body.reason).toContain('演示简历');
      expect(body.reason).toContain('API Key');
    } finally {
      closeDatabase(db);
    }
  });

  it('预检是只读的：不建会话、不往卡带目录写东西', async () => {
    const dir = newTempDir('readonly');
    const { app, db } = rig(dir);
    try {
      await post(app, '/api/preflight', { resumeText: OWN_RESUME });
      await post(app, '/api/preflight', { useDemo: true });
      const sessions = (await (await app.request('/api/sessions')).json()) as { sessions: unknown[] };
      expect(sessions.sessions.length).toBe(0);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      closeDatabase(db);
    }
  });

  it('联网模式下预检直接说能跑，不去翻卡带', async () => {
    const dir = newTempDir('live');
    const { app, db } = rig(dir);
    try {
      const body = await withEnv(
        { LLM_BASE_URL: 'https://example.invalid/v1', LLM_API_KEY: 'k', LLM_MODEL: 'm' },
        async () => {
          const res = await post(app, '/api/preflight', { resumeText: OWN_RESUME, mode: 'live' });
          expect(res.status).toBe(200);
          return (await res.json()) as Preflight;
        },
      );
      expect(body.mode).toBe('live');
      expect(body.coverable).toBe(true);
      expect(body.reason).toContain('真实调用');
    } finally {
      closeDatabase(db);
    }
  });

  it('输入错了就和建档说同一句话，不另造一套文案', async () => {
    const { app, db } = rig(FIXTURE_DIR);
    try {
      const tooShort = await post(app, '/api/preflight', { resumeText: '太短' });
      expect(tooShort.status).toBe(400);
      expect(((await tooShort.json()) as { error: string }).error).toContain('简历太短了');

      const badMode = await post(app, '/api/preflight', { useDemo: true, mode: 'fast' });
      expect(badMode.status).toBe(400);
      expect(((await badMode.json()) as { error: string }).error).toContain('运行模式只能是');
    } finally {
      closeDatabase(db);
    }
  });
});

describe('会话详情与报告里的合成标注', () => {
  /** 走真 HTTP 建会话 + 跑一场，然后把详情与报告都取回来 */
  async function runSessionOverHttp(
    cassetteDir: string,
    body: Record<string, unknown>,
  ): Promise<{ summary: Record<string, unknown>; view: SessionDetail; report: string }> {
    const { app, db } = rig(cassetteDir);
    try {
      const created = await post(app, '/api/sessions', body);
      expect(created.status).toBe(201);
      const session = (await created.json()) as { id: string };

      const ran = await post(app, '/api/sessions/' + session.id + '/run?stream=0', {});
      expect(ran.status).toBe(200);
      const summary = (await ran.json()) as Record<string, unknown>;

      const detail = await app.request('/api/sessions/' + session.id);
      expect(detail.status).toBe(200);
      const view = (await detail.json()) as SessionDetail;

      const report = await app.request('/api/sessions/' + session.id + '/report.md');
      expect(report.status).toBe(200);
      return { summary, view, report: await report.text() };
    } finally {
      closeDatabase(db);
    }
  }

  it('演示简历一场全命中：synthetic 字段照旧出现，但值是 0，报告里也没有合成说明', async () => {
    const { view, report } = await runSessionOverHttp(FIXTURE_DIR, { useDemo: true });
    expect(view.synthetic).toEqual({ count: 0, stages: [] });
    expect(view.events.some((event) => event.kind === 'synthetic')).toBe(false);
    expect(report.startsWith('> **本次运行的合成说明**')).toBe(false);
    expect(report).toContain('# ');
  });

  it('自建简历靠兜底跑完：详情与报告都必须如实标注，卡带目录仍为空', async () => {
    const dir = newTempDir('fallback');
    const { summary, view, report } = await runSessionOverHttp(dir, { resumeText: OWN_RESUME });
    expect(view.synthetic.count).toBeGreaterThan(0);
    expect(view.synthetic.stages).toContain('extract');
    expect(view.notices.some((line) => line.includes('离线兜底'))).toBe(true);
    expect(Array.isArray(summary['notices'])).toBe(true);
    expect(report.startsWith('> **本次运行的合成说明**')).toBe(true);
    expect(report).toContain('不是真实模型的判断');
    // 默认不落盘：用户简历的正文不许被写进仓库
    expect(readdirSync(dir)).toEqual([]);
  });

  it('strict 下自建简历跑不动：错误体带 code 与两条出路的 hint，SSE 也一样', async () => {
    const dir = newTempDir('strict');
    const { app, db } = rig(dir);
    try {
      await withEnv({ [FALLBACK_ENV]: 'strict' }, async () => {
        const created = await post(app, '/api/sessions', { resumeText: OWN_RESUME });
        expect(created.status).toBe(201);
        const session = (await created.json()) as { id: string };

        const failed = await post(app, '/api/sessions/' + session.id + '/run?stream=0', {});
        expect(failed.status).toBe(500);
        const body = (await failed.json()) as { error: string; code: string; hint?: string };
        expect(body.code).toBe('cassette-missing');
        expect(body.error).toContain('回放模式找不到这一条记录');
        expect(body.hint).toContain('离线回放模式');
        expect(body.hint).toContain('演示简历');
        expect(body.hint).toContain('API Key');
        // 开发者指令只许待在括号里，不当主句：hint 是人话主句，补录方法在 error 原文的括号之后
        expect(body.hint).not.toContain('CROSSEXAM_MODE=record');
        expect(body.error).toContain('CROSSEXAM_MODE=record');
        const bracket = body.error.indexOf('（');
        expect(bracket).toBeGreaterThanOrEqual(0);
        expect(body.error.indexOf('CROSSEXAM_MODE=record')).toBeGreaterThan(bracket);
      });

      // 同一场会话换到 SSE 再跑一次：fatal 事件也必须带上同样的 code/hint
      const fresh = await post(app, '/api/sessions', { resumeText: OWN_RESUME });
      const freshSession = (await fresh.json()) as { id: string };
      await withEnv({ [FALLBACK_ENV]: 'strict' }, async () => {
        const streamed = await app.request('/api/sessions/' + freshSession.id + '/run', { method: 'POST' });
        expect(streamed.status).toBe(200);
        const text = await streamed.text();
        expect(text).toContain('event: fatal');
        expect(text).toContain('cassette-missing');
        expect(text).toContain('离线回放模式');
      });
    } finally {
      closeDatabase(db);
    }
  });
});
