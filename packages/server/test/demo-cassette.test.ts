/**
 * 离线演示的两道门禁。
 *
 * 为什么用真卡带跑一遍 HTTP：这是「评委点一下就能看到完整质询」这句话的机器证明。
 * 卡带与提示词一旦脱节（改了一个字、换了一版渲染），这条测试就红——
 * 它比人肉回归可靠，因为提示词指纹是算出来的，不是记出来的。
 *
 * 第二条测试盯的是**静默失败**：编排层对单个阶段的失败是逐项容错的，
 * 演示脚本抛错时合成跑照样"成功"，只有回放到那一步才炸。
 * 所以生成器必须自己点名"五个阶段是否都录到了"。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { seedDemoCassettes } from '../src/demo-seed.ts';
import { createApp } from '../src/http/app.ts';
import type { RunSummary } from '../src/http/app.ts';
import { CASSETTE_VERSION, listCassettes, readCassette, writeCassette } from '../src/llm/cassette.ts';
import type { CassetteEntry } from '../src/llm/cassette.ts';
import { EMPTY_USAGE } from '../src/llm/types.ts';
import { createReplayClient } from '../src/llm/replay.ts';
import type { SessionView } from '../src/pipeline.ts';
import { closeDatabase, openDatabase } from '../src/store/index.ts';

/** 仓库里已提交的卡带目录（本文件在 packages/server/test 下，往上是仓库根） */
const FIXTURE_DIR = fileURLToPath(new URL('../../../fixtures/llm', import.meta.url));
/** 演示要录到的全部阶段：漏一个，离线回放就会在那一阶段掉进「查不到卡带」 */
const ALL_PURPOSES = [
  'extract',
  'jd-extract',
  'jd-merge',
  'jd-match',
  'probe',
  'answer',
  'verdict',
  'suggest',
  'counter',
];

const tempDirs: string[] = [];

function newTempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'crossexam-' + tag + '-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** 造一盘看起来像真的的卡带：只用于验证清理规则会不会误伤。 */
function fakeEntry(digest: string, model: string): CassetteEntry {
  return {
    version: CASSETTE_VERSION,
    digest,
    purpose: 'extract',
    model,
    recordedAt: '2026-10-26T00:00:00.000Z',
    request: { system: 'x', messages: [], temperature: null, maxTokens: null, json: true },
    response: { text: '{}', usage: EMPTY_USAGE },
  };
}

/** 走真实 HTTP 接口跑一遍示例简历：创建会话 -> 同步开跑 -> 读摘要与落库后的详情 */
async function runDemoOverHttp(
  cassetteDir: string,
  difficulty = '',
  style = '',
): Promise<{ summary: RunSummary; view: SessionView }> {
  const db = openDatabase({ path: ':memory:' });
  try {
    const app = createApp({ db, client: createReplayClient(cassetteDir), cassetteDir });
    const body: Record<string, unknown> = { useDemo: true };
    if (difficulty !== '') body['difficulty'] = difficulty;
    if (style !== '') body['style'] = style;
    const created = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as { id: string };

    const res = await app.request('/api/sessions/' + session.id + '/run?stream=0', { method: 'POST' });
    expect(res.status).toBe(200);
    const summary = (await res.json()) as RunSummary;

    const detail = await app.request('/api/sessions/' + session.id);
    expect(detail.status).toBe(200);
    const view = (await detail.json()) as SessionView;
    return { summary, view };
  } finally {
    closeDatabase(db);
  }
}

