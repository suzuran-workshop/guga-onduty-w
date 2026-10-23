/**
 * 业务身份中间件 —— 桥接 auth SDK session 与业务档案。
 *
 * 链路（docs §2.2）：
 *  sessionMiddleware(SDK) 校验 cookie/Bearer → c.set('auth', {sub: uuid, sid, ...})
 *  → requireProfile（本文件）查 userProfiles → c.set('profile', {userId, campusId, role, ...})
 *  → requireRole(...roles) 读 profile.role 做 RBAC
 *
 * 修复的现有缺陷：
 *  - 角色变更后旧 token 7 天有效 → profile 每请求查库，改角色即时生效。
 *  - student 可增删改年级/班级/标签/… → requireRole 收紧（见各路由）。
 *  - 多校区「假隔离」（?campus_id= 任意覆盖）→ resolveCampusId 非 admin 强制用 profile.campusId。
 *
 * profile 加进程内 TTL 缓存（@homurajs/core TTL-KV），避免每请求查库；
 * 角色/校区变更时由 users-repo 侧失效（见 invalidateProfile）。
 */
import type { Context, Next, MiddlewareHandler } from 'hono';
import type { SessionClaims } from '@homurajs/auth';
import type { UserProfile, UserRole } from '@guga-onduty-w/shared';
import type { UsersRepo } from '../repos/types.js';
import { ApiError } from '../http/respond.js';

declare module 'hono' {
  interface ContextVariableMap {
    profile: UserProfile;
  }
}

const ERR = {
  unauthorized: { success: false, error: { code: 'UNAUTHORIZED', message: '未认证' } },
  forbidden: { success: false, error: { code: 'FORBIDDEN', message: '权限不足' } },
  profileMissing: { success: false, error: { code: 'PROFILE_NOT_FOUND', message: '用户档案缺失' } },
} as const;

/**
 * 从 session claims 解析业务档案并挂到 c.set('profile')。
 * 必须在 SDK sessionMiddleware 之后、业务路由之前。
 */
export function requireProfile(usersRepo: UsersRepo): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const claims = c.get('auth') as SessionClaims | undefined;
    if (!claims?.sub) {
      return c.json(ERR.unauthorized, 401);
    }
    const profile = await usersRepo.findProfile(claims.sub);
    if (!profile) {
      // session 有效但无业务档案（身份锚点存在、profile 被删）——拒绝，避免后续崩溃
      return c.json(ERR.profileMissing, 403);
    }
    c.set('profile', profile);
    await next();
  };
}

/** RBAC：profile.role 不在允许集则 403。必须在 requireProfile 之后。 */
export function requireRole(...roles: UserRole[]): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const profile = c.get('profile');
    if (!profile) return c.json(ERR.unauthorized, 401);
    if (!roles.includes(profile.role)) return c.json(ERR.forbidden, 403);
    await next();
  };
}

/**
 * student 白名单（需求 2：「学生只能评价，除此之外不能使用任何模块」）。
 *
 * ⚠ 这是**默认拒绝（fail-closed）**语义：未列入的端点一律 403。这样将来新增端点
 * 会自动对 student 关闭，而不是像「逐个端点补 requireRole」那样默认敞开、靠人记得收紧。
 * 各端点自身的 requireRole（如 revoke=admin、appeal=teacher）仍保留作纵深防御。
 *
 * 白名单只含「评价」这条业务链的最小集：
 *  - 自身身份（前端 useAuth 依赖 GET /auth/me，缺它整站无法初始化）
 *  - 打分所需的只读：标签、班级（含 join 出的 gradeName）、模板（快选）
 *  - 创建评价 + 查看评价（自己提交过的记录，校区隔离由端点内校验）
 *  - 图片上传三端点（扣分必拍照，缺它无法提交扣分）
 *
 * 明确**不**给 student 的（原全部敞开，其中前四个是越权读）：
 *  appeals（全校区申诉单含理由与审批意见）、statistics/export（全校区明细 CSV）、
 *  settings（系统配置）、templates/export（全校区模板导出）；
 *  以及 statistics/{ranking,trend,dashboard}、awards、summaries、groups、campuses、
 *  grades、sse、records/:id/logs（含审批意见）。
 */
