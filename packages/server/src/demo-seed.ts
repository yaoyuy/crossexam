/**
 * 一键生成演示卡带，并立刻用回放模式自检一遍。
 *
 * 卡带是**合成演示数据**：scripted-demo.ts 里的确定性脚本扮演抽取官、三位面试官、
 * 求职者与复盘官。这里负责把它跑成两遍：
 *   第一遍用脚本客户端跑，边跑边把每次调用按提示词指纹写进 fixtures/llm；
 *   第二遍换一个干净会话、换一个只读回放客户端，用刚写好的卡带重跑。
 * 两遍的签名必须逐字节相同——这就是「10 分钟复现」这句话的机器证明。
 *
 * 为什么不满足于「写出来就算」：改一句提示词就会换掉指纹，卡带全部失效，
 * 而失效的表现是评委点下按钮后看到一句报错。与其让评委踩到，
 * 不如让 seed 自己在交付前红掉：对不上就返回 ok=false 并给出问题清单。
 */

import { unlinkSync } from 'node:fs';
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_REWRITE_STYLE,
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  REWRITE_STYLES,
  REWRITE_STYLE_LABEL,
  budgetOf,
  jdIdOf,
  jdTitleOf,
  shortHash,
  stableStringify,
} from '@crossexam/shared';
import type { ClaimComparison, Difficulty, RewriteStyle } from '@crossexam/shared';
import { DEMO_JD, DEMO_JD_TITLE, DEMO_RESUME, DEMO_TITLE } from './demo-content.ts';
import { DEMO_MODEL, createDemoScriptedClient } from './llm/scripted-demo.ts';
import type { DemoSeedEntry } from './llm/scripted-demo.ts';
import { cassettePath, listCassettes } from './llm/cassette.ts';
import { createReplayClient } from './llm/replay.ts';
import { closeDatabase, insertJds, insertSession, listClaims, openDatabase } from './store/index.ts';
import type { StoredLlmMode } from './store/index.ts';
import { runAndPersist } from './pipeline.ts';
import type { RunSessionResult } from './orchestrator/run.ts';
import { acceptRevisions } from './revisions.ts';
import { compareSessions } from './compare.ts';

type AnyDb = ReturnType<typeof openDatabase>;

export interface DemoRunSummary {
  rounds: number;
  claims: number;
  probes: number;
  suggestions: number;
  counters: number;
  rejectedClaims: number;
  /** 判定种类 -> 条数，例如 { solid: 1, overstated: 1 } */
  verdicts: Record<string, number>;
  notices: string[];
  usageTokens: number;
}

/**
 * 「改完再跑一遍」那第二场的结果。
 *
 * 为什么要录进演示：C1 这个功能在界面上只有两个入口（采纳改写、再跑一遍），
 * 而离线演示是评委第一次见到它时唯一能看到的东西。只录第一场的话，
 * 「判定会变好」就只是文档里的一句话——评委点不出证据。
 */
export interface DemoRerun {
  record: DemoRunSummary;
  replay: DemoRunSummary;
  /** 改前 → 改后的简历字数：打印用，也是「确实改了东西」的肉眼证据 */
  resumeChars: { before: number; after: number };
  /**
   * 与界面上「比上次」用的是同一个函数 compareSessions。
   * 数字对不上就说明演示讲了另一个故事，所以这里只搬运、不重算。
   */
  comparison: {
    headline: string;
    improved: number;
    worsened: number;
    added: number;
    removed: number;
    pairs: number;
    resumeChanged: boolean;
  } | null;
  ok: boolean;
  problems: string[];
  signature: string;
}

export interface DemoRun {
  difficulty: Difficulty;
  difficultyLabel: string;
  style: RewriteStyle;
  styleLabel: string;
  /** 打印与报错用的合成名：「常规档 · 敢改」 */
  label: string;
  record: DemoRunSummary;
  replay: DemoRunSummary;
  /** 这一组合两次跑的结果是否逐项一致 */
  ok: boolean;
  problems: string[];
  signature: string;
  /** 「改完再跑一遍」的第二场：卡带、自检与对比一起留在这里 */
  rerun: DemoRerun;
}

