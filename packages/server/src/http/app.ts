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
import {
  DEFAULT_BUDGET,
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  JOB_TEMPLATES,
  TEMPLATE_INDUSTRIES,
  TEMPLATE_LIMITS,
  budgetOf,
  contractDigest,
  customInterviewerId,
  difficultyOf,
  difficultyViews,
  interviewerDraftSchema,
  isDifficulty,
  jdDigest,
  jdIdOf,
  jdProblems,
  jdTitleOf,
  normalizeJdText,
  renderSystemPrompt,
  shortHash,
  templateById,
  templateDigest,
} from '@crossexam/shared';
import type { Difficulty, IntentContract, InterviewerDraft, JobDescription } from '@crossexam/shared';
import { DEMO_JD, DEMO_RESUME, DEMO_TITLE } from '../demo-content.ts';
import { createLlmClient, defaultCassetteDir, describeClient, listLiveModels, LLM_MODES, MODE_LABEL, resolveLiveConfig } from '../llm/index.ts';
import type { LlmClient, LlmMode } from '../llm/types.ts';
import { assembleSession, metaPanelIds, runAndPersist, viewsOfContracts } from '../pipeline.ts';
import type { SessionView } from '../pipeline.ts';
import { extractResumeFromFile, ImportError, IMPORT_ACCEPT } from '../import/index.ts';
import type { ImportErrorCode } from '../import/index.ts';
import { renderReport, reportFileName } from '../report.ts';
import { renderReportHtml, reportDocFileName, reportHtmlFileName } from '../report-html.ts';
import { resumeDocFileName, resumeHtmlFileName, renderResumeHtml, resumeTextFileName } from '../resume-export.ts';
import { acceptRevisions, discardRevisions, removeSupplementFor, revisedOf, saveSupplementFor } from '../revisions.ts';
import {
  deleteInterviewer,
  deleteSession,
  getInterviewer,
  getSession,
  insertJds,
  insertSession,
  listEvents,
  listInterviewers,
  listSessions,
  llmStats,
  saveInterviewer,
} from '../store/index.ts';
import type { Db, InterviewerRow } from '../store/index.ts';
import type { RunSessionResult } from '../orchestrator/run.ts';
import { PRESET_ROLES, budgetView, isPresetRole, normalizePanelIds, presetContracts, resolvePanel } from '../orchestrator/panel.ts';
import { bundleOf, localOutcome, optimizeDraft } from '../orchestrator/optimize.ts';
import type { DraftOutcome } from '../orchestrator/optimize.ts';

/** 简历短于这个长度就没法抽出可被追问的主张，与其跑一盘空的不如直接说清楚 */
const MIN_RESUME_CHARS = 30;
const IMPORT_FIELD = 'file';

/** 导入失败时给哪个状态码：太大是 413，格式不收是 415，内容是空的/认不出来是 422。 */
function importStatus(code: ImportErrorCode): 413 | 415 | 422 {
  if (code === 'too-large') return 413;
  if (code === 'unsupported' || code === 'legacy-doc') return 415;
  return 422;
}
/** 自定义面试官 id 前缀，与 shared 里的 CUSTOM_ID_PREFIX 同口径（这里是路由层的兜底判断） */
const CUSTOM_PREFIX = 'custom-';
/** 保存到库里的自定义面试官上限：再多也不方便在一屏里挑 */
const MAX_INTERVIEWERS = 40;

