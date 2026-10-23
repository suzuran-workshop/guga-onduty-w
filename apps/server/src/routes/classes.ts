/**
 * classes 路由 —— 班级 CRUD。
 *
 * 迁移要点（对照旧 routes/classes.ts）：
 *  - id 为 uuid；读走 resolveCampusId 隔离，可按 grade_id 过滤。
 *  - **写端点收紧为 admin only**（修复旧代码 student 可增删改班级的越权）。
 *  - PUT/DELETE 先 findById 校验归属（非 admin 不得跨校区）。
 *  - 唯一约束冲突（campus+grade+name 重复）转 409。
 *  - 2026-10-23：新增 `teacher_user_id`（班主任权威关联），写入前校验该用户存在、
 *    属本校区且角色为 teacher —— 绑错 userId 会让「只能申诉自己班」误判、钉钉推送静默失败。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { RouteDeps } from './_deps.js';
import { getProfile, requireRole, resolveCampusId, resolveWriteCampusId } from '../middleware/profile.js';
import { ok, created, ApiError, isUniqueViolation } from '../http/respond.js';

/** 校验存在 + 校区归属；返回实体便于链式取字段（非本校区返 404，不泄露存在性） */
function assertOwnership<T extends { campusId: string }>(c: Context, entity: T | null): T {
  if (!entity) throw ApiError.notFound('班级不存在');
  const profile = getProfile(c);
  if (profile.role !== 'admin' && entity.campusId !== profile.campusId) {
    throw ApiError.notFound('班级不存在');
  }
  return entity;
}

export function createClassRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  /**
   * 校验班主任绑定的合法性（2026-10-23 新增 teacherUserId 列）。
   * null/空 → 放行（解绑是合法操作）。否则必须：用户存在 + 属本校区 + 角色为 teacher。
   * 绑错 userId 的后果比报错更隐蔽：申诉归属校验会误判、钉钉推送会静默发给错人。
   */
  async function assertTeacherBinding(campusId: string, teacherUserId?: string | null): Promise<void> {
    if (!teacherUserId) return;
    const users = await repos.users.list(campusId, 'teacher');
    if (!users.some((u) => u.id === teacherUserId)) {
      throw ApiError.badRequest('班主任须为本校区的教师用户（teacher_user_id 无效）');
    }
  }

  // GET / —— 本校区班级列表（可按年级过滤，含 gradeName）
  app.get('/', async (c) => {
    const classes = await repos.classes.listByCampus(
      resolveCampusId(c),
      c.req.query('grade_id') || undefined,
    );
    return ok(c, classes);
  });

  // POST / —— admin 建班级
  app.post('/', requireRole('admin'), async (c) => {
    const body = await c.req
      .json<{ campus_id?: string; grade_id: string; name: string; class_teacher?: string; teacher_user_id?: string | null }>()
      .catch(() => null as any);
    if (!body?.grade_id || !body.name) throw ApiError.badRequest('缺少 grade_id / name');
    const campusId = resolveWriteCampusId(c, body.campus_id);
    await assertTeacherBinding(campusId, body.teacher_user_id);
    try {
      const klass = await repos.classes.create({
        campusId,
        gradeId: body.grade_id,
        name: body.name,
        classTeacher: body.class_teacher ?? null,
        teacherUserId: body.teacher_user_id ?? null,
      });
      return created(c, klass);
    } catch (e) {
      if (isUniqueViolation(e)) throw ApiError.conflict('同年级班级名已存在');
      throw e;
    }
  });

  // PUT /:id —— admin 改班级
  app.put('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ name: string; class_teacher?: string; teacher_user_id?: string | null }>().catch(() => null as any);
    if (!body?.name) throw ApiError.badRequest('缺少 name');
    const existing = assertOwnership(c, await repos.classes.findById(id));
    await assertTeacherBinding(existing.campusId, body.teacher_user_id);
    const klass = await repos.classes.update(id, {
      name: body.name,
      classTeacher: body.class_teacher ?? null,
      teacherUserId: body.teacher_user_id ?? null,
    });
    if (!klass) throw ApiError.notFound('班级不存在');
    return ok(c, klass);
  });

  // DELETE /:id —— admin 删班级
  app.delete('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    const klass = assertOwnership(c, await repos.classes.findById(id)); // 校验存在 + 归属
    // REVIEW #8：班级下有记录则拒删（防 records 孤儿 → 列表 innerJoin 丢行/统计错算）
    const recs = await repos.records.list({ campusId: klass.campusId, classId: id, page: 1, pageSize: 1 });
    if (recs.pagination.total > 0) throw ApiError.conflict(`该班级下仍有 ${recs.pagination.total} 条值周记录，无法删除`);
    await repos.classes.remove(id);
    return ok(c, { deleted: true });
  });

  return app;
}
