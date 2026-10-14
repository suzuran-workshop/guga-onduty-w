/**
 * summary repo（drizzle 实现）—— 每日小结，只 list + create（与旧 routes/summary.ts 一致）。
 * 迁移要点：
 *  - id 为 uuid；listByCampus 可选 week 过滤，orderBy date desc → createdAt desc（复刻旧排序）。
 *  - notifiedTeachers 是 JSON 列（string[] | null），drizzle 自动反序列化，映射时兜底。
 *  - create 显式给 id；createdAt 走 schema default。date/week/content/campusId 必填。
 */
import { desc, eq } from 'drizzle-orm';
import type { DailySummary } from '@class-duty/shared';
import type { SummaryRepo } from '../types.js';
import { DrizzleCtx, whereAll, eqIf, num } from './_base.js';

function toSummary(r: any): DailySummary {
  return {
    id: r.id,
    campusId: r.campusId,
    week: r.week,
    date: r.date,
    content: r.content,
    notifiedTeachers: Array.isArray(r.notifiedTeachers)
      ? r.notifiedTeachers
      : (r.notifiedTeachers ? JSON.parse(r.notifiedTeachers) : null),
    createdAt: num(r.createdAt),
  };
}

export function createSummaryRepo(ctx: DrizzleCtx): SummaryRepo {
  const db = ctx.db as any;
  const { dailySummaries } = ctx.tables;

  return {
    async listByCampus(campusId, week?): Promise<DailySummary[]> {
      const cond = whereAll([eq(dailySummaries.campusId, campusId), eqIf(dailySummaries.week, week)]);
      const rows = await db
        .select()
        .from(dailySummaries)
        .where(cond!)
        .orderBy(desc(dailySummaries.date), desc(dailySummaries.createdAt));
      return rows.map(toSummary);
    },

    async create(input): Promise<DailySummary> {
      const id = crypto.randomUUID();
      await db.insert(dailySummaries).values({
        id,
        campusId: input.campusId,
        week: input.week,
        date: input.date,
        content: input.content,
        notifiedTeachers: input.notifiedTeachers ?? null,
      }).run();
      const rows = await db.select().from(dailySummaries).where(eq(dailySummaries.id, id)).limit(1);
      if (!rows[0]) throw new Error('小结创建后回查失败');
      return toSummary(rows[0]);
    },
  };
}
