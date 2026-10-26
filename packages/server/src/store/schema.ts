/**
 * 表结构。
 *
 * 设计上的三个要点：
 *
 * 1. **event 表是只追加的事实来源。** 前端重连、复盘、导出证据链全都读它，
 *    而不是去反推各张业务表。业务表是为了查询方便做的投影，可以重建。
 *
 * 2. **llm_call 表只记指纹与用量，不记提示词正文。** 正文在 fixtures 里，
 *    表里只留 digest，于是「这次演示用了多少钱、有没有联网」可以统计，
 *    而简历内容不会因为这张表多存一份。
 *
 * 3. **主张与追问的编号是「会话内编号」，不是全局编号。** C1、P1 由抽取器
 *    每场重新数起，因此主键必须是 (session_id, id)。第一版把 id 单独做主键，
 *    单场演示永远看不出问题，直到同一个进程里跑第二场会话才撞
 *    UNIQUE constraint failed: claim.id —— 这正是 v2 迁移存在的原因。
 */

import type { Db } from './db.ts';

export const SCHEMA_VERSION = 2;

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
    '  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,' +
    '  id TEXT NOT NULL,' +
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
    '  PRIMARY KEY (session_id, id),' +
    '  UNIQUE (session_id, ordinal)' +
    ')',
  'CREATE INDEX IF NOT EXISTS claim_by_session ON claim(session_id, ordinal)',

  'CREATE TABLE IF NOT EXISTS probe (' +
    '  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,' +
    '  id TEXT NOT NULL,' +
    '  claim_id TEXT NOT NULL,' +
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
    '  PRIMARY KEY (session_id, id),' +
    '  UNIQUE (session_id, claim_id, round, interviewer_id),' +
    '  FOREIGN KEY (session_id, claim_id) REFERENCES claim(session_id, id) ON DELETE CASCADE' +
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

/** v1 的两张表长这样，迁移时按原列名搬运，别指望 DDL 能自动改主键。 */
const CLAIM_V1_COLUMNS =
  'id, session_id, ordinal, text, category, weight, quote, start, end, exact, status, verdict, advice_json';
const PROBE_V1_COLUMNS =
  'id, session_id, claim_id, interviewer_id, round, question, rationale, parent_probe_id, quote, start, end, exact, answer_text, answer_mode, verdict, created_at';

/**
 * v1 → v2：把主张与追问的主键从「全局 id」改成「会话内 id」。
 *
 * SQLite 改不了主键，只能重建表。外键检查必须先关掉——重建期间
 * probe 会短暂指向一个已被改名走的老 claim 表。pragma 在事务内无效，
 * 因此关外键、开事务、搬数据、提交、再开外键，顺序不能换。
 */
function migrateV2(db: Db): void {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec('DROP INDEX IF EXISTS claim_by_session');
    db.exec('DROP INDEX IF EXISTS probe_by_claim');
    db.exec('ALTER TABLE claim RENAME TO claim_v1');
    db.exec('ALTER TABLE probe RENAME TO probe_v1');
    for (const statement of DDL) db.exec(statement);
    db.exec('INSERT INTO claim (' + CLAIM_V1_COLUMNS + ') SELECT ' + CLAIM_V1_COLUMNS + ' FROM claim_v1');
    db.exec('INSERT INTO probe (' + PROBE_V1_COLUMNS + ') SELECT ' + PROBE_V1_COLUMNS + ' FROM probe_v1');
    db.exec('DROP TABLE probe_v1');
    db.exec('DROP TABLE claim_v1');
    db.exec('PRAGMA user_version = 2');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

/** 版本号 → 升级动作。只写「从上一版升上来」的那一步，不写全量建表。 */
const MIGRATIONS: Record<number, (db: Db) => void> = {
  2: migrateV2,
};

export class SchemaVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaVersionError';
  }
}

function readVersion(db: Db): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  return row?.user_version ?? 0;
}

/**
 * 建表 / 校验版本。
 * 库比代码新时直接拒绝启动：宁可起不来，也不要让新版本写过的数据
 * 被旧代码按老结构解读，那会静默损坏证据链。
 */
export function migrate(db: Db): number {
  const current = readVersion(db);

  if (current > SCHEMA_VERSION) {
    throw new SchemaVersionError(
      '数据库结构版本是 v' + String(current) + '，高于本代码支持的 v' + String(SCHEMA_VERSION) + '；请更新代码，不要用旧代码写新库。',
    );
  }
  if (current === SCHEMA_VERSION) return current;

  if (current === 0) {
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

  for (let version = current + 1; version <= SCHEMA_VERSION; version += 1) {
    const step = MIGRATIONS[version];
    if (step === undefined) {
      throw new SchemaVersionError('缺少从 v' + String(version - 1) + ' 到 v' + String(version) + ' 的迁移步骤。');
    }
    step(db);
  }
  return SCHEMA_VERSION;
}
