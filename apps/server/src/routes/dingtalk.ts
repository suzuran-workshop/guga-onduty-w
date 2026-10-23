/**
 * dingtalk 路由 —— 钉钉集成管理面（2026-10-23，需求 4）。**全部 admin only**。
 *
 * 端点：
 *  - GET    /status                 平台启用状态 + 凭证齐备情况（含降级原因，便于排障）
 *  - POST   /sync                   引入整个组织通讯录（**不含家校通讯录**）
 *  - GET    /contacts               通讯录联系人列表（ConfigPage 班主任下拉的数据源）
 *  - GET    /apps                   列出企业应用（agentId 发现：asyncsend_v2 必需 agentId 且无法从 appKey 反推）
 *  - GET    /notifications          通知日志（分页，可按 status/kind 过滤）
 *  - POST   /notifications/:id/resend  重发单条失败/待发的通知
 *  - POST   /notifications/flush    补发全部 pending（凭证到位后用）
 *  - POST   /weekly-report          发/补发周报（dedupeKey 幂等，重复点安全）
 *
 * ⚠ 通讯录同步是**组织级**的（钉钉通讯录无校区维度），故 sync 不接受 campus_id；
 * 联系人可被任意校区班级绑定（数据录入正确性由管理员负责）。
 */
import { Hono } from 'hono';
import { supports } from '@homurajs/3p';
import type { RouteDeps } from './_deps.js';
import { requireRole, resolveCampusId, resolveWriteCampusId } from '../middleware/profile.js';
import { ok, created, ApiError, parsePagination } from '../http/respond.js';
import type { ContactsSyncResult, DingtalkContact, NotificationKind, NotificationStatus } from '@guga-onduty-w/shared';

