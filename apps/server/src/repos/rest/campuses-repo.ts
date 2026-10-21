/**
 * campuses repo（rest 实现）—— 简单 CRUD。
 * 语义对齐 drizzle/campuses-repo：id uuid；listAll/listForCampus orderBy id。
 * 唯一约束（code）rest 轨无 DB 冒泡路径 → 先查重再插入，冲突抛可被 isUniqueViolation 识别的错误。
 */
import type { RestFilters } from '@homurajs/db';
import type { Campus } from '@guga-onduty-w/shared';
import type { CampusesRepo } from '../types.js';
import { type RestCtx, tbl, num, uuid, dupError } from './_base.js';

function toCampus(r: any): Campus {
  return { id: r.id, name: r.name, code: r.code, createdAt: num(r.createdAt) };
}

export function createCampusesRepo(ctx: RestCtx): CampusesRepo {
  const campuses = tbl<any>(ctx.rest, 'campuses');

  return {
    async listAll(): Promise<Campus[]> {
      const rows = await campuses.select(undefined, { order: 'id.asc' });
      return rows.map(toCampus);
    },

    async listForCampus(campusId): Promise<Campus[]> {
      const rows = await campuses.select({ id: campusId }, { order: 'id.asc' });
      return rows.map(toCampus);
    },

    async findById(id): Promise<Campus | null> {
      const rows = await campuses.select({ id }, { limit: 1 });
      return rows[0] ? toCampus(rows[0]) : null;
    },

    async create(input): Promise<Campus> {
      // 唯一预判：campuses.code（drizzle 轨走 DB UNIQUE → 409）
      const dup = await campuses.select({ code: input.code }, { limit: 1 });
      if (dup[0]) throw dupError('campuses', 'code');
      const id = uuid();
      await campuses.insert({ id, name: input.name, code: input.code });
      const found = await this.findById(id);
      if (!found) throw new Error('校区创建后回查失败');
      return found;
    },

    async update(id, input): Promise<Campus | null> {
      // 更新 code 也可能撞唯一约束（drizzle 轨同样 409）
      const dupFilter: RestFilters = { code: input.code, id: { op: 'neq', value: id } };
      const dup = await campuses.select(dupFilter, { limit: 1 });
      if (dup[0]) throw dupError('campuses', 'code');
      await campuses.update({ name: input.name, code: input.code }, { id });
      return this.findById(id);
    },

    async remove(id): Promise<void> {
      await campuses.remove({ id });
    },
  };
}
