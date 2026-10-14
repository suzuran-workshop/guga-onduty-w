/**
 * tags 路由 —— 评价标签 CRUD。
 *
 * 迁移要点（对照旧 routes/tags.ts）：
 *  - id 为 uuid；读走 resolveCampusId 隔离，可按 category 过滤。
 *  - **写端点收紧为 admin only**（修复旧代码 student 可增删改标签的越权）。
 *  - PUT 部分更新（repo 已实现：只改传入字段，修复旧代码缺字段静默重置 bug）。
 *  - DELETE 系统标签额外拒绝（isSystem 为真 → 403，复刻旧逻辑）。
 *  - PUT/DELETE 先 findById 校验归属（非 admin 不得跨校区）。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { RouteDeps } from './_deps.js';
import { getProfile, requireRole, resolveCampusId, resolveWriteCampusId } from '../middleware/profile.js';
import { ok, created, ApiError, isUniqueViolation } from '../http/respond.js';
import type { Tag } from '@class-duty/shared';

function assertOwnership(c: Context, tag: Tag | null): Tag {
  if (!tag) throw ApiError.notFound('标签不存在');
  const profile = getProfile(c);
  if (profile.role !== 'admin' && tag.campusId !== profile.campusId) {
    throw ApiError.notFound('标签不存在');
  }
  return tag;
}

export function createTagRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  // GET / —— 本校区标签列表（可按 category 过滤）
  app.get('/', async (c) => {
    const tags = await repos.tags.listByCampus(
      resolveCampusId(c),
      c.req.query('category') || undefined,
    );
    return ok(c, tags);
  });

  // POST / —— admin 建标签
  app.post('/', requireRole('admin'), async (c) => {
    const body = await c.req
      .json<{
        campus_id?: string; name: string; score: number;
        color?: string; category?: string; is_system?: boolean;
      }>()
      .catch(() => null as any);
    if (!body?.name || body.score === undefined) throw ApiError.badRequest('缺少 name / score');
    const campusId = resolveWriteCampusId(c, body.campus_id);
    try {
      const tag = await repos.tags.create({
        campusId,
        name: body.name,
        score: Number(body.score),
        color: body.color,
        category: body.category,
        isSystem: body.is_system,
      });
      return created(c, tag);
    } catch (e) {
      if (isUniqueViolation(e)) throw ApiError.conflict('标签已存在');
      throw e;
    }
  });

  // PUT /:id —— admin 改标签（部分更新）
  app.put('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req
      .json<{ name?: string; score?: number; color?: string; category?: string }>()
      .catch(() => null as any);
    if (!body) throw ApiError.badRequest('请求体非法');
    assertOwnership(c, await repos.tags.findById(id));
    const tag = await repos.tags.update(id, {
      name: body.name,
      score: body.score !== undefined ? Number(body.score) : undefined,
      color: body.color,
      category: body.category,
    });
    if (!tag) throw ApiError.notFound('标签不存在');
    return ok(c, tag);
  });

  // DELETE /:id —— admin 删标签（系统标签拒绝）
  app.delete('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    const tag = assertOwnership(c, await repos.tags.findById(id));
    if (tag.isSystem) throw ApiError.forbidden('系统标签不可删除');
    await repos.tags.remove(id);
    return ok(c, { deleted: true });
  });

  return app;
}
