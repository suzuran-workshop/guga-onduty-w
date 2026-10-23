/**
 * classes repo（drizzle 实现）—— CRUD + join grades/campuses 取名称。
 * 迁移要点（对照旧 routes/classes.ts）：
 *  - id 为 uuid；listByCampus join grades(gradeName) + campuses(campusName)，可选 gradeId 过滤，
 *    orderBy grades.sortOrder 再 classes.name。
 *  - findOwnership 取 {campusId, gradeId, teacherUserId}：记录创建时确定校区归属 +
 *    申诉时校验「只能申诉自己班」（teacherUserId 对比 profile.userId）。
 *  - listByTeacher：反查某教师任班主任的班级（钉钉周报按教师聚合用）。
 */
import { asc, eq } from 'drizzle-orm';
import type { Class } from '@guga-onduty-w/shared';
import type { ClassesRepo } from '../types.js';
import { DrizzleCtx, whereAll, eqIf } from './_base.js';

function toClass(r: any): Class {
  return {
    id: r.id,
    gradeId: r.gradeId,
    campusId: r.campusId,
    name: r.name,
    classTeacher: r.classTeacher ?? null,
    teacherUserId: r.teacherUserId ?? null,
    ...(r.gradeName !== undefined ? { gradeName: r.gradeName } : {}),
    ...(r.campusName !== undefined ? { campusName: r.campusName } : {}),
  };
}

export function createClassesRepo(ctx: DrizzleCtx): ClassesRepo {
  const db = ctx.db as any;
  const { classes, grades, campuses } = ctx.tables;

  const projection = {
    id: classes.id,
    gradeId: classes.gradeId,
    campusId: classes.campusId,
    name: classes.name,
    classTeacher: classes.classTeacher,
    teacherUserId: classes.teacherUserId,
    gradeName: grades.name,
    campusName: campuses.name,
  };

  const joined = () =>
    db
      .select(projection)
      .from(classes)
      .innerJoin(grades, eq(classes.gradeId, grades.id))
      .innerJoin(campuses, eq(classes.campusId, campuses.id));

  return {
    async listByCampus(campusId, gradeId?): Promise<Class[]> {
      const cond = whereAll([eq(classes.campusId, campusId), eqIf(classes.gradeId, gradeId)]);
      const rows = await joined()
        .where(cond!)
        .orderBy(asc(grades.sortOrder), asc(classes.name));
      return rows.map(toClass);
    },

    async findById(id): Promise<Class | null> {
      const rows = await joined().where(eq(classes.id, id)).limit(1);
      return rows[0] ? toClass(rows[0]) : null;
    },

    async findOwnership(id): Promise<{ campusId: string; gradeId: string; teacherUserId: string | null } | null> {
      const rows = await db
        .select({ campusId: classes.campusId, gradeId: classes.gradeId, teacherUserId: classes.teacherUserId })
        .from(classes)
        .where(eq(classes.id, id))
        .limit(1);
      return rows[0]
        ? { campusId: rows[0].campusId, gradeId: rows[0].gradeId, teacherUserId: rows[0].teacherUserId ?? null }
        : null;
    },

    async listByTeacher(teacherUserId): Promise<Class[]> {
      const rows = await joined()
        .where(eq(classes.teacherUserId, teacherUserId))
        .orderBy(asc(grades.sortOrder), asc(classes.name));
      return rows.map(toClass);
    },

    async create(input): Promise<Class> {
      const id = crypto.randomUUID();
      await db.insert(classes).values({
        id,
        gradeId: input.gradeId,
        campusId: input.campusId,
        name: input.name,
        classTeacher: input.classTeacher ?? null,
        teacherUserId: input.teacherUserId ?? null,
      }).run();
      const found = await this.findById(id);
      if (!found) throw new Error('班级创建后回查失败');
      return found;
    },

    async update(id, input): Promise<Class | null> {
      await db.update(classes).set({
        name: input.name,
        classTeacher: input.classTeacher ?? null,
        teacherUserId: input.teacherUserId ?? null,
      }).where(eq(classes.id, id)).run();
      return this.findById(id);
    },

    async remove(id): Promise<void> {
      await db.delete(classes).where(eq(classes.id, id)).run();
    },
  };
}
