/**
 * awards 路由 —— 流动红旗（自动评选）。
 *
 * 迁移要点（对照旧 routes/awards.ts）：
 *  - id 为 uuid；读走 resolveCampusId 隔离，可按 week 过滤。
 *  - **POST/DELETE 收紧为 admin only**（修复旧代码 student 可发/删流动红旗的越权）。
 *  - autoAward 幂等由 repo 保证（UNIQUE(campus,class,week) + onConflictDoNothing，
 *    修复旧代码重复调用产生重复奖项 + 空数组 IN () 语法错误两个 bug）。
 *  - 写校区走 resolveWriteCampusId（admin 可指定）。
 *  - DELETE：admin only 已足够（awards repo 无 findById；跨校区删风险由 admin 角色边界兜底）。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { requireRole, resolveCampusId, resolveWriteCampusId } from '../middleware/profile.js';
import { ok, created, ApiError } from '../http/respond.js';

export function createAwardRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  // GET / —— 本校区奖项列表（可按 week 过滤）
  app.get('/', async (c) => {
    const awards = await repos.awards.listByCampus(
      resolveCampusId(c),
      c.req.query('week') || undefined,
    );
    return ok(c, awards);
  });

  // POST / —— admin 一键自动评选（每年级第一名，幂等）
  app.post('/', requireRole('admin'), async (c) => {
    const body = await c.req
      .json<{ campus_id?: string; week: string; grade_id?: string | null }>()
      .catch(() => null as any);
    if (!body?.week) throw ApiError.badRequest('缺少 week');
    const campusId = resolveWriteCampusId(c, body.campus_id);
    const awards = await repos.awards.autoAward(campusId, body.week, body.grade_id ?? null);
    return created(c, awards);
  });

  // DELETE /:id —— admin 删奖项
  app.delete('/:id', requireRole('admin'), async (c) => {
    await repos.awards.remove(c.req.param('id'));
    return ok(c, { deleted: true });
  });

  return app;
}