export interface AppOptions {
  db: Db;
  /** 不传就按 CROSSEXAM_MODE 现造一个；测试与离线演示都靠这个注入 */
  client?: LlmClient;
  model?: string;
  cassetteDir?: string;
  /** 阶段 → 模型 的路由；原样透给 /api/health，让界面能说明「谁在思考」 */
  reasoning?: Record<string, string>;
  /**
   * 同时上场的面试官数量上限（PANEL_SIZE）。只做截断，不负责挑选：
   * 面板组成仍由请求的 ?panel= 或 DEFAULT_PANEL 决定。不传则不设上限。
   */
  panelSize?: number;
  /**
   * 按「这一场选的模式与模型」现造客户端。会话行是单一事实来源：
   * 同一份库里可以既有回放跑过的老会话、又有联网跑的新会话，重跑谁的都按它自己记的模式来。
   */
  clientFactory?: (mode: LlmMode, model: string) => LlmClient;
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * JD 标题的兜底：调用方没填标题时取正文第一行非空文本。
 * JD 正文的第一行通常就是岗位名，比界面上一律显示「岗位 1」有用得多。
 */
function firstLineOf(text: string): string {
  for (const line of text.split(String.fromCharCode(10))) {
    const trimmed = line.trim();
    if (trimmed !== '') return trimmed;
  }
  return '';
}

/**
 * 请求里带的运行模式。写错的值明确拒绝（返回 null），不做「猜一个最接近的」——
 * 猜错的代价是用户以为在联网，实际跑的是回放。
 */
function modeField(value: unknown): LlmMode | null | undefined {
  const text = textField(value).toLowerCase();
  if (text === '') return undefined;
  return text === 'replay' || text === 'live' || text === 'record' ? (text as LlmMode) : null;
}

/**
 * 联网是否就绪：只查两个真正必需的环境变量。
 * 模型名可以来自界面输入，所以 LLM_MODEL 缺失不算「没配好」，界面会提示可以直接手填。
 */
function liveReadiness(): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if ((process.env['LLM_BASE_URL'] ?? '').trim() === '') missing.push('LLM_BASE_URL');
  if ((process.env['LLM_API_KEY'] ?? '').trim() === '') missing.push('LLM_API_KEY');
  return { ready: missing.length === 0, missing };
}

function numberField(value: unknown): number | undefined {
  const text = textField(value);
  if (text === '') return undefined;
  const num = Number(text);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * 把 ?panel=tech,hr 或请求体里的 interviewers 数组拆成 id 列表。
 * 这里**只拆不判**：认不认得出来由 resolvePanel 查库决定，
 * 否则自定义面试官（custom-xxx）会被这张白名单直接挡在门外。
 */
function idsOf(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return idsOf(value);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim());
}