export interface DemoSeedReport {
  cassetteDir: string;
  entries: DemoSeedEntry[];
  /**
   * 追问强度 × 改写风格 = 九种组合，每种各跑一遍。
   *
   * 两个维度都会改提示词：强度改的是契约里的预算段落，风格改的是改写阶段的收敛说明。
   * 只要有一样写进了提示词，指纹就会变，卡带就必须各录一份——
   * 漏录一组的表现是用户在界面上切一下档位，点开跑就报「找不到记录」。
   */
  runs: DemoRun[];
  /** 默认组合（常规档 × 常规风格）的那一份，顶层保留它，免得既有消费者全改一遍 */
  record: DemoRunSummary;
  replay: DemoRunSummary;
  /** 九种组合全部逐项一致才算通过 */
  ok: boolean;
  problems: string[];
  /** 这一轮不再需要、已被清理掉的旧合成卡带（提示词改动后的孤儿） */
  pruned: string[];
  /** 逐字节可比的签名（默认组合）：写进日志、测试断言、出问题时 diff 都靠它 */
  signature: string;
}

function newSessionId(
  db: AnyDb,
  mode: StoredLlmMode,
  difficulty: Difficulty,
  style: RewriteStyle,
  /** 第二场用：换成改完的简历，并记下自己是从哪一场改出来的 */
  rerun?: { resumeText: string; parentSessionId: string },
): string {
  const resumeText = rerun === undefined ? DEMO_RESUME : rerun.resumeText;
  const id = insertSession(db, {
    jobTitle: DEMO_TITLE,
    jdText: DEMO_JD,
    resumeText,
    resumeHash: shortHash(resumeText, 24),
    llmMode: mode,
    budget: { config: budgetOf(difficulty), totalProbes: 0, claims: {} },
    meta: { source: 'demo-seed', difficulty, style },
    parentSessionId: rerun === undefined ? null : rerun.parentSessionId,
  });
  // 演示场次也要像 HTTP 建会话那样把 JD 写进 jd 表：编排层读的是 listJds(db, sessionId)，
  // 只写老字段 jdText 等于告诉它「这场没上传岗位要求」，JD 三个阶段会整段被跳过。
  insertJds(db, id, [
    { id: jdIdOf(1), ordinal: 1, title: jdTitleOf(DEMO_JD_TITLE, 1), text: DEMO_JD },
  ]);
  return id;
}

function summarize(result: RunSessionResult): DemoRunSummary {
  const verdicts: Record<string, number> = {};
  for (const verdict of result.verdicts) {
    verdicts[verdict.kind] = (verdicts[verdict.kind] ?? 0) + 1;
  }
  return {
    rounds: result.rounds,
    claims: result.claims.length,
    probes: result.probes.length,
    suggestions: result.suggestions.length,
    counters: result.counters.length,
    rejectedClaims: result.rejectedClaims.length,
    verdicts,
    notices: result.notices,
    usageTokens: result.usage.inputTokens + result.usage.outputTokens,
  };
}

/**
 * 只看「应该完全一样」的东西：主张、追问链、判定与证据、改写建议、预算收尾。
 * 刻意不放进指纹的：卡带 digest（那正是要检验的对象）与耗时。
 */
function signatureOf(result: RunSessionResult): string {
  return stableStringify({
    rounds: result.rounds,
    claims: result.claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      category: claim.category,
      quote: claim.anchor.quote,
    })),
    rejected: result.rejectedClaims.map((item) => item.quote),
    jds: result.jds.map((jd) => ({ id: jd.id, title: jd.title })),
    requirements: result.requirements.map((requirement) => ({
      id: requirement.id,
      kind: requirement.kind,
      text: requirement.text,
      quote: requirement.anchor.quote,
    })),
    requirementMatches: result.requirementMatches.map((match) => ({
      requirementId: match.requirementId,
      claimId: match.claimId,
      status: match.status,
      reason: match.reason,
    })),
    probes: result.probes.map((probe) => ({
      id: probe.id,
      claimId: probe.claimId,
      interviewerId: probe.interviewerId,
      round: probe.round,
      question: probe.question,
      parent: probe.parentProbeId ?? null,
    })),
    verdicts: result.verdicts.map((verdict) => ({
      claimId: verdict.claimId,
      kind: verdict.kind,
      evidence: verdict.evidence.map((anchor) => anchor.quote),
    })),
    suggestions: result.suggestions.map((suggestion) => ({
      claimId: suggestion.claimId,
      before: suggestion.before,
      after: suggestion.after,
    })),
    counters: result.counters.map((item) => ({
      id: item.id,
      kind: item.kind,
      source: item.source,
      text: item.text,
      quote: item.anchor.quote,
    })),
    notices: result.notices,
    budget: result.budget,
    usage: result.usage,
  });
}