describe('离线演示（合成卡带）', () => {
  it('仓库里的卡带能让示例简历在零网络下跑完整场质询', async () => {
    const { summary, view } = await runDemoOverHttp(FIXTURE_DIR);

    expect(summary.claims).toBe(5);
    expect(summary.rejectedClaims).toBe(1);
    expect(summary.rounds).toBe(3);
    expect(summary.probes).toBe(10);
    expect(summary.suggestions).toBe(4);
    expect(summary.counters).toBe(4);

    // 四种判定各有戏：站得住 / 表述过度 / 无法回答 / 证据缺失（两条）
    const kinds = summary.verdicts.map((verdict) => verdict.kind).sort();
    expect(kinds).toEqual(['overstated', 'solid', 'unanswerable', 'unsupported', 'unsupported']);

    // 第三轮没有新问题就收尾，而不是空转烧调用
    expect(summary.notices.some((notice) => notice.indexOf('没有任何新的追问') >= 0)).toBe(true);
    expect(summary.usage.outputTokens).toBeGreaterThan(0);

    // P8：岗位要求那条链路在离线演示里也必须看得见完整体。
    // 要是演示脚本不再吐第二处锚，这场回放就只剩「面试官凭经验问」，
    // 评委看到的 P8 等于没做——所以这里盯的是「双锚点真的落到了业务表里」。
    expect(view.requirements.length).toBeGreaterThan(0);
    expect(view.requirementSummary.total).toBe(view.requirements.length);
    const anchored = view.probes.filter((probe) => probe.requirementId != null && probe.jdAnchor != null);
    expect(anchored.length).toBeGreaterThan(0);
    expect((anchored[0]?.jdAnchor?.quote.length ?? 0) > 3).toBe(true);

    // P10-A4：反问也要在离线演示里看得见，而且两种依据都得出现过——
    // 只依据 JD 的话，评委看不到「反问也能锚回简历原话」这一半。
    expect(view.counters.length).toBe(4);
    const sources = view.counters.map((item) => item.source).sort();
    expect(sources).toEqual(['jd', 'jd', 'resume', 'resume']);
    expect(view.counters.every((item) => item.anchor.quote.length > 3)).toBe(true);
    expect(view.counters.every((item) => item.reply !== '')).toBe(true);
  });

  // 追问强度换一档，提示词里的预算就换一段，指纹跟着换——所以卡带必须按档位各录一份。
  // 这条测试盯的就是「三档都不缺卡带」：漏录一档，用户一切档就掉进「查不到卡带」，
  // 而那正是最像产品坏了的一种失败。
  it('三档追问强度都能在零网络下跑完，且档位真的流进了契约', async () => {
    const rounds: number[] = [];
    const perInterviewer: number[] = [];
    for (const difficulty of ['gentle', 'normal', 'hard']) {
      const { summary, view } = await runDemoOverHttp(FIXTURE_DIR, difficulty);
      expect(summary.claims).toBe(5);
      expect(summary.suggestions).toBe(4);
      expect(summary.probes).toBeGreaterThan(0);
      expect(view.difficulty).toBe(difficulty);
      const budget = view.contracts[0]?.contract.budget;
      rounds.push(budget?.maxRoundsPerClaim ?? 0);
      perInterviewer.push(budget?.maxProbesPerInterviewerPerClaim ?? 0);
    }
    // 温和 2 轮·每人 1 次 / 常规 3 轮·每人 2 次 / 挑刺 4 轮·每人 2 次：
    // 档位不是界面上的装饰，它改的是每一场真正拿去渲染提示词的那份契约。
    expect(rounds).toEqual([2, 3, 4]);
    expect(perInterviewer).toEqual([1, 2, 2]);
  });

  // 改写风格换一档，改写阶段的系统提示词就换一段收敛说明，指纹跟着换；
  // 而如果脚本对档位无感知，三档会吐出同一批建议——那界面上切档位就只是换了一句说明。
  // 所以这条测试同时盯两件事：三档都跑得通，以及三档改出来的句子真的不一样。
  it('三档改写风格都能在零网络下跑完，且改出来的句子真的不一样', async () => {
    const afters: Record<string, string[]> = {};
    for (const style of ['conservative', 'normal', 'bold']) {
      const { summary, view } = await runDemoOverHttp(FIXTURE_DIR, '', style);
      expect(summary.claims).toBe(5);
      expect(summary.suggestions).toBe(4);
      expect(view.style).toBe(style);
      // suggestions 里既有「改了」也有「不用改」（站得住的那条），这里只取真的改出来的句子
      afters[style] = view.suggestions
        .filter((item) => item.status === 'suggested' && item.suggestion !== null)
        .map((item) => item.suggestion?.after ?? '');
    }
    const conservative = afters['conservative'] ?? [];
    const normal = afters['normal'] ?? [];
    const bold = afters['bold'] ?? [];
    expect(conservative.length).toBe(4);
    expect(new Set(conservative).size).toBe(4);
    // 三条红线在任何档位下都不变：保守档不许比常规档更长（它是做减法的），
    // 敢改档不许更短——否则「敢改/保守」两个名字就没有说服力。
    const total = (list: string[]): number => list.reduce((sum, item) => sum + item.length, 0);
    expect(total(conservative) < total(normal)).toBe(true);
    expect(total(bold) > total(normal)).toBe(true);
  });
  it('生成器写出的卡带覆盖九个阶段，且两遍结果一致', async () => {
    const dir = newTempDir('demo-seed');
    const report = await seedDemoCassettes({ dir });

    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.replay).toEqual(report.record);

    const summaries = listCassettes(dir);
    expect(summaries).toHaveLength(report.entries.length);
    for (const purpose of ALL_PURPOSES) {
      expect(summaries.filter((item) => item.purpose === purpose).length).toBeGreaterThan(0);
    }

    // 合成数据必须一眼可辨：模型名固定、录制时间固定（重跑逐字节相同）
    expect(summaries.every((item) => item.model === 'scripted-demo')).toBe(true);
    const first = summaries[0];
    expect(first).toBeDefined();
    const entry = first === undefined ? null : readCassette(dir, first.digest);
    expect(entry?.recordedAt).toBe('2026-10-26T00:00:00.000Z');
    expect(entry?.version).toBe(1);
  });

  it('重跑会清掉旧指纹的合成卡带，但不动真人录下来的卡带', async () => {
    const dir = newTempDir('demo-prune');
    const first = await seedDemoCassettes({ dir });
    expect(first.pruned).toEqual([]);

    // 两盘这一轮不再需要的卡带：一盘是旧指纹的合成卡带（改提示词后的孤儿），
    // 一盘是真人用 CROSSEXAM_MODE=record 录下来的真实卡带——后者一根汗毛都不许动。
    const staleDigest = 'a'.repeat(24);
    const realDigest = 'b'.repeat(24);
    writeCassette(dir, fakeEntry(staleDigest, 'scripted-demo'));
    writeCassette(dir, fakeEntry(realDigest, 'deepseek-chat'));

    const second = await seedDemoCassettes({ dir });

    expect(second.pruned).toEqual([staleDigest]);
    const left = listCassettes(dir).map((item) => item.digest);
    expect(left).not.toContain(staleDigest);
    expect(left).toContain(realDigest);
    expect(left).toHaveLength(first.entries.length + 1);
  });
});