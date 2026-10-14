/**
 * awards repo（drizzle 实现）—— 自动评选流动红旗，幂等。
 *
 * 迁移要点（对照旧 routes/awards.ts）：
 *  - autoAward：复刻「每年级排名第一的班级各颁一面旗」逻辑，计分口径与 statistics 一致
 *    （active+appealing+appeal_approved）。
 *  - **幂等**：awards 表有 UNIQUE(campusId,classId,week)，重复调用用 onConflictDoNothing 跳过，
 *    修复旧代码「重复调用产生重复奖项」bug。
 *  - 事务批量 insert；返回本周该校区实际存在的奖项（含此前已颁的，前端看到完整列表）。
 *  - 修复旧代码 awards 空数组时 `IN ()` 语法错误（此处用 onConflict，无 IN 拼接）。
 *  - listByCampus join classes+grades 取 className/gradeName。
 */
import { eq, and, desc, asc, sql, inArray } from 'drizzle-orm';
import type { Award } from '@class-duty/shared';
import type { AwardsRepo } from '../types.js';
import { DrizzleCtx, whereAll, eqIf, num } from './_base.js';

const SCORED_STATUSES = ['active', 'appealing', 'appeal_approved'];

function toAward(r: any): Award {
  return {
    id: r.id,
    campusId: r.campusId,
    classId: r.classId,
    week: r.week,
    category: r.category,
    note: r.note ?? null,
    awardedAt: num(r.awardedAt),
    className: r.className,
    gradeName: r.gradeName,
  };
}

export function createAwardsRepo(ctx: DrizzleCtx): AwardsRepo {
  const { tables: T } = ctx;
  const db = ctx.db as any;
  const { awards, classes, grades, records } = T;

  /** list/detail 的 join 投影 */
  const projection = {
    id: awards.id,
    campusId: awards.campusId,
    classId: awards.classId,
    week: awards.week,
    category: awards.category,
    note: awards.note,
    awardedAt: awards.awardedAt,
    className: classes.name,
    gradeName: grades.name,
  };

  return {
    async listByCampus(campusId, week): Promise<Award[]> {
      const cond = whereAll([eq(awards.campusId, campusId), eqIf(awards.week, week)]);
      const rows = await db
        .select(projection)
        .from(awards)
        .innerJoin(classes, eq(awards.classId, classes.id))
        .innerJoin(grades, eq(classes.gradeId, grades.id))
        .where(cond!)
        .orderBy(desc(awards.awardedAt));
      return rows.map(toAward);
    },

    async autoAward(campusId, week, gradeId): Promise<Award[]> {
      // 1. 按班级聚合本周得分（含年级维度），计分口径与 statistics 一致
      const totalExpr = sql<number>`COALESCE(SUM(CASE WHEN ${records.status} IN (${sql.raw(SCORED_STATUSES.map((s) => `'${s}'`).join(','))}) THEN ${records.score} ELSE 0 END), 0)`;
      const joinCond = and(eq(records.classId, classes.id), eq(records.week, week));
      const cond = whereAll([eq(classes.campusId, campusId), gradeId ? eq(grades.id, gradeId) : undefined]);

      const rankings = await db
        .select({
          classId: classes.id,
          className: classes.name,
          gradeId: grades.id,
          gradeName: grades.name,
          totalScore: totalExpr,
        })
        .from(classes)
        .innerJoin(grades, eq(classes.gradeId, grades.id))
        .leftJoin(records, joinCond)
        .where(cond!)
        // pg 严格：groupBy 补全非聚合列
        .groupBy(classes.id, classes.name, grades.id, grades.name)
        // orderBy 重复表达式（不用别名）；按年级分组、组内按分降序 → 每年级第一名在前
        .orderBy(asc(grades.id), desc(totalExpr));

      // 2. 每年级取第一个（该年级最高分班级）
      const seenGrades = new Set<string>();
      const winners: { classId: string; gradeName: string; className: string }[] = [];
      for (const r of rankings) {
        if (!seenGrades.has(r.gradeId)) {
          seenGrades.add(r.gradeId);
          winners.push({ classId: r.classId, gradeName: r.gradeName, className: r.className });
        }
      }

      // 3. 幂等批量 insert（UNIQUE 冲突跳过）
      if (winners.length > 0) {
        await ctx.tx(async (tx: any) => {
          for (const w of winners) {
            await tx.insert(awards).values({
              id: crypto.randomUUID(),
              campusId,
              classId: w.classId,
              week,
              category: 'overall',
              note: `${w.gradeName} ${w.className} 获第${week}周流动红旗`,
              awardedAt: Date.now(),
            }).onConflictDoNothing({ target: [awards.campusId, awards.classId, awards.week] }).run();
          }
        });
      }

      // 4. 返回本周该校区全部奖项（含此前已颁的，前端看到完整列表）
      return this.listByCampus(campusId, week);
    },

    async remove(id): Promise<void> {
      await db.delete(awards).where(eq(awards.id, id)).run();
    },
  };
}