/**
 * 清掉上一轮留下、这一轮不再需要的**合成**卡带。
 *
 * 为什么需要：改一句提示词就换一批指纹，旧指纹的卡带不会被覆盖，只会变成孤儿躺在
 * 目录里——它们谁也读不到，却会让「卡带共 N 盘」这句话变成假话，也让后来的人以为
 * 某盘卡带被用上了。只删 model 等于 DEMO_MODEL 的那一批：用户用
 * CROSSEXAM_MODE=record 真录下来的卡带模型名不是它，一根汗毛都不许动。
 */
function pruneStaleCassettes(dir: string, keep: ReadonlySet<string>): string[] {
  const stale = listCassettes(dir).filter((item) => item.model === DEMO_MODEL && !keep.has(item.digest));
  const removed: string[] = [];
  for (const item of stale) {
    try {
      unlinkSync(cassettePath(dir, item.digest));
      removed.push(item.digest);
    } catch {
      // 删不掉不算致命：孤儿卡带只影响整洁，不影响回放。
    }
  }
  return removed;
}

/** 一次「合成跑 + 回放跑」：两遍必须逐项一致，否则这一组合的卡带就是脱节的 */
async function runOne(
  dir: string,
  scripted: ReturnType<typeof createDemoScriptedClient>,
  rerunScripted: ReturnType<typeof createDemoScriptedClient>,
  difficulty: Difficulty,
  style: RewriteStyle,
): Promise<{ run: DemoRun; result: RunSessionResult }> {
  const recordDb = openDatabase({ path: ':memory:' });
  let recordRun: RunSessionResult;
  let rerunRecordRun: RunSessionResult;
  let rerunFacts: RerunFacts;
  try {
    const firstId = newSessionId(recordDb, 'record', difficulty, style);
    recordRun = await runAndPersist({ db: recordDb, sessionId: firstId, client: scripted.client, model: 'scripted-demo' });
    // 第一场跑完就**全部采纳**：演示要展示的是「改完之后」，不是「改到一半」。
    // 只采纳一部分会让改后的简历随用户勾选而变，而卡带是按提示词指纹寻址的——
    // 到时候每一份「部分采纳」都得各录一套，成本天文数字。
    const revised = acceptRevisions(recordDb, firstId, listClaims(recordDb, firstId).map((claim) => claim.id));
    if (!revised.ok) throw new Error('演示场次的改写全部采纳失败：' + revised.error);
    const secondId = newSessionId(recordDb, 'record', difficulty, style, {
      resumeText: revised.view.text,
      parentSessionId: firstId,
    });
    rerunRecordRun = await runAndPersist({
      db: recordDb,
      sessionId: secondId,
      client: rerunScripted.client,
      model: 'scripted-demo',
    });
    rerunFacts = { before: DEMO_RESUME.length, after: revised.view.text.length, comparison: compareOf(recordDb, secondId) };
  } finally {
    closeDatabase(recordDb);
  }

  const replayDb = openDatabase({ path: ':memory:' });
  let replayRun: RunSessionResult;
  let rerunReplayRun: RunSessionResult;
  try {
    const firstId = newSessionId(replayDb, 'replay', difficulty, style);
    replayRun = await runAndPersist({ db: replayDb, sessionId: firstId, client: createReplayClient(dir), model: 'fixture' });
    const revised = acceptRevisions(replayDb, firstId, listClaims(replayDb, firstId).map((claim) => claim.id));
    if (!revised.ok) throw new Error('回放场次的改写全部采纳失败：' + revised.error);
    const secondId = newSessionId(replayDb, 'replay', difficulty, style, {
      resumeText: revised.view.text,
      parentSessionId: firstId,
    });
    rerunReplayRun = await runAndPersist({ db: replayDb, sessionId: secondId, client: createReplayClient(dir), model: 'fixture' });
  } finally {
    closeDatabase(replayDb);
  }

  const difficultyLabel = DIFFICULTY_LABEL[difficulty];
  const styleLabel = REWRITE_STYLE_LABEL[style];
  // 组合名两边都写出来：报错时只说「常规档」没法定位到底是哪一种组合坏了
  const label = difficultyLabel + '档 · ' + styleLabel;
  const problems: string[] = [];
  if (signatureOf(recordRun) !== signatureOf(replayRun)) {
    problems.push(label + '的回放结果与合成结果不一致：卡带与当前提示词已经脱节，请检查提示词改动后重跑 seed。');
  }
  if (replayRun.rejectedClaims.length === 0) {
    problems.push(label + '的演示里没有被拦下的主张：锚定闸门失去了可见的正面证据。');
  }
  // 温和档每人对一条主张只问一次，最容易变成「一条追问都没有」而没人发现。
  if (replayRun.probes.length === 0) {
    problems.push(label + '一条追问都没问出来：这一组合的演示等于没演示。');
  }

  // 第二场（改完再跑）的同一套自检。它不是「多跑一次」的附加项：
  // 界面上那个「改完再跑一遍」按钮点下去走的就是这条路，卡带缺一盘，
  // 评委看到的就是一句「找不到记录」。
  const rerunProblems: string[] = [];
  if (signatureOf(rerunRecordRun) !== signatureOf(rerunReplayRun)) {
    rerunProblems.push(label + '改完再跑那一次的回放结果与合成结果不一致：第二场的卡带与提示词已经脱节。');
  }
  if (rerunReplayRun.probes.length === 0) {
    rerunProblems.push(label + '改完再跑那一次一条追问都没问出来。');
  }
  if (rerunFacts.comparison === null) {
    rerunProblems.push(label + '改完再跑那一次没能和上一场对上：版本链断了，界面上会比不出任何东西。');
  } else {
    // 演示的立意是「改完会变好」。变好的条数为 0 不一定是 Bug，
    // 但**变差**一定是：那说明剧本把改后的简历判得更糟，这个故事讲反了。
    if (rerunFacts.comparison.improved === 0) {
      rerunProblems.push(label + '改完再跑那一次一条主张都没变好：演示里最重要的那句话说反了。');
    }
    if (rerunFacts.comparison.worsened > 0) {
      rerunProblems.push(label + '改完再跑那一次有 ' + String(rerunFacts.comparison.worsened) + ' 条主张变差了：改完反而更站不住，剧本写反了。');
    }
  }

  return {
    run: {
      difficulty,
      difficultyLabel,
      style,
      styleLabel,
      label,
      record: summarize(recordRun),
      replay: summarize(replayRun),
      ok: problems.length === 0 && rerunProblems.length === 0,
      problems: problems.concat(rerunProblems),
      signature: signatureOf(recordRun),
      rerun: {
        record: summarize(rerunRecordRun),
        replay: summarize(rerunReplayRun),
        resumeChars: { before: rerunFacts.before, after: rerunFacts.after },
        comparison: rerunFacts.comparison,
        ok: rerunProblems.length === 0,
        problems: rerunProblems,
        signature: signatureOf(rerunRecordRun),
      },
    },
    result: recordRun,
  };
}

