/**
 * awards 路由 —— 流动红旗（2026-10-23：仅管理员人工颁发，系统只提供参考）。
 *
 * 需求变更：原「一键自动评选并直接落库」拆成两步——
 *  - `GET /candidates`：算出每年级第一名作**参考**（只读，不落库），标记该周是否已颁。
 *  - `POST /`：管理员从候选中挑选 classIds 后**显式颁发**（幂等：UNIQUE + onConflictDoNothing）。
 * 管理员可采纳候选，也可改选其他班级——颁发权归人，系统只提供依据。
 *
 * 迁移要点（对照旧 routes/awards.ts）：
 *  - id 为 uuid；读走 resolveCampusId 隔离，可按 week 过滤。
 *  - **POST/DELETE 收紧为 admin only**（修复旧代码 student 可发/删流动红旗的越权）。
 *  - 写校区走 resolveWriteCampusId（admin 可指定）。
 *  - DELETE：admin only（admin 本就可跨校区管理，无越权面）。
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

  // GET /candidates —— 候选参考（只读，不落库）：每年级第一名 + 该周是否已颁
  app.get('/candidates', requireRole('admin'), async (c) => {
    const week = c.req.query('week');
    if (!week) throw ApiError.badRequest('缺少 week');
    const candidates = await repos.awards.candidates(
      resolveCampusId(c),
      week,
      c.req.query('grade_id') || null,
    );
    return ok(c, candidates);
  });

  // POST / —— admin 人工颁发（从候选挑选 classIds；幂等）
  app.post('/', requireRole('admin'), async (c) => {
    const body = await c.req
      .json<{ campus_id?: string; week: string; class_ids?: string[]; category?: string; note?: string | null }>()
      .catch(() => null as any);
    if (!body?.week) throw ApiError.badRequest('缺少 week');
    const classIds = Array.isArray(body.class_ids) ? body.class_ids.map(String).filter((s: string) => s.length > 0) : [];
    if (classIds.length === 0) throw ApiError.badRequest('至少选择一个班级（class_ids）');
    const campusId = resolveWriteCampusId(c, body.campus_id);
    const awarded = await repos.awards.grant(campusId, body.week, classIds, {
      category: body.category,
      note: body.note ?? null,
    });
    return created(c, awarded);
  });

  // DELETE /:id —— admin 删奖项
  // 2026-10-23：补存在性校验（原实现删不存在的 id 也返回 {deleted:true}，静默成功）。
  // 校区归属无需额外校验：本端点已是 admin only，而 admin 按设计可跨校区管理
  // （与 resolveCampusId 的 admin 语义一致），非 admin 根本到不了这里。
  app.delete('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    if (!(await repos.awards.findById(id))) throw ApiError.notFound('奖项不存在');
    await repos.awards.remove(id);
    return ok(c, { deleted: true });
  });

  return app;
}
