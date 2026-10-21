/**
 * tags repo（rest 实现）—— CRUD，update 为部分更新语义。
 * 语义对齐 drizzle/tags-repo：orderBy category → isSystem desc → name；空 findByIds 短路。
 */
import type { RestFilters } from '@homurajs/db';
import type { Tag, TagCategory } from '@guga-onduty-w/shared';
import type { TagsRepo } from '../types.js';
import { type RestCtx, tbl, num, uuid } from './_base.js';

function toTag(r: any): Tag {
  return {
    id: r.id,
    campusId: r.campusId,
    name: r.name,
    score: num(r.score),
    color: r.color,
    category: r.category as TagCategory,
    isSystem: num(r.isSystem),
    createdAt: num(r.createdAt),
  };
}

export function createTagsRepo(ctx: RestCtx): TagsRepo {
  const tags = tbl<any>(ctx.rest, 'tags');

  return {
    async listByCampus(campusId, category?): Promise<Tag[]> {
      const filters: RestFilters = { campusId };
      if (category) filters.category = category;
      const rows = await tags.select(filters, { order: 'category.asc,isSystem.desc,name.asc' });
      return rows.map(toTag);
    },

    async findById(id): Promise<Tag | null> {
      const rows = await tags.select({ id }, { limit: 1 });
      return rows[0] ? toTag(rows[0]) : null;
    },

    async findByIds(ids): Promise<Tag[]> {
      if (ids.length === 0) return [];
      const rows = await tags.select({ id: ids });
      return rows.map(toTag);
    },

    async create(input): Promise<Tag> {
      const id = uuid();
      await tags.insert({
        id,
        campusId: input.campusId,
        name: input.name,
        score: input.score,
        color: input.color ?? '#FFAACC',
        category: input.category ?? 'positive',
        isSystem: input.isSystem ? 1 : 0,
      });
      const found = await this.findById(id);
      if (!found) throw new Error('标签创建后回查失败');
      return found;
    },

    async update(id, input): Promise<Tag | null> {
      // 部分更新：仅覆盖传入字段（修复旧代码缺字段静默重置 bug）
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.score !== undefined) patch.score = input.score;
      if (input.color !== undefined) patch.color = input.color;
      if (input.category !== undefined) patch.category = input.category;
      if (Object.keys(patch).length > 0) {
        await tags.update(patch, { id });
      }
      return this.findById(id);
    },

    async remove(id): Promise<void> {
      await tags.remove({ id });
    },
  };
}
