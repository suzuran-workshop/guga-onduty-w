/**
 * P1 地基验收脚本 —— 真实加载三轨 schema 并在 sqlite 上跑通复杂查询。
 * 验收点：
 *  1. import schema/index.ts → 触发 assertSchemaParity 门禁（表/列/主键一致）
 *  2. restSchema 从 pg 派生，列名 = camelCase（PostgREST 用）
 *  3. createDb(sqlite) + runMigrations → 真实建 18 张表
 *  4. 复杂 query：join + SUM(CASE WHEN) 聚合 + groupBy + orderBy（复刻 statistics/ranking 口径）
 *  5. 事务：db.transaction() 多语句原子（复刻 records+logs 写入）
 *  6. JSON 列（images/tagIds/members）读写往返一致
 * 运行：pnpm tsx scripts/verify-p1.ts
 */
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, runMigrations } from '@homurajs/db';
import { eq, and, sql, desc, inArray } from 'drizzle-orm';

// import 即触发 assertSchemaParity（schema/index.ts 顶层）
import { restSchema } from '../src/schema/index.js';
// sqlite 表对象（repo 运行时用方言匹配的表）
import { sqliteSchema } from '../src/schema/index.js';
import {
  campuses,
  grades,
  classes,
  tags,
  records,
  recordLogs,
  userProfiles,
  templates,
} from '../src/schema/sqlite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB = join(__dirname, '../data/verify-p1.db');

function ok(label: string, extra?: unknown) {
  console.log(`  ✅ ${label}`, extra !== undefined ? JSON.stringify(extra) : '');
}

