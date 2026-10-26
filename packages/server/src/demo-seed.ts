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
import { DEFAULT_BUDGET, shortHash, stableStringify } from '@crossexam/shared';
import { DEMO_JD, DEMO_RESUME, DEMO_TITLE } from './demo-content.ts';
import { DEMO_MODEL, createDemoScriptedClient } from './llm/scripted-demo.ts';
import type { DemoSeedEntry } from './llm/scripted-demo.ts';
import { cassettePath, listCassettes } from './llm/cassette.ts';
import { createReplayClient } from './llm/replay.ts';
import { closeDatabase, insertSession, openDatabase } from './store/index.ts';
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

export interface DemoSeedReport {
  cassetteDir: string;
  entries: DemoSeedEntry[];
  record: DemoRunSummary;
  replay: DemoRunSummary;
  /** 两次跑的结果是否逐项一致 */
  ok: boolean;
  problems: string[];
  /** 这一轮不再需要、已被清理掉的旧合成卡带（提示词改动后的孤儿） */
  pruned: string[];
  /** 逐字节可比的签名：写进日志、测试断言、出问题时 diff 都靠它 */
  signature: string;
}

function newSessionId(db: AnyDb, mode: StoredLlmMode): string {
  return insertSession(db, {
    jobTitle: DEMO_TITLE,
    jdText: DEMO_JD,
    resumeText: DEMO_RESUME,
    resumeHash: shortHash(DEMO_RESUME, 24),
    llmMode: mode,
    budget: { config: DEFAULT_BUDGET, totalProbes: 0, claims: {} },
    meta: { source: 'demo-seed' },
  });
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

export async function seedDemoCassettes(opts: { dir: string }): Promise<DemoSeedReport> {
  const scripted = createDemoScriptedClient(opts.dir);

  const recordDb = openDatabase({ path: ':memory:' });
  let recordRun: RunSessionResult;
  try {
    recordRun = await runAndPersist({
      db: recordDb,
      sessionId: newSessionId(recordDb, 'record'),
      client: scripted.client,
      model: 'scripted-demo',
    });
  } finally {
    closeDatabase(recordDb);
  }

  // 新卡带已经全部落盘（第一遍边跑边写），此刻清理旧指纹最安全：
  // 回放要用的那一批已经在了，删掉的都是这一轮谁也读不到的孤儿。
  const pruned = pruneStaleCassettes(opts.dir, new Set(scripted.entries.map((entry) => entry.digest)));

  const replayDb = openDatabase({ path: ':memory:' });
  let replayRun: RunSessionResult;
  try {
    replayRun = await runAndPersist({
      db: replayDb,
      sessionId: newSessionId(replayDb, 'replay'),
      client: createReplayClient(opts.dir),
      model: 'fixture',
    });
  } finally {
    closeDatabase(replayDb);
  }

  const problems: string[] = [];
  if (scripted.entries.length === 0) {
    problems.push('一盘卡带也没写出来：演示脚本没有覆盖到任何一个阶段的模型调用。');
  }
  // 逐阶段点名：编排层对单个阶段的失败是逐项容错的，
  // 脚本抛错时合成跑照样"成功"，只有到回放才炸。所以生成端必须自己点名。
  const required = ['extract', 'probe', 'answer', 'verdict', 'suggest'];
  const missing = required.filter((purpose) => !scripted.entries.some((entry) => entry.purpose === purpose));
  if (missing.length > 0) {
    problems.push(
      '演示脚本没有覆盖这些阶段：' +
        missing.join('、') +
        '。回放会在这些阶段报「找不到记录」，而合成跑不会报错——属于静默失败，必须在生成端拦下。',
    );
  }
  if (signatureOf(recordRun) !== signatureOf(replayRun)) {
    problems.push('回放结果与合成结果不一致：卡带与当前提示词已经脱节，请检查提示词改动后重跑 seed。');
  }
  if (replayRun.rejectedClaims.length === 0) {
    problems.push('演示里没有被拦下的主张：锚定闸门失去了可见的正面证据。');
  }

  return {
    cassetteDir: opts.dir,
    entries: scripted.entries,
    record: summarize(recordRun),
    replay: summarize(replayRun),
    ok: problems.length === 0,
    problems,
    pruned,
    signature: signatureOf(recordRun),
  };
}
