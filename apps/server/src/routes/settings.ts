/**
 * settings 路由 —— 系统设置（key-value）。
 *
 * 迁移要点（对照旧 routes/settings.ts）：
 *  - GET 返回 key-value map（非数组，复刻旧语义）。
 *  - **整模块收紧为 admin only**（2026-10-23：原仅 PUT 收紧，GET 敞开使 student 可读系统配置）。
 *  - upsertMany 事务化（repo 已实现，修复旧代码批量循环无事务的部分更新）。
 *  - 读走 resolveCampusId 隔离；写校区走 resolveWriteCampusId（admin 可指定）。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { requireRole, resolveCampusId, resolveWriteCampusId } from '../middleware/profile.js';
import { ok, ApiError } from '../http/respond.js';

export function createSettingRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  // 模块级 RBAC：系统设置属管理面，读写一律 admin only（模块内 fail-closed）
  app.use('*', requireRole('admin'));

  // GET / —— 本校区设置 map
  app.get('/', async (c) => {
    const map = await repos.settings.getMap(resolveCampusId(c));
    return ok(c, map);
  });

  // PUT / —— admin 批量 upsert 设置
  app.put('/', async (c) => {
    const body = await c.req
      .json<{ campus_id?: string; settings: { key: string; value: string }[] }>()
      .catch(() => null as any);
    if (!body?.settings || !Array.isArray(body.settings)) {
      throw ApiError.badRequest('缺少 settings 数组');
    }
    // REVIEW #7：key 白名单 + 值校验（bool 类键限定 'true'/'false'）。
    const validated: { key: string; value: string }[] = [];
    for (const e of body.settings) {
      const key = String(e?.key ?? '');
      const value = String(e?.value ?? '');
      switch (key) {
        case 'appeal_enabled':
          if (value !== 'true' && value !== 'false') {
            throw ApiError.badRequest(`${key} 须为 'true'/'false'，收到：${value}`);
          }
          break;
        default:
          // 2026-10-23：移除死键 auto_notify_teachers —— 全仓零消费方（只有 seed/白名单/
          // 前端 Switch 三处），关掉它推送照发，是个撒谎的开关。推送是否启用由**凭证是否配齐**
          // 决定，见 GET /dingtalk/status 与系统设置页的「推送状态」（如实展示未启用原因）。
          throw ApiError.badRequest(`未知设置项：${key}（白名单：appeal_enabled）`);
      }
      validated.push({ key, value });
    }
    const campusId = resolveWriteCampusId(c, body.campus_id);
    await repos.settings.upsertMany(campusId, validated);
    return ok(c, { updated: true });
  });

  return app;
}
