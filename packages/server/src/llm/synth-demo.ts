/**
 * 离线合成兜底（replay fallback）：没录过卡带的简历，也能把一场跑完。
 *
 * 为什么要有这个文件：replay 是默认模式，而卡带只覆盖演示简历那几份。
 * 用户换成自己的简历，第一条 extract 就撞上 cassette-missing，整场直接 500——
 * 演示一遍能跑，用户自己一试就炸。这里让「没录过的简历」也能走完整条链路。
 *
 * 三条纪律（与 scripted-demo.ts 同源，但这里服务的是任意简历，所以不能有固定剧本）：
 *  1) 逐字节确定：只看提示词内容，不碰时间、随机数与环境差异；同样的请求永远得到同样的字节。
 *  2) 每条都过 zod 与既有闸门：引文逐字可定位、after 不新增数字、提问只带一个问号……
 *     合成不出「能过闸门」的内容时返回 null，由调用方原样抛回 cassette-missing——
 *     宁可这一场报错，也不塞一条过不了闸门的半成品进去。
 *  3) 绝不静默：每合成一条都记数（count / stages），由 run.ts 写进事件与会话详情。
 *
 * 默认不落盘：卡带目录在仓库里（fixtures/llm），把用户简历正文写进去等于把隐私数据提交进仓库。
 * 只有显式设置 CROSSEXAM_SYNTH_DIR（或调用方传 opts.dir）时才写卡带，且 model 固定为 SYNTH_MODEL，
 * 一眼可辨「这不是真实模型的输出」。
 */
import { REQUIREMENT_KIND_LABEL } from '@crossexam/shared';
import { CASSETTE_VERSION, digestFor, writeCassette } from './cassette.ts';
import type { CassetteEntry } from './cassette.ts';
import { chunkText } from './replay.ts';
import { LlmError } from './types.ts';
import type { LlmClient, LlmRequest, LlmResult, LlmStreamEvent, LlmUsage } from './types.ts';

/** 合成卡带的模型名。不复用 scripted-demo：那个名字专指「演示剧本」，混用就等于骗人。 */
export const SYNTH_MODEL = 'scripted-synth';
/** 固定的 recordedAt：时间戳会让同一次合成在两台机器上落出不同字节，确定性先崩在这里。 */
export const SYNTH_RECORDED_AT = '2026-11-01T00:00:00.000Z';
export const FALLBACK_ENV = 'CROSSEXAM_REPLAY_FALLBACK';
export const SYNTH_DIR_ENV = 'CROSSEXAM_SYNTH_DIR';

export type ReplayFallback = 'synth' | 'strict';
export type EnvLike = Record<string, string | undefined>;

export interface SyntheticTally {
  count: number;
  /** 出现过合成的阶段（purpose），按第一次出现的顺序 */
  stages: string[];
}

/** 兜底开关：默认 synth（离线优先，先让用户跑得完）；strict 保持原有抛错行为，给录制流程用。 */
export function replayFallbackOf(env: EnvLike = process.env): ReplayFallback {
  const raw = (env[FALLBACK_ENV] ?? '').trim();
  if (raw === '') return 'synth';
  if (raw === 'synth' || raw === 'strict') return raw;
  throw new LlmError('not-configured', FALLBACK_ENV + ' 只能是 synth 或 strict，收到「' + raw + '」。');
}

export interface SynthesizingClient extends LlmClient {
  readonly synthetic: SyntheticTally;
}

/** run.ts 用它取「本场合成了几条」。不是合成客户端时返回 null，调用方按 0 处理。 */
export function syntheticTallyOf(client: LlmClient): SyntheticTally | null {
  const maybe = client as Partial<SynthesizingClient>;
  return maybe.synthetic === undefined ? null : maybe.synthetic;
}

export interface SynthOptions {
  /** 显式落盘目录；不传且没设 CROSSEXAM_SYNTH_DIR 时不写盘（见文件头「默认不落盘」）。 */
  dir?: string;
  env?: EnvLike;
}

