/**
 * 离线兜底合成（synth-demo）的测试。
 *
 * 这条功能最怕的不是「合成得不好看」，而是「看着挺好、其实过不了闸门」：
 * 一旦有闸门拦下，编排层是逐项容错的——用户看到的仍是「跑完了」，只是结果少了几块，
 * 而且没有任何提示。所以这里的重点不是断言文案好不好，而是把合成结果**真的喂回**
 * 各阶段的 zod schema 与闸门函数，用机器证明「兜底产物是能进库的那一类」。
 *
 * 第二条纪律是确定性：同样的输入必须逐字节得到同样的输出。卡带、比对、复现演示
 * 全都建立在这一点上，所以同一个请求连调两次要比文本相等。
 */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BUDGET,
  MAX_QUESTION_MARKS,
  assumedFactsIn,
  buildContracts,
  claimListSchema,
  contributionEscalation,
  jdRequirementListSchema,
  parseLlmOutput,
  questionMarkCount,
  resolveAnchor,
  segmentResume,
} from '@crossexam/shared';
import type { JobDescription } from '@crossexam/shared';
import { digestFor, listCassettes } from '../src/llm/cassette.ts';
import { createReplayClient } from '../src/llm/replay.ts';
import {
  FALLBACK_ENV,
  SYNTH_MODEL,
  createSynthesizingClient,
  replayFallbackOf,
  synthesizeText,
  syntheticTallyOf,
} from '../src/llm/synth-demo.ts';
import { LlmError } from '../src/llm/types.ts';
import type { LlmRequest } from '../src/llm/types.ts';
import {
  EXTRACT_SYSTEM,
  JD_EXTRACT_SYSTEM,
  buildExtractPrompt,
  buildJdExtractPrompt,
  stageRequest,
} from '../src/orchestrator/prompts.ts';
import { runSession } from '../src/orchestrator/run.ts';
import { newNumbersIn } from '../src/orchestrator/suggest.ts';
import { createScriptedClient } from './scripted.ts';

const NL = String.fromCharCode(10);

const RESUME = [
  '项目经历',
  '主导重构订单系统，把首屏加载时间从 2.4 秒降到 0.8 秒，日均订单量 30 万。',
  '负责订单履约链路的日常维护，配合客服处理线上问题，参与每周的发布评审。',
  '熟悉 TypeScript 与 Node.js，写过一套内部使用的配置下发工具。',
  '2023 年至今在某电商平台做后端开发，团队一共六个人。',
  '技能：Python、SQL',
].join(NL);

const JD_TEXT = [
  '必须熟悉 Node.js 与 TypeScript，能独立承担服务端模块的设计与开发。',
  '有高并发系统经验者优先，熟悉订单履约链路加分。',
  '负责订单核心链路的迭代，参与线上问题排查与性能优化。',
].join(NL);

const JD: JobDescription = { id: 'J1', ordinal: 1, title: '后端开发工程师（订单方向）', text: JD_TEXT };

const tempDirs: string[] = [];

function newTempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'crossexam-synth-' + tag + '-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const OUTLINE = segmentResume(RESUME);

const extractRequest: LlmRequest = stageRequest(
  'extract',
  EXTRACT_SYSTEM,
  buildExtractPrompt({ resumeText: RESUME, outline: OUTLINE, jdText: JD_TEXT, maxClaims: 12 }),
);

const jdExtractRequest: LlmRequest = stageRequest(
  'jd-extract',
  JD_EXTRACT_SYSTEM,
  buildJdExtractPrompt({ jd: JD, maxRequirements: 5 }),
);

/** 空卡带目录 + 一个真请求：兜底必然被触发，这正是要测的那条路。 */
async function synthesized(req: LlmRequest): Promise<string> {
  const client = createSynthesizingClient(createReplayClient(newTempDir('empty')));
  const first = await client.complete(req);
  const second = await client.complete(req);
  expect(second.text).toBe(first.text);
  expect(first.replayed).toBe(false);
  expect(first.elapsedMs).toBe(0);
  expect(first.digest).toBe(digestFor(req));
  expect(syntheticTallyOf(client)?.count).toBe(2);
  return first.text;
}

