/**
 * statistics repo（rest 实现）—— 聚合查询在 JS 侧（PostgREST 无聚合/join）。
 * 语义对齐 drizzle/statistics-repo，逐字段口径一致：
 *  - 有效计分口径：仅 active + appealing（appeal_approved=申诉成立撤销、revoked=撤回，均不计）。
 *  - ranking：每年级所有班级都出现（无记录计 0），按 totalScore 降序排 rank。
 *  - trend：无数据周补 0。
 *  - dashboard：今日 [dayStart,dayEnd) 计分记录数/正负分；本周 top 班级（取最高分第一名）。
 */
import type { RestFilters } from '@homurajs/db';
import type { ClassRanking, TrendPoint, DashboardStats } from '@guga-onduty-w/shared';
import type { StatisticsRepo } from '../types.js';
import { type RestCtx, tbl, indexByIds, num } from './_base.js';

/** 有效计分状态口径（单一真源，与 drizzle/statistics-repo 一致，REVIEW #1） */
const SCORED = new Set(['active', 'appealing']);
const isScored = (r: any) => SCORED.has(r.status);

export function createStatisticsRepo(ctx: RestCtx): StatisticsRepo {
  const records = tbl<any>(ctx.rest, 'records');
  const classes = tbl<any>(ctx.rest, 'classes');
  const grades = tbl<any>(ctx.rest, 'grades');

  return {
    async ranking(campusId, week, gradeId): Promise<ClassRanking[]> {
      // 班级全集（campusId 隔离 + 可选年级过滤），带年级信息（leftJoin 语义：无记录班级也出现）
      const classFilters: RestFilters = { campusId };
      if (gradeId) classFilters.gradeId = gradeId;
      const classRows = await classes.select(classFilters);
      const gmap = await indexByIds(grades, 'id', classRows.map((c) => c.gradeId));

      // 相关记录：campusId + 可选 week（单次查询，JS 分组）
      const recFilters: RestFilters = { campusId };
      if (week) recFilters.week = week;
      const recRows = await records.select(recFilters);
      const byClass = new Map<string, any[]>();
      for (const r of recRows) {
        const list = byClass.get(r.classId);
        if (list) list.push(r); else byClass.set(r.classId, [r]);
      }

      const rows = classRows.map((c) => {
        const scored = (byClass.get(c.id) ?? []).filter(isScored);
        let totalScore = 0, positiveCount = 0, negativeCount = 0;
        for (const r of scored) {
          const s = num(r.score);
          totalScore += s;
          if (s > 0) positiveCount++;
          if (s < 0) negativeCount++;
        }
        return {
          classId: c.id,
          className: c.name,
          gradeId: c.gradeId,
          gradeName: gmap.get(c.gradeId)?.name ?? '',
          totalScore,
          positiveCount,
          negativeCount,
          recordCount: scored.length,
        };
      });
      // 按 totalScore 降序（drizzle orderBy desc(totalExpr)）
      rows.sort((a, b) => b.totalScore - a.totalScore);
      return rows.map((r, i) => ({ rank: i + 1, ...r }));
    },

    async trend(campusId, classId, weeks): Promise<TrendPoint[]> {
      if (weeks.length === 0) return [];
      const rows = await records.select({ campusId, classId, week: weeks });
      const byWeek = new Map<string, number>();
      for (const r of rows) {
        if (!isScored(r)) continue;
        byWeek.set(r.week, (byWeek.get(r.week) ?? 0) + num(r.score));
      }
      // 补零：无数据的周填 0
      return weeks.map((w) => ({ week: w, totalScore: byWeek.get(w) ?? 0 }));
    },

    async dashboard(campusId, dayStart, dayEnd, week): Promise<DashboardStats> {
      // 今日聚合口径与 ranking 一致：active+appealing 计入；区间 [dayStart, dayEnd)
      const todayRows = await records.select({ campusId });
      let todayRecords = 0, todayPositive = 0, todayNegative = 0;
      for (const r of todayRows) {
        if (!isScored(r)) continue;
        const at = num(r.recordedAt);
        if (at < dayStart || at >= dayEnd) continue;
        todayRecords++;
        const s = num(r.score);
        if (s > 0) todayPositive += s;
        if (s < 0) todayNegative += s;
      }

      // 本周 top 班级（计分口径同上）；并列时取遍历序第一个（drizzle orderBy 仅按分降序，语义一致）
      const weekRows = await records.select({ campusId, week });
      const byClass = new Map<string, number>();
      for (const r of weekRows) {
        if (!isScored(r)) continue;
        byClass.set(r.classId, (byClass.get(r.classId) ?? 0) + num(r.score));
      }
      let weekTopClass: string | null = null;
      let weekTopScore: number | null = null;
      if (byClass.size > 0) {
        const cmap = await indexByIds(classes, 'id', Array.from(byClass.keys()));
        for (const [classId, score] of byClass) {
          if (weekTopScore === null || score > weekTopScore) {
            weekTopScore = score;
            weekTopClass = cmap.get(classId)?.name ?? '';
          }
        }
      }

      return { todayRecords, todayPositive, todayNegative, weekTopClass, weekTopScore };
    },
  };
}
