/**
 * records repo（drizzle 实现）—— 核心表，含事务与多表 join。
 *
 * 迁移要点（对照旧 routes/records.ts）：
 *  - id 全 uuid；recorderName 来自 userProfiles.displayName（旧 users.display_name）。
 *  - create/revoke 用事务包裹 record+log（修复旧代码非原子：log 缺失/状态撕裂）。
 *  - images 存 storage objectKey 数组（JSON 列，drizzle 自动编解码）。
 *  - 分页 total 用子查询 count（复刻旧逻辑，但参数化）。
 */
import { desc, eq, and, sql, inArray } from 'drizzle-orm';
import type { RecordWithDetails, RecordStatus } from '@guga-onduty-w/shared';
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
    // REVIEW #2：leftJoin 后 recorder 可能为 null（用户已删），COALESCE 兜底避免记录整行消失
    recorderName: sql<string>`COALESCE(${userProfiles.displayName}, '已删除用户')`,
    tagName: tags.name,
    tagColor: tags.color,
  };

  /**
   * 基础 join 链（records → classes → grades → userProfiles(recorder) → tags）。
   * REVIEW #2：userProfiles 用 **leftJoin**（原 innerJoin）——用户被删后其记录不再被 join 丢弃，
   * 避免「count(单表)≠rows(join)」的幻影分页、CSV 导出静默丢行、统计与列表矛盾。
   * classes/grades 仍 innerJoin（记录必属于存在的班级/年级，删除守卫已挡，见 #8）。
   */
  const joined = () =>
    db
      .select(projection)
      .from(records)
      .innerJoin(classes, eq(records.classId, classes.id))
      .innerJoin(grades, eq(classes.gradeId, grades.id))
      .leftJoin(userProfiles, eq(records.recorderId, userProfiles.userId))
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
      // REVIEW #4/#11：状态迁移合法性——只允许 active/appealing → revoked。
      // 防重复撤回已 revoked 记录（重复 log + 重复 SSE），防静默推翻 appeal_approved（申诉成立结果）。
      // record 状态机合法迁移：active→{appealing,revoked}；appealing→{appeal_approved,active,revoked}；
      //   appeal_approved / revoked 为终态。
      const updated = await ctx.tx(async (tx: any) => {
        const res = await tx.update(records).set({ status: 'revoked' })
          .where(and(eq(records.id, id), inArray(records.status, ['active', 'appealing'])))
          .run();
        // 仅当确有行被更新时才写 log（幂等：已终态的记录不重复记日志）
        const changed = res?.changes ?? (res?.rowsAffected ?? 1);
        if (Number(changed) > 0) {
          await tx.insert(recordLogs).values({
            id: crypto.randomUUID(),
            recordId: id,
            action: 'revoke',
            operatorId,
            reason,
          }).run();
        }
        return Number(changed);
      });
      return void updated;
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
