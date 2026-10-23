/**
 * records repo（drizzle 实现）—— 核心表，含事务与多表 join。
 *
 * 2026-10-23 多标签改造：
 *  - `tagId` 单值 → `tagIds` JSON 数组；**score 由本 repo 按 tagIds 求和写入**（标签分权威，
 *    不接受调用方传 score），从数据层杜绝「评分模块自行改分」。
 *  - 多标签无法再对 tags 做 1:1 leftJoin，改为取行后批量 findByIds + JS 组装（照抄 templates-repo.attachTags）。
 *  - 新增 createMany（班级平铺多选，一次事务落多条独立记录）与 adjust（申诉通过=调分而非撤销）。
 *
 * 迁移要点（对照旧 routes/records.ts）：
 *  - id 全 uuid；recorderName 来自 userProfiles.displayName。
 *  - create/revoke/adjust 用事务包裹 record+log（修复旧代码非原子：log 缺失/状态撕裂）。
 *  - images 存 storage objectKey 数组（JSON 列，drizzle 自动编解码）。
 *  - 分页 total 用子查询 count（复刻旧逻辑，但参数化）。
 */
import { desc, asc, eq, and, sql, inArray } from 'drizzle-orm';
import type { RecordWithDetails, RecordStatus, RecordLog, RecordAction, Tag, TagCategory } from '@guga-onduty-w/shared';
import type { RecordsRepo, Paged } from '../types.js';
import { DrizzleCtx, whereAll, eqIf, paginate, num } from './_base.js';

/** tag 行 → Tag 领域对象（与 templates-repo 一致） */
function toTag(r: any): Tag {
  return {
    id: r.id,
    campusId: r.campusId,
    name: r.name,
    score: num(r.score),
    color: r.color,
    category: r.category as TagCategory,
    isSystem: num(r.isSystem),
    createdAt: num(r.createdAt),
  };
}

/** JSON 列（string[]）反序列化兜底 */
function toJsonArray(v: unknown): string[] | null {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.length > 0) {
    try { return JSON.parse(v); } catch { return null; }
  }
  return null;
}

/** record + join 的原始行 → 领域对象（tags 稍后由 attachTags 填充） */
function toDetails(r: any): RecordWithDetails {
  return {
    id: r.id,
    campusId: r.campusId,
    classId: r.classId,
    recorderId: r.recorderId,
    tagIds: toJsonArray(r.tagIds),
    score: num(r.score),
    comment: r.comment ?? null,
    images: toJsonArray(r.images),
    week: r.week,
    status: r.status as RecordStatus,
    recordedAt: num(r.recordedAt),
    className: r.className,
    gradeName: r.gradeName,
    recorderName: r.recorderName,
    tags: [],
  };
}

