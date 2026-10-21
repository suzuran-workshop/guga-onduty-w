/**
 * API 路由装配 —— 把路由模块挂到 /api/v1/*，统一前置 requireProfile。
 *
 * 中间件链（app-kit createApp 已装好全局部分）：
 *   [createApp] requestId+日志 → healthz → sessionMiddleware(SDK, 设 c.auth) → authRoutes(SDK, /auth/*)
 *   → [本文件 businessRoutes] requireProfile(设 c.profile) → /api/v1/* 各路由
 *   → static → SPA fallback → onError
 *
 * 关键：
 *  - requireProfile 在业务路由前统一跑（读 c.auth.sub → 查 userProfiles → c.set('profile')）。
 *  - SDK 的登录路由 /auth/password/login 由 createApp 单独挂（不经 requireProfile，登录时无 profile）。
 *  - 所有 /api/v1/* 业务路由都要求已登录且有 profile（与旧代码 authMiddleware 覆盖一致）。
 *  - businessRoutes 挂在 '/'（createApp 内部），故此处每个模块都带完整 /api/v1/<res> 前缀。
 *
 * 域划分：
 *  - 值周域（细粒度巡查）：records/appeals/awards/statistics/summary/tags/templates/... —— 本仓库全部
 *    （原值班域已拆分至 guga-onduty 仓库）。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { requireProfile } from '../middleware/profile.js';

import { createAuthRoutes } from './auth.js';
import { createCampusRoutes } from './campuses.js';
import { createGradeRoutes } from './grades.js';
import { createClassRoutes } from './classes.js';
import { createUserRoutes } from './users.js';
import { createGroupRoutes } from './groups.js';
import { createTagRoutes } from './tags.js';
import { createTemplateRoutes } from './templates.js';
import { createRecordRoutes } from './records.js';
import { createAppealRoutes } from './appeals.js';
import { createSummaryRoutes } from './summary.js';
import { createStatisticsRoutes } from './statistics.js';
import { createAwardRoutes } from './awards.js';
import { createSettingRoutes } from './settings.js';
import { createSseRoutes } from './sse.js';
import { createFileChunkRoutes } from './files.js';

/** 组装业务 API 路由（挂到 createApp 的 routes） */
export function buildApiRoutes(deps: RouteDeps): Hono {
  const api = new Hono();

  // 统一前置：session claims → 业务档案。
  // ⚠ 仅守 /api/v1/* —— 不能挂 '*'，否则本 app 以 '/' 挂载时会拦截所有请求（含 SPA 根/深链），
  //   无会话即 401，使 app-kit 排在其后的 static + SPA fallback 永远不可达（同源生产部署 bug）。
  api.use('/api/v1/*', requireProfile(deps.repos.users));

  // ── 值周域（细粒度巡查）──
  api.route('/api/v1/auth', createAuthRoutes(deps));
  api.route('/api/v1/campuses', createCampusRoutes(deps));
  api.route('/api/v1/grades', createGradeRoutes(deps));
  api.route('/api/v1/classes', createClassRoutes(deps));
  api.route('/api/v1/users', createUserRoutes(deps));
  api.route('/api/v1/groups', createGroupRoutes(deps));
  api.route('/api/v1/tags', createTagRoutes(deps));
  api.route('/api/v1/templates', createTemplateRoutes(deps));
  api.route('/api/v1/records', createRecordRoutes(deps));
  api.route('/api/v1/appeals', createAppealRoutes(deps));
  api.route('/api/v1/summaries', createSummaryRoutes(deps));
  api.route('/api/v1/statistics', createStatisticsRoutes(deps));
  api.route('/api/v1/awards', createAwardRoutes(deps));
  api.route('/api/v1/settings', createSettingRoutes(deps));
  api.route('/api/v1/sse', createSseRoutes(deps));
  // 分块上传（配合前端 chunk-client，绕开 qw-pages 网关 ~1MB 入站上限）
  api.route('/api/v1/files', createFileChunkRoutes(deps));

  return api;
}