/** 第二场的对比结果：只搬运 compareSessions 的结论，不在这里重算一遍 */
interface RerunFacts {
  before: number;
  after: number;
  comparison: DemoRerun['comparison'];
}

function compareOf(db: AnyDb, sessionId: string): DemoRerun['comparison'] {
  const view = compareSessions(db, sessionId);
  if (view === null || view.comparison === null) return null;
  const comparison: ClaimComparison = view.comparison;
  return {
    headline: comparison.headline,
    improved: comparison.improved.length,
    worsened: comparison.worsened.length,
    added: comparison.added.length,
    removed: comparison.removed.length,
    pairs: comparison.pairs.length,
    resumeChanged: view.resumeChanged,
  };
}

export async function seedDemoCassettes(opts: { dir: string }): Promise<DemoSeedReport> {
  // 追问强度三档 × 改写风格三档 = 九种组合，每种各跑一遍。
  // 两个维度都写进了提示词，所以每一种组合都是独立的一批卡带；
  // 不这么做的后果很具体：用户在界面上切一下档位，一点开跑就报找不到记录。
  const runs: DemoRun[] = [];
  const entries: DemoSeedEntry[] = [];
  const keep = new Set<string>();
  for (const difficulty of DIFFICULTIES) {
    for (const style of REWRITE_STYLES) {
      // 第一场与第二场各用一个**全新**的脚本客户端：演示脚本的「这条已经问过了」记忆
      // 挂在客户端实例上（scripted-demo.ts 的 ScriptState），共用一个实例时，
      // 它会以为自己已经问遍全场，第二场一条追问都不问——实测温和 10 条、后两档 0 条。
      const scripted = createDemoScriptedClient(opts.dir, 1);
      const rerunScripted = createDemoScriptedClient(opts.dir, 2);
      const one = await runOne(opts.dir, scripted, rerunScripted, difficulty, style);
      runs.push(one.run);
      for (const entry of scripted.entries.concat(rerunScripted.entries)) {
        // 同一份提示词（例如 answer 阶段既不含预算也不含风格）在多种组合下指纹相同，
        // 合并时按指纹去重：不去重会让「一共写出 N 盘卡带」这句话变成重复计数。
        if (keep.has(entry.digest)) continue;
        keep.add(entry.digest);
        entries.push(entry);
      }
    }
  }

  // 新卡带已经全部落盘（每一遍边跑边写），此刻清理旧指纹最安全：
  // 回放要用的那一批已经在了，删掉的都是这一轮谁也读不到的孤儿。
  const pruned = pruneStaleCassettes(opts.dir, keep);

  const normal = runs.filter(
    (item) => item.difficulty === DEFAULT_DIFFICULTY && item.style === DEFAULT_REWRITE_STYLE,
  )[0];
  if (normal === undefined) {
    throw new Error('默认组合（常规档 × 常规风格）没有跑出结果：DIFFICULTIES 与 REWRITE_STYLES 都必须包含默认值。');
  }

  const problems: string[] = [];
  const expected = DIFFICULTIES.length * REWRITE_STYLES.length;
  if (runs.length !== expected) {
    problems.push('组合数量对不上：预期 ' + String(expected) + ' 种组合，实际跑了 ' + String(runs.length) + ' 种。');
  }
  if (entries.length === 0) {
    problems.push('一盘卡带也没写出来：演示脚本没有覆盖到任何一个阶段的模型调用。');
  }
  // 逐阶段点名：编排层对单个阶段的失败是逐项容错的，
  // 脚本抛错时合成跑照样"成功"，只有到回放才炸。所以生成端必须自己点名。
  const required = ['extract', 'jd-extract', 'jd-merge', 'jd-match', 'probe', 'answer', 'verdict', 'suggest', 'counter'];
  const missing = required.filter((purpose) => !entries.some((entry) => entry.purpose === purpose));
  if (missing.length > 0) {
    problems.push(
      '演示脚本没有覆盖这些阶段：' +
        missing.join('、') +
        '。回放会在这些阶段报「找不到记录」，而合成跑不会报错——属于静默失败，必须在生成端拦下。',
    );
  }
  // 逐组的问题由 runOne 给出（套在同一个 problems 里，调用方只看一处）
  for (const item of runs) {
    for (const problem of item.problems) problems.push(problem);
  }

  return {
    cassetteDir: opts.dir,
    entries,
    runs,
    record: normal.record,
    replay: normal.replay,
    ok: problems.length === 0,
    problems,
    pruned,
    signature: normal.signature,
  };
}