const STUDENT_ALLOWLIST: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: 'GET', path: /^\/api\/v1\/auth\/(me|profile)$/ },
  { method: 'GET', path: /^\/api\/v1\/tags$/ },
  { method: 'GET', path: /^\/api\/v1\/classes$/ },
  { method: 'GET', path: /^\/api\/v1\/templates$/ },
  // ⚠ 负向前瞻排除 export：/templates/export 同样匹配 /templates/[^/]+，
  //   不排除就等于把全校区模板导出放给 student（原 P1 泄漏点之一）。
  { method: 'GET', path: /^\/api\/v1\/templates\/(?!export$)[^/]+$/ },
  { method: 'GET', path: /^\/api\/v1\/records$/ },
  { method: 'POST', path: /^\/api\/v1\/records$/ },
  // 仅 GET 单条详情；/records/:id/{revoke,appeal,logs} 是两段深，天然不匹配，
  // 且各自另有 requireRole（admin/teacher）——双重保障。
  { method: 'GET', path: /^\/api\/v1\/records\/[^/]+$/ },
  { method: 'POST', path: /^\/api\/v1\/files\/(init|complete)$/ },
  { method: 'PUT', path: /^\/api\/v1\/files\/chunk$/ },
];

/**
 * student 模块闸门（默认拒绝）。必须在 requireProfile 之后、业务路由之前挂载。
 * 非 student 角色直接放行（其权限由各端点 requireRole 管控）。
 */
export function requireStudentScope(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const profile = c.get('profile');
    if (!profile) return c.json(ERR.unauthorized, 401);
    if (profile.role !== 'student') {
      await next();
      return;
    }
    const method = c.req.method;
    // c.req.path 不含 query，故正则无需考虑 ?campus_id= 等参数
    const pathname = new URL(c.req.url).pathname;
    const allowed = STUDENT_ALLOWLIST.some((r) => r.method === method && r.path.test(pathname));
    if (!allowed) return c.json(ERR.forbidden, 403);
    await next();
  };
}

/** 取当前业务档案（requireProfile 已挂载） */
export function getProfile(c: Context): UserProfile {
  return c.get('profile');
}

/**
 * 多校区隔离解析（修复「假隔离」）：
 *  - admin：可用 ?campus_id= 指定任意校区（跨校区管理）；不传则默认自己校区。
 *  - 非 admin：**强制**用 profile.campusId，忽略请求参数（不能跨校区读）。
 */
export function resolveCampusId(c: Context): string {
  const profile = getProfile(c);
  if (profile.role === 'admin') {
    const q = c.req.query('campus_id');
    return q && q.length > 0 ? q : profile.campusId;
  }
  return profile.campusId;
}

/**
 * 写操作的校区归属（修复「campus_id 取自请求体」越权）：
 *  - admin：允许请求体指定 campusId（跨校区建号/建标签等）。
 *  - 非 admin：**强制** profile.campusId，忽略请求体值。
 */
export function resolveWriteCampusId(c: Context, bodyCampusId?: string | null): string {
  const profile = getProfile(c);
  if (profile.role === 'admin' && bodyCampusId) return bodyCampusId;
  return profile.campusId;
}

/**
 * 实体归属校验（共享）—— 修复值班域 by-id 写端点整片漏掉校区校验（REVIEW #3）。
 *
 * 语义（与值周域 assertOwnership 一致，此处抽成单一真源消除 5× 重复）：
 *  - 实体不存在 → 404。
 *  - 非 admin 且实体不属本人校区 → 404（不泄露跨校区实体存在性）。
 *  - admin 可跨校区（resolveWriteCampusId 语义一致）。
 * 返回实体本身，便于链式：const x = assertEntityOwnership(c, await repo.findById(id))。
 */
export function assertEntityOwnership<T extends { campusId: string }>(c: Context, entity: T | null, label = '资源'): T {
  if (!entity) throw ApiError.notFound(label + '不存在');
  const profile = getProfile(c);
  if (profile.role !== 'admin' && entity.campusId !== profile.campusId) {
    throw ApiError.notFound(label + '不存在');
  }
  return entity;
}