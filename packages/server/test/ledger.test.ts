/**
 * 判定台账（.xlsx）的门禁。
 *
 * 一、格式：自己拼的 zip + 五份 XML，出得来还要读得回去——用仓里的 readZip 解回来，
 *     逐份点名固定 XML 是否存在，再确认五张表的表名与关键内容都在。
 * 二、确定性与诚实：同一场两次导出逐字节相同（zip 时间戳写死，否则版本库里每次都会多一个「变了但没变」的文件）；
 *     台账里的条数必须等于库里的条数——数字全从库里算，不许在这里再判一次（与 ADR-0019 同一条纪律）。
 */

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.ts';
import { readZip } from '../src/import/zip.ts';
import { createReplayClient } from '../src/llm/replay.ts';
import { closeDatabase, openDatabase } from '../src/store/index.ts';
import { crc32, safeSheetName, writeXlsx } from '../src/xlsx.ts';

const FIXTURE_DIR = fileURLToPath(new URL('../../../fixtures/llm', import.meta.url));

/** 走真实 HTTP 跑一遍示例简历：拿到会话 id、应用实例与库里记的主张条数 */
async function demoSession() {
  const db = openDatabase({ path: ':memory:' });
  const app = createApp({ db, client: createReplayClient(FIXTURE_DIR), cassetteDir: FIXTURE_DIR });
  const created = await app.request('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ useDemo: true }),
  });
  expect(created.status).toBe(201);
  const session = (await created.json()) as { id: string };
  const run = await app.request('/api/sessions/' + session.id + '/run?stream=0', { method: 'POST' });
  expect(run.status).toBe(200);
  const detail = await app.request('/api/sessions/' + session.id);
  const view = (await detail.json()) as { claims: unknown[] };
  return { id: session.id, app, db, claims: view.claims.length };
}

describe('xlsx 写入器', () => {
  it('crc32 用的是标准多项式：拿公认向量对一下', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new TextEncoder().encode(''))).toBe(0);
  });

  it('表名按 Excel 的规则收：31 字符上限、几个非法字符换空格、空名有兜底', () => {
    expect(safeSheetName('判定台账', '表1')).toBe('判定台账');
    expect(safeSheetName('a/b:c?d*e[f]g', '表1')).toBe('a b c d e f g');
    expect(safeSheetName('   ', '表1')).toBe('表1');
    expect(safeSheetName('x'.repeat(40), '表1').length).toBe(31);
  });

  it('同一份表写两遍逐字节相同', () => {
    const sheets = [{ name: '一', columns: ['甲', '乙'], rows: [['a', 1], ['b', 2]] }];
    expect(writeXlsx(sheets).equals(writeXlsx(sheets))).toBe(true);
  });
});

describe('判定台账接口', () => {
  it('下载得到一个 xlsx：五份固定 XML 齐、五张表都在、内容里有这一场的判定', async () => {
    const { id, app, db, claims } = await demoSession();
    try {
      const res = await app.request('/api/sessions/' + id + '/ledger.xlsx');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('spreadsheetml.sheet');
      expect(res.headers.get('content-disposition')).toContain('crossexam-ledger-' + id);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const entries = readZip(bytes);
      const names = entries.map((entry) => entry.name);
      for (const fixed of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml']) {
        expect(names).toContain(fixed);
      }
      expect(names).toContain('xl/worksheets/sheet5.xml');
      const decoder = new TextDecoder();
      const at = (name: string): string => decoder.decode(entries.find((entry) => entry.name === name)?.data ?? new Uint8Array());
      const workbook = at('xl/workbook.xml');
      for (const title of ['这一场', '判定台账', '追问明细', '岗位对照', '被拦下的']) {
        expect(workbook).toContain(title);
      }
      // 数字单元格走 <v>，文本走 <t>：这里断言的是「主张条数」那一行的数值与库里一致
      expect(at('xl/worksheets/sheet1.xml')).toContain('<v>' + String(claims) + '</v>');
      expect(at('xl/worksheets/sheet2.xml')).toContain('站得住');
      // 「被拦下的」那张表必须真的记着工具丢过什么，不是一张空表
      expect(at('xl/worksheets/sheet5.xml')).toContain('精通分布式事务与高并发架构');
      expect(at('xl/worksheets/sheet5.xml')).toContain('找不到');
    } finally {
      closeDatabase(db);
    }
  });

  it('两次下载逐字节相同：台账是可归档的产物，不是每次都有点不一样的报告', async () => {
    const { id, app, db } = await demoSession();
    try {
      const url = '/api/sessions/' + id + '/ledger.xlsx';
      const first = new Uint8Array(await (await app.request(url)).arrayBuffer());
      const second = new Uint8Array(await (await app.request(url)).arrayBuffer());
      expect(second.length).toBe(first.length);
      let same = true;
      for (let index = 0; index < first.length; index += 1) if (first[index] !== second[index]) same = false;
      expect(same).toBe(true);
    } finally {
      closeDatabase(db);
    }
  });

  it('会话不存在时给 404，而不是一个空文件', async () => {
    const db = openDatabase({ path: ':memory:' });
    try {
      const app = createApp({ db, client: createReplayClient(FIXTURE_DIR), cassetteDir: FIXTURE_DIR });
      const res = await app.request('/api/sessions/s_missing/ledger.xlsx');
      expect(res.status).toBe(404);
    } finally {
      closeDatabase(db);
    }
  });
});
