/**
 * records repo（drizzle 实现）—— 核心表，含事务与多表 join。
 *
 * 迁移要点（对照旧 routes/records.ts）：
 *  - id 全 uuid；recorderName 来自 userProfiles.displayName（旧 users.display_name）。
 *  - create/revoke 用事务包裹 record+log（修复旧代码非原子：log 缺失/状态撕裂）。
 *  - images 存 storage objectKey 数组（JSON 列，drizzle 自动编解码）。
 *  - 分页 total 用子查询 count（复刻旧逻辑，但参数化）。
 */
import { desc, eq, and, sql } from 'drizzle-orm';
import type { RecordWithDetails, RecordStatus } from '@class-duty/shared';
import type { RecordsRepo, Paged } from '../types.js';
import { DrizzleCtx, whereAll, eqIf, paginate, num } from './_base.js';

/** record + join 的原始行 → 领域对象（camelCase，epoch 数值化，JSON 已反序列化） */
function toDetails(r: any): RecordWithDetails {
  return {
    id: r.id,
    campusId: r.campusId,
    classId: r.classId,
    recorderId: r.recorderId,
    tagId: r.tagId ?? null,
    score: r.score === null || r.score === undefined ? null : num(r.score),
    comment: r.comment ?? null,
    images: Array.isArray(r.images) ? r.images : (r.images ? JSON.parse(r.images) : null),
    week: r.week,
    status: r.status as RecordStatus,
    recordedAt: num(r.recordedAt),
    className: r.className,
    gradeName: r.gradeName,
    recorderName: r.recorderName,
    tagName: r.tagName ?? null,
    tagColor: r.tagColor ?? null,
  };
}

export function createRecordsRepo(ctx: DrizzleCtx): RecordsRepo {
  const { tables: T } = ctx;
  const db = ctx.db as any;
  const { records, recordLogs, classes, grades, tags, userProfiles } = T;

  /** join 投影（list/detail/export 复用）—— 别名 camelCase，与 RecordWithDetails 对齐 */
  const projection = {
    id: records.id,
    campusId: records.campusId,
    classId: records.classId,
    recorderId: records.recorderId,
    tagId: records.tagId,
    score: records.score,
    comment: records.comment,
    images: records.images,
    week: records.week,
    status: records.status,
    recordedAt: records.recordedAt,
    className: classes.name,
    gradeName: grades.name,
    recorderName: userProfiles.displayName,
    tagName: tags.name,
    tagColor: tags.color,
  };

  /** 基础 join 链（records → classes → grades → userProfiles(recorder) → tags） */
  const joined = () =>
    db
      .select(projection)
      .from(records)
      .innerJoin(classes, eq(records.classId, classes.id))
      .innerJoin(grades, eq(classes.gradeId, grades.id))
      .innerJoin(userProfiles, eq(records.recorderId, userProfiles.userId))
      .leftJoin(tags, eq(records.tagId, tags.id));

  return {
    async list(filter): Promise<Paged<RecordWithDetails>> {
      const { campusId, classId, week, status, page, pageSize } = filter;
      const cond = whereAll([
        eq(records.campusId, campusId),
        eqIf(records.classId, classId),
        eqIf(records.week, week),
        eqIf(records.status, status),
      ]);

      // count（子查询包裹，复刻旧逻辑）
      const [{ total }] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(records)
        .where(cond!);

      const rows = await joined()
        .where(cond!)
        .orderBy(desc(records.recordedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return { data: rows.map(toDetails), pagination: paginate(page, pageSize, num(total)) };
    },

    async findByIdWithDetails(id): Promise<RecordWithDetails | null> {
      const rows = await joined().where(eq(records.id, id)).limit(1);
      return rows[0] ? toDetails(rows[0]) : null;
    },

    async create(input): Promise<RecordWithDetails> {
      const id = crypto.randomUUID();
      await ctx.tx(async (tx: any) => {
        await tx.insert(records).values({
          id,
          campusId: input.campusId,
          classId: input.classId,
          recorderId: input.recorderId,
          tagId: input.tagId ?? null,
          score: input.score ?? null,
          comment: input.comment ?? null,
          images: input.images && input.images.length > 0 ? input.images : null,
          week: input.week,
          status: 'active',
          recordedAt: input.recordedAt,
        }).run();
        await tx.insert(recordLogs).values({
          id: crypto.randomUUID(),
          recordId: id,
          action: 'create',
          operatorId: input.recorderId,
          reason: null,
        }).run();
      });
      const detail = await this.findByIdWithDetails(id);
      if (!detail) throw new Error('记录创建后回查失败');
      return detail;
    },

    async revoke(id, operatorId, reason): Promise<void> {
      await ctx.tx(async (tx: any) => {
        await tx.update(records).set({ status: 'revoked' }).where(eq(records.id, id)).run();
        await tx.insert(recordLogs).values({
          id: crypto.randomUUID(),
          recordId: id,
          action: 'revoke',
          operatorId,
          reason,
        }).run();
      });
    },

    async listForExport(campusId, startWeek, endWeek): Promise<RecordWithDetails[]> {
      const cond = whereAll([
        eq(records.campusId, campusId),
        startWeek ? sql`${records.week} >= ${startWeek}` : undefined,
        endWeek ? sql`${records.week} <= ${endWeek}` : undefined,
      ]);
      const rows = await joined().where(cond!).orderBy(desc(records.recordedAt));
      return rows.map(toDetails);
    },
  };
}