function isCassetteMissing(err: unknown): boolean {
  return err instanceof LlmError && err.code === 'cassette-missing';
}

function estimateUsage(req: LlmRequest, text: string): LlmUsage {
  let promptChars = req.system.length;
  for (const message of req.messages) promptChars += message.content.length;
  return {
    inputTokens: Math.max(1, Math.round(promptChars / 2)),
    outputTokens: Math.max(1, Math.round(text.length / 2)),
    cacheReadTokens: 0,
    reasoningTokens: 0,
  };
}

function entryFor(req: LlmRequest, text: string, usage: LlmUsage): CassetteEntry {
  return {
    version: CASSETTE_VERSION,
    digest: digestFor(req),
    purpose: req.purpose,
    model: SYNTH_MODEL,
    recordedAt: SYNTH_RECORDED_AT,
    request: {
      system: req.system,
      messages: req.messages.map((message) => ({ role: message.role, content: message.content })),
      temperature: req.temperature ?? null,
      maxTokens: req.maxTokens ?? null,
      json: req.json ?? false,
    },
    response: { text, usage },
  };
}

export function createSynthesizingClient(base: LlmClient, opts: SynthOptions = {}): SynthesizingClient {
  const env = opts.env ?? process.env;
  const fallback = replayFallbackOf(env);
  const enabled = base.mode === 'replay' && fallback === 'synth';
  const dir = (opts.dir ?? env[SYNTH_DIR_ENV] ?? '').trim();
  const tally: SyntheticTally = { count: 0, stages: [] };

  function impose(req: LlmRequest): LlmResult | null {
    const text = synthesizeText(req);
    // 合成不出来就交回原来的错：报错好过一条过不了闸门的假响应
    if (text === null) return null;
    const usage = estimateUsage(req, text);
    tally.count += 1;
    if (tally.stages.indexOf(req.purpose) < 0) tally.stages.push(req.purpose);
    if (dir !== '') {
      try {
        writeCassette(dir, entryFor(req, text, usage));
      } catch {
        // 落盘只是给这次合成留个底，写不进去不影响这一场
      }
    }
    return { text, usage, digest: digestFor(req), replayed: false, elapsedMs: 0 };
  }

  const client: SynthesizingClient = {
    mode: base.mode,
    synthetic: tally,
    async complete(req: LlmRequest): Promise<LlmResult> {
      try {
        return await base.complete(req);
      } catch (err) {
        if (!enabled || !isCassetteMissing(err)) throw err;
        const made = impose(req);
        if (made === null) throw err;
        return made;
      }
    },
    async *stream(req: LlmRequest): AsyncGenerator<LlmStreamEvent, void, void> {
      if (!enabled) {
        yield* base.stream(req);
        return;
      }
      let handedOut = false;
      try {
        for await (const event of base.stream(req)) {
          handedOut = true;
          yield event;
        }
        return;
      } catch (err) {
        // 已经往外吐过分片就不能再换源：前端会把两段不相干的内容接在一起
        if (handedOut || !isCassetteMissing(err)) throw err;
        const made = impose(req);
        if (made === null) throw err;
        for (const piece of chunkText(made.text)) yield { type: 'delta', text: piece };
        yield { type: 'done', result: made };
      }
    },
  };
  return client;
}

// ---------------------------------------------------------------------------
// 从提示词里读材料：只认各阶段提示词里稳定的二级标题与逐行格式（prompts.ts 里构造的）
// ---------------------------------------------------------------------------

const NL = String.fromCharCode(10);

function linesOf(text: string): string[] {
  return text.split(NL);
}

