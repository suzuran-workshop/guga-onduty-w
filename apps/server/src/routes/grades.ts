/**
 * grades 路由 —— 年级 CRUD。
 *
 * 迁移要点（对照旧 routes/grades.ts）：
 *  - id 为 uuid；读走 resolveCampusId 隔离（admin 可 ?campus_id= 跨校区，非 admin 强制自己校区）。
 *  - **写端点收紧为 admin only**（修复旧代码 student 可增删改任意校区年级的越权）。
 *  - 写校区走 resolveWriteCampusId（admin 可指定，非 admin 强制自己校区）。
 *  - PUT/DELETE 先 findById 校验归属（非 admin 不得跨校区），不泄露跨校区实体存在性。
 *  - 唯一约束冲突（campus+name 重复）转 409。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { getProfile, requireRole, resolveCampusId, resolveWriteCampusId } from '../middleware/profile.js';
import { ok, created, ApiError, isUniqueViolation } from '../http/respond.js';

/** 非 admin 校验年级归属；admin 放行 */
function assertOwnership(c: any, grade: { campusId: string } | null) {
  if (!grade) throw ApiError.notFound('年级不存在');
  const profile = getProfile(c);
  if (profile.role !== 'admin' && grade.campusId !== profile.campusId) {
    throw ApiError.notFound('年级不存在');
  }
}

export function createGradeRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  // GET / —— 本校区年级列表（含 campusName）
  app.get('/', async (c) => {
    const grades = await repos.grades.listByCampus(resolveCampusId(c));
    return ok(c, grades);
  });

  // POST / —— admin 建年级
  app.post('/', requireRole('admin'), async (c) => {
    const body = await c.req.json<{ campus_id?: string; name: string; sort_order?: number }>().catch(() => null as any);
    if (!body?.name) throw ApiError.badRequest('缺少 name');
    const campusId = resolveWriteCampusId(c, body.campus_id);
    try {
      const grade = await repos.grades.create({
        campusId,
        name: body.name,
        sortOrder: body.sort_order ?? 0,
      });
      return created(c, grade);
    } catch (e) {
      if (isUniqueViolation(e)) throw ApiError.conflict('同校区年级名已存在');
      throw e;
    }
  });

  // PUT /:id —— admin 改年级
  app.put('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ name: string; sort_order?: number }>().catch(() => null as any);
    if (!body?.name) throw ApiError.badRequest('缺少 name');
    assertOwnership(c, await repos.grades.findById(id));
    const grade = await repos.grades.update(id, { name: body.name, sortOrder: body.sort_order ?? 0 });
    if (!grade) throw ApiError.notFound('年级不存在');
    return ok(c, grade);
  });

  // DELETE /:id —— admin 删年级
  app.delete('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    assertOwnership(c, await repos.grades.findById(id));
    await repos.grades.remove(id);
    return ok(c, { deleted: true });
  });

  return app;
}
