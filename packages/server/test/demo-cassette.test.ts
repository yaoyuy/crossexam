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
import { closeDatabase, openDatabase } from '../src/store/index.ts';

/** 仓库里已提交的卡带目录（本文件在 packages/server/test 下，往上是仓库根） */
const FIXTURE_DIR = fileURLToPath(new URL('../../../fixtures/llm', import.meta.url));
const ALL_PURPOSES = ['extract', 'probe', 'answer', 'verdict', 'suggest'];

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

/** 走真实 HTTP 接口跑一遍示例简历：创建会话 -> 同步开跑 -> 读摘要 */
async function runDemoOverHttp(cassetteDir: string): Promise<RunSummary> {
  const db = openDatabase({ path: ':memory:' });
  try {
    const app = createApp({ db, client: createReplayClient(cassetteDir), cassetteDir });
    const created = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ useDemo: true }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as { id: string };

    const res = await app.request('/api/sessions/' + session.id + '/run?stream=0', { method: 'POST' });
    expect(res.status).toBe(200);
    return (await res.json()) as RunSummary;
  } finally {
    closeDatabase(db);
  }
}

describe('离线演示（合成卡带）', () => {
  it('仓库里的卡带能让示例简历在零网络下跑完整场质询', async () => {
    const summary = await runDemoOverHttp(FIXTURE_DIR);

    expect(summary.claims).toBe(5);
    expect(summary.rejectedClaims).toBe(1);
    expect(summary.rounds).toBe(3);
    expect(summary.probes).toBe(10);
    expect(summary.suggestions).toBe(4);

    // 四种判定各有戏：站得住 / 表述过度 / 无法回答 / 证据缺失（两条）
    const kinds = summary.verdicts.map((verdict) => verdict.kind).sort();
    expect(kinds).toEqual(['overstated', 'solid', 'unanswerable', 'unsupported', 'unsupported']);

    // 第三轮没有新问题就收尾，而不是空转烧调用
    expect(summary.notices.some((notice) => notice.indexOf('没有任何新的追问') >= 0)).toBe(true);
    expect(summary.usage.outputTokens).toBeGreaterThan(0);
  });

  it('生成器写出的卡带覆盖五个阶段，且两遍结果一致', async () => {
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