/** 取某个二级标题之后、下一个二级标题之前的内容。标题用 startsWith：提示词里的标题带括号补充说明。 */
function section(text: string, heading: string): string {
  const all = linesOf(text);
  let start = -1;
  for (let i = 0; i < all.length; i += 1) {
    if (all[i] !== undefined && all[i]!.startsWith(heading)) { start = i; break; }
  }
  if (start < 0) return '';
  const kept: string[] = [];
  for (let i = start + 1; i < all.length; i += 1) {
    const line = all[i] ?? '';
    if (line.startsWith('## ')) break;
    kept.push(line);
  }
  return kept.join(NL).trim();
}

/** 标题独占一行、数字写在下一行时（如「## 本次要抽取的主张条数上限」）用这个。 */
function lineAfterHeading(text: string, heading: string): string {
  const all = linesOf(text);
  for (let i = 0; i < all.length; i += 1) {
    if ((all[i] ?? '').trim() !== heading) continue;
    for (let k = i + 1; k < all.length; k += 1) {
      const line = (all[k] ?? '').trim();
      if (line !== '') return line;
    }
  }
  return '';
}

function headingNumber(text: string, pattern: RegExp): number | null {
  const hit = pattern.exec(text);
  if (hit === null) return null;
  const value = Number(hit[1]);
  return Number.isFinite(value) ? value : null;
}

