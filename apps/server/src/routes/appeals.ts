/**
 * appeals 路由 —— 申诉查询（只读；审批动作在 records 路由的 /records/:id/appeal/*）。
 *
 * 迁移要点（对照旧 routes/appeals.ts）：
 *  - teacher 只看自己的申诉：teacherId（系统账号）**OR** teacherDingtalkId（钉钉身份），
 *    覆盖免登录令牌链接提交的申诉——那种没有系统账号，只有钉钉身份。
 *  - 非 admin 按 resolveCampusId 隔离（修复旧代码 student/admin 看全局申诉的越权）。
 *  - admin 可用 ?campus_id= 指定校区，不传则看全部（campusId=undefined）。
 *  - list 一次 join 取 record_info（repo 已修复 N+1）。
 *  - GET /:id 校验归属（非 admin/非本人不得跨校区看；本人判定与 list 同口径 OR）。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { getProfile, requireRole, resolveCampusId } from '../middleware/profile.js';
import { ok, ApiError, parsePagination } from '../http/respond.js';
import { resolveDingtalkUserId } from '../platform/resolve-identity.js';

export function createAppealRoutes(deps: RouteDeps): Hono {
  const { repos, auth } = deps;
  const app = new Hono();

  /**
   * 当前登录教师的钉钉 userid（解析不出则为 null）。
   *
   * 申诉的归属权威是 **teacherDingtalkId**：免登录链接提交的申诉没有系统账号（teacherId 为 null），
   * 只认钉钉身份。教师若用钉钉 OAuth 登录，linkStore 里有关联 → 能解析出来，于是
   * 「我用链接提交的申诉」与「我在系统里提交的申诉」落在同一个列表里。
   *
   * 解析失败/账密登录 → 返回 null，调用方**只**按 teacherId 过滤：那是更窄的集合，
   * 绝不放宽到全校区（fail-closed 到少看，而不是多看）。
   */
  const myDingtalkId = async (profile: { userId: string }): Promise<string | null> => {
    try {
      return await resolveDingtalkUserId(auth.linkStore, profile.userId);
    } catch {
      // 只读列表不得因身份解析故障 500：降级为仅按 teacherId 过滤
      return null;
    }
  };

  // GET / —— 申诉列表（分页 + 角色/校区过滤）
  // 2026-10-23 修 RBAC 不一致：detail 端点显式拒绝 student，而 list 原先无守卫——
  // teacherId 过滤只在 role==='teacher' 时生效，student → undefined → 可分页读取全校区
  // 申诉单（含 teacherName/理由/审批意见/关联记录分数）。现与 detail 对齐收紧为 admin/teacher。
  // （学生闸门 requireStudentScope 已先挡一道，此处是纵深防御 + 消除两处语义分歧。）
  app.get('/', requireRole('admin', 'teacher'), async (c) => {
    const profile = getProfile(c);
    const { page, pageSize } = parsePagination(c);

    // teacher 只看自己的（两个身份维度 OR）；非 admin 按校区隔离；admin 可跨校区（?campus_id=）或看全部
    const isTeacher = profile.role === 'teacher';
    const teacherId = isTeacher ? profile.userId : undefined;
    const teacherDingtalkId = isTeacher ? ((await myDingtalkId(profile)) ?? undefined) : undefined;
    const campusId = profile.role === 'admin'
      ? (c.req.query('campus_id') || undefined)
      : resolveCampusId(c);

    const result = await repos.appeals.list({
      campusId,
      teacherId,
      teacherDingtalkId,
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
    // REVIEW #9：非 admin 强制本校区隔离（旧代码靠「id 只能来自已隔离列表」兜底，现直接校验 campusId）
    if (profile.role !== 'admin' && appeal.campusId !== profile.campusId) {
      throw ApiError.notFound('申诉不存在'); // 不泄露跨校区申诉的存在性
    }
    // teacher 只能看自己发起的申诉；admin 放行；student 无申诉语义，拒绝。
    // 本人判定与 list **同口径 OR**：免登录申诉的 teacherId 为 null，只比 teacherId 会让教师
    // 从列表点进自己刚提交的申诉却吃 404（列表 OR 放出来、详情 AND 挡住 = 自相矛盾）。
    if (profile.role === 'teacher') {
      const dt = await myDingtalkId(profile);
      const mine = appeal.teacherId === profile.userId || (dt !== null && appeal.teacherDingtalkId === dt);
      if (!mine) throw ApiError.notFound('申诉不存在');
    } else if (profile.role !== 'admin') {
      throw ApiError.forbidden('无权查看申诉详情');
    }
    return ok(c, appeal);
  });

  return app;
}
