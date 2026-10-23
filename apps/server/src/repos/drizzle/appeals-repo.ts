/**
 * appeals repo（drizzle 实现）—— 申诉状态机，事务保证 record↔appeal 联动。
 *
 * 2026-10-23 变更（需求：申诉通过是「修改而非撤销」）：
 *  - approve 不再把 record 打成终态 `appeal_approved`（该状态已移除），而是**调整分数后回 active**：
 *    管理员给出调整后的 tagIds（省略则保持原集），score 按 tagIds 重算，记录回 active 照常计分。
 *  - create 补写 appeals.campusId（此前是死参数，insert 不含它）。
 *  - recordInfo 的标签从单值 tagName 改为 tags 数组（records.tagId→tagIds），去掉对 tags 的 1:1 join，
 *    改为批量 attach（照抄 records-repo）。
 *
 * 迁移要点（对照旧 routes/records.ts 的 appeal 端点 + routes/appeals.ts 查询）：
 *  - create：事务 update records.status→appealing（仅 active）+ insert appeal + log。
 *  - approve：事务 update appeal(approved,仅 pending)+ record(调分回 active,仅 appealing)+ log 'adjust'。
 *  - reject：事务 update appeal(rejected)+ record(回滚 active)+ log。
 *  - list：一次 join 取 record_info（修复旧代码逐行再查的 N+1）。
 *  - teacher 只看自己的（teacherId 过滤）；campusId 过滤补齐。
 */
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import type { Appeal, AppealWithDetails, AppealRecordInfo, Tag, TagCategory } from '@guga-onduty-w/shared';
import type { AppealsRepo, Paged } from '../types.js';
import { DrizzleCtx, whereAll, eqIf, paginate, num } from './_base.js';

function toTag(r: any): Tag {
  return {
    id: r.id, campusId: r.campusId, name: r.name, score: num(r.score),
    color: r.color, category: r.category as TagCategory, isSystem: num(r.isSystem), createdAt: num(r.createdAt),
  };
}

function toJsonArray(v: unknown): string[] | null {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.length > 0) {
    try { return JSON.parse(v); } catch { return null; }
  }
  return null;
}

