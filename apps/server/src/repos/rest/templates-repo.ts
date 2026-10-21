/**
 * templates repo（rest 实现）—— 修复 N+1（批量查 tags）+ 导入校验。
 * 语义对齐 drizzle/templates-repo：tagIds JSON 列（PostgREST 返回已解析数组，jsonArr 兜底）；
 * importMany 校验 tagIds 属于该校区；orderBy name。
 */
import type { Template, Tag, TagCategory } from '@guga-onduty-w/shared';
import type { TemplatesRepo } from '../types.js';
import { type RestCtx, tbl, num, jsonArr, uuid } from './_base.js';

function toTemplate(r: any): Template {
  return {
    id: r.id,
    campusId: r.campusId,
    name: r.name,
    tagIds: jsonArr(r.tagIds) ?? [],
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

export function createTemplatesRepo(ctx: RestCtx): TemplatesRepo {
  const templates = tbl<any>(ctx.rest, 'templates');
  const tags = tbl<any>(ctx.rest, 'tags');

  /** 批量把 tagIds 展开为 Tag（一次 in 查询，消除 N+1） */
  async function attachTags(list: Template[]): Promise<Template[]> {
    const allIds = Array.from(new Set(list.flatMap((t) => t.tagIds)));
    if (allIds.length === 0) return list.map((t) => ({ ...t, tags: [] }));
    const rows = await tags.select({ id: allIds });
    const byId = new Map<string, Tag>();
    for (const r of rows) byId.set(r.id, toTag(r));
    return list.map((t) => ({ ...t, tags: t.tagIds.map((id) => byId.get(id)).filter((x): x is Tag => Boolean(x)) }));
  }

  return {
    async listByCampus(campusId): Promise<Template[]> {
      const rows = await templates.select({ campusId }, { order: 'name.asc' });
      return attachTags(rows.map(toTemplate));
    },

    async findById(id): Promise<Template | null> {
      const rows = await templates.select({ id }, { limit: 1 });
      if (!rows[0]) return null;
      const [withTags] = await attachTags([toTemplate(rows[0])]);
      return withTags;
    },

    async create(input): Promise<Template> {
      const id = uuid();
      await templates.insert({ id, campusId: input.campusId, name: input.name, tagIds: input.tagIds });
      const rows = await templates.select({ id }, { limit: 1 });
      return toTemplate(rows[0]);
    },

    async update(id, input): Promise<Template | null> {
      await templates.update({ name: input.name, tagIds: input.tagIds }, { id });
      const rows = await templates.select({ id }, { limit: 1 });
      return rows[0] ? toTemplate(rows[0]) : null;
    },

    async remove(id): Promise<void> {
      await templates.remove({ id });
    },

    async exportByCampus(campusId): Promise<{ name: string; tagIds: string[] }[]> {
      const rows = await templates.select({ campusId });
      return rows.map((r) => ({ name: r.name, tagIds: toTemplate(r).tagIds }));
    },

    async importMany(campusId, data): Promise<number> {
      if (data.length === 0) return 0;
      // 校验：只接受属于本校区的 tagId（旧代码不校验，可跨校区引用）
      const allTagIds = Array.from(new Set(data.flatMap((d) => d.tagIds)));
      let validIds = new Set<string>();
      if (allTagIds.length > 0) {
        const rows = await tags.select({ campusId, id: allTagIds });
        validIds = new Set(rows.map((r) => String(r.id)));
      }
      // 无事务 → 顺序插入（部分失败容忍，返回已导入数）
      let imported = 0;
      for (const tpl of data) {
        const filteredTagIds = tpl.tagIds.filter((id) => validIds.has(id));
        await templates.insert({ id: uuid(), campusId, name: tpl.name, tagIds: filteredTagIds });
        imported++;
      }
      return imported;
    },
  };
}
