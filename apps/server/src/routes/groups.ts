/**
 * groups 路由 —— 值周小组 CRUD（成员双写事务由 repo 保证）。
 *
 * 迁移要点（对照旧 routes/groups.ts）：
 *  - id 为 uuid；members 是 userId(uuid) 数组。
 *  - **写端点收紧为 admin only**（修复旧代码 student 可增删改值周组的越权）。
 *  - groups repo 无 findById → 归属校验用 listByCampus(profile.campusId) 判断 id 是否属于本校区
 *    （admin 放行）。成员 groupId 双写一致性由 repo 事务保证，路由不关心。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { RouteDeps } from './_deps.js';
import { getProfile, requireRole, resolveCampusId, resolveWriteCampusId } from '../middleware/profile.js';
import { ok, created, ApiError } from '../http/respond.js';
import type { DutyGroup } from '@class-duty/shared';

/** 校验组归属（非 admin 只能操作本校区组）；返回该组或抛 404 */
async function assertOwnership(c: Context, repos: RouteDeps['repos'], id: string): Promise<DutyGroup> {
  const profile = getProfile(c);
  const groups = await repos.groups.listByCampus(profile.campusId);
  const found = groups.find((g) => g.id === id);
  if (!found) throw ApiError.notFound('值周组不存在');
  return found;
}

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
    await assertOwnership(c, repos, id);
    const group = await repos.groups.update(id, { name: body.name, members: body.members });
    if (!group) throw ApiError.notFound('值周组不存在');
    return ok(c, group);
  });

  // DELETE /:id —— admin 删组
  app.delete('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    await assertOwnership(c, repos, id);
    await repos.groups.remove(id);
    return ok(c, { deleted: true });
  });

  return app;
}