export function createAppealsRepo(ctx: DrizzleCtx): AppealsRepo {
  const { tables: T } = ctx;
  const db = ctx.db as any;
  const { appeals, records, recordLogs, classes, tags, userProfiles } = T;

  // teacher/reviewer 都来自 userProfiles.displayName（旧 users.display_name）
  const teacherName = sql<string>`(SELECT ${userProfiles.displayName} FROM ${userProfiles} WHERE ${userProfiles.userId} = ${appeals.teacherId})`;
  const reviewerName = sql<string | null>`(SELECT ${userProfiles.displayName} FROM ${userProfiles} WHERE ${userProfiles.userId} = ${appeals.reviewerId})`;

  /** appeal + record_info 的完整投影（list/detail 复用）。tags 由 attachTags 批量补 */
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
    riTagIds: records.tagIds,
    riCampusId: records.campusId,
  };

  // 不再 join tags（records.tagIds 是数组，1:1 join 不成立）
  const joined = () =>
    db
      .select(projection)
      .from(appeals)
      .leftJoin(records, eq(appeals.recordId, records.id))
      .leftJoin(classes, eq(records.classId, classes.id));

  /** 内部中间态：AppealWithDetails + 待展开的 recordInfo.tagIds（attachRecordTags 消费后丢弃） */
  type AppealRow = { appeal: AppealWithDetails; riTagIds: string[] };

  function toRow(r: any): AppealRow {
    const riTagIds = toJsonArray(r.riTagIds) ?? [];
    const recordInfo: AppealRecordInfo | null =
      r.riWeek === null || r.riWeek === undefined
        ? null
        : {
            score: num(r.riScore),
            comment: r.riComment ?? null,
            week: r.riWeek,
            recordedAt: num(r.riRecordedAt),
            recordStatus: r.riStatus,
            className: r.riClassName ?? '',
            tags: [], // 由 attachRecordTags 填充
          };
    const appeal: AppealWithDetails = {
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
    return { appeal, riTagIds };
  }

  /** 批量把 recordInfo.tags 按 riTagIds 展开为 Tag（一次查询，消除 N+1），返回纯 AppealWithDetails */
  async function attachRecordTags(rows: AppealRow[]): Promise<AppealWithDetails[]> {
    const allIds = Array.from(new Set(rows.flatMap((x) => x.riTagIds)));
    const byId = new Map<string, Tag>();
    if (allIds.length > 0) {
      const tagRows = await db.select().from(tags).where(inArray(tags.id, allIds));
      for (const r of tagRows) byId.set(r.id, toTag(r));
    }
    return rows.map(({ appeal, riTagIds }) => {
      if (appeal.recordInfo) {
        appeal.recordInfo.tags = riTagIds.map((id) => byId.get(id)).filter((x): x is Tag => Boolean(x));
      }
      return appeal;
    });
  }

  /** 按 tagIds 求和分数（与 records-repo 同口径：空→0，找不到的 id 不计入） */
  async function sumScore(tagIds: string[]): Promise<number> {
    if (tagIds.length === 0) return 0;
    const rows = await db.select({ score: tags.score }).from(tags).where(inArray(tags.id, tagIds));
    return rows.reduce((acc: number, r: any) => acc + num(r.score), 0);
  }

  return {
    async list(filter): Promise<Paged<AppealWithDetails>> {
      const { campusId, teacherId, status, page, pageSize } = filter;
      // campusId 过滤走 appeals.campusId（2026-10-23 起该列已落库，无需 join records 推导）
      const cond = whereAll([
        eqIf(appeals.campusId, campusId),
        eqIf(appeals.teacherId, teacherId),
        eqIf(appeals.status, status),
      ]);

      const [{ total }] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(appeals)
        .where(whereAll([
          eqIf(appeals.campusId, campusId),
          eqIf(appeals.teacherId, teacherId),
          eqIf(appeals.status, status),
        ])!);

      const rows = await joined()
        .where(cond!)
        .orderBy(desc(appeals.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return {
        data: await attachRecordTags(rows.map(toRow)),
        pagination: paginate(page, pageSize, num(total)),
      };
    },

    async findById(id): Promise<AppealWithDetails | null> {
      const rows = await joined().where(eq(appeals.id, id)).limit(1);
      if (!rows[0]) return null;
      const [withTags] = await attachRecordTags([toRow(rows[0])]);
      return withTags;
    },

    async create(input): Promise<Appeal> {
      const id = crypto.randomUUID();
      await ctx.tx(async (tx: any) => {
        // 仅 active 记录可申诉（复刻旧 WHERE status='active' 语义）
        await tx.update(records).set({ status: 'appealing' })
          .where(and(eq(records.id, input.recordId), eq(records.status, 'active'))).run();
        await tx.insert(appeals).values({
          id, campusId: input.campusId, recordId: input.recordId, teacherId: input.teacherId,
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

    async approve(recordId, reviewerId, opts): Promise<void> {
      // 需求：申诉通过=「修改而非撤销」。管理员给出调整后 tagIds（省略则保持原集），
      // score 重算，record 回 active 照常计分。仅处理 appealing 记录（防复活已撤回的）。
      const [rec] = await db.select({ tagIds: records.tagIds, status: records.status })
        .from(records).where(eq(records.id, recordId)).limit(1);
      if (!rec) throw new Error('记录不存在');
      const tagIds = opts.tagIds ?? (toJsonArray(rec.tagIds) ?? []);
      const score = await sumScore(tagIds);
      await ctx.tx(async (tx: any) => {
        const appealRes = await tx.update(appeals)
          .set({ status: 'approved', reviewerId, reviewComment: opts.reviewComment, reviewedAt: Date.now() })
          .where(and(eq(appeals.recordId, recordId), eq(appeals.status, 'pending'))).run();
        const appealChanged = Number(appealRes?.changes ?? appealRes?.rowsAffected ?? 1);
        // 仅 appealing 记录才调分回 active（REVIEW #4：防复活已 revoked 的记录）
        await tx.update(records)
          .set({ tagIds: tagIds.length > 0 ? tagIds : null, score, status: 'active' })
          .where(and(eq(records.id, recordId), eq(records.status, 'appealing'))).run();
        if (appealChanged > 0) {
          await tx.insert(recordLogs).values({
            id: crypto.randomUUID(), recordId, action: 'adjust',
            operatorId: reviewerId, reason: opts.reviewComment ?? '申诉通过，调整分数',
          }).run();
        }
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
