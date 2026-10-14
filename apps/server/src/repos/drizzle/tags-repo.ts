/**
 * tags repo（drizzle 实现）—— CRUD，update 为部分更新语义。
 * 迁移要点（对照旧 routes/tags.ts）：
 *  - id 为 uuid；listByCampus 可选 category 过滤，orderBy category → isSystem desc → name（复刻旧排序）。
 *  - **update 部分更新**：修复旧代码 bug —— 旧 PUT 缺 color/category 时静默重置为默认值。
 *    此处先查现有行，仅用传入字段覆盖，未传字段保留原值。
 *  - findByIds：空数组短路返回 []（避免 inArray 空集），否则 inArray 批量查。
 *  - isSystem 存 int 0/1（旧 schema 一致）；create 的 isSystem 布尔入参转 0/1。
 */
import { asc, desc, eq, inArray } from 'drizzle-orm';
import type { Tag, TagCategory } from '@class-duty/shared';
import type { TagsRepo } from '../types.js';
import { DrizzleCtx, whereAll, eqIf, num } from './_base.js';

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

export function createTagsRepo(ctx: DrizzleCtx): TagsRepo {
  const db = ctx.db as any;
  const { tags } = ctx.tables;

  return {
    async listByCampus(campusId, category?): Promise<Tag[]> {
      const cond = whereAll([eq(tags.campusId, campusId), eqIf(tags.category, category)]);
      const rows = await db
        .select()
        .from(tags)
        .where(cond!)
        .orderBy(asc(tags.category), desc(tags.isSystem), asc(tags.name));
      return rows.map(toTag);
    },

    async findById(id): Promise<Tag | null> {
      const rows = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
      return rows[0] ? toTag(rows[0]) : null;
    },

    async findByIds(ids): Promise<Tag[]> {
      if (ids.length === 0) return [];
      const rows = await db.select().from(tags).where(inArray(tags.id, ids));
      return rows.map(toTag);
    },

    async create(input): Promise<Tag> {
      const id = crypto.randomUUID();
      await db.insert(tags).values({
        id,
        campusId: input.campusId,
        name: input.name,
        score: input.score,
        color: input.color ?? '#FFAACC',
        category: input.category ?? 'positive',
        isSystem: input.isSystem ? 1 : 0,
      }).run();
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
        await db.update(tags).set(patch).where(eq(tags.id, id)).run();
      }
      return this.findById(id);
    },

    async remove(id): Promise<void> {
      await db.delete(tags).where(eq(tags.id, id)).run();
    },
  };
}
