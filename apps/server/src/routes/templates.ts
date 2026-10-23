/**
 * templates 路由 —— 打分模板 CRUD + 导入导出。
 *
 * 迁移要点（对照旧 routes/templates.ts）：
 *  - id 为 uuid；tagIds 是 tag uuid 数组。
 *  - **GET /export 必须注册在 GET /:id 之前**（否则 /export 被当成 id=export，旧代码有此注释）。
 *  - **写端点（含 import）收紧为 admin only**（修复旧代码 student 可增删改/导入模板的越权）。
 *  - listByCampus 含展开 tags（repo 已批量查，无 N+1）。
 *  - importMany 事务化 + tagId 校区校验（repo 已实现）；请求体 tag_ids → tagIds。
 *  - PUT/DELETE 先 findById 校验归属（非 admin 不得跨校区）。
 *  - 2026-10-23：归属校验收敛到 middleware 的 assertEntityOwnership（消除本文件的局部副本）。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { assertEntityOwnership, requireRole, resolveCampusId, resolveWriteCampusId } from '../middleware/profile.js';
import { ok, created, ApiError } from '../http/respond.js';

export function createTemplateRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  // GET / —— 本校区模板列表（含展开 tags）
  app.get('/', async (c) => {
    const templates = await repos.templates.listByCampus(resolveCampusId(c));
    return ok(c, templates);
  });

  // GET /export —— 导出（⚠ 必须在 /:id 之前注册，避免路由冲突）
  // 2026-10-23：收紧为 admin only，与 POST /import 对称（原 export 敞开，student 可导出全校区模板配置）。
  app.get('/export', requireRole('admin'), async (c) => {
    const data = await repos.templates.exportByCampus(resolveCampusId(c));
    // 保持旧契约：tag_ids 字段名（前端导出/导入对称）
    return ok(c, data.map((d) => ({ name: d.name, tag_ids: d.tagIds })));
  });

  // POST /import —— admin 导入（事务 + tagId 校验）
  app.post('/import', requireRole('admin'), async (c) => {
    const body = await c.req
      .json<{ campus_id?: string; data: { name: string; tag_ids: string[] }[] }>()
      .catch(() => null as any);
    if (!body?.data || !Array.isArray(body.data)) throw ApiError.badRequest('缺少 data 数组');
    const campusId = resolveWriteCampusId(c, body.campus_id);
    const imported = await repos.templates.importMany(
      campusId,
      body.data.map((d: { name: string; tag_ids: string[] }) => ({ name: d.name, tagIds: d.tag_ids ?? [] })),
    );
    return ok(c, { imported });
  });

  // GET /:id —— 模板详情（含展开 tags）
  app.get('/:id', async (c) => {
    const tpl = assertEntityOwnership(c, await repos.templates.findById(c.req.param('id')), '模板');
    return ok(c, tpl);
  });

  // POST / —— admin 建模板
  app.post('/', requireRole('admin'), async (c) => {
    const body = await c.req
      .json<{ campus_id?: string; name: string; tag_ids: string[] }>()
      .catch(() => null as any);
    if (!body?.name) throw ApiError.badRequest('缺少 name');
    const campusId = resolveWriteCampusId(c, body.campus_id);
    const tpl = await repos.templates.create({
      campusId,
      name: body.name,
      tagIds: body.tag_ids ?? [],
    });
    return created(c, tpl);
  });

  // PUT /:id —— admin 改模板
  app.put('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ name: string; tag_ids: string[] }>().catch(() => null as any);
    if (!body?.name) throw ApiError.badRequest('缺少 name');
    assertEntityOwnership(c, await repos.templates.findById(id), '模板');
    const tpl = await repos.templates.update(id, { name: body.name, tagIds: body.tag_ids ?? [] });
    if (!tpl) throw ApiError.notFound('模板不存在');
    return ok(c, tpl);
  });

  // DELETE /:id —— admin 删模板
  app.delete('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    assertEntityOwnership(c, await repos.templates.findById(id), '模板');
    await repos.templates.remove(id);
    return ok(c, { deleted: true });
  });

  return app;
}
