/**
 * grades repo（drizzle 实现）—— CRUD + join campuses 取 campusName。
 * 迁移要点（对照旧 routes/grades.ts）：id 为 uuid；listByCampus join campuses 取 campusName，orderBy sortOrder。
 */
import { asc, eq } from 'drizzle-orm';
import type { Grade } from '@guga-onduty-w/shared';
import type { GradesRepo } from '../types.js';
import { DrizzleCtx, num } from './_base.js';

function toGrade(r: any): Grade {
  return {
    id: r.id,
    campusId: r.campusId,
    name: r.name,
    sortOrder: num(r.sortOrder),
    ...(r.campusName !== undefined ? { campusName: r.campusName } : {}),
  };
}

export function createGradesRepo(ctx: DrizzleCtx): GradesRepo {
  const db = ctx.db as any;
  const { grades, campuses } = ctx.tables;

  const projection = {
    id: grades.id,
    campusId: grades.campusId,
    name: grades.name,
    sortOrder: grades.sortOrder,
    campusName: campuses.name,
  };

  return {
    async listByCampus(campusId): Promise<Grade[]> {
      const rows = await db
        .select(projection)
        .from(grades)
        .innerJoin(campuses, eq(grades.campusId, campuses.id))
        .where(eq(grades.campusId, campusId))
        .orderBy(asc(grades.sortOrder));
      return rows.map(toGrade);
    },

    async findById(id): Promise<Grade | null> {
      const rows = await db
        .select(projection)
        .from(grades)
        .innerJoin(campuses, eq(grades.campusId, campuses.id))
        .where(eq(grades.id, id))
        .limit(1);
      return rows[0] ? toGrade(rows[0]) : null;
    },

    async create(input): Promise<Grade> {
      const id = crypto.randomUUID();
      await db.insert(grades).values({ id, campusId: input.campusId, name: input.name, sortOrder: input.sortOrder ?? 0 }).run();
      const found = await this.findById(id);
      if (!found) throw new Error('年级创建后回查失败');
      return found;
    },

    async update(id, input): Promise<Grade | null> {
      await db.update(grades).set({ name: input.name, sortOrder: input.sortOrder ?? 0 }).where(eq(grades.id, id)).run();
      return this.findById(id);
    },

    async remove(id): Promise<void> {
      await db.delete(grades).where(eq(grades.id, id)).run();
    },
  };
}
