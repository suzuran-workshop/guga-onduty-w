/**
 * awards repo（rest 实现）—— 自动评选流动红旗，幂等。
 * 语义对齐 drizzle/awards-repo：
 *  - autoAward：每年级排名第一的班级各颁一面旗，计分口径与 statistics 一致（active+appealing）；
 *    幂等靠「插入前查重 UNIQUE(campusId,classId,week)」（rest 无 onConflictDoNothing）。
 *  - listByCampus join classes+grades 取 className/gradeName（innerJoin：班级缺失的奖项行丢弃）。
 */
import type { RestFilters } from '@homurajs/db';
import type { Award } from '@guga-onduty-w/shared';
import type { AwardsRepo } from '../types.js';
import { type RestCtx, tbl, indexByIds, num, uuid } from './_base.js';

// 计分口径与 statistics-repo 一致（REVIEW #1）：appeal_approved=申诉成立撤销，不计分
const SCORED = new Set(['active', 'appealing']);
const isScored = (r: any) => SCORED.has(r.status);

function toAward(r: any, cls?: any, grade?: any): Award {
  return {
    id: r.id,
    campusId: r.campusId,
    classId: r.classId,
    week: r.week,
    category: r.category,
    note: r.note ?? null,
    awardedAt: num(r.awardedAt),
    className: cls?.name ?? '',
    gradeName: grade?.name ?? '',
  };
}

export function createAwardsRepo(ctx: RestCtx): AwardsRepo {
  const awards = tbl<any>(ctx.rest, 'awards');
  const classes = tbl<any>(ctx.rest, 'classes');
  const grades = tbl<any>(ctx.rest, 'grades');
  const records = tbl<any>(ctx.rest, 'records');

  return {
    async listByCampus(campusId, week): Promise<Award[]> {
      const filters: RestFilters = { campusId };
      if (week) filters.week = week;
      const rows = await awards.select(filters, { order: 'awardedAt.desc' });
      // innerJoin(classes)+innerJoin(grades)：班级/年级缺失的行不出现
      const cmap = await indexByIds(classes, 'id', rows.map((r) => r.classId));
      const gmap = await indexByIds(grades, 'id', Array.from(cmap.values()).map((c) => c.gradeId));
      const out: Award[] = [];
      for (const r of rows) {
        const c = cmap.get(r.classId);
        if (!c) continue;
        const g = gmap.get(c.gradeId);
        if (!g) continue;
        out.push(toAward(r, c, g));
      }
      return out;
    },

    async autoAward(campusId, week, gradeId): Promise<Award[]> {
      // 1. 按班级聚合本周得分（含年级维度），计分口径与 statistics 一致
      const classFilters: RestFilters = { campusId };
      if (gradeId) classFilters.gradeId = gradeId;
      const classRows = await classes.select(classFilters);
      const gmap = await indexByIds(grades, 'id', classRows.map((c) => c.gradeId));

      const recRows = await records.select({ campusId, week });
      const scoreByClass = new Map<string, number>();
      for (const r of recRows) {
        if (!isScored(r)) continue;
        scoreByClass.set(r.classId, (scoreByClass.get(r.classId) ?? 0) + num(r.score));
      }

      // 排序：按年级分组、组内按分降序 → 每年级第一名（drizzle orderBy grades.id asc, totalScore desc）
      const ranked = classRows
        .map((c) => ({
          classId: c.id,
          className: c.name,
          gradeId: c.gradeId,
          gradeName: gmap.get(c.gradeId)?.name ?? '',
          totalScore: scoreByClass.get(c.id) ?? 0,
        }))
        .sort((a, b) =>
          a.gradeId < b.gradeId ? -1 : a.gradeId > b.gradeId ? 1 : b.totalScore - a.totalScore,
        );

      // 2. 每年级取第一个（该年级最高分班级）
      const seenGrades = new Set<string>();
      const winners: { classId: string; gradeName: string; className: string }[] = [];
      for (const r of ranked) {
        if (!seenGrades.has(r.gradeId)) {
          seenGrades.add(r.gradeId);
          winners.push({ classId: r.classId, gradeName: r.gradeName, className: r.className });
        }
      }

      // 3. 幂等插入（UNIQUE(campusId,classId,week) 预判跳过）
      for (const w of winners) {
        const dup = await awards.select({ campusId, classId: w.classId, week }, { limit: 1 });
        if (dup[0]) continue;
        await awards.insert({
          id: uuid(),
          campusId,
          classId: w.classId,
          week,
          category: 'overall',
          note: `${w.gradeName} ${w.className} 获第${week}周流动红旗`,
          awardedAt: Date.now(),
        });
      }

      // 4. 返回本周该校区全部奖项（含此前已颁的）
      return this.listByCampus(campusId, week);
    },

    async remove(id): Promise<void> {
      await awards.remove({ id });
    },
  };
}
