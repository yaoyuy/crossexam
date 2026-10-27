#!/usr/bin/env node
/**
 * 命令行：生成离线演示卡带，并自检回放能不能跑通。
 *
 * 为什么要有这条命令：这是「没有 API Key 也能 10 分钟复现」的生成端。
 * 复现的人只需要 npm install && npm run seed:demo && npm run dev，
 * 不需要 Key、不需要联网、不需要等待模型。
 *
 * 用法：
 *   npm run seed:demo
 *   npm run seed:demo -- --dir fixtures/llm
 */

import { resolve } from 'node:path';
import { shortHash, VERDICT_LABEL } from '@crossexam/shared';
import { defaultCassetteDir } from '../llm/index.ts';
import { seedDemoCassettes } from '../demo-seed.ts';
import type { DemoRunSummary, DemoSeedReport } from '../demo-seed.ts';

const HELP = [
  'CrossExam 演示卡带生成器',
  '',
  '用法：',
  '  node packages/server/src/bin/seed-demo.ts [--dir <目录>] [--help]',
  '',
  '选项：',
  '  --dir <目录>   卡带写入目录，默认 fixtures/llm（可用 CROSSEXAM_FIXTURES 覆盖）',
  '  --help         显示这段说明',
  '',
  '它会按三种追问强度（温和 / 常规 / 挑刺）× 三种改写风格（保守 / 常规 / 敢改）各跑两遍演示沙盘：第一遍用确定性脚本客户端',
  '边跑边录卡带，第二遍用只读回放客户端重跑并比对签名。任何一档对不上就退出码 1。',
].join(String.fromCharCode(10));

function argValue(name: string): string | null {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === name) return argv[i + 1] ?? null;
    if (item !== undefined && item.startsWith(name + '=')) return item.slice(name.length + 1);
  }
  return null;
}

function labelOf(kind: string): string {
  const table = VERDICT_LABEL as Record<string, string>;
  return table[kind] ?? kind;
}

function verdictLine(verdicts: Record<string, number>): string {
  const kinds = Object.keys(verdicts);
  if (kinds.length === 0) return '无判定';
  return kinds.map((kind) => labelOf(kind) + ' ' + verdicts[kind] + ' 条').join(' / ');
}

function summaryLine(summary: DemoRunSummary): string {
  return [
    summary.rounds + ' 轮',
    summary.claims + ' 条主张',
    summary.probes + ' 次追问',
    '判定 ' + verdictLine(summary.verdicts),
    summary.suggestions + ' 条改写建议',
    '拦下 ' + summary.rejectedClaims + ' 条',
    '估算 token ' + summary.usageTokens,
  ].join(' · ');
}

function purposeLine(entries: DemoSeedReport['entries']): string {
  const counts: Record<string, number> = {};
  for (const entry of entries) counts[entry.purpose] = (counts[entry.purpose] ?? 0) + 1;
  const parts = Object.keys(counts).map((purpose) => purpose + ' ' + counts[purpose]);
  return entries.length + ' 条' + (parts.length > 0 ? '（' + parts.join(' / ') + '）' : '');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.indexOf('--help') >= 0 || argv.indexOf('-h') >= 0) {
    console.log(HELP);
    return;
  }

  const explicit = argValue('--dir');
  const dir = resolve(explicit === null || explicit === '' ? defaultCassetteDir() : explicit);
  console.log('卡带目录：' + dir);

  const report = await seedDemoCassettes({ dir });

  console.log('写出卡带：' + purposeLine(report.entries));
  if (report.pruned.length > 0) {
    console.log('清理旧卡带：' + report.pruned.length + ' 条（提示词改过，旧指纹已经没人读得到）');
  }
  // 逐组报一遍：强度与风格都写进提示词，所以每种组合都是独立的一批卡带，
  // 只报默认组合会让人以为「切到挑刺或敢改也能离线跑」，而实际上很可能没有那批卡带。
  for (const run of report.runs) {
    console.log('【' + run.label + '】合成脚本：' + summaryLine(run.record));
    console.log('【' + run.label + '】只读回放：' + summaryLine(run.replay));
  }

  if (!report.ok) {
    console.log('自检：失败');
    for (const problem of report.problems) console.log('  - ' + problem);
    process.exitCode = 1;
    return;
  }

  console.log('自检：通过（' + String(report.runs.length) + ' 种组合各自两遍签名一致 · 默认组合 ' + shortHash(report.signature, 12) + '）');
  console.log('');
  console.log('下一步：CROSSEXAM_MODE=replay npm run dev 然后打开服务地址点「示例简历」');
}

await main();
