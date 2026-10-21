/**
 * grades repo（rest 实现）—— CRUD + join campuses 取 campusName（应用侧 join）。
 * 语义对齐 drizzle/grades-repo：orderBy sortOrder；唯一约束 (campusId,name) 预判。
 */
import type { RestFilters } from '@homurajs/db';
import type { Grade } from '@guga-onduty-w/shared';
import type { GradesRepo } from '../types.js';
import { type RestCtx, tbl, indexByIds, num, uuid, dupError } from './_base.js';

function toGrade(r: any, campusName?: string): Grade {
  return {
    id: r.id,
    campusId: r.campusId,
    name: r.name,
    sortOrder: num(r.sortOrder),
    ...(campusName !== undefined ? { campusName } : {}),
  };
}

export function createGradesRepo(ctx: RestCtx): GradesRepo {
  const grades = tbl<any>(ctx.rest, 'grades');
  const campuses = tbl<any>(ctx.rest, 'campuses');

  return {
    async listByCampus(campusId): Promise<Grade[]> {
      const rows = await grades.select({ campusId }, { order: 'sortOrder.asc' });
      const cmap = await indexByIds(campuses, 'id', rows.map((r) => r.campusId));
      return rows.map((r) => toGrade(r, cmap.get(r.campusId)?.name));
    },

    async findById(id): Promise<Grade | null> {
      const rows = await grades.select({ id }, { limit: 1 });
      if (!rows[0]) return null;
      const cmap = await indexByIds(campuses, 'id', [rows[0].campusId]);
      return toGrade(rows[0], cmap.get(rows[0].campusId)?.name);
    },

    async create(input): Promise<Grade> {
      // 唯一预判：(campusId,name)
      const dup = await grades.select({ campusId: input.campusId, name: input.name }, { limit: 1 });
      if (dup[0]) throw dupError('grades', 'campusId, name');
      const id = uuid();
      await grades.insert({ id, campusId: input.campusId, name: input.name, sortOrder: input.sortOrder ?? 0 });
      const found = await this.findById(id);
      if (!found) throw new Error('年级创建后回查失败');
      return found;
    },

    async update(id, input): Promise<Grade | null> {
      const prev = await this.findById(id);
      if (prev) {
        const dupFilter: RestFilters = {
          campusId: prev.campusId,
          name: input.name,
          id: { op: 'neq', value: id },
        };
        const dup = await grades.select(dupFilter, { limit: 1 });
        if (dup[0]) throw dupError('grades', 'campusId, name');
      }
      await grades.update({ name: input.name, sortOrder: input.sortOrder ?? 0 }, { id });
      return this.findById(id);
    },

    async remove(id): Promise<void> {
      await grades.remove({ id });
    },
  };
}
