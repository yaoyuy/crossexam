/**
 * 存储层出口。P1 只到建表与迁移；仓储函数在 repo.ts。
 */
export { closeDatabase, openDatabase, withTransaction } from './db.ts';
export { DDL, migrate, SCHEMA_VERSION, SchemaVersionError } from './schema.ts';
export * from './repo.ts';
export type { Db, OpenOptions } from './db.ts';
