/**
 * templates repo（drizzle 实现）—— 修复 N+1 + 导入事务化。
 *
 * 迁移要点（对照旧 routes/templates.ts）：
 *  - listByCampus：旧代码对每个模板单独查 tags（N+1）；此处一次 inArray 批量查全部 tagId，
 *    JS 侧按 id 分组回填。
 *  - importMany：旧代码循环 INSERT 无事务（部分导入）；此处事务批量 + 返回导入数。
 *    校验 tagIds 属于该校区（旧代码不校验，可跨校区引用标签）。
 *  - tagIds 是 JSON 列（string[] of tag uuid），drizzle 自动编解码。
 */
import { eq, and, asc, inArray } from 'drizzle-orm';
import type { Template, Tag, TagCategory } from '@class-duty/shared';
import type { TemplatesRepo } from '../types.js';
import { DrizzleCtx, num } from './_base.js';

function toTemplate(r: any): Template {
  return {
    id: r.id,
    campusId: r.campusId,
    name: r.name,
    tagIds: Array.isArray(r.tagIds) ? r.tagIds : (r.tagIds ? JSON.parse(r.tagIds) : []),
    createdAt: num(r.createdAt),
  };
}

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

export function createTemplatesRepo(ctx: DrizzleCtx): TemplatesRepo {
  const { tables: T } = ctx;
  const db = ctx.db as any;
  const { templates, tags } = T;

  /** 批量把 tagIds 展开为 Tag（一次查询，消除 N+1） */
  async function attachTags(list: Template[]): Promise<Template[]> {
    const allIds = Array.from(new Set(list.flatMap((t) => t.tagIds)));
    if (allIds.length === 0) return list.map((t) => ({ ...t, tags: [] }));
    const rows = await db.select().from(tags).where(inArray(tags.id, allIds));
    const byId = new Map<string, Tag>();
    for (const r of rows) byId.set(r.id, toTag(r));
    return list.map((t) => ({ ...t, tags: t.tagIds.map((id) => byId.get(id)).filter((x): x is Tag => Boolean(x)) }));
  }

  return {
    async listByCampus(campusId): Promise<Template[]> {
      const rows = await db.select().from(templates).where(eq(templates.campusId, campusId)).orderBy(asc(templates.name));
      return attachTags(rows.map(toTemplate));
    },

    async findById(id): Promise<Template | null> {
      const rows = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
      if (!rows[0]) return null;
      const [withTags] = await attachTags([toTemplate(rows[0])]);
      return withTags;
    },

    async create(input): Promise<Template> {
      const id = crypto.randomUUID();
      await db.insert(templates).values({
        id, campusId: input.campusId, name: input.name, tagIds: input.tagIds,
      }).run();
      const rows = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
      return toTemplate(rows[0]);
    },

    async update(id, input): Promise<Template | null> {
      await db.update(templates).set({ name: input.name, tagIds: input.tagIds }).where(eq(templates.id, id)).run();
      const rows = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
      return rows[0] ? toTemplate(rows[0]) : null;
    },

    async remove(id): Promise<void> {
      await db.delete(templates).where(eq(templates.id, id)).run();
    },

    async exportByCampus(campusId): Promise<{ name: string; tagIds: string[] }[]> {
      const rows = await db.select().from(templates).where(eq(templates.campusId, campusId));
      return rows.map((r: any) => ({ name: r.name, tagIds: toTemplate(r).tagIds }));
    },

    async importMany(campusId, data): Promise<number> {
      if (data.length === 0) return 0;
      // 校验：只接受属于本校区的 tagId（旧代码不校验，可跨校区引用）
      const allTagIds = Array.from(new Set(data.flatMap((d) => d.tagIds)));
      let validIds = new Set<string>();
      if (allTagIds.length > 0) {
        const rows = await db.select({ id: tags.id }).from(tags)
          .where(and(eq(tags.campusId, campusId), inArray(tags.id, allTagIds)));
        validIds = new Set(rows.map((r: any) => r.id));
      }
      let imported = 0;
      await ctx.tx(async (tx: any) => {
        for (const tpl of data) {
          const filteredTagIds = tpl.tagIds.filter((id) => validIds.has(id));
          await tx.insert(templates).values({
            id: crypto.randomUUID(), campusId, name: tpl.name, tagIds: filteredTagIds,
          }).run();
          imported++;
        }
      });
      return imported;
    },
  };
}
