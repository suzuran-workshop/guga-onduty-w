/**
 * statistics repo（drizzle 实现）—— 聚合查询，双方言一致的口径。
 *
 * 迁移要点（对照旧 routes/statistics.ts）：
 *  - 有效计分口径 SCORED_STATUSES（active+appealing，见 schema/enums.ts 单一真源）。
 *  - ranking 的 total/positive/negative/count 用 SUM(CASE WHEN)；orderBy 重复表达式（不用别名）。
 *  - groupBy 补全所有非聚合列（pg 严格）。
 *  - dashboard 用 epoch 区间 [dayStart,dayEnd) 判「今日」（修复旧代码 UTC 日期边界 bug）。
 *  - trend 的周次列表由路由算好传入（repo 不碰日期逻辑，便于双方言一致）。
 */
import { desc, eq, and, sql, gte, lt, inArray } from 'drizzle-orm';
import type { ClassRanking, TrendPoint, DashboardStats } from '@guga-onduty-w/shared';
import type { StatisticsRepo } from '../types.js';
import { DrizzleCtx, whereAll, num } from './_base.js';
import { SCORED_STATUSES } from '../../schema/enums.js';

/**
 * 有效计分状态口径见 schema/enums.ts 的 SCORED_STATUSES（active + appealing）。
 *
 * ⚠ 语义（2026-10-23 申诉改造后）：
 *  - active：正常记录，计分。
 *  - appealing：申诉中，罚分**暂仍生效**（未裁决前不倒扣）。
 *  - revoked：管理员撤回 → 不计分。
 *  - 申诉通过（adjust）后记录回 **active**、分数改为调整后值 → 照常计分。
 *    （旧 `appeal_approved` 终态「踢出计分=全额撤销」的机制已移除，改为「修改而非撤销」。）
 */

