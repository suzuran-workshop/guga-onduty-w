/**
 * appeals repo（drizzle 实现）—— 申诉状态机，事务保证 record↔appeal 联动。
 *
 * 迁移要点（对照旧 routes/records.ts 的 appeal 端点 + routes/appeals.ts 查询）：
 *  - create：事务 update records.status→appealing（仅 active）+ insert appeal + log。
 *    修复旧代码非原子 bug（状态改了但无申诉单 → appealing 记录永远无法 approve）。
 *  - approve：事务 update appeal(approved,仅 pending)+ record(appeal_approved)+ log。
 *  - reject：事务 update appeal(rejected)+ record(回滚 active)+ log。
 *  - list：一次 join 取 record_info（修复旧代码逐行再查的 N+1）。
 *  - teacher 只看自己的（teacherId 过滤）；campusId 过滤补齐（旧代码 student/admin 看全局）。
 */
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import type { Appeal, AppealWithDetails, AppealRecordInfo } from '@class-duty/shared';
import type { AppealsRepo, Paged } from '../types.js';
import { DrizzleCtx, whereAll, eqIf, paginate, num } from './_base.js';

export function createAppealsRepo(ctx: DrizzleCtx): AppealsRepo {
  const { tables: T } = ctx;
  const db = ctx.db as any;
  const { appeals, records, recordLogs, classes, tags, userProfiles } = T;

  // teacher/reviewer 都来自 userProfiles.displayName（旧 users.display_name）
  const teacherName = sql<string>`(SELECT ${userProfiles.displayName} FROM ${userProfiles} WHERE ${userProfiles.userId} = ${appeals.teacherId})`;
  const reviewerName = sql<string | null>`(SELECT ${userProfiles.displayName} FROM ${userProfiles} WHERE ${userProfiles.userId} = ${appeals.reviewerId})`;

  /** appeal + record_info 的完整投影（list/detail 复用） */
  const projection = {
    id: appeals.id,
    recordId: appeals.recordId,
    teacherId: appeals.teacherId,
    reason: appeals.reason,
    status: appeals.status,
    reviewerId: appeals.reviewerId,
    reviewComment: appeals.reviewComment,
    createdAt: appeals.createdAt,
    reviewedAt: appeals.reviewedAt,
    teacherName,
    reviewerName,
    // record_info 子字段
    riScore: records.score,
    riComment: records.comment,
    riWeek: records.week,
    riRecordedAt: records.recordedAt,
    riStatus: records.status,
    riClassName: classes.name,
    riTagName: tags.name,
    riCampusId: records.campusId,
  };

  const joined = () =>
    db
      .select(projection)
      .from(appeals)
      .leftJoin(records, eq(appeals.recordId, records.id))
      .leftJoin(classes, eq(records.classId, classes.id))
      .leftJoin(tags, eq(records.tagId, tags.id));

  function toDetails(r: any): AppealWithDetails {
    const recordInfo: AppealRecordInfo | null =
      r.riWeek === null || r.riWeek === undefined
        ? null
        : {
            score: r.riScore === null || r.riScore === undefined ? null : num(r.riScore),
            comment: r.riComment ?? null,
            week: r.riWeek,
            recordedAt: num(r.riRecordedAt),
            recordStatus: r.riStatus,
            className: r.riClassName ?? '',
            tagName: r.riTagName ?? null,
          };
    return {
      id: r.id,
      recordId: r.recordId,
      teacherId: r.teacherId,
      reason: r.reason,
      status: r.status,
      reviewerId: r.reviewerId ?? null,
      reviewComment: r.reviewComment ?? null,
      createdAt: num(r.createdAt),
      reviewedAt: r.reviewedAt === null || r.reviewedAt === undefined ? null : num(r.reviewedAt),
      teacherName: r.teacherName ?? '',
      reviewerName: r.reviewerName ?? null,
      recordInfo,
      campusId: r.riCampusId ?? null,
    };
  }

  return {
    async list(filter): Promise<Paged<AppealWithDetails>> {
      const { campusId, teacherId, status, page, pageSize } = filter;
      // campusId 过滤走 records.campusId（appeals 表无 campusId 列，靠 join records 推导）
      const cond = whereAll([
        campusId ? eq(records.campusId, campusId) : undefined,
        eqIf(appeals.teacherId, teacherId),
        eqIf(appeals.status, status),
      ]);

      const countCond = whereAll([
        campusId ? eq(records.campusId, campusId) : undefined,
        eqIf(appeals.teacherId, teacherId),
        eqIf(appeals.status, status),
      ]);
      const [{ total }] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(appeals)
        .leftJoin(records, eq(appeals.recordId, records.id))
        .where(countCond!);

      const rows = await joined()
        .where(cond!)
        .orderBy(desc(appeals.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return { data: rows.map(toDetails), pagination: paginate(page, pageSize, num(total)) };
    },

    async findById(id): Promise<AppealWithDetails | null> {
      const rows = await joined().where(eq(appeals.id, id)).limit(1);
      return rows[0] ? toDetails(rows[0]) : null;
    },

    async create(input): Promise<Appeal> {
      const id = crypto.randomUUID();
      await ctx.tx(async (tx: any) => {
        // 仅 active 记录可申诉（复刻旧 WHERE status='active' 语义）
        await tx.update(records).set({ status: 'appealing' })
          .where(and(eq(records.id, input.recordId), eq(records.status, 'active'))).run();
        await tx.insert(appeals).values({
          id, recordId: input.recordId, teacherId: input.teacherId,
          reason: input.reason, status: 'pending', reviewerId: null,
          reviewComment: null, reviewedAt: null,
        }).run();
        await tx.insert(recordLogs).values({
          id: crypto.randomUUID(), recordId: input.recordId,
          action: 'appeal', operatorId: input.teacherId, reason: input.reason,
        }).run();
      });
      const rows = await db.select().from(appeals).where(eq(appeals.id, id)).limit(1);
      const r = rows[0];
      return {
        id: r.id, recordId: r.recordId, teacherId: r.teacherId, reason: r.reason,
        status: r.status, reviewerId: r.reviewerId ?? null, reviewComment: r.reviewComment ?? null,
        createdAt: num(r.createdAt), reviewedAt: r.reviewedAt === null ? null : num(r.reviewedAt),
      };
    },

    async approve(recordId, reviewerId, reviewComment): Promise<void> {
      await ctx.tx(async (tx: any) => {
        await tx.update(appeals)
          .set({ status: 'approved', reviewerId, reviewComment, reviewedAt: Date.now() })
          .where(and(eq(appeals.recordId, recordId), eq(appeals.status, 'pending'))).run();
        await tx.update(records).set({ status: 'appeal_approved' }).where(eq(records.id, recordId)).run();
        await tx.insert(recordLogs).values({
          id: crypto.randomUUID(), recordId, action: 'appeal_approve',
          operatorId: reviewerId, reason: reviewComment ?? '申诉审批通过',
        }).run();
      });
    },

    async reject(recordId, reviewerId, reviewComment): Promise<void> {
      await ctx.tx(async (tx: any) => {
        // 仅当申诉仍 pending 才处理（防重复审批）
        const appealRes = await tx.update(appeals)
          .set({ status: 'rejected', reviewerId, reviewComment, reviewedAt: Date.now() })
          .where(and(eq(appeals.recordId, recordId), eq(appeals.status, 'pending'))).run();
        const appealChanged = Number(appealRes?.changes ?? appealRes?.rowsAffected ?? 1);
        // REVIEW #4：record 回滚 active 必须带状态前置 `WHERE status='appealing'`——
        // 否则申诉期间记录已被 admin 撤回(revoked)时，驳回会把已撤回记录「复活」成 active 重新计分。
        // 状态机：只有 appealing 才回滚；revoked/appeal_approved 为终态，不动。
        await tx.update(records).set({ status: 'active' })
          .where(and(eq(records.id, recordId), eq(records.status, 'appealing'))).run();
        if (appealChanged > 0) {
          await tx.insert(recordLogs).values({
            id: crypto.randomUUID(), recordId, action: 'appeal_reject',
            operatorId: reviewerId, reason: reviewComment ?? '申诉被驳回',
          }).run();
        }
      });
    },
  };
}
