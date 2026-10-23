/**
 * repo 模式验证（records + statistics）—— 在铺开其余 11 个 repo 前，
 * 证明 drizzle `any`-cast query builder + 事务 + 多表 join + 聚合在 sqlite 上跑通。
 * 运行：pnpm tsx scripts/verify-repos.ts
 */
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, runMigrations } from '@homurajs/db';
import type { Tables } from '../src/db/client.js';
import * as sqliteTables from '../src/schema/sqlite.js';
import { createRecordsRepo } from '../src/repos/drizzle/records-repo.js';
import { createStatisticsRepo } from '../src/repos/drizzle/statistics-repo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB = join(__dirname, '../data/verify-repos.db');
function ok(label: string, extra?: unknown) {
  console.log(`  ✅ ${label}`, extra !== undefined ? JSON.stringify(extra) : '');
}

async function main() {
  console.log('\n[repo] records + statistics 模式验证\n');
  rmSync(DB, { force: true }); rmSync(DB + '-wal', { force: true }); rmSync(DB + '-shm', { force: true });
  mkdirSync(dirname(DB), { recursive: true });

  const db = createDb({ dialect: 'sqlite', path: DB });
  await runMigrations(db, join(__dirname, '../drizzle/sqlite'));
  const T = sqliteTables as Tables;
  const ctx = {
    db,
    tables: T,
    tx: (fn: any) => (db as any).transaction(fn),
  };
  const records = createRecordsRepo(ctx);
  const stats = createStatisticsRepo(ctx);
  const { campuses, grades, classes, tags, userProfiles } = T;

  // ── 基础数据 ──
  const campusId = crypto.randomUUID();
  const gradeId = crypto.randomUUID();
  const classId = crypto.randomUUID();
  const classId2 = crypto.randomUUID();
  const tagId = crypto.randomUUID();
  const recorderId = crypto.randomUUID();
  await db.insert(campuses).values({ id: campusId, name: '一校区', code: 'c1' }).run();
  await db.insert(grades).values({ id: gradeId, campusId, name: '1年级', sortOrder: 1 }).run();
  await db.insert(classes).values({ id: classId, gradeId, campusId, name: '1班' }).run();
  await db.insert(classes).values({ id: classId2, gradeId, campusId, name: '2班' }).run();
  await db.insert(tags).values({ id: tagId, campusId, name: '卫生差', score: -2, category: 'negative', isSystem: 1 }).run();
  // 2026-10-23：score 由 repo 按 tagIds 求和（标签分权威），故各分值需有对应标签
  const tagPos = crypto.randomUUID();
  const tagNeg1 = crypto.randomUUID();
  await db.insert(tags).values({ id: tagPos, campusId, name: '卫生优秀', score: 3, category: 'positive', isSystem: 1 }).run();
  await db.insert(tags).values({ id: tagNeg1, campusId, name: '迟到', score: -1, category: 'negative', isSystem: 1 }).run();
  await db.insert(userProfiles).values({ userId: recorderId, campusId, displayName: '值周生A', role: 'student' }).run();

  // ── create（事务 + images JSON）──
  console.log('[create]');
  const now = Date.now();
  const rec = await records.create({
    campusId, classId, recorderId, tagIds: [tagId], comment: '地面垃圾',
    images: ['records/files/a.jpg'], week: '2026-W41', recordedAt: now,
  });
  ok('create 返回详情（join 生效）', { className: rec.className, recorderName: rec.recorderName, tags: rec.tags.map((t) => t.name), score: rec.score, images: rec.images });
  if (rec.className !== '1班') throw new Error('className join 失败');
  if (rec.recorderName !== '值周生A') throw new Error('recorderName 应来自 userProfiles.displayName');
  if (!Array.isArray(rec.images) || rec.images.length !== 1) throw new Error('images JSON 未反序列化');
  if (rec.score !== -2) throw new Error(`score 应由标签求和为 -2，实际 ${rec.score}`);
  if (rec.tags.length !== 1 || rec.tags[0].name !== '卫生差') throw new Error('tags 应展开为对象数组');

  // 1班 再加一条正分（+3 标签）
  await records.create({ campusId, classId, recorderId, tagIds: [tagPos], week: '2026-W41', recordedAt: now });
  // 2班 一条负分（-1 标签）
  await records.create({ campusId, classId: classId2, recorderId, tagIds: [tagNeg1], week: '2026-W41', recordedAt: now });

  // ── list（分页 + 动态 where）──
  console.log('\n[list]');
  const page1 = await records.list({ campusId, page: 1, pageSize: 2 });
  ok('list 分页 total=3, pageSize=2 → 2 行', { total: page1.pagination.total, totalPages: page1.pagination.totalPages, n: page1.data.length });
  if (page1.pagination.total !== 3 || page1.data.length !== 2) throw new Error('分页错误');
  const byClass = await records.list({ campusId, classId: classId2, page: 1, pageSize: 20 });
  ok('list 按 class 过滤', { n: byClass.data.length, className: byClass.data[0]?.className });
  if (byClass.data.length !== 1) throw new Error('class 过滤错误');

  // ── revoke（事务 + log）──
  console.log('\n[revoke]');
  await records.revoke(rec.id, recorderId, '误录');
  const afterRevoke = await records.findByIdWithDetails(rec.id);
  ok('revoke 后 status', { status: afterRevoke?.status });
  if (afterRevoke?.status !== 'revoked') throw new Error('revoke 失败');

  // ── statistics.ranking（聚合 + 有效口径 + orderBy 表达式）──
  console.log('\n[statistics.ranking]');
  const ranking = await stats.ranking(campusId, '2026-W41');
  ok('ranking 结果', ranking.map((r) => ({ cls: r.className, rank: r.rank, total: r.totalScore, pos: r.positiveCount, neg: r.negativeCount, cnt: r.recordCount })));
  // 1班：-2(revoked 不计) + 3(active) = 3；2班：-1(active) = -1
  const c1 = ranking.find((r) => r.className === '1班')!;
  const c2 = ranking.find((r) => r.className === '2班')!;
  if (c1.totalScore !== 3) throw new Error(`1班 total 应 3（revoked 不计），实际 ${c1.totalScore}`);
  if (c1.rank !== 1) throw new Error('1班应排第 1');
  if (c2.totalScore !== -1) throw new Error(`2班 total 应 -1，实际 ${c2.totalScore}`);
  ok('排名口径正确（revoked 不计分，按 total desc）');

  // ── statistics.dashboard（epoch 区间判今日）──
  console.log('\n[statistics.dashboard]');
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const dash = await stats.dashboard(campusId, dayStart.getTime(), dayEnd.getTime(), '2026-W41');
  ok('dashboard', dash);
  // 今日 active：1班的+3、2班的-1（1班那条-2是revoked不计）→ records=2, pos=3, neg=-1
  if (dash.todayRecords !== 2) throw new Error(`todayRecords 应 2，实际 ${dash.todayRecords}`);
  if (dash.todayPositive !== 3) throw new Error(`todayPositive 应 3，实际 ${dash.todayPositive}`);
  if (dash.weekTopClass !== '1班') throw new Error(`weekTopClass 应 1班，实际 ${dash.weekTopClass}`);

  // ── statistics.trend（补零）──
  console.log('\n[statistics.trend]');
  // 修正原有 bug：trend 签名是 (campusId, classId, weeks)，此前漏传 campusId 导致运行时崩
  const trend = await stats.trend(campusId, classId, ['2026-W40', '2026-W41', '2026-W42']);
  ok('trend 补零', trend);
  if (trend.length !== 3) throw new Error('trend 应含 3 周');
  if (trend[0].totalScore !== 0) throw new Error('W40 无数据应为 0');
  if (trend[1].totalScore !== 3) throw new Error(`W41 应 3，实际 ${trend[1].totalScore}`);

  console.log('\n✅✅✅ repo 模式全绿：事务 + join + 分页 + 聚合口径 + epoch区间 + trend补零\n');
  try { (db as any).$client.close?.(); } catch {}
  rmSync(DB, { force: true }); rmSync(DB + '-wal', { force: true }); rmSync(DB + '-shm', { force: true });
}

main().catch((e) => { console.error('\n❌ repo 验证失败:', e instanceof Error ? e.stack : e); process.exit(1); });