export function createDingtalkRoutes(deps: RouteDeps): Hono {
  const { repos, platform, notify } = deps;
  const app = new Hono();

  // 整个模块 admin only（管理面：凭证/通讯录/通知日志都不该对其他角色可见）
  app.use('*', requireRole('admin'));

  // GET /status —— 启用状态（凭证是否齐备 + 降级原因）
  app.get('/status', async (c) => {
    const p = platform.platform;
    return ok(c, {
      enabled: platform.canSend,
      reason: platform.reason ?? null,
      agentId: platform.agentId,
      capabilities: p ? [...p.capabilities] : [],
      oauth: p ? supports(p, 'oauth') : false,
      contacts: p ? supports(p, 'contacts') : false,
      message: p ? supports(p, 'message') : false,
      apps: p ? supports(p, 'apps') : false,
    });
  });

  // POST /sync —— 引入整个组织通讯录（不含家校）
  app.post('/sync', async (c) => {
    const p = platform.platform;
    if (!p || !supports(p, 'contacts')) {
      throw ApiError.badRequest(
        '钉钉通讯录能力不可用（请配置 DINGTALK_APP_KEY / DINGTALK_APP_SECRET）',
        'DINGTALK_NOT_CONFIGURED',
      );
    }
    // ⚠ includeFamily 恒为 false：训练员明确要求「引入整个组织通讯录（**不含家校通讯录**）」。
    // 家校子树（dept_id=-7）也不能用普通部门 API 递归（3p 实测 40009），fetchAllContacts 已自动跳过。
    const snap = await p.fetchAllContacts({ includeFamily: false, concurrency: 4 });

    // 部门 id → 名称映射，给每个联系人算出部门名路径（展示用，避免前端重建部门树）
    const deptNameById = new Map<number, string>();
    for (const d of snap.depts) deptNameById.set(d.deptId, d.name);

    const now = Date.now();
    const contacts = snap.users.map((u) => ({
      userId: u.userid,
      unionId: u.unionid ?? null,
      name: u.name ?? '(未命名)',
      mobile: u.mobile ?? null,
      title: u.title ?? null,
      avatarUrl: u.avatarUrl ?? null,
      deptIds: u.deptIdList ?? null,
      deptNames: (u.deptIdList ?? []).map((id) => deptNameById.get(id)).filter((n): n is string => Boolean(n)),
      syncedAt: now,
    }));
    const synced = await repos.dingtalkContacts.upsertMany(contacts);

    const result: ContactsSyncResult = {
      synced,
      depts: snap.depts.length,
      truncated: snap.truncated,
      errors: snap.errors,
      // 本系统按产品要求不引入家校通讯录，如实回报（管理员据此知情）
      family: { included: false, reason: '按产品要求不引入家校通讯录（仅引入组织通讯录）' },
      syncedAt: now,
    };
    return created(c, result);
  });

  // GET /contacts —— 联系人列表（班主任下拉数据源；可按姓名模糊搜）
  app.get('/contacts', async (c) => {
    const contacts: DingtalkContact[] = await repos.dingtalkContacts.list({
      nameLike: c.req.query('q') || undefined,
      limit: Math.min(500, Number(c.req.query('limit') ?? 200)),
    });
    return ok(c, contacts);
  });

  // GET /apps —— 企业应用列表（agentId 发现）
  app.get('/apps', async (c) => {
    const p = platform.platform;
    if (!p || !supports(p, 'apps')) {
      throw ApiError.badRequest('钉钉应用能力不可用（请配置凭证）', 'DINGTALK_NOT_CONFIGURED');
    }
    return ok(c, await p.listMicroApps());
  });

  // GET /notifications —— 通知日志（分页）
  app.get('/notifications', async (c) => {
    const { page, pageSize } = parsePagination(c);
    const result = await repos.notifications.list({
      campusId: resolveCampusId(c),
      status: (c.req.query('status') as NotificationStatus) || undefined,
      kind: (c.req.query('kind') as NotificationKind) || undefined,
      recordId: c.req.query('record_id') || undefined,
      page,
      pageSize,
    });
    return ok(c, result.data, result.pagination);
  });

  // POST /notifications/:id/resend —— 重发单条
  app.post('/notifications/:id/resend', async (c) => {
    const id = c.req.param('id');
    const log = await repos.notifications.findById(id);
    if (!log) throw ApiError.notFound('通知不存在');
    // 校区隔离：非 admin 不会到这里（模块级 requireRole），但 admin 可跨校区，故只校验存在性
    if (!platform.canSend) {
      throw ApiError.badRequest(`钉钉未启用，无法重发（${platform.reason ?? '凭证缺失'}）`, 'DINGTALK_NOT_CONFIGURED');
    }
    // 周报类：走周报通道（带 dedupeKey，重复重发不会重复投递）
    if (log.kind === 'weekly_report' && log.week) {
      const r = await notify.sendWeeklyReport(log.campusId, log.week);
      return ok(c, r);
    }
    // 记录类：按 recordId 重推（会生成新的通知日志行，保留原行作审计）
    if (!log.recordId) throw ApiError.badRequest('该通知无关联记录，无法重发');
    const r = await notify.notifyRecord(log.recordId);
    return ok(c, r);
  });

  // POST /notifications/flush —— 补发全部 pending（凭证到位后用）
  app.post('/notifications/flush', async (c) => {
    const campusId = resolveCampusId(c);
    const r = await notify.flushPending(campusId);
    return ok(c, r);
  });

  // POST /weekly-report —— 发/补发周报（幂等，可重复点击）
  app.post('/weekly-report', async (c) => {
    const body = await c.req
      .json<{ campus_id?: string; week?: string }>()
      .catch(() => ({}) as { campus_id?: string; week?: string });
    const campusId = resolveWriteCampusId(c, body.campus_id);
    if (!body.week) throw ApiError.badRequest('缺少 week');
    const r = await notify.sendWeeklyReport(campusId, body.week);
    return ok(c, { week: body.week, ...r });
  });

  return app;
}
