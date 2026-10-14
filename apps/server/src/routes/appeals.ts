/**
 * appeals 路由 —— 申诉查询（只读；审批动作在 records 路由的 /records/:id/appeal/*）。
 *
 * 迁移要点（对照旧 routes/appeals.ts）：
 *  - teacher 只看自己的申诉（传 teacherId=profile.userId）。
 *  - 非 admin 按 resolveCampusId 隔离（修复旧代码 student/admin 看全局申诉的越权）。
 *  - admin 可用 ?campus_id= 指定校区，不传则看全部（campusId=undefined）。
 *  - list 一次 join 取 record_info（repo 已修复 N+1）。
 *  - GET /:id 校验归属（非 admin/非本人不得跨校区看）。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { getProfile, resolveCampusId } from '../middleware/profile.js';
import { ok, ApiError, parsePagination } from '../http/respond.js';

export function createAppealRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  // GET / —— 申诉列表（分页 + 角色/校区过滤）
  app.get('/', async (c) => {
    const profile = getProfile(c);
    const { page, pageSize } = parsePagination(c);

    // teacher 只看自己的；非 admin 按校区隔离；admin 可跨校区（?campus_id=）或看全部
    const teacherId = profile.role === 'teacher' ? profile.userId : undefined;
    const campusId = profile.role === 'admin'
      ? (c.req.query('campus_id') || undefined)
      : resolveCampusId(c);

    const result = await repos.appeals.list({
      campusId,
      teacherId,
      status: c.req.query('status') || undefined,
      page,
      pageSize,
    });
    return ok(c, result.data, result.pagination);
  });

  // GET /:id —— 申诉详情
  app.get('/:id', async (c) => {
    const profile = getProfile(c);
    const appeal = await repos.appeals.findById(c.req.param('id'));
    if (!appeal) throw ApiError.notFound('申诉不存在');
    // teacher 只能看自己发起的申诉；admin 放行；student 无申诉语义，拒绝。
    // 注：AppealWithDetails 不含 campusId，校区隔离的真实边界在 list 端点（已按 resolveCampusId 过滤），
    // 详情端点靠「id 只能来自已隔离的列表」+ 角色校验兜底。
    if (profile.role === 'teacher') {
      if (appeal.teacherId !== profile.userId) throw ApiError.notFound('申诉不存在');
    } else if (profile.role !== 'admin') {
      throw ApiError.forbidden('无权查看申诉详情');
    }
    return ok(c, appeal);
  });

  return app;
}
