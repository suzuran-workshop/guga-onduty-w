/**
 * awards repo（drizzle 实现）—— 流动红旗「候选参考 + 人工颁发」。
 *
 * 2026-10-23 变更（需求：仅管理员人工颁发，系统只提供参考）：
 *  - 原 `autoAward`（一键评选每年级第一名并直接落库）拆成两个动作：
 *    · `candidates`（**只读**）：算出每年级第一名作参考，标记 alreadyAwarded，**不落库**。
 *    · `grant`（显式写）：管理员从候选中挑选 classIds 后颁发；幂等靠 UNIQUE + onConflictDoNothing。
 *  - 计分口径 SCORED_STATUSES 改用 schema/enums.ts 单一真源（原 4 份重复定义收敛）。
 *
 * 迁移要点（对照旧 routes/awards.ts）：
 *  - **幂等**：awards 表有 UNIQUE(campusId,classId,week)，重复颁发用 onConflictDoNothing 跳过。
 *  - 事务批量 insert；grant 返回本次实际新增的奖项。
 *  - listByCampus join classes+grades 取 className/gradeName。
 */
import { eq, and, desc, asc, sql, inArray } from 'drizzle-orm';
import type { Award, AwardCandidate } from '@guga-onduty-w/shared';
import type { AwardsRepo } from '../types.js';
import { DrizzleCtx, whereAll, eqIf, num } from './_base.js';
import { SCORED_STATUSES } from '../../schema/enums.js';

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

  /** 本周按班级聚合得分（含年级维度），计分口径与 statistics 一致 */
  async function aggregateRanking(campusId: string, week: string, gradeId?: string | null) {
    const totalExpr = sql<number>`COALESCE(SUM(CASE WHEN ${records.status} IN (${sql.raw(SCORED_STATUSES.map((s) => `'${s}'`).join(','))}) THEN ${records.score} ELSE 0 END), 0)`;
    const joinCond = and(eq(records.classId, classes.id), eq(records.week, week));
    const cond = whereAll([eq(classes.campusId, campusId), gradeId ? eq(grades.id, gradeId) : undefined]);
    return db
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
  }

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

    async candidates(campusId, week, gradeId): Promise<AwardCandidate[]> {
      // 1. 聚合排名（口径与 statistics 一致）
      const rankings = await aggregateRanking(campusId, week, gradeId);

      // 2. 每年级取第一名（rank=1）作候选参考
      const seenGrades = new Set<string>();
      const picked: AwardCandidate[] = [];
      for (const r of rankings) {
        if (seenGrades.has(r.gradeId)) continue;
        seenGrades.add(r.gradeId);
        picked.push({
          classId: r.classId,
          className: r.className,
          gradeId: r.gradeId,
          gradeName: r.gradeName,
          totalScore: num(r.totalScore),
          rank: 1,
          alreadyAwarded: false, // 下方批量标记
        });
      }

      // 3. 标记本周已颁发的（避免重复颁旗）
      if (picked.length > 0) {
        const existing = await db
          .select({ classId: awards.classId })
          .from(awards)
          .where(and(eq(awards.campusId, campusId), eq(awards.week, week), inArray(awards.classId, picked.map((p) => p.classId))));
        const awardedSet = new Set(existing.map((e: any) => e.classId));
        for (const c of picked) c.alreadyAwarded = awardedSet.has(c.classId);
      }
      return picked;
    },

    async grant(campusId, week, classIds, opts): Promise<Award[]> {
      if (classIds.length === 0) return [];
      // 校验班级归属本校区（防跨校区颁旗）+ 取班级/年级名作 note
      const rows = await db
        .select({ classId: classes.id, className: classes.name, gradeName: grades.name })
        .from(classes)
        .innerJoin(grades, eq(classes.gradeId, grades.id))
        .where(and(eq(classes.campusId, campusId), inArray(classes.id, classIds)));
      const byId = new Map<string, { className: string; gradeName: string }>();
      for (const r of rows) byId.set(r.classId, { className: r.className, gradeName: r.gradeName });

      const created: Award[] = [];
      await ctx.tx(async (tx: any) => {
        for (const classId of classIds) {
          const info = byId.get(classId);
          if (!info) continue; // 跨校区/不存在的班级静默跳过（不泄露存在性）
          const id = crypto.randomUUID();
          const note = opts?.note ?? `${info.gradeName} ${info.className} 获第${week}周流动红旗`;
          const res = await tx.insert(awards).values({
            id,
            campusId,
            classId,
            week,
            category: opts?.category ?? 'overall',
            note,
            awardedAt: Date.now(),
          }).onConflictDoNothing({ target: [awards.campusId, awards.classId, awards.week] }).run();
          const changed = Number(res?.changes ?? res?.rowsAffected ?? 1);
          if (changed > 0) {
            created.push({ id, campusId, classId, week, category: opts?.category ?? 'overall', note, awardedAt: Date.now(), className: info.className, gradeName: info.gradeName });
          }
        }
      });
      return created;
    },

    async remove(id): Promise<void> {
      await db.delete(awards).where(eq(awards.id, id)).run();
    },
  };
}
