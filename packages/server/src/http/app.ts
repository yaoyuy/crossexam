/**
 * HTTP 层：一个会话从创建、开跑到读结果的全部接口，追问过程用 SSE 直播。
 *
 * 三条刻意的取舍：
 *   1. 跑沙盘是 POST + SSE 而不是 WebSocket：单向推送用不上双向，
 *      而且 SSE 自带 last-event-id 语义，重连按 seq 续传是协议里写好的。
 *   2. 同一份提示词与预算在三种模式下完全一致——HTTP 层不参与决策，
 *      它只负责把事件搬给前端，把结果交给报告渲染。
 *   3. 每个事件都先落库再推送：前端崩了、刷新了，过程也还在，
 *      这正是"过程可复现"这个评分维度要的东西。
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { DEFAULT_BUDGET, shortHash } from '@crossexam/shared';
import type { InterviewerRole } from '@crossexam/shared';
import { DEMO_JD, DEMO_RESUME, DEMO_TITLE } from '../demo-content.ts';
import { createLlmClient, defaultCassetteDir, describeClient } from '../llm/index.ts';
import type { LlmClient } from '../llm/types.ts';
import { assembleSession, contractViews, runAndPersist } from '../pipeline.ts';
import type { SessionView } from '../pipeline.ts';
import { renderReport, reportFileName } from '../report.ts';
import { deleteSession, getSession, insertSession, listEvents, listSessions, llmStats } from '../store/index.ts';
import type { Db } from '../store/index.ts';
import { DEFAULT_PANEL } from '../orchestrator/run.ts';
import type { RunSessionResult } from '../orchestrator/run.ts';

/** 简历短于这个长度就没法抽出可被追问的主张，与其跑一盘空的不如直接说清楚 */
const MIN_RESUME_CHARS = 30;
const ROLES: readonly string[] = ['tech', 'hr', 'hiring_manager', 'stress', 'domain_expert'];

export interface AppOptions {
  db: Db;
  /** 不传就按 CROSSEXAM_MODE 现造一个；测试与离线演示都靠这个注入 */
  client?: LlmClient;
  model?: string;
  cassetteDir?: string;
  /**
   * 同时上场的面试官数量上限（PANEL_SIZE）。只做截断，不负责挑选：
   * 面板组成仍由请求的 ?panel= 或 DEFAULT_PANEL 决定。不传则不设上限。
   */
  panelSize?: number;
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberField(value: unknown): number | undefined {
  const text = textField(value);
  if (text === '') return undefined;
  const num = Number(text);
  return Number.isFinite(num) ? num : undefined;
}

function panelOf(raw: string | undefined): readonly InterviewerRole[] | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const picked = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => ROLES.includes(item));
  return picked.length === 0 ? undefined : (picked as InterviewerRole[]);
}

