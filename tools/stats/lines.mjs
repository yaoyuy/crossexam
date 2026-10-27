#!/usr/bin/env node
// 代码规模：技术文档 3.7.1 的那张表就是这条命令的输出。
//
// 为什么做成命令：表里的数字以前是手工量一次写进文档的，改完代码就会悄悄过期
// （F27：同一事实写在两份文档里会长出两个数字）。量法写死在代码里，谁都能重跑、也都能对账。
//
// 口径：只数行（文件末尾没有换行的最后一行也算一行），不数空行与注释——
// 判断「这行算不算」需要解析器，而这张表要说明的是规模量级与测试密度，不是精确度。
// 源码与测试按路径里的 test 目录分开：packages/*/test 与 tools/*/test 都算测试行。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const MODULES = [
  { name: 'packages/shared/src', roots: ['packages/shared/src', 'packages/shared/test'], exts: ['.ts'], note: '纯函数与数据' },
  { name: 'packages/server/src', roots: ['packages/server/src', 'packages/server/test'], exts: ['.ts'], note: '编排 + IO + 导入解析' },
  { name: 'packages/web/src', roots: ['packages/web/src', 'packages/web/test'], exts: ['.ts', '.tsx'], note: '界面（只计 .ts/.tsx）' },
  { name: 'tools/', roots: ['tools'], exts: ['.mjs'], note: '导出器 / 冒烟 / 截图 / 点测 / 复现 / 文档构建' },
];

function walk(dir, exts, out) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(path, exts, out);
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      out.push(path);
    }
  }
  return out;
}

function lineCount(file) {
  const text = readFileSync(file, 'utf8');
  const parts = text.split(String.fromCharCode(10)).length;
  return text.endsWith(String.fromCharCode(10)) ? parts - 1 : parts;
}

function count(files) {
  let total = 0;
  for (const file of files) total += lineCount(file);
  return total;
}

function isTest(path) {
  return path.split(/[\\/]/).includes('test');
}

console.log('| 模块 | 源码行 | 测试行 | 说明 |');
console.log('| --- | --- | --- | --- |');
let srcTotal = 0;
let testTotal = 0;
for (const mod of MODULES) {
  let files = [];
  for (const root2 of mod.roots) files = files.concat(walk(join(root, root2), mod.exts, []));
  const src = count(files.filter((path) => !isTest(path)));
  const test = count(files.filter(isTest));
  srcTotal += src;
  testTotal += test;
  console.log('| ' + mod.name + ' | ' + String(src) + ' | ' + String(test) + ' | ' + mod.note + ' |');
}
const ratio = srcTotal === 0 ? 0 : Math.round((testTotal / srcTotal) * 100) / 100;
console.log('| **合计** | **' + String(srcTotal) + '** | **' + String(testTotal) + '** | 测试/源码 ≈ ' + String(ratio) + ' |');

// 界面的 CSS 不在上面（只计 .ts/.tsx），单独报一行，免得文档里那句话过期。
console.log('index.css: ' + String(lineCount(join(root, 'packages/web/src/index.css'))) + ' 行');