function firstNumber(text: string): number | null {
  const hit = /([0-9]+)/.exec(text);
  if (hit === null) return null;
  const value = Number(hit[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * 截断。为什么不能直接 slice：把「5000」截成「500」还会在原文里找得到，
 * 但把「2.4」截成「2.」就凭空多出一个原文没有的数字，反而被契约④拦下。
 */
function clip(text: string, max: number): string {
  const tight = text.replace(/\s+/g, ' ').trim();
  if (tight.length <= max) return tight;
  let cut = tight.slice(0, max);
  const tail = tight.slice(max);
  if (/^[0-9]/.test(tail) && /[0-9]$/.test(cut)) {
    const withoutTail = cut.replace(/[0-9.]+$/, '').trim();
    if (withoutTail.length >= 4) cut = withoutTail;
  }
  return cut.trim();
}

/**
 * 渲染后的简历里，'#N [小节]' 是程序加的编号行；以 '#' 开头的行是 markdown 标题。
 * 两种都不是「一条可引用的事实」，当主张或引文都会让追问变成问标题，所以一并跳过。
 */
function resumeLines(block: string): string[] {
  const out: string[] = [];
  for (const raw of linesOf(block)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    out.push(line);
  }
  return out;
}

const CLAIM_HEAD = /^\[(C[0-9]+)\]\s*类别=([a-z]+)\s*权重=([0-9.]+)$/;

interface ClaimBlock { id: string; category: string; text: string; quote: string }

/** 读 renderClaim 渲染出来的主张块（id / 类别 / 主张 / 原文引文）。 */
function claimBlocks(text: string): ClaimBlock[] {
  const all = linesOf(text);
  const out: ClaimBlock[] = [];
  for (let i = 0; i < all.length; i += 1) {
    const head = CLAIM_HEAD.exec((all[i] ?? '').trim());
    if (head === null) continue;
    const id = head[1] ?? '';
    let claimText = '';
    let quote = '';
    for (let k = i + 1; k < all.length && k <= i + 3; k += 1) {
      const line = (all[k] ?? '').trim();
      if (line.startsWith('主张：')) { claimText = line.slice(3).trim(); continue; }
      if (line.startsWith('原文引文：')) { quote = line.slice(5).trim(); break; }
      if (CLAIM_HEAD.test(line)) break;
    }
    if (id === '' || quote === '') continue;
    out.push({ id, category: head[2] ?? 'other', text: claimText, quote });
  }
  return out;
}

const NOTE_HEAD = /^- \[(R[0-9]+)\]\s*(.*)（对应主张 (C[0-9]+)，来自《[^》]*》）：(.*)$/;

interface NoteBlock { id: string; claimId: string; jdQuote: string }

/** 读 renderRequirementNotes 渲染出来的岗位要求块（含它自己的 JD 原文引文）。 */
function noteBlocks(text: string): NoteBlock[] {
  const all = linesOf(text);
  const out: NoteBlock[] = [];
  for (let i = 0; i < all.length; i += 1) {
    const head = NOTE_HEAD.exec((all[i] ?? '').trim());
    if (head === null) continue;
    let jdQuote = '';
    for (let k = i + 1; k < all.length && k <= i + 2; k += 1) {
      const line = (all[k] ?? '').trim();
      if (line.startsWith('要求原文：')) { jdQuote = line.slice(5).trim(); break; }
      if (NOTE_HEAD.test(line)) break;
    }
    const id = head[1] ?? '';
    const claimId = head[3] ?? '';
    if (id === '' || claimId === '' || jdQuote === '') continue;
    out.push({ id, claimId, jdQuote });
  }
  return out;
}

/** 面试官名字用来区分同轮不同面试官的提问，不然问题文本会撞在一起被去重闸门拦下。 */
const PERSONA_NAME = /^你是「([^」]+)」/;
function interviewerOf(system: string): string {
  const hit = PERSONA_NAME.exec(system);
  return hit === null ? '面试官' : (hit[1] ?? '面试官');
}

function bigrams(text: string): string[] {
  const out: string[] = [];
  for (const chunk of text.match(/[\u4e00-\u9fa5]{2,}/g) ?? []) {
    for (let i = 0; i + 2 <= chunk.length; i += 1) out.push(chunk.slice(i, i + 2));
  }
  return out;
}

function overlapScore(left: string, right: string): number {
  const bag = new Set(bigrams(right));
  let score = 0;
  for (const token of new Set(bigrams(left))) if (bag.has(token)) score += 1;
  return score;
}

function claimTextOf(line: string): string {
  const first = line.split(/[。；;！!？?]/)[0] ?? line;
  const text = clip(first, 120);
  return text === '' ? clip(line, 120) : text;
}

function categoryOf(line: string): string {
  if (/[0-9]/.test(line)) return 'metric';
  if (/(主导|牵头|独立|全权|带领|带队|从0到1|从零到一)/.test(line)) return 'ownership';
  if (/(提升|提高|降低|增长|缩短|翻倍|达到|超出)/.test(line)) return 'achievement';
  if (/(至今|期间|[0-9]{4}年|今年|去年)/.test(line)) return 'timeline';
  if (/(熟悉|掌握|精通|了解|使用|熟练|语言|框架|工具|平台)/.test(line)) return 'skill';
  return 'experience';
}

function requirementKindOf(line: string): 'must' | 'plus' | 'duty' {
  if (/(优先|加分|最好|更佳)/.test(line)) return 'plus';
  if (/(负责|参与|承担|职责|工作内容)/.test(line)) return 'duty';
  return 'must';
}

function kindOfLabel(label: string): 'must' | 'plus' | 'duty' {
  for (const kind of ['must', 'plus', 'duty'] as const) {
    if (REQUIREMENT_KIND_LABEL[kind] === label) return kind;
  }
  return 'duty';
}

// ---------------------------------------------------------------------------
// 各阶段：按提示词内容合出「能过闸门」的 JSON
// ---------------------------------------------------------------------------

export function synthesizeText(req: LlmRequest): string | null {
  const prompt = req.messages.map((message) => message.content).join(NL);
  switch (req.purpose) {
    case 'extract': return synthExtract(prompt);
    case 'jd-extract': return synthJdExtract(prompt);
    case 'jd-merge': return synthJdMerge(prompt);
    case 'jd-match': return synthJdMatch(prompt);
    case 'probe': return synthProbe(req.system, prompt);
    case 'answer': return synthAnswer(prompt);
    case 'verdict': return synthVerdict(prompt);
    case 'suggest': return synthSuggest(prompt);
    case 'counter': return synthCounter(prompt);
    // 不认识的阶段（如面试官设计师的 contract）交给各自的调用方兜底，别在这里硬编
    default: return null;
  }
}

function synthExtract(prompt: string): string | null {
  const lines = resumeLines(section(prompt, '## 简历原文')).filter((line) => line.length >= 6);
  if (lines.length === 0) return null;
  const cap = firstNumber(lineAfterHeading(prompt, '## 本次要抽取的主张条数上限')) ?? 12;
  // 取最长的几行：越长的行越可能是真在讲一件事的条目，而不是「技能：Python」这种短语
  const picked = lines.slice().sort((left, right) => right.length - left.length).slice(0, Math.max(1, Math.min(cap, 6)));
  const claims = picked.map((line, index) => ({
    text: claimTextOf(line),
    quote: clip(line, 180),
    category: categoryOf(line),
    weight: Number((0.9 - index * 0.06).toFixed(2)),
  }));
  return JSON.stringify({ claims });
}

function synthJdExtract(prompt: string): string | null {
  const cap = headingNumber(prompt, /^## 本次最多抽 ([0-9]+) 条$/m) ?? 6;
  const lines = resumeLines(section(prompt, '## JD 原文')).filter((line) => line.length >= 8);
  if (lines.length === 0) return null;
  const picked = lines.slice(0, Math.max(1, Math.min(cap, 5)));
  return JSON.stringify({
    requirements: picked.map((line) => ({
      text: clip(line, 120),
      quote: clip(line, 180),
      kind: requirementKindOf(line),
      keywords: [],
    })),
  });
}

const MERGE_LINE = /^- \[(J[0-9]+#[0-9]+)\]\s*([^：]*)：(.*)$/;

function synthJdMerge(prompt: string): string | null {
  const groups: { text: string; kind: 'must' | 'plus' | 'duty'; members: string[]; keywords: string[] }[] = [];
  for (const raw of linesOf(prompt)) {
    const hit = MERGE_LINE.exec(raw.trim());
    if (hit === null) continue;
    const key = hit[1] ?? '';
    const body = (hit[3] ?? '').trim();
    if (key === '' || body.length < 4) continue;
    groups.push({ text: clip(body, 160), kind: kindOfLabel((hit[2] ?? '').trim()), members: [key], keywords: [] });
  }
  if (groups.length === 0) return null;
  return JSON.stringify({ groups });
}

const MATCH_LINE = /^- \[(R[0-9]+)\]\s*([^：]*)：(.*)$/;

function synthJdMatch(prompt: string): string | null {
  const reqs: { id: string; text: string }[] = [];
  for (const raw of linesOf(section(prompt, '## 岗位要求（每一条都要对照一次，方括号里的就是 requirementId）'))) {
    const hit = MATCH_LINE.exec(raw.trim());
    if (hit === null) continue;
    const id = hit[1] ?? '';
    const body = (hit[3] ?? '').trim();
    if (id === '' || body.length < 4) continue;
    reqs.push({ id, text: body });
  }
  if (reqs.length === 0) return null;
  const claims = claimBlocks(section(prompt, '## 这份简历里可以被引用的主张'));
  const matches = reqs.map((req) => {
    let best: ClaimBlock | null = null;
    let bestScore = 0;
    for (const claim of claims) {
      const score = overlapScore(req.text, claim.text + claim.quote);
      if (score > bestScore) { best = claim; bestScore = score; }
    }
    if (best === null) {
      // 兜底不敢说「对上了」：只敢说「简历里找不到这条」，两种情况都留给人来核
      return {
        requirementId: req.id,
        claimId: null,
        status: 'missing',
        reason: '离线合成：这份简历里没有找到写这条要求的字句，按「简历里没写」处理。',
      };
    }
    return {
      requirementId: req.id,
      claimId: best.id,
      status: 'weak',
      reason: '离线合成：只找到字面相近的一句，按「部分对上」处理，还需要真实模型核对。',
    };
  });
  return JSON.stringify({ matches });
}

/** 每类主张配一个通用追问角度。措辞里不放高阶梯贡献词、不放机构名、不放数字——契约④就盯这三样。 */
const ASK_BY_CATEGORY: Record<string, string> = {
  metric: '这个数字的口径和统计范围分别是什么，是谁来核对的',
  achievement: '这个结果具体是怎么衡量出来的，中间有没有对照过',
  ownership: '这件事里你实际拍板和交付的是哪一部分',
  timeline: '这段时间里你主要在推进哪件事，前后顺序是怎样的',
  skill: '这项能力你是在哪个场景里真正用起来的',
  experience: '这段经历里你每天实际在做的是什么',
  other: '这句话背后具体发生了什么，能按先后顺序说一遍吗',
};
const ROUND_WORDS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function questionOf(name: string, round: number, claim: ClaimBlock, quote: string): string {
  const frag = quote.replace(/[?？]/g, '');
  const body = ASK_BY_CATEGORY[claim.category] ?? ASK_BY_CATEGORY['other'] ?? '这句话具体是怎么发生的';
  const word = ROUND_WORDS[round] ?? String(round);
  // 引文放句末：契约④把「高阶梯词 + 过/了」后面跟的内容当成被断言的事实，
  // 片段落在最后，它后面只剩一个引号，就不会把自撰的措辞算进那个对象里。
  return name + '（第' + word + '轮）：' + body + '？——针对简历里这句：「' + frag + '」';
}

function synthProbe(system: string, prompt: string): string | null {
  const claims = claimBlocks(section(prompt, '## 你可以追问的主张'));
  // 空手而归是允许的（提示词里就这么写的），编一个问题不是
  if (claims.length === 0) return JSON.stringify({ probes: [] });
  const notes = noteBlocks(section(prompt, '## 岗位要求里对得上的几条'));
  const max = headingNumber(prompt, /^## 本轮最多问 ([0-9]+) 条$/m) ?? 2;
  const round = headingNumber(prompt, /^## 本轮是第 ([0-9]+) 轮追问$/m) ?? 1;
  const name = interviewerOf(system);
  const limit = Math.max(1, Math.min(max, claims.length));
  // 每轮从不同位置起：全场问题文本唯一（去重闸门按文本比对），也避免同一轮反复问同一条
  const start = ((round - 1) * limit) % claims.length;
  const probes: Record<string, string>[] = [];
  for (let step = 0; step < claims.length && probes.length < limit; step += 1) {
    const claim = claims[(start + step) % claims.length];
    if (claim === undefined) continue;
    const quote = clip(claim.quote, 160);
    if (quote.length < 4) continue;
    const probe: Record<string, string> = {
      claimId: claim.id,
      question: questionOf(name, round, claim, quote),
      quote,
      rationale: '离线合成兜底：按这条主张的类别挑一个通用追问角度，等真实模型或人工再细化。',
    };
    const note = notes.find((item) => item.claimId === claim.id);
    const jdQuote = note === undefined ? '' : clip(note.jdQuote, 160);
    if (note !== undefined && jdQuote.length >= 4) {
      probe['requirementId'] = note.id;
      probe['jdQuote'] = jdQuote;
    }
    probes.push(probe);
  }
  return JSON.stringify({ probes });
}

function focusClaimText(prompt: string): string {
  const prefix = '（这个问题针对简历里的这条主张：';
  for (const raw of linesOf(prompt)) {
    const line = raw.trim();
    if (line.startsWith(prefix)) return line.slice(prefix.length).replace(/）$/, '').trim();
  }
  return '';
}

function synthAnswer(prompt: string): string | null {
  const lines = resumeLines(section(prompt, '## 你的简历原文')).filter((line) => line.length >= 4);
  if (lines.length === 0) return null;
  const focus = focusClaimText(prompt);
  let best = lines[0] ?? '';
  let bestScore = -1;
  for (const line of lines) {
    const score = focus === '' ? 0 : overlapScore(focus, line);
    if (score > bestScore) { best = line; bestScore = score; }
  }
  const quote = clip(best, 180);
  if (quote.length < 4) return null;
  // 回答只复述简历原文，不推导、不补充：离线兜底没有资格替候选人编经历
  return JSON.stringify({
    answered: true,
    text: '（离线合成回答）关于这个问题，简历里能拿出来的原文只有这句：「' + clip(quote, 120) + '」。具体的过程、角色和数字，需要补充原始记录才能展开。',
    citedQuotes: [quote],
  });
}

function synthVerdict(prompt: string): string | null {
  const claim = claimBlocks(section(prompt, '## 待判定主张'))[0];
  if (claim === undefined) return null;
  const quote = clip(claim.quote, 180);
  if (quote.length < 4) return null;
  // 恒为 unsupported：兜底没有真实模型读过这场问答，只敢说「证据不足」，不敢说「站得住」也不敢说「夸大」
  return JSON.stringify({
    kind: 'unsupported',
    confidence: 0.2,
    rationale: '离线合成兜底：这一条没有经过真实模型的追问与判定，按最保守的口径记为证据不足；补录卡带或配上 API Key 后可以重跑这一场。',
    evidenceQuotes: [quote],
  });
}

/** 降档改写：只把明显拔高的措辞换回低一档的说法，顺序上先长词后短词。 */
const SOFTEN: readonly (readonly [RegExp, string])[] = [
  [/独立主导/g, '参与'],
  [/独立完成/g, '参与'],
  [/独立负责/g, '参与'],
  [/独立搭建/g, '参与'],
  [/独立设计/g, '参与'],
  [/全权负责/g, '参与'],
  [/全程负责/g, '参与'],
  [/从0到1/g, '参与'],
  [/从零到一/g, '参与'],
  [/独当一面/g, '参与'],
  [/牵头/g, '参与'],
  [/主导/g, '参与'],
  [/带领/g, '配合'],
  [/带队/g, '配合'],
  [/精通/g, '熟悉'],
];

function synthSuggest(prompt: string): string | null {
  const claim = claimBlocks(section(prompt, '## 被质疑的主张'))[0];
  if (claim === undefined) return null;
  const before = clip(claim.quote, 200);
  if (before.length < 4) return null;
  let after = before;
  for (const [pattern, replacement] of SOFTEN) after = after.replace(pattern, replacement);
  if (after === before) {
    // 改写后与原文相同等于没改（会被闸门拦下），那就明确写成「还缺什么」，而不是硬编一个新说法
    after = before + '（离线合成：这一句缺少可核对的过程与验收细节，建议补齐后再对外）';
  }
  return JSON.stringify({
    problem: '这条主张在简历里只有一句结论，没有过程、角色与验收方，被追问时容易答不上来。',
    before,
    after: clip(after, 380),
    why: '离线合成兜底：先把明显拔高的措辞降回可核对的表述，不添加任何原文没有的事实与数字。',
  });
}

const COUNTER_KINDS = ['team', 'tech', 'growth', 'business', 'process'];

function synthCounter(prompt: string): string | null {
  const claims = claimBlocks(section(prompt, '## 简历里可以被引用的主张'));
  if (claims.length === 0) return null;
  const counters = claims.slice(0, 3).map((claim, index) => {
    const quote = clip(claim.quote, 160);
    return {
      text: '简历里写的「' + clip(quote, 40) + '」这一条，在实际项目里你具体做了什么？',
      kind: COUNTER_KINDS[index % COUNTER_KINDS.length] ?? 'team',
      reason: '离线合成兜底：这条主张只有结论没有过程，招进来以后需要你补上可核对的细节。',
      reply: '先讲清自己实际负责的那一段，再说这部分是谁验收的，避免把团队成果说成个人成果。',
      quote,
      sourceId: claim.id,
    };
  });
  return JSON.stringify({ counters });
}
