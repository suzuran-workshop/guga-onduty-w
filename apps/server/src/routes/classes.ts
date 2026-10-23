/**
 * classes 路由 —— 班级 CRUD。
 *
 * 迁移要点（对照旧 routes/classes.ts）：
 *  - id 为 uuid；读走 resolveCampusId 隔离，可按 grade_id 过滤。
 *  - **写端点收紧为 admin only**（修复旧代码 student 可增删改班级的越权）。
 *  - PUT/DELETE 先 findById 校验归属（非 admin 不得跨校区）。
 *  - 唯一约束冲突（campus+grade+name 重复）转 409。
 *  - 2026-10-23：新增 `teacher_dingtalk_id`（班主任权威关联），写入前校验该用户存在、
 *    属本校区且角色为 teacher —— 绑错 userId 会让「只能申诉自己班」误判、钉钉推送静默失败。
 *  - 2026-10-23：归属校验收敛到 middleware 的 assertEntityOwnership（消除本文件的局部副本）。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { assertEntityOwnership, requireRole, resolveCampusId, resolveWriteCampusId } from '../middleware/profile.js';
import { ok, created, ApiError, isUniqueViolation } from '../http/respond.js';

export function createClassRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  /**
   * 校验班主任绑定的合法性（2026-10-23：teacherDingtalkId 存**钉钉 userid**，非系统 users.id）。
   * null/空 → 放行（解绑是合法操作）。否则该 userid 必须已存在于本地通讯录缓存
   * （管理员先在设置里「引入组织通讯录」，再从联系人下拉选人）。
   * 绑错的后果比报错更隐蔽：扣分推送会静默发给错人或发不出、申诉归属校验会误判。
   */
  async function assertTeacherBinding(teacherDingtalkId?: string | null): Promise<void> {
    if (!teacherDingtalkId) return;
    const contact = await repos.dingtalkContacts.findByUserId(teacherDingtalkId);
    if (!contact) {
      throw ApiError.badRequest(
        '班主任须为已引入的钉钉通讯录联系人（请先在「设置 → 钉钉」引入组织通讯录，再从联系人中选择）',
      );
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
      .json<{ campus_id?: string; grade_id: string; name: string; class_teacher?: string; teacher_dingtalk_id?: string | null }>()
      .catch(() => null as any);
    if (!body?.grade_id || !body.name) throw ApiError.badRequest('缺少 grade_id / name');
    const campusId = resolveWriteCampusId(c, body.campus_id);
    await assertTeacherBinding(body.teacher_dingtalk_id);
    try {
      const klass = await repos.classes.create({
        campusId,
        gradeId: body.grade_id,
        name: body.name,
        classTeacher: body.class_teacher ?? null,
        teacherDingtalkId: body.teacher_dingtalk_id ?? null,
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
    const body = await c.req.json<{ name: string; class_teacher?: string; teacher_dingtalk_id?: string | null }>().catch(() => null as any);
    if (!body?.name) throw ApiError.badRequest('缺少 name');
    // 校验存在 + 校区归属（抛错即中断，故无需接返回值）
    assertEntityOwnership(c, await repos.classes.findById(id), '班级');
    await assertTeacherBinding(body.teacher_dingtalk_id);
    const klass = await repos.classes.update(id, {
      name: body.name,
      classTeacher: body.class_teacher ?? null,
      teacherDingtalkId: body.teacher_dingtalk_id ?? null,
    });
    if (!klass) throw ApiError.notFound('班级不存在');
    return ok(c, klass);
  });

  // DELETE /:id —— admin 删班级
  app.delete('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    const klass = assertEntityOwnership(c, await repos.classes.findById(id), '班级'); // 校验存在 + 归属
    // REVIEW #8：班级下有记录则拒删（防 records 孤儿 → 列表 innerJoin 丢行/统计错算）
    const recs = await repos.records.list({ campusId: klass.campusId, classId: id, page: 1, pageSize: 1 });
    if (recs.pagination.total > 0) throw ApiError.conflict(`该班级下仍有 ${recs.pagination.total} 条值周记录，无法删除`);
    await repos.classes.remove(id);
    return ok(c, { deleted: true });
  });

  return app;
}