/** 可选值清单，给 400 的提示用 */
function knownPanelHint(): string {
  return '预设可选：' + PRESET_ROLES.join('、') + '；自定义面试官请先在「面试官工作室」里配好。';
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

/** zod 的 issues 压成一句人话：界面上要能直接显示给不懂代码的用户看 */
function describeZod(issues: readonly { path: readonly (string | number | symbol)[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const where = issue.path.map((item) => String(item)).join('.');
      return where === '' ? issue.message : where + ' ' + issue.message;
    })
    .join('；');
}

/** 草稿结果 → 界面视图。notes 与 fallbackReason 一定原样带上：谁生成的必须让用户知道。 */
function viewOfOutcome(outcome: DraftOutcome): Record<string, unknown> {
  return {
    draft: outcome.draft,
    source: outcome.source,
    notes: outcome.notes,
    fallbackReason: outcome.fallbackReason,
    diff: outcome.diff,
    id: outcome.bundle.id,
    version: outcome.bundle.version,
    digest: outcome.bundle.digest,
    contract: outcome.bundle.contract,
    systemPrompt: outcome.bundle.systemPrompt,
    replayed: outcome.replayed,
    usage: outcome.usage,
  };
}

/** 库里的一行 → 界面视图（与 /api/contracts 的契约视图同形，前端不用写两套渲染） */
function viewOfRow(row: InterviewerRow | null): Record<string, unknown> | null {
  if (row === null) return null;
  const contract: IntentContract = { ...row.contract, budget: budgetView(DEFAULT_BUDGET) };
  return {
    id: row.id,
    version: row.version,
    digest: contractDigest(contract),
    storedDigest: row.digest,
    verified: row.digest === contractDigest(contract),
    domain: row.domain,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    contract,
    systemPrompt: renderSystemPrompt(contract),
  };
}

/**
 * 把请求里的 JD 收成一份清单。
 *
 * 三条刻意的设计：
 *   - 空文本是「还没粘」而不是错误：用户可能正在一份份往里贴，中途拦下来只会让人困惑；
 *   - 老字段 jdText 仍然认，等价于「只有一份 JD」——老会话、脚本与内置演示都不必改；
 *   - 份数与长度交给 shared 的 jdProblems 判，错误信息由它给中文说法。
 */
function jdsOf(raw: unknown, fallbackText: string): { list: JobDescription[]; problem: string | null } {
  const drafts: { title: string; text: string }[] = [];
  const items = Array.isArray(raw) ? raw : [];
  for (const item of items) {
    const record = item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const text = normalizeJdText(textField(record['text']));
    if (text === '') continue;
    drafts.push({ title: textField(record['title']) || firstLineOf(text), text });
  }
  if (drafts.length === 0) {
    const legacy = normalizeJdText(fallbackText);
    if (legacy !== '') drafts.push({ title: firstLineOf(legacy), text: legacy });
  }
  const problems = jdProblems(drafts);
  if (problems.length > 0) return { list: [], problem: problems.join(' ') };
  return {
    list: drafts.map((item, index) => ({
      id: jdIdOf(index + 1),
      ordinal: index + 1,
      title: jdTitleOf(item.title, index + 1),
      text: item.text,
    })),
    problem: null,
  };
}

export function createApp(opts: AppOptions): Hono {
  const db = opts.db;
  const cassetteDir = opts.cassetteDir ?? defaultCassetteDir();
  const client = opts.client ?? createLlmClient({ cassetteDir });
  const model = opts.model ?? process.env['LLM_MODEL'] ?? '';
  const reasoning = opts.reasoning ?? {};
  const panelLimit = opts.panelSize;
  const clientFor = (mode: LlmMode, wanted: string): LlmClient =>
    opts.clientFactory !== undefined
      ? opts.clientFactory(mode, wanted)
      : opts.client ??
        createLlmClient({
          cassetteDir,
          mode,
          model: wanted === '' ? undefined : wanted,
          stageModels: reasoning,
        });
  /**
   * 解析这一场的阵容。返回 contracts 与 missing 两件东西：
   * missing 非空时调用方必须拒绝（少一位面试官而界面显示五位是最难查的问题）。
   */
  const panelFrom = (ids: readonly string[], difficulty: Difficulty = DEFAULT_DIFFICULTY) => {
    const wanted = normalizePanelIds(ids, panelLimit);
    // 档位只影响预算，于是「换一档」= 换一组预算数字 = 换一个契约指纹。
    // 这也是为什么同一场会话必须把档位一起留档：不然跑完再对账就算不回来了。
    return { ids: wanted, resolved: resolvePanel(db, wanted, budgetOf(difficulty)) };
  };
  const app = new Hono();

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      mode: client.mode,
      runMode: describeClient(client, cassetteDir),
      model,
      reasoning,
      cassetteDir,
      modes: LLM_MODES,
      modeLabels: MODE_LABEL,
      live: liveReadiness(),
      // 档位清单由 shared 提供：界面按它渲染 chip，服务端按它算预算，两边不各写一份
      difficulties: difficultyViews(),
      defaultDifficulty: DEFAULT_DIFFICULTY,
    }),
  );

  /**
   * 真实端点上有哪些模型。**只在用户选了联网时前端才会调它**：
   * 默认的离线路径一个网络包都不发（没配好就直接返回 ready=false）。
   */
  app.get('/api/models', async (c) => {
    const listed = await listLiveModels();
    return c.json({
      ready: listed.ready,
      models: listed.models,
      defaultModel: listed.defaultModel === '' ? model : listed.defaultModel,
      error: listed.error,
      missing: liveReadiness().missing,
    });
  });

  app.get('/api/demo', (c) => c.json({ title: DEMO_TITLE, resume: DEMO_RESUME, jd: DEMO_JD }));
  /**
   * 意图契约是**声明式**的：给定角色与预算就能算出全文和指纹，不用跑沙盘、不调模型。
   * 所以界面在开跑之前就能把这场质询的规则摊开；跑完之后还能拿指纹和落库的那份对账。
   */
  app.get('/api/contracts', (c) => {
    // 界面在开跑之前就能把规则摊开：换档位时重算一遍，看到的就是这一场真正会用的那一份。
    const difficulty = difficultyOf(c.req.query('difficulty'));
    const { resolved } = panelFrom(idsOf(c.req.query('panel')), difficulty);
    if (resolved.missing.length > 0) {
      return c.json({ error: '找不到这几位面试官：' + resolved.missing.join('、') + '。' + knownPanelHint() }, 400);
    }
    return c.json({
      panel: resolved.ids,
      difficulty,
      budget: budgetOf(difficulty),
      contracts: viewsOfContracts(resolved.contracts),
    });
  });

  /**
   * 面试官库：五位预设（只读，契约在代码里）+ 用户自己配的（可改可删）。
   * 返回的是**契约视图**，所以自定义面试官在界面上的展示方式与预设完全一致。
   */
  app.get('/api/interviewers', (c) => {
    const budget = budgetView(DEFAULT_BUDGET);
    const presets = presetContracts(PRESET_ROLES, budget);
    const custom = listInterviewers(db);
    return c.json({
      presets: viewsOfContracts(presets),
      custom: custom.map((row) => {
        const contract: IntentContract = { ...row.contract, budget };
        return {
          id: row.id,
          version: row.version,
          digest: contractDigest(contract),
          storedDigest: row.digest,
          verified: row.digest === contractDigest(contract),
          domain: row.domain,
          source: row.source,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          contract,
          systemPrompt: renderSystemPrompt(contract),
        };
      }),
      limit: MAX_INTERVIEWERS,
      budget: DEFAULT_BUDGET,
    });
  });

  /**
   * 岗位模板库：12 个行业 × 3 个岗位的原创 JD 与示例简历，只读。
   *
   * 模板里那位自建面试官**不在这里落库**：翻一遍模板库不该往库里塞几十位面试官。
   * 真要用哪一套，走下面的 apply —— 那条路按模板 id 幂等。
   */
  app.get('/api/templates', (c) =>
    c.json({
      industries: TEMPLATE_INDUSTRIES,
      templates: JOB_TEMPLATES.map((item) => ({ ...item, digest: templateDigest(item) })),
      limits: TEMPLATE_LIMITS,
    }),
  );

  /**
   * 一键采用一套模板：返回 JD、示例简历与推荐阵容，并把那位自建面试官存进库。
   *
   * 面试官 id 由**模板 id** 决定（customInterviewerId 的 salt），不是随机数：
   * 同一套模板点十次也只会有一位面试官，也不会把 40 位上限撞爆。
   * source 记 local —— 这个字段的意思是「不是模型现编的」，模板自带正属于此。
   */
  app.post('/api/templates/:id/apply', (c) => {
    const wanted = c.req.param('id');
    const template = templateById(wanted);
    if (template === null) return c.json({ error: '没有这套模板：' + wanted }, 404);
    const budget = budgetView(DEFAULT_BUDGET);
    const interviewerId = customInterviewerId(template.custom.name, template.id);
    const existed = getInterviewer(db, interviewerId) !== null;
    if (!existed && listInterviewers(db).length >= MAX_INTERVIEWERS) {
      return c.json({ error: '自定义面试官最多 ' + String(MAX_INTERVIEWERS) + ' 位，先删掉几位再换模板。' }, 400);
    }
    const bundle = bundleOf(template.custom, { id: interviewerId, budget });
    saveInterviewer(db, {
      id: bundle.id,
      version: bundle.version,
      digest: bundle.digest,
      source: 'local',
      domain: template.custom.domain,
      contract: bundle.contract,
    });
    return c.json({
      ok: true,
      created: !existed,
      template: {
        id: template.id,
        industry: template.industry,
        title: template.title,
        jd: template.jd,
        resume: template.resume,
        hints: template.hints,
        digest: templateDigest(template),
      },
      panel: [...template.presets, bundle.id],
      interviewer: viewOfRow(getInterviewer(db, bundle.id)),
    });
  });

  /**
   * 把一句人话变成一份结构化草稿。**不落库**：用户得先看见 AI 写了什么、
   * 能改、改完再点保存，否则「AI 帮我配的面试官」就变成了一个黑箱。
   *
   * useModel=false 或没配联网时走本地规则——保证没有 Key 的评委也能走完这条链路。
   */
  app.post('/api/interviewers/draft', async (c) => {
    const body = await readBody(c);
    const description = textField(body['description']);
    if (description === '') {
      return c.json({ error: '先用一句话说清你要一位什么样的面试官。比如「想找一位懂医院药房流程、会追问细节的主管」。' }, 400);
    }
    const beforeRaw = body['before'];
    let before: InterviewerDraft | undefined;
    if (beforeRaw !== undefined && beforeRaw !== null) {
      const parsed = interviewerDraftSchema.safeParse(beforeRaw);
      if (!parsed.success) return c.json({ error: '传进来的旧草稿不合约，没法算「改了什么」。' }, 400);
      before = parsed.data;
    }
    const salt = textField(body['salt']);
    const shared = {
      description,
      jobTitle: textField(body['jobTitle']) || undefined,
      jdText: textField(body['jdText']) || undefined,
      resumeText: textField(body['resumeText']) || undefined,
      before,
      id: textField(body['id']) || undefined,
      salt,
      budget: budgetView(DEFAULT_BUDGET),
    };
    const useModel = body['useModel'] !== false;
    if (!useModel) return c.json(viewOfOutcome(localOutcome(shared)));

    // 模型这条路用什么跑：沿用页面选的模式（replay 时查卡带，缺了就退回本地规则）
    const wantedMode = modeField(body['mode']);
    if (wantedMode === null) {
      return c.json({ error: '运行模式只能是 ' + LLM_MODES.join(' / ') + '。' }, 400);
    }
    const mode = wantedMode ?? client.mode;
    const wantedModel = mode === 'replay' ? '' : textField(body['model']);
    const outcome = await optimizeDraft({ ...shared, client: clientFor(mode, wantedModel === '' ? model : wantedModel) });
    return c.json(viewOfOutcome(outcome));
  });

  /** 保存草稿。id 由草稿本身决定，所以同一份草稿保存两次不会多出一位面试官。 */
  app.post('/api/interviewers', async (c) => {
    const body = await readBody(c);
    const parsed = interviewerDraftSchema.safeParse(body['draft'] ?? body);
    if (!parsed.success) {
      return c.json({ error: '这份草稿还不合约：' + describeZod(parsed.error.issues) }, 400);
    }
    const draft = parsed.data;
    const existing = textField(body['id']);
    if (existing !== '' && !existing.startsWith(CUSTOM_PREFIX)) {
      return c.json({ error: '预设面试官不能改也不能存：它们的人设写在代码里。你可以另存一份自定义的。' }, 400);
    }
    const count = listInterviewers(db).length;
    const id = existing !== '' ? existing : bundleOf(draft, { budget: budgetView(DEFAULT_BUDGET) }).id;
    if (existing === '' && count >= MAX_INTERVIEWERS && getInterviewer(db, id) === null) {
      return c.json({ error: '自定义面试官最多 ' + String(MAX_INTERVIEWERS) + ' 位，先删掉几位再存。' }, 400);
    }
    const bundle = bundleOf(draft, { id, budget: budgetView(DEFAULT_BUDGET) });
    saveInterviewer(db, {
      id: bundle.id,
      version: bundle.version,
      digest: bundle.digest,
      source: body['source'] === 'llm' ? 'llm' : 'local',
      domain: draft.domain,
      contract: bundle.contract,
    });
    const row = getInterviewer(db, bundle.id);
    return c.json({ ok: true, interviewer: viewOfRow(row) }, 201);
  });

  app.delete('/api/interviewers/:id', (c) => {
    const id = c.req.param('id');
    if (isPresetRole(id)) {
      return c.json({ error: '预设面试官不能删：它们的人设写在代码里。' }, 400);
    }
    const removed = deleteInterviewer(db, id);
    if (!removed) return c.json({ error: '面试官库里没有这一位：' + id }, 404);
    return c.json({ ok: true, id });
  });

  /**
   * 简历导入：把用户手上的 PDF / Word / 文本变成一段可编辑的文字。
   * 上传的文件**不落库、不留盘**——解出文字直接返回给界面，用户看清了再决定要不要拿它开跑。
   */
  app.post('/api/import', async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.parseBody()) as Record<string, unknown>;
    } catch (err) {
      return c.json({ error: '这个上传请求读不出来：' + messageOf(err) }, 400);
    }
    const file = body[IMPORT_FIELD];
    if (!(file instanceof File)) {
      return c.json({ error: '没有收到文件。挑一份 ' + IMPORT_ACCEPT + ' 简历再试。' }, 400);
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const imported = await extractResumeFromFile({ name: file.name, bytes });
      return c.json(imported);
    } catch (err) {
      if (err instanceof ImportError) {
        return c.json({ error: err.message, code: err.code }, importStatus(err.code));
      }
      return c.json({ error: '导入失败：' + messageOf(err) }, 500);
    }
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
    const jobTitle = textField(body['jobTitle']) || (useDemo ? DEMO_TITLE : '未填写岗位');
    const jds = jdsOf(body['jds'], textField(body['jdText']) || (useDemo ? DEMO_JD : ''));
    if (jds.problem !== null) return c.json({ error: jds.problem }, 400);

    // 这一场用什么跑：默认沿用进程启动时的模式，页面上可以逐场改。
    const wantedMode = modeField(body['mode']);
    if (wantedMode === null) {
      return c.json({
        error: '运行模式只能是 ' + LLM_MODES.join(' / ') + '，收到「' + textField(body['mode']) + '」。',
      }, 400);
    }
    const mode = wantedMode ?? client.mode;
    const wantedModel = mode === 'replay' ? '' : textField(body['model']);
    if (wantedMode !== undefined && wantedMode !== 'replay') {
      // 用户显式选了联网，就先查配置：缺哪个环境变量当场说，而不是跑了一半才发现。
      // 没写 mode 时沿用进程启动时的客户端，那是部署者自己的配置，不在这里拦。
      try {
        resolveLiveConfig({ model: wantedModel === '' ? undefined : wantedModel });
      } catch (err) {
        return c.json({ error: messageOf(err) }, 400);
      }
    }

    // 问多深要在建会话时就定下来，和阵容同理：重跑时必须还是那一档，
    // 否则同一场会话的契约指纹会随页面此刻的选择变化，对账就没意义了。
    // 写接口对档位**严格**：认不出的档位是打错字，静默当默认档会让人以为生效了。
    const rawDifficulty = body['difficulty'];
    if (rawDifficulty !== undefined && rawDifficulty !== null && !isDifficulty(rawDifficulty)) {
      return c.json({
        error: '追问强度只能是 ' + DIFFICULTIES.join(' / ') + '，收到「' + textField(rawDifficulty) + '」。',
      }, 400);
    }
    const difficulty = difficultyOf(rawDifficulty);

    // 阵容在建会话时就定下来：重跑同一场不会因为页面此刻勾了别人就换人。
    const wantedIds = stringList(body['interviewers']);
    const panel = normalizePanelIds(wantedIds, panelLimit);
    const resolved = resolvePanel(db, panel, budgetOf(difficulty));
    if (resolved.missing.length > 0) {
      return c.json({ error: '找不到这几位面试官：' + resolved.missing.join('、') + '。' + knownPanelHint() }, 400);
    }

    const id = insertSession(db, {
      jobTitle,
      // 老字段只留第一份：它是给旧代码与报告头部看的投影，真正的清单在 jd 表里。
      jdText: jds.list.length > 0 ? jds.list[0]!.text : '',
      resumeText,
      resumeHash: shortHash(resumeText, 24),
      llmMode: mode,
      // 预算账本一建会话就按档位写好：跑的时候用它，读的时候也用它重算契约指纹。
      budget: { config: budgetOf(difficulty), totalProbes: 0, claims: {} },
      meta: {
        source: useDemo ? 'demo' : 'user',
        model: wantedModel,
        difficulty,
        panel: resolved.ids,
        // 指纹逐份留档：JD 原文是输入，日后想核对「当时贴的是不是这一版」只看指纹就够。
        jdDigests: jds.list.map((jd) => jdDigest(jd.text)),
      },
    });
    if (jds.list.length > 0) insertJds(db, id, jds.list);
    return c.json(
      {
        id,
        mode,
        model: wantedModel,
        jobTitle,
        difficulty,
        panel: resolved.ids,
        // 只回编号与标题：原文界面本来就有，没必要再传一遍。
        jds: jds.list.map((jd) => ({ id: jd.id, ordinal: jd.ordinal, title: jd.title })),
      },
      201,
    );
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

  /**
   * 可直接打印的 HTML 报告。不带 print 参数时是普通页面（浏览器里看），
   * 带 ?print=1 时页面加载完自己调 window.print()——「另存为 PDF」少点一次。
   * 服务端刻意不自己生成 PDF：那需要带上一个无头浏览器，会把「10 分钟复现」变成赌本机装了什么。
   */
  app.get('/api/sessions/:id/report.html', (c) => {
    const view = assembleSession(db, c.req.param('id'));
    if (view === null) return c.json({ error: '会话不存在' }, 404);
    const print = c.req.query('print') === '1';
    return c.body(renderReportHtml(view, { print }), 200, {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': 'inline; filename="' + reportHtmlFileName(view) + '"',
    });
  });

  /** Word（.doc）导出：同一份 HTML，换成 Word 认识的类型与附件名 */
  app.get('/api/sessions/:id/report.doc', (c) => {
    const view = assembleSession(db, c.req.param('id'));
    if (view === null) return c.json({ error: '会话不存在' }, 404);
    return c.body(renderReportHtml(view), 200, {
      'content-type': 'application/msword; charset=utf-8',
      'content-disposition': 'attachment; filename="' + reportDocFileName(view) + '"',
    });
  });

  /* ------------------------------------------------- 采纳改写与简历导出 */

  /** 当前这一版改完的简历；没采纳过返回 null（而不是空串：没采纳过和改成了空是两件事） */
  app.get('/api/sessions/:id/revisions', (c) => {
    const id = c.req.param('id');
    if (getSession(db, id) === null) return c.json({ error: '会话不存在：' + id }, 404);
    return c.json({ revised: revisedOf(db, id) });
  });

  /**
   * 确认采纳。请求体里的 claims 是**本次确认的全部主张**，不是增量：
   * 取消勾选一条再提交，那条就该从改完的简历里消失。
   * 每次都从原文重算，所以「先采纳 C1 再采纳 C3」与「一次采纳 C1+C3」结果逐字节相同。
   */
  app.post('/api/sessions/:id/revisions', async (c) => {
    const id = c.req.param('id');
    const body = await readBody(c);
    const claims = stringList(body['claims']);
    const result = acceptRevisions(db, id, claims);
    if (!result.ok) return c.json({ error: result.error }, result.code);
    return c.json({ revised: result.view });
  });

  /** 撤销全部采纳，回到原文。改完的简历是一份可以被推翻的稿子，不是既成事实。 */
  app.delete('/api/sessions/:id/revisions', (c) => {
    const id = c.req.param('id');
    if (getSession(db, id) === null) return c.json({ error: '会话不存在：' + id }, 404);
    const cleared = discardRevisions(db, id);
    return c.json({ ok: true, cleared, revised: null });
  });

  /**
   * 记一句补充说明：面试官说「简历里没写」时，求职者当场补一句真话。
   *
   * 它不是改写——简历上没有原句可改——所以单独一张表；采纳时作为插入型改动
   * 落在该主张锚点所在那一行的行尾，与改写建议共用同一套重叠判定与位移重算。
   */
  app.post('/api/sessions/:id/supplements', async (c) => {
    const id = c.req.param('id');
    const body = await readBody(c);
    const claimId = textField(body['claimId']);
    if (claimId === '') return c.json({ error: '要指明这是哪一条主张的补充说明。' }, 400);
    const result = saveSupplementFor(db, id, claimId, textField(body['text']));
    if (!result.ok) return c.json({ error: result.error }, result.code);
    return c.json({ supplement: result.row }, 201);
  });

  /** 删掉一条补充说明：改主意是正常的；下次确认采纳时这一行就不再加进去 */
  app.delete('/api/sessions/:id/supplements/:claimId', (c) => {
    const id = c.req.param('id');
    const claimId = c.req.param('claimId');
    if (getSession(db, id) === null) return c.json({ error: '会话不存在：' + id }, 404);
    const removed = removeSupplementFor(db, id, claimId);
    if (!removed) return c.json({ error: '这条主张还没有补充说明：' + claimId }, 404);
    return c.json({ ok: true, removed });
  });

  /** 改完（或没改过）的简历纯文本：复制粘贴、再喂给别的工具都靠它 */
  app.get('/api/sessions/:id/resume.txt', (c) => {
    const id = c.req.param('id');
    const view = assembleSession(db, id);
    if (view === null) return c.json({ error: '会话不存在：' + id }, 404);
    const revised = revisedOf(db, id);
    const text = revised === null ? view.session.resumeText : revised.text;
    return c.body(text, 200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': 'attachment; filename="' + resumeTextFileName(view) + '"',
    });
  });

  /**
   * 简历 HTML：?print=1 打开即调打印（另存为 PDF），?marks=1 标出改过的段落并附改动清单。
   * 与报告一样不自己生成 PDF：见 ADR-0006。
   */
  app.get('/api/sessions/:id/resume.html', (c) => {
    const id = c.req.param('id');
    const view = assembleSession(db, id);
    if (view === null) return c.json({ error: '会话不存在：' + id }, 404);
    const print = c.req.query('print') === '1';
    const marks = c.req.query('marks') === '1';
    const html = renderResumeHtml(view, revisedOf(db, id), { print, marks });
    return c.body(html, 200, {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': 'inline; filename="' + resumeHtmlFileName(view) + '"',
    });
  });

  /** 简历 Word（.doc）：同一份 HTML 换类型与附件名，与报告导出走同一条老路 */
  app.get('/api/sessions/:id/resume.doc', (c) => {
    const id = c.req.param('id');
    const view = assembleSession(db, id);
    if (view === null) return c.json({ error: '会话不存在：' + id }, 404);
    const marks = c.req.query('marks') === '1';
    const html = renderResumeHtml(view, revisedOf(db, id), { marks });
    return c.body(html, 200, {
      'content-type': 'application/msword; charset=utf-8',
      'content-disposition': 'attachment; filename="' + resumeDocFileName(view) + '"',
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
    // 请求里点名了就用点名的，没点名就用会话行里记的那份（建会话时已经定好）。
    const asked = idsOf(c.req.query('panel'));
    const wantedIds = asked.length > 0 ? normalizePanelIds(asked, panelLimit) : metaPanelIds(session.meta);
    const maxClaims = numberField(c.req.query('maxClaims'));
    // 用会话行里记的模式与模型，而不是进程启动时的那一套：
    // 同一场会话重跑，必须和它当初跑的是同一种东西。
    const sessionModel = textField(session.meta['model']);
    const runModel = sessionModel === '' ? model : sessionModel;
    const runClient = clientFor(session.llmMode, runModel);
    const runInput = {
      db,
      sessionId: id,
      client: runClient,
      model: runModel,
      panelIds: wantedIds.length > 0 ? wantedIds : undefined,
      maxClaims,
    };

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
