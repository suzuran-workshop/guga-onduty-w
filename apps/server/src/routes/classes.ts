/**
 * classes 路由 —— 班级 CRUD。
 *
 * 迁移要点（对照旧 routes/classes.ts）：
 *  - id 为 uuid；读走 resolveCampusId 隔离，可按 grade_id 过滤。
 *  - **写端点收紧为 admin only**（修复旧代码 student 可增删改班级的越权）。
 *  - PUT/DELETE 先 findById 校验归属（非 admin 不得跨校区）。
 *  - 唯一约束冲突（campus+grade+name 重复）转 409。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { RouteDeps } from './_deps.js';
import { getProfile, requireRole, resolveCampusId, resolveWriteCampusId } from '../middleware/profile.js';
import { ok, created, ApiError, isUniqueViolation } from '../http/respond.js';

function assertOwnership(c: Context, entity: { campusId: string } | null) {
  if (!entity) throw ApiError.notFound('班级不存在');
  const profile = getProfile(c);
  if (profile.role !== 'admin' && entity.campusId !== profile.campusId) {
    throw ApiError.notFound('班级不存在');
  }
}

export function createClassRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  // GET / —— 本校区班级列表（可按年级过滤，含 gradeName）
  app.get('/', async (c) => {
    const classes = await repos.classes.listByCampus(
      resolveCampusId(c),
      c.req.query('grade_id') || undefined,
    );
    return ok(c, classes);
  });

  // POST / —— admin 建班级
  app.post('/', requireRole('admin'), async (c) => {
    const body = await c.req
      .json<{ campus_id?: string; grade_id: string; name: string; class_teacher?: string }>()
      .catch(() => null as any);
    if (!body?.grade_id || !body.name) throw ApiError.badRequest('缺少 grade_id / name');
    const campusId = resolveWriteCampusId(c, body.campus_id);
    try {
      const klass = await repos.classes.create({
        campusId,
        gradeId: body.grade_id,
        name: body.name,
        classTeacher: body.class_teacher ?? null,
      });
      return created(c, klass);
    } catch (e) {
      if (isUniqueViolation(e)) throw ApiError.conflict('同年级班级名已存在');
      throw e;
    }
  });

  // PUT /:id —— admin 改班级
  app.put('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ name: string; class_teacher?: string }>().catch(() => null as any);
    if (!body?.name) throw ApiError.badRequest('缺少 name');
    assertOwnership(c, await repos.classes.findById(id));
    const klass = await repos.classes.update(id, { name: body.name, classTeacher: body.class_teacher ?? null });
    if (!klass) throw ApiError.notFound('班级不存在');
    return ok(c, klass);
  });

  // DELETE /:id —— admin 删班级
  app.delete('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    assertOwnership(c, await repos.classes.findById(id));
    await repos.classes.remove(id);
    return ok(c, { deleted: true });
  });

  return app;
}