export function createStatisticsRepo(ctx: DrizzleCtx): StatisticsRepo {
  const { tables: T } = ctx;
  const db = ctx.db as any;
  const { records, classes, grades } = T;

  // 计分条件下的分数表达式（active/appealing 才计入；revoked 撤回不计。申诉通过后记录回 active 照常计分）
  const scoredScore = sql<number>`CASE WHEN ${records.status} IN (${sql.raw(SCORED_STATUSES.map((s) => `'${s}'`).join(','))}) THEN ${records.score} ELSE 0 END`;

  return {
    async ranking(campusId, week, gradeId): Promise<ClassRanking[]> {
      const totalExpr = sql<number>`COALESCE(SUM(${scoredScore}), 0)`;
      const positiveExpr = sql<number>`COALESCE(SUM(CASE WHEN ${records.status} IN (${sql.raw(SCORED_STATUSES.map((s) => `'${s}'`).join(','))}) AND ${records.score} > 0 THEN 1 ELSE 0 END), 0)`;
      const negativeExpr = sql<number>`COALESCE(SUM(CASE WHEN ${records.status} IN (${sql.raw(SCORED_STATUSES.map((s) => `'${s}'`).join(','))}) AND ${records.score} < 0 THEN 1 ELSE 0 END), 0)`;
      const countExpr = sql<number>`COALESCE(COUNT(CASE WHEN ${records.status} IN (${sql.raw(SCORED_STATUSES.map((s) => `'${s}'`).join(','))}) THEN 1 END), 0)`;

      // week 条件放在 LEFT JOIN 的 ON 上（保证无记录班级也出现，复刻旧逻辑）
      const joinCond = week
        ? and(eq(records.classId, classes.id), eq(records.week, week))
        : eq(records.classId, classes.id);

      const cond = whereAll([eq(classes.campusId, campusId), gradeId ? eq(grades.id, gradeId) : undefined]);

      const rows = await db
        .select({
          classId: classes.id,
          className: classes.name,
          gradeId: grades.id,
          gradeName: grades.name,
          totalScore: totalExpr,
          positiveCount: positiveExpr,
          negativeCount: negativeExpr,
          recordCount: countExpr,
        })
        .from(classes)
        .innerJoin(grades, eq(classes.gradeId, grades.id))
        .leftJoin(records, joinCond)
        .where(cond!)
        // pg 严格：groupBy 补全所有非聚合列
        .groupBy(classes.id, classes.name, grades.id, grades.name)
        // ⚠ orderBy 重复表达式（不能用字段 key totalScore —— drizzle 不生成别名）
        .orderBy(desc(totalExpr));

      return rows.map((r: any, i: number) => ({
        rank: i + 1,
        classId: r.classId,
        className: r.className,
        gradeId: r.gradeId,
        gradeName: r.gradeName,
        totalScore: num(r.totalScore),
        positiveCount: num(r.positiveCount),
        negativeCount: num(r.negativeCount),
        recordCount: num(r.recordCount),
      }));
    },

    async trend(campusId, classId, weeks): Promise<TrendPoint[]> {
      if (weeks.length === 0) return [];
      const weekTotal = sql<number>`COALESCE(SUM(${scoredScore}), 0)`;
      const rows = await db
        .select({ week: records.week, totalScore: weekTotal })
        .from(records)
        // REVIEW #3：加 campusId 隔离，杜绝跨校区班级趋势泄漏
        .where(and(eq(records.campusId, campusId), eq(records.classId, classId), inArray(records.week, weeks)))
        .groupBy(records.week)
        .orderBy(records.week);

      // 补零：无数据的周填 0（复刻旧逻辑）
      const byWeek = new Map<string, number>();
      for (const r of rows) byWeek.set(r.week, num(r.totalScore));
      return weeks.map((w) => ({ week: w, totalScore: byWeek.get(w) ?? 0 }));
    },

    async dashboard(campusId, dayStart, dayEnd, week): Promise<DashboardStats> {
      // 今日聚合口径与 ranking 一致：active+appealing 计入（revoked 撤回不计；申诉通过后回 active 照常计分）。
      // 与旧代码差异：旧代码今日只数 active，会把「申诉中」的当日记录漏掉；此处纳入 appealing 使口径与排名一致。
      const todayCond = and(
        eq(records.campusId, campusId),
        gte(records.recordedAt, dayStart),
        lt(records.recordedAt, dayEnd),
        sql`${records.status} IN (${sql.raw(SCORED_STATUSES.map((s) => `'${s}'`).join(','))})`,
      );

      // 今日聚合：一次查询取 count + 正/负分（旧代码是 3 条独立查询，合并）
      const [todayAgg] = await db
        .select({
          records: sql<number>`COUNT(*)`,
          positive: sql<number>`COALESCE(SUM(CASE WHEN ${records.score} > 0 THEN ${records.score} ELSE 0 END), 0)`,
          negative: sql<number>`COALESCE(SUM(CASE WHEN ${records.score} < 0 THEN ${records.score} ELSE 0 END), 0)`,
        })
        .from(records)
        .where(todayCond);

      // 本周 top 班级
      const weekTotal = sql<number>`COALESCE(SUM(${records.score}), 0)`;
      const [top] = await db
        .select({ className: classes.name, totalScore: weekTotal })
        .from(records)
        .innerJoin(classes, eq(records.classId, classes.id))
        .where(
          and(
            eq(records.campusId, campusId),
            eq(records.week, week),
            sql`${records.status} IN (${sql.raw(SCORED_STATUSES.map((s) => `'${s}'`).join(','))})`,
          ),
        )
        .groupBy(classes.id, classes.name)
        .orderBy(desc(weekTotal))
        .limit(1);

      return {
        todayRecords: num(todayAgg?.records),
        todayPositive: num(todayAgg?.positive),
        todayNegative: num(todayAgg?.negative),
        weekTopClass: top?.className ?? null,
        weekTopScore: top ? num(top.totalScore) : null,
      };
    },
  };
}
