/**
 * 表结构。
 *
 * 设计上的两个要点：
 *
 * 1. **event 表是只追加的事实来源。** 前端重连、复盘、导出证据链全都读它，
 *    而不是去反推各张业务表。业务表是为了查询方便做的投影，可以重建。
 *
 * 2. **llm_call 表只记指纹与用量，不记提示词正文。** 正文在 fixtures 里，
 *    表里只留 digest，于是「这次演示用了多少钱、有没有联网」可以统计，
 *    而简历内容不会因为这张表多存一份。
 */

import type { Db } from './db.ts';

export const SCHEMA_VERSION = 1;

export const DDL: readonly string[] = [
  'CREATE TABLE IF NOT EXISTS session (' +
    '  id TEXT PRIMARY KEY,' +
    '  created_at TEXT NOT NULL,' +
    '  updated_at TEXT NOT NULL,' +
    '  mode TEXT NOT NULL,' +
    '  job_title TEXT NOT NULL,' +
    '  jd_text TEXT NOT NULL,' +
    '  resume_text TEXT NOT NULL,' +
    '  resume_hash TEXT NOT NULL,' +
    '  status TEXT NOT NULL,' +
    '  budget_json TEXT NOT NULL,' +
    "  meta_json TEXT NOT NULL DEFAULT '{}'" +
    ')',

  'CREATE TABLE IF NOT EXISTS claim (' +
    '  id TEXT PRIMARY KEY,' +
    '  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,' +
    '  ordinal INTEGER NOT NULL,' +
    '  text TEXT NOT NULL,' +
    '  category TEXT NOT NULL,' +
    '  weight REAL NOT NULL,' +
    '  quote TEXT NOT NULL,' +
    '  start INTEGER NOT NULL,' +
    '  end INTEGER NOT NULL,' +
    '  exact INTEGER NOT NULL,' +
    '  status TEXT NOT NULL,' +
    '  verdict TEXT,' +
    '  advice_json TEXT,' +
    '  UNIQUE (session_id, ordinal)' +
    ')',
  'CREATE INDEX IF NOT EXISTS claim_by_session ON claim(session_id, ordinal)',

  'CREATE TABLE IF NOT EXISTS probe (' +
    '  id TEXT PRIMARY KEY,' +
    '  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,' +
    '  claim_id TEXT NOT NULL REFERENCES claim(id) ON DELETE CASCADE,' +
    '  interviewer_id TEXT NOT NULL,' +
    '  round INTEGER NOT NULL,' +
    '  question TEXT NOT NULL,' +
    '  rationale TEXT NOT NULL,' +
    '  parent_probe_id TEXT,' +
    '  quote TEXT NOT NULL,' +
    '  start INTEGER NOT NULL,' +
    '  end INTEGER NOT NULL,' +
    '  exact INTEGER NOT NULL,' +
    '  answer_text TEXT,' +
    '  answer_mode TEXT,' +
    '  verdict TEXT,' +
    '  created_at TEXT NOT NULL,' +
    '  UNIQUE (claim_id, round, interviewer_id)' +
    ')',
  'CREATE INDEX IF NOT EXISTS probe_by_claim ON probe(session_id, claim_id, round)',

  'CREATE TABLE IF NOT EXISTS event (' +
    '  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,' +
    '  seq INTEGER NOT NULL,' +
    '  kind TEXT NOT NULL,' +
    '  payload_json TEXT NOT NULL,' +
    '  created_at TEXT NOT NULL,' +
    '  PRIMARY KEY (session_id, seq)' +
    ')',

  'CREATE TABLE IF NOT EXISTS llm_call (' +
    '  id TEXT PRIMARY KEY,' +
    '  session_id TEXT,' +
    '  digest TEXT NOT NULL,' +
    '  purpose TEXT NOT NULL,' +
    '  model TEXT NOT NULL,' +
    '  replayed INTEGER NOT NULL,' +
    '  input_tokens INTEGER NOT NULL,' +
    '  output_tokens INTEGER NOT NULL,' +
    '  cache_read_tokens INTEGER NOT NULL,' +
    '  reasoning_tokens INTEGER NOT NULL,' +
    '  elapsed_ms INTEGER NOT NULL,' +
    '  created_at TEXT NOT NULL' +
    ')',
  'CREATE INDEX IF NOT EXISTS llm_call_by_digest ON llm_call(digest)',
  'CREATE INDEX IF NOT EXISTS llm_call_by_session ON llm_call(session_id, created_at)',
];

export class SchemaVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaVersionError';
  }
}

/**
 * 建表 / 校验版本。
 * 库比代码新时直接拒绝启动：宁可起不来，也不要让新版本写过的数据
 * 被旧代码按老结构解读，那会静默损坏证据链。
 */
export function migrate(db: Db): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  const current = row?.user_version ?? 0;

  if (current > SCHEMA_VERSION) {
    throw new SchemaVersionError(
      '数据库结构版本是 v' + String(current) + '，高于本代码支持的 v' + String(SCHEMA_VERSION) + '；请更新代码，不要用旧代码写新库。',
    );
  }
  if (current === SCHEMA_VERSION) return current;

  db.exec('BEGIN');
  try {
    for (const statement of DDL) db.exec(statement);
    db.exec('PRAGMA user_version = ' + String(SCHEMA_VERSION));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return SCHEMA_VERSION;
}
