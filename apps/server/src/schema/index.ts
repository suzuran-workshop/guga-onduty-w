/**
 * Schema 双方言装配入口 —— 单一真源。
 *
 *  - `pgSchema`     = pg 业务表 + auth SDK 5 表（pgAuthTables spread）
 *  - `sqliteSchema` = sqlite 业务表 + auth SDK 5 表（sqliteAuthTables spread）
 *
 * 启动期硬门禁 `assertSchemaParity(pgSchema, sqliteSchema)`：表名集合 / 列名集合 / 主键
 * 三者不一致即抛错，防止双方言 schema 漂移（见 @homurajs/db README）。
 *
 * 历史：曾有第三轨 `restSchema`（由 pgSchema 经 restSchemaFromPg 派生，供 PostgREST/qw-pages），
 * 已于 2026-10-23 随 rest 轨移除（ADR-7）。移除后 parity 门禁是 pg/sqlite 双方言列名一致的
 * **唯一**保障（原 rest 轨靠从 pg 派生天然一致），故其重要性上升，务必保留。
 *
 * ⚠ storage 的 db 后端表（homura_files / homura_file_chunks）由 createDrizzleFileStore 运行时
 *   CREATE TABLE IF NOT EXISTS 自建，不纳入本 schema（见 storage/build.ts）。
 */
import { assertSchemaParity } from '@homurajs/db';
import { pgAuthTables } from '@homurajs/auth/tables';
import { sqliteAuthTables } from '@homurajs/auth/tables';

import { pgBusinessSchema } from './pg.js';
import { sqliteBusinessSchema } from './sqlite.js';

/** pg 轨完整 schema（业务表 + auth 表） */
export const pgSchema = {
  ...pgBusinessSchema,
  ...pgAuthTables,
} as const;

/** sqlite 轨完整 schema（业务表 + auth 表） */
export const sqliteSchema = {
  ...sqliteBusinessSchema,
  ...sqliteAuthTables,
} as const;

// ── 启动期硬门禁：双方言 parity ──────────────────────────────────────
// 表名/列名/主键任一漂移即抛错（fail fast，不带病上线）。
assertSchemaParity(pgSchema, sqliteSchema);

