/**
 * groups 路由 —— 值周小组 CRUD（成员双写事务由 repo 保证）。
 *
 * 迁移要点（对照旧 routes/groups.ts）：
 *  - id 为 uuid；members 是 userId(uuid) 数组。
 *  - **写端点收紧为 admin only**（修复旧代码 student 可增删改值周组的越权）。
 *  - 2026-10-23：归属校验改用 middleware 的 assertEntityOwnership（单一真源）。
 *    原局部 assertOwnership 有两个缺陷：① 用 listByCampus + find 做 O(n) 查找；
 *    ② 只在 profile.campusId 内找，导致 **admin 无法管理其他校区的小组**。
 *    现改为 findById + assertEntityOwnership（O(1) 查找，admin 正确放行）。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { assertEntityOwnership, requireRole, resolveCampusId, resolveWriteCampusId } from '../middleware/profile.js';
import { ok, created, ApiError } from '../http/respond.js';

export function createGroupRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  // GET / —— 本校区值周组列表
  app.get('/', async (c) => {
    const groups = await repos.groups.listByCampus(resolveCampusId(c));
    return ok(c, groups);
  });

  // POST / —— admin 建组
  app.post('/', requireRole('admin'), async (c) => {
    const body = await c.req
      .json<{ campus_id?: string; name: string; members?: string[] }>()
      .catch(() => null as any);
    if (!body?.name) throw ApiError.badRequest('缺少 name');
    const campusId = resolveWriteCampusId(c, body.campus_id);
    const group = await repos.groups.create({
      campusId,
      name: body.name,
      members: body.members,
    });
    return created(c, group);
  });

  // PUT /:id —— admin 改组（含换成员）
  app.put('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ name: string; members?: string[] }>().catch(() => null as any);
    if (!body?.name) throw ApiError.badRequest('缺少 name');
    assertEntityOwnership(c, await repos.groups.findById(id), '值周组');
    const group = await repos.groups.update(id, { name: body.name, members: body.members });
    if (!group) throw ApiError.notFound('值周组不存在');
    return ok(c, group);
  });

  // DELETE /:id —— admin 删组
  app.delete('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    assertEntityOwnership(c, await repos.groups.findById(id), '值周组');
    await repos.groups.remove(id);
    return ok(c, { deleted: true });
  });

  return app;
}
