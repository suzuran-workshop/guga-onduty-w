/**
 * summary 路由 —— 每日小结。
 *
 * 迁移要点（对照旧 routes/summary.ts）：
 *  - id 为 uuid；读走 resolveCampusId 隔离，可按 week 过滤。
 *  - POST 收紧为 admin+teacher（修复旧代码 student 可建小结的越权）。
 *  - 写校区走 resolveWriteCampusId（admin 可指定，非 admin 强制自己校区）。
 *  - notifiedTeachers 是 userId(uuid) 数组（JSON 列，repo 自动编解码）。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { requireRole, resolveCampusId, resolveWriteCampusId } from '../middleware/profile.js';
import { ok, created, ApiError } from '../http/respond.js';

export function createSummaryRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  // GET / —— 本校区小结列表（可按 week 过滤）
  app.get('/', async (c) => {
    const summaries = await repos.summary.listByCampus(
      resolveCampusId(c),
      c.req.query('week') || undefined,
    );
    return ok(c, summaries);
  });

  // POST / —— admin/teacher 建小结
  app.post('/', requireRole('admin', 'teacher'), async (c) => {
    const body = await c.req
      .json<{
        campus_id?: string; week: string; date: string;
        content: string; notified_teachers?: string[] | null;
      }>()
      .catch(() => null as any);
    if (!body?.week || !body.date || !body.content) {
      throw ApiError.badRequest('缺少 week / date / content');
    }
    const campusId = resolveWriteCampusId(c, body.campus_id);
    const summary = await repos.summary.create({
      campusId,
      week: body.week,
      date: body.date,
      content: body.content,
      notifiedTeachers: body.notified_teachers ?? null,
    });
    return created(c, summary);
  });

  return app;
}
