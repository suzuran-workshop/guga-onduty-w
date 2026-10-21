/**
 * classes repo（rest 实现）—— CRUD + join grades/campuses 取名称（应用侧 join）。
 * 语义对齐 drizzle/classes-repo：orderBy grades.sortOrder → classes.name；
 * findOwnership 供记录创建时确定校区归属；唯一约束 (campusId,gradeId,name) 预判。
 */
import type { RestFilters } from '@homurajs/db';
import type { Class } from '@guga-onduty-w/shared';
import type { ClassesRepo } from '../types.js';
import { type RestCtx, tbl, indexByIds, num, uuid, dupError } from './_base.js';

function toClass(r: any, gradeName?: string, campusName?: string): Class {
  return {
    id: r.id,
    gradeId: r.gradeId,
    campusId: r.campusId,
    name: r.name,
    classTeacher: r.classTeacher ?? null,
    ...(gradeName !== undefined ? { gradeName } : {}),
    ...(campusName !== undefined ? { campusName } : {}),
  };
}

export function createClassesRepo(ctx: RestCtx): ClassesRepo {
  const classes = tbl<any>(ctx.rest, 'classes');
  const grades = tbl<any>(ctx.rest, 'grades');
  const campuses = tbl<any>(ctx.rest, 'campuses');

  /** 应用侧 join：classes 页 → 批查 grades/campuses → JS 拼接 + 排序（sortOrder,name） */
  async function joinedWhere(filters?: RestFilters): Promise<Class[]> {
    const rows = await classes.select(filters);
    const gmap = await indexByIds(grades, 'id', rows.map((r) => r.gradeId));
    const cmap = await indexByIds(campuses, 'id', rows.map((r) => r.campusId));
    return rows
      .map((r) => toClass(r, gmap.get(r.gradeId)?.name, cmap.get(r.campusId)?.name))
      .sort((a, b) => {
        const ga = gmap.get(a.gradeId), gb = gmap.get(b.gradeId);
        const sa = num(ga?.sortOrder), sb = num(gb?.sortOrder);
        if (sa !== sb) return sa - sb;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
  }

  return {
    async listByCampus(campusId, gradeId?): Promise<Class[]> {
      const filters: RestFilters = { campusId };
      if (gradeId) filters.gradeId = gradeId;
      return joinedWhere(filters);
    },

    async findById(id): Promise<Class | null> {
      const rows = await classes.select({ id }, { limit: 1 });
      if (!rows[0]) return null;
      const gmap = await indexByIds(grades, 'id', [rows[0].gradeId]);
      const cmap = await indexByIds(campuses, 'id', [rows[0].campusId]);
      return toClass(rows[0], gmap.get(rows[0].gradeId)?.name, cmap.get(rows[0].campusId)?.name);
    },

    async findOwnership(id): Promise<{ campusId: string; gradeId: string } | null> {
      const rows = await classes.select({ id }, { limit: 1 });
      const r = rows[0];
      return r ? { campusId: r.campusId, gradeId: r.gradeId } : null;
    },

    async create(input): Promise<Class> {
      // 唯一预判：(campusId,gradeId,name)
      const dup = await classes.select(
        { campusId: input.campusId, gradeId: input.gradeId, name: input.name },
        { limit: 1 },
      );
      if (dup[0]) throw dupError('classes', 'campusId, gradeId, name');
      const id = uuid();
      await classes.insert({
        id,
        gradeId: input.gradeId,
        campusId: input.campusId,
        name: input.name,
        classTeacher: input.classTeacher ?? null,
      });
      const found = await this.findById(id);
      if (!found) throw new Error('班级创建后回查失败');
      return found;
    },

    async update(id, input): Promise<Class | null> {
      const prev = await this.findById(id);
      if (prev) {
        const dupFilter: RestFilters = {
          campusId: prev.campusId,
          gradeId: prev.gradeId,
          name: input.name,
          id: { op: 'neq', value: id },
        };
        const dup = await classes.select(dupFilter, { limit: 1 });
        if (dup[0]) throw dupError('classes', 'campusId, gradeId, name');
      }
      await classes.update({ name: input.name, classTeacher: input.classTeacher ?? null }, { id });
      return this.findById(id);
    },

    async remove(id): Promise<void> {
      await classes.remove({ id });
    },
  };
}
