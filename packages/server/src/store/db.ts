/**
 * SQLite 连接入口。
 *
 * 用 node:sqlite 而不是 better-sqlite3，是一条硬约束下的选择：
 * 赛题要求「10 分钟极速复现」，而带原生扩展的依赖在 Windows 上需要
 * 预编译包或本地编译工具链——评委的机器大概率没有。
 * Node 22.5 起内置 sqlite，代价是启动时多一行 ExperimentalWarning。
 * 这笔交易划算：多一行警告，换掉一次「npm install 卡在编译」的失败演示。
 *
 * 简历是个人隐私数据，只落本地文件，本项目不会把它发往任何第三方存储。
 */

import { DatabaseSync } from 'node:sqlite';
import { migrate } from './schema.ts';

export type Db = DatabaseSync;

export interface OpenOptions {
  /** 文件路径；':memory:' 表示内存库（测试用）。 */
  path: string;
  readonly?: boolean;
  /** 只读库或已确认建过表的场景可以跳过；一般用不上。 */
  skipMigrate?: boolean;
}

/**
 * 打开连接，顺带保证表已就绪。
 *
 * 建表放在这里而不是让每个调用方自己记得调 migrate，是因为漏调一次
 * 的后果很隐蔽：进程正常启动、接口正常注册，直到第一次写入才报
 * 「no such table」——真实进程冒烟测试就是这么抓到它的。
 * migrate 自身幂等，版本更高时抛 SchemaVersionError 拒绝启动，
 * 所以「连接即可用」不会掩盖结构不兼容的问题。
 */
export function openDatabase(opts: OpenOptions): Db {
  const db = new DatabaseSync(opts.path, { readOnly: opts.readonly ?? false });
  // 外键必须每个连接单独打开。忘了这一步就会出现
  // 「会话删了、主张还在」的孤儿行，而且不报任何错。
  db.exec('PRAGMA foreign_keys = ON');
  if (opts.path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  if ((opts.readonly ?? false) === false && opts.skipMigrate !== true) migrate(db);
  return db;
}

export function closeDatabase(db: Db): void {
  db.close();
}

/**
 * 把一段写操作包进事务。
 * 不支持嵌套：node:sqlite 没有 savepoint 语法糖，而我们也不需要，
 * 一旦发现嵌套调用就是设计出错，宁可显式报错。
 */
let inTransaction = false;

export function withTransaction<T>(db: Db, fn: () => T): T {
  if (inTransaction) throw new Error('withTransaction 不支持嵌套调用；请把两段写操作合并成一个事务。');
  inTransaction = true;
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    inTransaction = false;
  }
}
