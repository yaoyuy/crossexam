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
import { DEFAULT_DIFFICULTY, DIFFICULTIES, DIFFICULTY_LABEL, budgetOf, jdIdOf, jdTitleOf, shortHash, stableStringify } from '@crossexam/shared';
import type { Difficulty } from '@crossexam/shared';
import { DEMO_JD, DEMO_JD_TITLE, DEMO_RESUME, DEMO_TITLE } from './demo-content.ts';
import { DEMO_MODEL, createDemoScriptedClient } from './llm/scripted-demo.ts';
import type { DemoSeedEntry } from './llm/scripted-demo.ts';
import { cassettePath, listCassettes } from './llm/cassette.ts';
import { createReplayClient } from './llm/replay.ts';
import { closeDatabase, insertJds, insertSession, openDatabase } from './store/index.ts';
import type { StoredLlmMode } from './store/index.ts';
import { runAndPersist } from './pipeline.ts';
import type { RunSessionResult } from './orchestrator/run.ts';

type AnyDb = ReturnType<typeof openDatabase>;

export interface DemoRunSummary {
  rounds: number;
  claims: number;
  probes: number;
  suggestions: number;
  rejectedClaims: number;
  /** 判定种类 -> 条数，例如 { solid: 1, overstated: 1 } */
  verdicts: Record<string, number>;
  notices: string[];
  usageTokens: number;
}

export interface DemoDifficultyRun {
  difficulty: Difficulty;
  label: string;
  record: DemoRunSummary;
  replay: DemoRunSummary;
  /** 这一档两次跑的结果是否逐项一致 */
  ok: boolean;
  problems: string[];
  signature: string;
}

export interface DemoSeedReport {
  cassetteDir: string;
  entries: DemoSeedEntry[];
  /** 三档各自跑一遍：档位改的是预算，而预算写在渲染出的提示词里，所以每档都要有自己的卡带 */
  runs: DemoDifficultyRun[];
  /** 常规档的那一份。顶层保留它，是为了不让既有消费者（CLI 打印、测试断言）跟着改一遍 */
  record: DemoRunSummary;
  replay: DemoRunSummary;
  /** 三档全部逐项一致才算通过 */
  ok: boolean;
  problems: string[];
  /** 这一轮不再需要、已被清理掉的旧合成卡带（提示词改动后的孤儿） */
  pruned: string[];
  /** 逐字节可比的签名（常规档）：写进日志、测试断言、出问题时 diff 都靠它 */
  signature: string;
}