async function main() {
  console.log('\n[P1] 地基验收 —— sqlite 轨\n');

  // ── 1. parity 门禁（import schema/index.ts 已通过，这里确认 rest 派生）──
  console.log('[1] assertSchemaParity + restSchema 派生');
  const tables = Object.keys(restSchema);
  ok('parity 门禁通过（import 未抛错）');
  ok('rest 派生表数', tables.length);
  ok('records 的 rest 列名', restSchema.records.columns);
  if (!restSchema.records.columns.includes('campusId')) throw new Error('rest 列名应为 camelCase campusId');
  if (restSchema.records.primaryKeys.join() !== 'id') throw new Error('records 主键应为 id');
  ok('records 主键', restSchema.records.primaryKeys);

  // ── 2. createDb(sqlite) + runMigrations ──
  console.log('\n[2] createDb(sqlite) + runMigrations');
  rmSync(DB, { force: true });
  rmSync(DB + '-wal', { force: true });
  rmSync(DB + '-shm', { force: true });
  mkdirSync(dirname(DB), { recursive: true });
  const db = createDb({ dialect: 'sqlite', path: DB });
  await runMigrations(db, join(__dirname, '../drizzle/sqlite'));
  const $c = (db as any).$client;
  const tableCount = $c
    .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`)
    .get();
  ok('建表数量（期望 18：13 业务 + 5 auth）', tableCount);
  if (tableCount.n !== 18) throw new Error(`表数不符，实际 ${tableCount.n}`);

  // ── 3. 写入基础数据（含 uuid id、JSON 列）──
  console.log('\n[3] 写入 + JSON 列往返');
  const campusId = crypto.randomUUID();
  await db.insert(campuses).values({ id: campusId, name: '第一校区', code: 'campus_01' }).run();
  const gradeId = crypto.randomUUID();
  await db.insert(grades).values({ id: gradeId, campusId, name: '1年级', sortOrder: 1 }).run();
  const classId = crypto.randomUUID();
  await db.insert(classes).values({ id: classId, gradeId, campusId, name: '1班', classTeacher: '张老师' }).run();
  const tagId = crypto.randomUUID();
  await db.insert(tags).values({ id: tagId, campusId, name: '卫生差', score: -2, color: '#795548', category: 'negative', isSystem: 1 }).run();
  const recorderId = crypto.randomUUID();
  await db.insert(userProfiles).values({ userId: recorderId, campusId, displayName: '值周生A', role: 'student' }).run();

  // 模板 JSON 数组列
  const tplId = crypto.randomUUID();
  await db.insert(templates).values({ id: tplId, campusId, name: '晨检模板', tagIds: [tagId] }).run();
  const [tpl] = await db.select().from(templates).where(eq(templates.id, tplId));
  ok('templates.tagIds JSON 往返（期望数组）', { tagIds: tpl.tagIds, isArray: Array.isArray(tpl.tagIds) });
  if (!Array.isArray(tpl.tagIds)) throw new Error('tagIds 未正确反序列化为数组');

  // ── 4. 事务：records + recordLogs 原子写入（复刻核心表 + images JSON）──
  console.log('\n[4] 事务原子写入 records + recordLogs（含 images JSON）');
  const recordId = crypto.randomUUID();
  const now = Date.now();
  await (db as any).transaction(async (tx: any) => {
    await tx.insert(records).values({
      id: recordId, campusId, classId, recorderId, tagId,
      score: -2, comment: '地面有垃圾', images: ['records/files/a.jpg', 'records/files/b.jpg'],
      week: '2026-W41', status: 'active', recordedAt: now,
    }).run();
    await tx.insert(recordLogs).values({
      id: crypto.randomUUID(), recordId, action: 'create', operatorId: recorderId,
    }).run();
  });
  const [rec] = await db.select().from(records).where(eq(records.id, recordId));
  ok('records.images JSON 往返', { images: rec.images, n: rec.images?.length });
  if (rec.images?.length !== 2) throw new Error('images 数组长度应为 2');
  const [log] = await db.select().from(recordLogs).where(eq(recordLogs.recordId, recordId));
  ok('recordLogs.action（事务内写入）', { action: log.action });

  // ── 5. 复杂查询：join + SUM(CASE WHEN) 聚合 + groupBy + orderBy ──
  // 复刻 statistics/ranking 口径：按班级聚合有效记录分数（active/appealing/appeal_approved 计分）
  console.log('\n[5] 复杂聚合查询（join + SUM CASE WHEN + groupBy）');
  // 再加一条正分记录，验证聚合
  await db.insert(records).values({
    id: crypto.randomUUID(), campusId, classId, recorderId, tagId: null,
    score: 3, week: '2026-W41', status: 'active', recordedAt: now,
  }).run();
  // ⚠ drizzle 坑：select 对象里的 sql 片段不自动生成 AS 别名，故 ORDER BY 不能引用
  //   字段 key（total），必须重复完整表达式。定义为可复用变量，select 与 orderBy 共用。
  // ⚠ 三轨一致坑：pg 严格要求 groupBy 含所有非聚合 select 列（sqlite 宽松），故补全 name 列。
  const totalExpr = sql<number>`COALESCE(SUM(CASE WHEN ${records.status} IN ('active','appealing','appeal_approved') THEN ${records.score} ELSE 0 END), 0)`;
  const negCountExpr = sql<number>`COALESCE(SUM(CASE WHEN ${records.score} < 0 AND ${records.status} = 'active' THEN 1 ELSE 0 END), 0)`;
  const ranking = await db
    .select({
      classId: classes.id,
      className: classes.name,
      gradeName: grades.name,
      total: totalExpr,
      negCount: negCountExpr,
    })
    .from(classes)
    .leftJoin(records, eq(classes.id, records.classId))
    .leftJoin(grades, eq(classes.gradeId, grades.id))
    .where(eq(classes.campusId, campusId))
    .groupBy(classes.id, classes.name, grades.name)
    .orderBy(desc(totalExpr));
  ok('ranking 结果（total 期望 1 = -2 + 3，negCount 期望 1）', ranking);
  if (Number(ranking[0].total) !== 1) throw new Error(`聚合错误，total=${ranking[0].total}`);
  if (Number(ranking[0].negCount) !== 1) throw new Error(`负分计数错误=${ranking[0].negCount}`);
  // 验证多 sql 片段按位置映射正确（total 与 negCount 未串位）
  if (ranking[0].className !== '1班') throw new Error(`结果映射串位，className=${ranking[0].className}`);


  // ── 6. inArray + 分页 ──
  console.log('\n[6] inArray + limit/offset');
  const weekRows = await db
    .select({ id: records.id })
    .from(records)
    .where(and(inArray(records.status, ['active']), eq(records.week, '2026-W41')))
    .limit(10)
    .offset(0);
  ok('inArray 过滤 + 分页命中', { count: weekRows.length });
  if (weekRows.length !== 2) throw new Error('应命中 2 条 active 记录');

  console.log('\n✅✅✅ P1 地基全绿：parity + rest派生 + 18表建表 + 事务 + JSON往返 + join聚合 + inArray分页\n');

  // 清理
  try { (db as any).$client.close?.(); } catch {}
  rmSync(DB, { force: true });
  rmSync(DB + '-wal', { force: true });
  rmSync(DB + '-shm', { force: true });
}

main().catch((e) => {
  console.error('\n❌ P1 验收失败:', e instanceof Error ? e.message : e);
  process.exit(1);
});