describe('离线兜底合成', () => {
  it('同一个请求合成两次，逐字节相同', async () => {
    const once = synthesizeText(extractRequest);
    const twice = synthesizeText(extractRequest);
    expect(once).not.toBeNull();
    expect(twice).toBe(once);
    expect(await synthesized(extractRequest)).toBe(once);
  });

  it('抽取与 JD 抽取的合成结果过得了 schema，且每条引文都能锚回原文', async () => {
    const parsed = parseLlmOutput(claimListSchema, await synthesized(extractRequest));
    if (!parsed.ok) throw new Error('合成的主张没过 schema：' + parsed.error);
    expect(parsed.value.claims.length).toBeGreaterThan(0);
    for (const claim of parsed.value.claims) {
      expect(claim.quote.length).toBeGreaterThanOrEqual(4);
      expect(resolveAnchor(RESUME, { quote: claim.quote }).ok).toBe(true);
    }

    const jdParsed = parseLlmOutput(jdRequirementListSchema, await synthesized(jdExtractRequest));
    if (!jdParsed.ok) throw new Error('合成的岗位要求没过 schema：' + jdParsed.error);
    expect(jdParsed.value.requirements.length).toBeGreaterThan(0);
    for (const item of jdParsed.value.requirements) {
      expect(resolveAnchor(JD_TEXT, { quote: item.quote }).ok).toBe(true);
    }
  });

  it('strict 模式保持原有的抛错行为，且一条都不合成', async () => {
    const client = createSynthesizingClient(createReplayClient(newTempDir('strict')), {
      env: { [FALLBACK_ENV]: 'strict' },
    });
    let caught: unknown = null;
    try {
      await client.complete(extractRequest);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LlmError);
    expect((caught as LlmError).code).toBe('cassette-missing');
    // 报错本身也要能读懂：说清缺哪一条，并保留开发者补录的指令
    expect((caught as LlmError).message).toContain('CROSSEXAM_MODE=record');
    expect((caught as LlmError).message).toContain(digestFor(extractRequest));
    expect(syntheticTallyOf(client)?.count).toBe(0);
  });

  it('非回放模式原样透传，一次也不合成', async () => {
    const scripted = createScriptedClient(() => '{"claims":[]}');
    const client = createSynthesizingClient(scripted);
    const result = await client.complete(extractRequest);
    expect(result.text).toBe('{"claims":[]}');
    expect(syntheticTallyOf(client)?.count).toBe(0);
  });

  it('不认识的阶段不硬编，把原来的错误交回去', async () => {
    const contractRequest: LlmRequest = {
      purpose: 'contract',
      system: 'x',
      messages: [{ role: 'user', content: 'y' }],
      json: true,
    };
    expect(synthesizeText(contractRequest)).toBeNull();
    const client = createSynthesizingClient(createReplayClient(newTempDir('unknown')));
    await expect(client.complete(contractRequest)).rejects.toBeInstanceOf(LlmError);
  });

  it('只有在显式给了目录时才落盘，且卡带一眼能看出是合成的', async () => {
    const out = newTempDir('out');
    const client = createSynthesizingClient(createReplayClient(newTempDir('empty')), { dir: out });
    await client.complete(extractRequest);
    const rows = listCassettes(out);
    expect(rows.length).toBe(1);
    expect(rows[0]?.purpose).toBe('extract');
    expect(rows[0]?.model).toBe(SYNTH_MODEL);
    // 与演示脚本的卡带区分开：seed 只会清理 model 为 scripted-demo 的旧卡带
    expect(SYNTH_MODEL).not.toBe('scripted-demo');
  });

  it('开关只认 synth / strict，其它值当场报错而不是悄悄用默认值', () => {
    expect(replayFallbackOf({})).toBe('synth');
    expect(replayFallbackOf({ [FALLBACK_ENV]: 'strict' })).toBe('strict');
    expect(() => replayFallbackOf({ [FALLBACK_ENV]: 'yes' })).toThrowError(LlmError);
  });
});