function newSessionId(db: AnyDb, mode: StoredLlmMode, difficulty: Difficulty): string {
  const id = insertSession(db, {
    jobTitle: DEMO_TITLE,
    jdText: DEMO_JD,
    resumeText: DEMO_RESUME,
    resumeHash: shortHash(DEMO_RESUME, 24),
    llmMode: mode,
    budget: { config: budgetOf(difficulty), totalProbes: 0, claims: {} },
    meta: { source: 'demo-seed', difficulty },
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

/** 一次「合成跑 + 回放跑」：两遍必须逐项一致，否则这一档的卡带就是脱节的 */
async function runOneDifficulty(
  dir: string,
  scripted: ReturnType<typeof createDemoScriptedClient>,
  difficulty: Difficulty,
): Promise<{ run: DemoDifficultyRun; result: RunSessionResult }> {
  const recordDb = openDatabase({ path: ':memory:' });
  let recordRun: RunSessionResult;
  try {
    recordRun = await runAndPersist({
      db: recordDb,
      sessionId: newSessionId(recordDb, 'record', difficulty),
      client: scripted.client,
      model: 'scripted-demo',
    });
  } finally {
    closeDatabase(recordDb);
  }

  const replayDb = openDatabase({ path: ':memory:' });
  let replayRun: RunSessionResult;
  try {
    replayRun = await runAndPersist({
      db: replayDb,
      sessionId: newSessionId(replayDb, 'replay', difficulty),
      client: createReplayClient(dir),
      model: 'fixture',
    });
  } finally {
    closeDatabase(replayDb);
  }

  const label = DIFFICULTY_LABEL[difficulty];
  const problems: string[] = [];
  if (signatureOf(recordRun) !== signatureOf(replayRun)) {
    problems.push(label + '档的回放结果与合成结果不一致：卡带与当前提示词已经脱节，请检查提示词改动后重跑 seed。');
  }
  if (replayRun.rejectedClaims.length === 0) {
    problems.push(label + '档的演示里没有被拦下的主张：锚定闸门失去了可见的正面证据。');
  }
  // 温和档每人对一条主张只问一次，最容易变成「一条追问都没有」而没人发现。
  if (replayRun.probes.length === 0) {
    problems.push(label + '档一条追问都没问出来：这一档的演示等于没演示。');
  }
  return {
    run: {
      difficulty,
      label,
      record: summarize(recordRun),
      replay: summarize(replayRun),
      ok: problems.length === 0,
      problems,
      signature: signatureOf(recordRun),
    },
    result: recordRun,
  };
}

export async function seedDemoCassettes(opts: { dir: string }): Promise<DemoSeedReport> {
  // 三档各跑一遍。预算写在渲染出的提示词里，所以档位不同就是不同的卡带；
  // 不这么做的后果很具体：用户在界面上把档位切到「挑刺」，一点开跑就报找不到记录。
  const runs: DemoDifficultyRun[] = [];
  const entries: DemoSeedEntry[] = [];
  const keep = new Set<string>();
  for (const difficulty of DIFFICULTIES) {
    // 每一档都必须是一个**全新**的脚本客户端：演示脚本的「这条已经问过了」记忆
    // 挂在客户端实例上（scripted-demo.ts 的 ScriptState），复用一个实例跑第二场时，
    // 它会以为自己已经问遍全场，第二场一条追问都不问——实测温和 10 条、后两档 0 条。
    const scripted = createDemoScriptedClient(opts.dir);
    const one = await runOneDifficulty(opts.dir, scripted, difficulty);
    runs.push(one.run);
    for (const entry of scripted.entries) {
      // 同一份提示词（例如 answer 阶段不含预算）在三档下指纹相同，合并时按指纹去重：
      // 不去重会让「一共写出 N 盘卡带」这句话变成重复计数。
      if (keep.has(entry.digest)) continue;
      keep.add(entry.digest);
      entries.push(entry);
    }
  }

  // 新卡带已经全部落盘（每一遍边跑边写），此刻清理旧指纹最安全：
  // 回放要用的那一批已经在了，删掉的都是这一轮谁也读不到的孤儿。
  const pruned = pruneStaleCassettes(opts.dir, keep);

  const normal = runs.filter((item) => item.difficulty === DEFAULT_DIFFICULTY)[0];
  if (normal === undefined) {
    throw new Error('常规档没有跑出结果：DIFFICULTIES 里必须包含默认档。');
  }

  const problems: string[] = [];
  if (runs.length !== DIFFICULTIES.length) {
    problems.push('档位数量对不上：预期 ' + String(DIFFICULTIES.length) + ' 档，实际跑了 ' + String(runs.length) + ' 档。');
  }
  if (entries.length === 0) {
    problems.push('一盘卡带也没写出来：演示脚本没有覆盖到任何一个阶段的模型调用。');
  }
  // 逐阶段点名：编排层对单个阶段的失败是逐项容错的，
  // 脚本抛错时合成跑照样"成功"，只有到回放才炸。所以生成端必须自己点名。
  const required = ['extract', 'jd-extract', 'jd-merge', 'jd-match', 'probe', 'answer', 'verdict', 'suggest'];
  const missing = required.filter((purpose) => !entries.some((entry) => entry.purpose === purpose));
  if (missing.length > 0) {
    problems.push(
      '演示脚本没有覆盖这些阶段：' +
        missing.join('、') +
        '。回放会在这些阶段报「找不到记录」，而合成跑不会报错——属于静默失败，必须在生成端拦下。',
    );
  }
  // 逐档的问题由 runOneDifficulty 给出（套在同一个 problems 里，调用方只看一处）
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
