/**
 * 表结构。
 *
 * 设计上的四个要点：
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
 *
 * 4. **追问表不设「一轮一条」的唯一约束。** v2 曾经有
 *    UNIQUE (session_id, claim_id, round, interviewer_id)，本意是防重复，
 *    实际上和编排器允许的「一位面试官一轮问同一条主张两条」直接冲突：
 *    第一问追口径、第二问追条件，产品上完全合理。冲突的后果不是拒绝插入，
 *    而是整场事务在落库时回滚、接口 500。合成卡带里每条主张每轮恰好只有一问，
 *    所以这个缺陷潜伏了很久，直到真模型一次给出两条才炸出来。v3 把该约束换成
 *    普通索引：去重交给提问去重那道闸门（probe.ts 的 seenQuestions），
 *    数据库不再替产品做它没想做的决定。
 *
 * 迁移步骤一律**冻结在自己的时点上**：DDL 是「现在」的结构，DDL_V2 是「v2 当时」
 * 的结构。否则历史库升级时会跳过中间形态，一步到位建出最新表，看着没事，
 * 但下一次改结构就没有可回退的落脚点。
 */

import type { Db } from './db.ts';

export const SCHEMA_VERSION = 4;

const SESSION_TABLE =
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
  ')';

const CLAIM_TABLE =
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
  ')';

const CLAIM_INDEX = 'CREATE INDEX IF NOT EXISTS claim_by_session ON claim(session_id, ordinal)';

/**
 * probe 表的建表语句。列从来没变过，只有唯一约束在 v3 被去掉，
 * 所以这里用一个参数区分两个时点的形态，避免把整张表抄两遍。
 */
function probeTableSql(turnUnique: boolean): string {
  const lines = [
    'CREATE TABLE IF NOT EXISTS probe (',
    '  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,',
    '  id TEXT NOT NULL,',
    '  claim_id TEXT NOT NULL,',
    '  interviewer_id TEXT NOT NULL,',
    '  round INTEGER NOT NULL,',
    '  question TEXT NOT NULL,',
    '  rationale TEXT NOT NULL,',
    '  parent_probe_id TEXT,',
    '  quote TEXT NOT NULL,',
    '  start INTEGER NOT NULL,',
    '  end INTEGER NOT NULL,',
    '  exact INTEGER NOT NULL,',
    '  answer_text TEXT,',
    '  answer_mode TEXT,',
    '  answer_cites_json TEXT,',
    '  verdict TEXT,',
    '  created_at TEXT NOT NULL,',
    '  PRIMARY KEY (session_id, id),',
  ];
  if (turnUnique) lines.push('  UNIQUE (session_id, claim_id, round, interviewer_id),');
  lines.push('  FOREIGN KEY (session_id, claim_id) REFERENCES claim(session_id, id) ON DELETE CASCADE');
  lines.push(')');
  return lines.join('\n');
}

const PROBE_INDEX = 'CREATE INDEX IF NOT EXISTS probe_by_claim ON probe(session_id, claim_id, round)';

const EVENT_TABLE =
  'CREATE TABLE IF NOT EXISTS event (' +
  '  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,' +
  '  seq INTEGER NOT NULL,' +
  '  kind TEXT NOT NULL,' +
  '  payload_json TEXT NOT NULL,' +
  '  created_at TEXT NOT NULL,' +
  '  PRIMARY KEY (session_id, seq)' +
  ')';

const LLM_CALL_TABLE =
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
  ')';

/**
 * 自定义面试官库（v4）。
 *
 * 它是**全局库**而不是会话表：用户配好一位「市场面试官」应该能在下一场继续用。
 * 但契约一旦被某一版会话引用过就冻结在会话里（meta.panel 记 id + version + digest），
 * 所以库里改了名字不会让历史会话的契约对不上账——对不上时报的是「契约指纹不符」，
 * 不是静默按新契约重新解释旧结果。
 */
const INTERVIEWER_TABLE =
  'CREATE TABLE IF NOT EXISTS interviewer (' +
  '  id TEXT PRIMARY KEY,' +
  '  version INTEGER NOT NULL,' +
  '  digest TEXT NOT NULL,' +
  '  source TEXT NOT NULL,' +
  '  domain TEXT NOT NULL,' +
  '  contract_json TEXT NOT NULL,' +
  '  created_at TEXT NOT NULL,' +
  '  updated_at TEXT NOT NULL' +
  ')';

const LLM_CALL_INDEX_DIGEST = 'CREATE INDEX IF NOT EXISTS llm_call_by_digest ON llm_call(digest)';
const LLM_CALL_INDEX_SESSION = 'CREATE INDEX IF NOT EXISTS llm_call_by_session ON llm_call(session_id, created_at)';