export function createRecordsRepo(ctx: DrizzleCtx): RecordsRepo {
  const { tables: T } = ctx;
  const db = ctx.db as any;
  const { records, recordLogs, classes, grades, tags, userProfiles } = T;

  /** join 投影（list/detail/export 复用）—— 别名 camelCase，与 RecordWithDetails 对齐（tags 除外） */
  const projection = {
    id: records.id,
    campusId: records.campusId,
    classId: records.classId,
    recorderId: records.recorderId,
    tagIds: records.tagIds,
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
  };

  /**
   * 基础 join 链（records → classes → grades → userProfiles(recorder)）。
   * 不再 join tags（tagIds 是数组，1:1 join 不成立）；标签详情由 attachTags 批量补。
   * REVIEW #2：userProfiles 用 **leftJoin**（原 innerJoin）——用户被删后其记录不再被 join 丢弃。
   * classes/grades 仍 innerJoin（记录必属于存在的班级/年级，删除守卫已挡，见 #8）。
   */
  const joined = () =>
    db
      .select(projection)
      .from(records)
      .innerJoin(classes, eq(records.classId, classes.id))
      .innerJoin(grades, eq(classes.gradeId, grades.id))
      .leftJoin(userProfiles, eq(records.recorderId, userProfiles.userId));

  /**
   * 批量把 tagIds 展开为 Tag 对象数组（一次 inArray 查询，消除 N+1；照抄 templates-repo.attachTags）。
   * 按每条记录的 tagIds 顺序回填；找不到的 id（标签被删）静默跳过。
   */
  async function attachTags(list: RecordWithDetails[]): Promise<RecordWithDetails[]> {
    const allIds = Array.from(new Set(list.flatMap((r) => r.tagIds ?? [])));
    if (allIds.length === 0) return list;
    const rows = await db.select().from(tags).where(inArray(tags.id, allIds));
    const byId = new Map<string, Tag>();
    for (const r of rows) byId.set(r.id, toTag(r));
    return list.map((r) => ({
      ...r,
      tags: (r.tagIds ?? []).map((id) => byId.get(id)).filter((x): x is Tag => Boolean(x)),
    }));
  }

  /**
   * 按 tagIds 求和分数（标签分权威）。一次查询取全部分数后 JS 求和。
   * 空 tagIds → 0。找不到的 id（标签被删）不计入（避免脏数据撑爆分数）。
   */
  async function sumScore(tagIds: string[]): Promise<number> {
    if (tagIds.length === 0) return 0;
    const rows = await db.select({ score: tags.score }).from(tags).where(inArray(tags.id, tagIds));
    return rows.reduce((acc: number, r: any) => acc + num(r.score), 0);
  }

  /** 单条 insert record + log（在调用方事务内执行） */
  async function insertRecord(
    tx: any,
    input: {
      id: string; campusId: string; classId: string; recorderId: string;
      tagIds: string[]; score: number; comment?: string | null;
      images?: string[] | null; week: string; recordedAt: number; status?: string;
    },
  ): Promise<void> {
    await tx.insert(records).values({
      id: input.id,
      campusId: input.campusId,
      classId: input.classId,
      recorderId: input.recorderId,
      tagIds: input.tagIds.length > 0 ? input.tagIds : null,
      score: input.score,
      comment: input.comment ?? null,
      images: input.images && input.images.length > 0 ? input.images : null,
      week: input.week,
      status: input.status ?? 'active',
      recordedAt: input.recordedAt,
    }).run();
    await tx.insert(recordLogs).values({
      id: crypto.randomUUID(),
      recordId: input.id,
      action: 'create',
      operatorId: input.recorderId,
      reason: null,
    }).run();
  }

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

      return {
        data: await attachTags(rows.map(toDetails)),
        pagination: paginate(page, pageSize, num(total)),
      };
    },

    async findByIdWithDetails(id): Promise<RecordWithDetails | null> {
      const rows = await joined().where(eq(records.id, id)).limit(1);
      if (!rows[0]) return null;
      const [withTags] = await attachTags([toDetails(rows[0])]);
      return withTags;
    },

    async create(input): Promise<RecordWithDetails> {
      const id = crypto.randomUUID();
      const score = await sumScore(input.tagIds);
      await ctx.tx(async (tx: any) => {
        await insertRecord(tx, { id, ...input, score });
      });
      const detail = await this.findByIdWithDetails(id);
      if (!detail) throw new Error('记录创建后回查失败');
      return detail;
    },

    async createMany(input): Promise<RecordWithDetails[]> {
      const score = await sumScore(input.tagIds);
      const ids = input.classIds.map(() => crypto.randomUUID());
      // 单事务：全成或全败（多班级相同评价是一次语义动作）
      await ctx.tx(async (tx: any) => {
        for (let i = 0; i < input.classIds.length; i++) {
          await insertRecord(tx, {
            id: ids[i],
            campusId: input.campusId,
            classId: input.classIds[i],
            recorderId: input.recorderId,
            tagIds: input.tagIds,
            score,
            comment: input.comment,
            images: input.images,
            week: input.week,
            recordedAt: input.recordedAt,
          });
        }
      });
      const details: RecordWithDetails[] = [];
      for (const id of ids) {
        const d = await this.findByIdWithDetails(id);
        if (!d) throw new Error('批量创建后回查失败');
        details.push(d);
      }
      return details;
    },

    async revoke(id, operatorId, reason): Promise<void> {
      // REVIEW #4/#11：状态迁移合法性——只允许 active/appealing → revoked。
      // 防重复撤回已 revoked 记录（重复 log + 重复 SSE）。
      // record 状态机合法迁移：active→{appealing,revoked}；appealing→{active,revoked}；revoked 为终态。
      // （2026-10-23：appeal_approved 已移除——申诉通过表现为 adjust 回 active，不再是终态。）
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

    async adjust(id, input): Promise<RecordWithDetails> {
      // 申诉通过=调分而非撤销：改 tagIds + 重算 score + 回 active + log 'adjust'。
      // 回 active 后调整分数照常计分（SCORED_STATUSES 含 active）——这正是「修改而非撤销」的落点。
      const score = await sumScore(input.tagIds);
      await ctx.tx(async (tx: any) => {
        await tx.update(records).set({
          tagIds: input.tagIds.length > 0 ? input.tagIds : null,
          score,
          status: 'active',
        }).where(eq(records.id, id)).run();
        await tx.insert(recordLogs).values({
          id: crypto.randomUUID(),
          recordId: id,
          action: 'adjust',
          operatorId: input.operatorId,
          reason: input.reason,
        }).run();
      });
      const detail = await this.findByIdWithDetails(id);
      if (!detail) throw new Error('调分后回查失败');
      return detail;
    },

    async listLogs(recordId): Promise<RecordLog[]> {
      // 按时间升序（先 create 后 adjust）；leftJoin userProfiles 取操作人名（用户可能已删，COALESCE 兜底）
      const rows = await db
        .select({
          id: recordLogs.id,
          recordId: recordLogs.recordId,
          action: recordLogs.action,
          operatorId: recordLogs.operatorId,
          reason: recordLogs.reason,
          createdAt: recordLogs.createdAt,
          operatorName: sql<string>`COALESCE(${userProfiles.displayName}, '已删除用户')`,
        })
        .from(recordLogs)
        .leftJoin(userProfiles, eq(recordLogs.operatorId, userProfiles.userId))
        .where(eq(recordLogs.recordId, recordId))
        .orderBy(asc(recordLogs.createdAt));
      return rows.map((r: any) => ({
        id: r.id,
        recordId: r.recordId,
        action: r.action as RecordAction,
        operatorId: r.operatorId,
        reason: r.reason ?? null,
        createdAt: num(r.createdAt),
        operatorName: r.operatorName,
      }));
    },

    async listForExport(campusId, startWeek, endWeek): Promise<RecordWithDetails[]> {
      const cond = whereAll([
        eq(records.campusId, campusId),
        startWeek ? sql`${records.week} >= ${startWeek}` : undefined,
        endWeek ? sql`${records.week} <= ${endWeek}` : undefined,
      ]);
      const rows = await joined().where(cond!).orderBy(desc(records.recordedAt));
      return attachTags(rows.map(toDetails));
    },
  };
}