describe('兜底跑一整场：每一道闸门都要真的过', () => {
  /** 空卡带目录跑满整场：九个阶段全靠合成，跑完的结果必须处处自洽。 */
  async function runFallback(): Promise<{
    result: Awaited<ReturnType<typeof runSession>>;
    tally: { count: number; stages: string[] };
    dir: string;
  }> {
    const dir = newTempDir('run');
    // 交给 runSession 的必须是没包过的回放客户端：兜底由 runSession 自己包一层。
    // 这里再包一层的话，里层先兜住错误，runSession 读到的计数就会归零（只包一层是计数可信的前提）。
    const client = createReplayClient(dir);
    const result = await runSession({
      client,
      resumeText: RESUME,
      jdText: JD_TEXT,
      jds: [JD],
      contracts: buildContracts(['tech', 'hr', 'hiring_manager'], DEFAULT_BUDGET, 1),
      budgetConfig: DEFAULT_BUDGET,
    });
    return { result, tally: result.synthetic, dir };
  }

  it('九个阶段全部合成了，且主张、追问、判定都落到了结果里', async () => {
    const { result, tally } = await runFallback();
    expect(tally.count).toBeGreaterThan(0);
    expect([...tally.stages].sort()).toEqual([
      'answer',
      'counter',
      'extract',
      'jd-extract',
      'jd-match',
      'jd-merge',
      'probe',
      'suggest',
      'verdict',
    ]);
    expect(result.claims.length).toBeGreaterThanOrEqual(3);
    expect(result.rejectedClaims).toEqual([]);
    expect(result.probes.length).toBeGreaterThan(0);
    expect(result.verdicts.length).toBe(result.claims.length);
    expect(result.verdicts.every((verdict) => verdict.kind === 'unsupported')).toBe(true);
    expect(result.suggestionDetails.every((item) => item.status !== 'rejected')).toBe(true);
    expect(result.counterRejected).toEqual([]);
    expect(result.counters.length).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(result.notices.some((line) => line.includes('离线兜底'))).toBe(true);
    expect(result.synthetic.count).toBe(tally.count);
  });

  it('合成的追问过得了契约③④：一个问题、不含简历里没有的事实、全场不重复', async () => {
    const { result } = await runFallback();
    const questions = result.probes.map((probe) => probe.question);
    expect(new Set(questions).size).toBe(questions.length);
    for (const probe of result.probes) {
      expect(questionMarkCount(probe.question)).toBeLessThanOrEqual(MAX_QUESTION_MARKS);
      const claim = result.claims.find((item) => item.id === probe.claimId);
      expect(claim).toBeDefined();
      expect(assumedFactsIn(probe.question, RESUME + ' ' + (claim?.anchor.quote ?? ''))).toEqual([]);
      expect(resolveAnchor(RESUME, { quote: probe.anchor.quote }).ok).toBe(true);
    }
  });

  it('合成的改写建议不给简历加数字、也不升格贡献', async () => {
    const { result } = await runFallback();
    for (const item of result.suggestionDetails) {
      const suggestion = item.suggestion;
      if (suggestion === null) continue;
      expect(resolveAnchor(RESUME, { quote: suggestion.before }).ok).toBe(true);
      expect(newNumbersIn(suggestion.after, RESUME)).toEqual([]);
      expect(contributionEscalation(suggestion.before, suggestion.after)).toBeNull();
    }
  });

  it('合成的反问都指得回简历里的主张', async () => {
    const { result } = await runFallback();
    for (const counter of result.counters) {
      expect(counter.source).toBe('resume');
      expect(counter.anchor.quote.length).toBeGreaterThan(3);
      expect(counter.reply.length).toBeGreaterThan(0);
      // 反问的依据必须锚得回简历原文：锚不回去的反问在 groundCounters 里会被直接丢掉
      expect(resolveAnchor(RESUME, { quote: counter.anchor.quote }).ok).toBe(true);
    }
  });

  it('兜底不往仓库里写卡带：用户简历的正文不落盘', async () => {
    const { dir } = await runFallback();
    expect(readdirSync(dir)).toEqual([]);
  });
});