/** 一套完整的建表语句。probeTurnUnique 只在重放历史时点时为 true。 */
function schemaStatements(options: { probeTurnUnique: boolean }): readonly string[] {
  return [
    SESSION_TABLE,
    CLAIM_TABLE,
    CLAIM_INDEX,
    probeTableSql(options.probeTurnUnique),
    PROBE_INDEX,
    EVENT_TABLE,
    LLM_CALL_TABLE,
    LLM_CALL_INDEX_DIGEST,
    LLM_CALL_INDEX_SESSION,
    INTERVIEWER_TABLE,
  ];
}

/** 当前版本（v3）的结构 */
export const DDL: readonly string[] = schemaStatements({ probeTurnUnique: false });

/** v2 当时的建表语句：probe 上还带着「一轮一条」唯一约束 */
const DDL_V2: readonly string[] = schemaStatements({ probeTurnUnique: true });

/** 主张表从 v1 起列就没变过，迁移时按原列名搬运，别指望 DDL 能自动改主键。 */
const CLAIM_V1_COLUMNS =
  'id, session_id, ordinal, text, category, weight, quote, start, end, exact, status, verdict, advice_json';
/**
 * v1/v2 的 probe 列清单。v3 新增的 answer_cites_json 不在里面——迁移时它保持 NULL，
 * 老库里本来就没人存过援引原文，编不出来。
 */
const PROBE_COLUMNS =
  'id, session_id, claim_id, interviewer_id, round, question, rationale, parent_probe_id, quote, start, end, exact, answer_text, answer_mode, verdict, created_at';

/**
 * 重建表时的统一姿势：SQLite 改不了主键也删不掉约束，只能建新表搬数据。
 *
 * 外键检查必须先关掉——重建期间老表已被改名，引用会短暂悬空。pragma 在事务内
 * 无效，因此「关外键、开事务、搬数据、提交、再开外键」的顺序不能换。
 */
function rebuild(db: Db, body: () => void, version: number): void {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    body();
    db.exec('PRAGMA user_version = ' + String(version));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

/**
 * v1 → v2：把主张与追问的主键从「全局 id」改成「会话内 id」。
 *
 * 这里刻意用 DDL_V2 而不是 DDL：v1 升上来必须先落到 v2 的形态，再交给 v3
 * 去掉唯一约束。用当前 DDL 会一步建成 v3 表却把版本号写成 2，之后 v3 的迁移
 * 就会对一张已经是 v3 的表再做一次无谓的重建。
 */
function migrateV2(db: Db): void {
  rebuild(
    db,
    () => {
      db.exec('DROP INDEX IF EXISTS claim_by_session');
      db.exec('DROP INDEX IF EXISTS probe_by_claim');
      db.exec('ALTER TABLE claim RENAME TO claim_v1');
      db.exec('ALTER TABLE probe RENAME TO probe_v1');
      for (const statement of DDL_V2) db.exec(statement);
      db.exec('INSERT INTO claim (' + CLAIM_V1_COLUMNS + ') SELECT ' + CLAIM_V1_COLUMNS + ' FROM claim_v1');
      db.exec('INSERT INTO probe (' + PROBE_COLUMNS + ') SELECT ' + PROBE_COLUMNS + ' FROM probe_v1');
      db.exec('DROP TABLE probe_v1');
      db.exec('DROP TABLE claim_v1');
    },
    2,
  );
}

/**
 * v2 → v3：去掉 probe 上「一轮一条」的唯一约束。
 *
 * 只重建 probe 一张表；claim 与 event 一个字都不动，因此这场迁移的风险面很小。
 * 老库里已经落下的追问一条不丢，靠的是同名列整表搬运。
 */
function migrateV3(db: Db): void {
  rebuild(
    db,
    () => {
      db.exec('DROP INDEX IF EXISTS probe_by_claim');
      db.exec('ALTER TABLE probe RENAME TO probe_v2');
      db.exec(probeTableSql(false));
      db.exec(PROBE_INDEX);
      db.exec('INSERT INTO probe (' + PROBE_COLUMNS + ') SELECT ' + PROBE_COLUMNS + ' FROM probe_v2');
      db.exec('DROP TABLE probe_v2');
    },
    3,
  );
}

/**
 * v3 → v4：新增自定义面试官库。
 *
 * 只加一张新表，不动任何既有列——这是最便宜的一种迁移，也是最容易做对的一种。
 * 老库升上来以后，历史会话的阵容仍然只存在于 meta_json 里，读得出来。
 */
function migrateV4(db: Db): void {
  rebuild(
    db,
    () => {
      db.exec(INTERVIEWER_TABLE);
    },
    4,
  );
}

/** 版本号 → 升级动作。只写「从上一版升上来」的那一步，不写全量建表。 */
const MIGRATIONS: Record<number, (db: Db) => void> = {
  2: migrateV2,
  3: migrateV3,
  4: migrateV4,
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