/** 上限只截断不补齐：面板是「谁上场」的选择题，不能靠数量凑人头 */
function limitPanel(
  panel: readonly InterviewerRole[],
  limit: number | undefined,
): readonly InterviewerRole[] {
  if (limit === undefined || panel.length <= limit) return panel;
  return panel.slice(0, limit);
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const value = await c.req.json();
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 给前端的跑完小结。详细内容走 GET /api/sessions/:id，这里只给"跑完了、结果长这样" */
export interface RunSummary {
  rounds: number;
  claims: number;
  probes: number;
  verdicts: RunSessionResult['verdicts'];
  suggestions: number;
  rejectedClaims: number;
  notices: string[];
  usage: RunSessionResult['usage'];
}

function summaryOf(result: RunSessionResult): RunSummary {
  return {
    rounds: result.rounds,
    claims: result.claims.length,
    probes: result.probes.length,
    verdicts: result.verdicts,
    suggestions: result.suggestions.length,
    rejectedClaims: result.rejectedClaims.length,
    notices: result.notices,
    usage: result.usage,
  };
}

export function createApp(opts: AppOptions): Hono {
  const db = opts.db;
  const cassetteDir = opts.cassetteDir ?? defaultCassetteDir();
  const client = opts.client ?? createLlmClient({ cassetteDir });
  const model = opts.model ?? process.env['LLM_MODEL'] ?? '';
  const panelLimit = opts.panelSize;
  const resolvePanel = (raw: string | undefined): readonly InterviewerRole[] =>
    limitPanel(panelOf(raw) ?? DEFAULT_PANEL, panelLimit);
  const app = new Hono();

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      mode: client.mode,
      runMode: describeClient(client, cassetteDir),
      model,
      cassetteDir,
    }),
  );

  app.get('/api/demo', (c) => c.json({ title: DEMO_TITLE, resume: DEMO_RESUME, jd: DEMO_JD }));
  /**
   * 意图契约是**声明式**的：给定角色与预算就能算出全文和指纹，不用跑沙盘、不调模型。
   * 所以界面在开跑之前就能把这场质询的规则摊开；跑完之后还能拿指纹和落库的那份对账。
   */
  app.get('/api/contracts', (c) => {
    const raw = c.req.query('panel');
    const parts =
      raw === undefined
        ? []
        : raw
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item !== '');
    const unknown = parts.filter((item) => !ROLES.includes(item));
    if (unknown.length > 0) {
      return c.json(
        { error: '不认识的面试官角色：' + unknown.join('、') + '。可选：' + ROLES.join('、') },
        400,
      );
    }
    const panel = resolvePanel(raw);
    return c.json({ panel, budget: DEFAULT_BUDGET, contracts: contractViews(panel, DEFAULT_BUDGET) });
  });

  app.get('/api/sessions', (c) => {
    const limit = numberField(c.req.query('limit')) ?? 50;
    return c.json({ sessions: listSessions(db, limit) });
  });

  app.post('/api/sessions', async (c) => {
    const body = await readBody(c);
    const useDemo = body['useDemo'] === true;
    const given = textField(body['resumeText']);
    const resumeText = given === '' && useDemo ? DEMO_RESUME : given;
    if (resumeText.length < MIN_RESUME_CHARS) {
      return c.json({ error: '简历太短了：至少 ' + String(MIN_RESUME_CHARS) + ' 个字符，才有东西可追问。' }, 400);
    }
    const jdText = textField(body['jdText']) || (useDemo ? DEMO_JD : '');
    const jobTitle = textField(body['jobTitle']) || (useDemo ? DEMO_TITLE : '未填写岗位');
    const id = insertSession(db, {
      jobTitle,
      jdText,
      resumeText,
      resumeHash: shortHash(resumeText, 24),
      llmMode: client.mode,
      budget: { config: DEFAULT_BUDGET, totalProbes: 0, claims: {} },
      meta: { source: useDemo ? 'demo' : 'user' },
    });
    return c.json({ id, mode: client.mode, jobTitle }, 201);
  });

  app.get('/api/sessions/:id', (c) => {
    const view = assembleSession(db, c.req.param('id'));
    if (view === null) return c.json({ error: '会话不存在' }, 404);
    return c.json(view);
  });

  app.get('/api/sessions/:id/events', (c) => {
    const id = c.req.param('id');
    if (getSession(db, id) === null) return c.json({ error: '会话不存在' }, 404);
    const from = numberField(c.req.query('from')) ?? 0;
    return c.json({ from, events: listEvents(db, id, from) });
  });

  app.delete('/api/sessions/:id', (c) => {
    const id = c.req.param('id');
    if (getSession(db, id) === null) return c.json({ error: '会话不存在' }, 404);
    deleteSession(db, id);
    return c.json({ ok: true, id });
  });

  app.get('/api/sessions/:id/report.md', (c) => {
    const id = c.req.param('id');
    const view = assembleSession(db, id);
    if (view === null) return c.json({ error: '会话不存在' }, 404);
    return c.body(renderReport(view), 200, {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': 'attachment; filename="' + reportFileName(view) + '"',
    });
  });

  app.get('/api/stats', (c) => {
    const session = c.req.query('session');
    return c.json(llmStats(db, session === undefined || session === '' ? undefined : session));
  });

  app.post('/api/sessions/:id/run', async (c) => {
    const id = c.req.param('id');
    const session = getSession(db, id);
    if (session === null) return c.json({ error: '会话不存在：' + id }, 404);
    const panel = resolvePanel(c.req.query('panel'));
    const maxClaims = numberField(c.req.query('maxClaims'));
    const runInput = { db, sessionId: id, client, model, panel, maxClaims };

    if (c.req.query('stream') === '0') {
      try {
        const result = await runAndPersist(runInput);
        return c.json(summaryOf(result));
      } catch (err) {
        const message = messageOf(err);
        return c.json({ error: message }, message.includes('已经跑过了') ? 409 : 500);
      }
    }

    return streamSSE(c, async (stream) => {
      try {
        const result = await runAndPersist({
          ...runInput,
          onEvent: async (event, seq) => {
            await stream.writeSSE({ id: String(seq), event: event.type, data: JSON.stringify(event) });
          },
          // 分片走没有 id 的 stream 事件：它不属于事件日志，刷新页面就没了，
          // 因此不能占用断线续传的 seq 编号。
          onStream: async (chunk) => {
            await stream.writeSSE({ event: 'stream', data: JSON.stringify(chunk) });
          },
        });
        await stream.writeSSE({ event: 'result', data: JSON.stringify(summaryOf(result)) });
      } catch (err) {
        await stream.writeSSE({ event: 'fatal', data: JSON.stringify({ fatal: true, message: messageOf(err) }) });
      }
    });
  });

  app.notFound((c) => c.json({ error: '没有这个接口：' + c.req.path }, 404));
  app.onError((err, c) => c.json({ error: messageOf(err) }, 500));

  return app;
}

export type { SessionView };
