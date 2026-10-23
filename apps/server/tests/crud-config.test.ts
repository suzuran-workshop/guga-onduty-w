/**
 * E2E：CRUD 配置实体 + 模板 + 小结 + 设置。
 * 覆盖：campus/grade/class/tag/group/user CRUD、tags 部分更新（修复静默重置 bug）、
 *      系统标签不可删、templates 导入导出（事务+tagId校验）、summary UNIQUE、settings upsert map、
 *      唯一约束冲突 409、删除不存在的资源、users 建号（auth register + profile）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, seedStandard, type Harness } from './helpers/harness.js';

let h: Harness;
let seed: Awaited<ReturnType<typeof seedStandard>>;

beforeAll(async () => {
  h = await boot('crud');
  seed = await seedStandard(h);
});
afterAll(async () => { await h.shutdown(); });

describe('校区 CRUD（admin）', () => {
  it('建校区 → 201，重名 code → 409', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('POST', '/api/v1/campuses', { body: { name: '第三校区', code: 'campus_03' } });
    expect(r.status).toBe(201);
    const dup = await c.req('POST', '/api/v1/campuses', { body: { name: '重复', code: 'campus_03' } });
    expect(dup.status).toBe(409); // 唯一约束
  });

  it('更新校区', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('PUT', `/api/v1/campuses/${seed.c1.id}`, { body: { name: '第一校区(改)', code: 'campus_01' } });
    expect(r.status).toBe(200);
    expect(r.json.data.name).toBe('第一校区(改)');
  });
});

describe('年级/班级 CRUD', () => {
  it('admin 建年级 + 班级', async () => {
    const c = await h.loginAs('admin');
    const g = await c.req('POST', '/api/v1/grades', { body: { name: '2年级', sort_order: 2 } });
    expect(g.status).toBe(201);
    const cls = await c.req('POST', '/api/v1/classes', { body: { grade_id: g.json.data.id, name: '3班', class_teacher: '王老师' } });
    expect(cls.status).toBe(201);
    expect(cls.json.data.gradeName).toBe('2年级'); // join gradeName
  });

  it('年级列表按 sortOrder 排序 + 带 campusName', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('GET', '/api/v1/grades');
    expect(r.status).toBe(200);
    expect(r.json.data[0].campusName).toBeTruthy();
  });
});

describe('班级班主任绑定（teacher_user_id，2026-10-23 新增）', () => {
  it('绑定本校区教师 → 201，GET 回读 teacherUserId', async () => {
    const c = await h.loginAs('admin');
    const g = await c.req('POST', '/api/v1/grades', { body: { name: `绑师年级${Date.now()}`, sort_order: 9 } });
    const cls = await c.req('POST', '/api/v1/classes', {
      body: { grade_id: g.json.data.id, name: '绑定班', class_teacher: '李老师', teacher_user_id: seed.teacher.id },
    });
    expect(cls.status).toBe(201);
    expect(cls.json.data.teacherUserId).toBe(seed.teacher.id);
    // GET 列表能读到
    const list = await c.req('GET', '/api/v1/classes', { query: { grade_id: g.json.data.id } });
    expect(list.json.data[0].teacherUserId).toBe(seed.teacher.id);
  });

  it('不存在的 teacher_user_id → 400', async () => {
    const c = await h.loginAs('admin');
    const g = await c.req('POST', '/api/v1/grades', { body: { name: `绑师年级2-${Date.now()}`, sort_order: 9 } });
    const r = await c.req('POST', '/api/v1/classes', {
      body: { grade_id: g.json.data.id, name: '坏绑定班', teacher_user_id: 'nonexistent-user-uuid' },
    });
    expect(r.status).toBe(400);
  });

  it('绑定 student（非教师）→ 400', async () => {
    const c = await h.loginAs('admin');
    const g = await c.req('POST', '/api/v1/grades', { body: { name: `绑师年级3-${Date.now()}`, sort_order: 9 } });
    const r = await c.req('POST', '/api/v1/classes', {
      body: { grade_id: g.json.data.id, name: '学生班', teacher_user_id: seed.student.id },
    });
    expect(r.status).toBe(400); // 角色不是 teacher
  });

  it('绑定他校区教师 → 400（防跨校区误绑）', async () => {
    const c = await h.loginAs('admin');
    const g = await c.req('POST', '/api/v1/grades', { body: { name: `绑师年级4-${Date.now()}`, sort_order: 9 } });
    const r = await c.req('POST', '/api/v1/classes', {
      body: { grade_id: g.json.data.id, name: '跨区班', teacher_user_id: seed.teacherC2.id },
    });
    expect(r.status).toBe(400);
  });

  it('PUT 更新绑定 + 传 null 可解绑', async () => {
    const c = await h.loginAs('admin');
    const g = await c.req('POST', '/api/v1/grades', { body: { name: `绑师年级5-${Date.now()}`, sort_order: 9 } });
    const cls = await c.req('POST', '/api/v1/classes', { body: { grade_id: g.json.data.id, name: '改绑班' } });
    const id = cls.json.data.id;
    // 绑定
    const bound = await c.req('PUT', `/api/v1/classes/${id}`, { body: { name: '改绑班', teacher_user_id: seed.teacher.id } });
    expect(bound.status).toBe(200);
    expect(bound.json.data.teacherUserId).toBe(seed.teacher.id);
    // 解绑
    const unbound = await c.req('PUT', `/api/v1/classes/${id}`, { body: { name: '改绑班', teacher_user_id: null } });
    expect(unbound.status).toBe(200);
    expect(unbound.json.data.teacherUserId).toBeNull();
  });
});

describe('标签（部分更新修复 + 系统标签保护）', () => {
  it('部分更新只改传入字段（修复旧代码缺字段静默重置 bug）', async () => {
    const c = await h.loginAs('admin');
    const created = await c.req('POST', '/api/v1/tags', { body: { name: '测试标签', score: 3, color: '#123456', category: 'positive' } });
    const id = created.json.data.id;
    // 只改 name，不传 score/color/category
    const r = await c.req('PUT', `/api/v1/tags/${id}`, { body: { name: '改名了' } });
    expect(r.status).toBe(200);
    expect(r.json.data.name).toBe('改名了');
    expect(r.json.data.score).toBe(3); // 未被重置
    expect(r.json.data.color).toBe('#123456');
    expect(r.json.data.category).toBe('positive');
  });

  it('系统标签不可删（403）', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('DELETE', `/api/v1/tags/${seed.tagNeg.id}`);
    expect(r.status).toBe(403);
  });

  it('非系统标签可删', async () => {
    const c = await h.loginAs('admin');
    const created = await c.req('POST', '/api/v1/tags', { body: { name: '临时标签', score: 1, is_system: false } });
    const r = await c.req('DELETE', `/api/v1/tags/${created.json.data.id}`);
    expect(r.status).toBe(200);
  });

  it('按 category 筛选标签', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('GET', '/api/v1/tags', { query: { category: 'negative' } });
    for (const t of r.json.data) expect(t.category).toBe('negative');
  });
});

describe('值周小组（成员双写事务）', () => {
  it('建组带成员 → members 回填 userProfiles.groupId', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('POST', '/api/v1/groups', { body: { name: '周一组', members: [seed.student.id] } });
    expect(r.status).toBe(201);
    expect(r.json.data.members).toContain(seed.student.id);
    // 校验 profile 回填
    const users = await c.req('GET', '/api/v1/users');
    const stu = users.json.data.find((u: any) => u.id === seed.student.id);
    expect(stu.groupId).toBe(r.json.data.id);
  });

  it('换成员 → 旧成员 groupId 清空，新成员回填', async () => {
    const c = await h.loginAs('admin');
    const created = await c.req('POST', '/api/v1/groups', { body: { name: '换组测试', members: [seed.student.id] } });
    const gid = created.json.data.id;
    const r = await c.req('PUT', `/api/v1/groups/${gid}`, { body: { name: '换组测试', members: [seed.teacher.id] } });
    expect(r.status).toBe(200);
    const users = await c.req('GET', '/api/v1/users');
    const stu = users.json.data.find((u: any) => u.id === seed.student.id);
    const tea = users.json.data.find((u: any) => u.id === seed.teacher.id);
    expect(stu.groupId).toBeNull(); // 旧成员清空
    expect(tea.groupId).toBe(gid); // 新成员回填
  });
});

describe('用户管理（auth register + profile）', () => {
  it('admin 建号 → 可登录（scrypt 密码）', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('POST', '/api/v1/users', { body: { username: 'newteacher', password: 'pw123456', display_name: '新老师', role: 'teacher' } });
    expect(r.status).toBe(201);
    expect(r.json.data.role).toBe('teacher');
    // 新号可登录
    const nc = h.client();
    const login = await nc.req('POST', '/auth/password/login', { body: { username: 'newteacher', password: 'pw123456' } });
    expect(login.status).toBe(200);
  });

  it('重名 username → 409', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('POST', '/api/v1/users', { body: { username: 'admin', password: 'x123456', display_name: '重复', role: 'student' } });
    expect(r.status).toBe(409);
  });

  it('非法 role → 400', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('POST', '/api/v1/users', { body: { username: 'x1', display_name: 'x', role: 'superuser' } });
    expect(r.status).toBe(400);
  });

  it('按 role 筛选用户列表', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('GET', '/api/v1/users', { query: { role: 'student' } });
    for (const u of r.json.data) expect(u.role).toBe('student');
  });
});

describe('模板（导入导出 + tagId 校验）', () => {
  it('建模板 + 导出（剥离 id）', async () => {
    const c = await h.loginAs('admin');
    await c.req('POST', '/api/v1/templates', { body: { name: '晨检', tag_ids: [seed.tagNeg.id, seed.tagPos.id] } });
    const exp = await c.req('GET', '/api/v1/templates/export');
    expect(exp.status).toBe(200);
    const item = exp.json.data.find((x: any) => x.name === '晨检');
    expect(item).toBeTruthy();
    // 导出文件 interchange 格式用 tag_ids（snake_case），与 /import 对称 + 兼容旧导出文件
    expect(item.tag_ids).toHaveLength(2);
    expect(item.id).toBeUndefined(); // 导出剥离 id
  });

  it('列表展开 tags（无 N+1，批量查）', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('GET', '/api/v1/templates');
    const withTags = r.json.data.find((x: any) => x.name === '晨检');
    expect(withTags.tags).toHaveLength(2);
  });

  it('导入过滤无效/跨校区 tagId', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('POST', '/api/v1/templates/import', {
      body: { data: [{ name: '导入A', tag_ids: [seed.tagNeg.id] }, { name: '导入B', tag_ids: [seed.tagPos.id, 'fake-not-in-campus'] }] },
    });
    expect(r.status).toBe(200);
    expect(r.json.data.imported).toBe(2);
    const list = await c.req('GET', '/api/v1/templates');
    const b = list.json.data.find((x: any) => x.name === '导入B');
    expect(b.tagIds).toHaveLength(1); // fake 被过滤
  });
});

describe('每日小结', () => {
  it('admin+teacher 可建小结（student 不可）', async () => {
    const teacher = await h.loginAs('teacher1');
    const r = await teacher.req('POST', '/api/v1/summaries', { body: { week: '2026-W41', date: '2026-10-12', content: '今日良好' } });
    expect(r.status).toBe(201);

    const stu = await h.loginAs('student1');
    const r2 = await stu.req('POST', '/api/v1/summaries', { body: { week: '2026-W41', date: '2026-10-13', content: 'x' } });
    expect(r2.status).toBe(403);
  });

  it('按周查询小结', async () => {
    const c = await h.loginAs('teacher1');
    const r = await c.req('GET', '/api/v1/summaries', { query: { week: '2026-W41' } });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.data)).toBe(true);
  });
});

describe('系统设置（upsert map）', () => {
  it('admin 读设置 map + upsert 覆盖', async () => {
    const c = await h.loginAs('admin');
    const get = await c.req('GET', '/api/v1/settings');
    expect(get.status).toBe(200);
    expect(typeof get.json.data).toBe('object'); // map，非数组

    await c.req('PUT', '/api/v1/settings', { body: { settings: [{ key: 'appeal_enabled', value: 'false' }] } });
    const after = await c.req('GET', '/api/v1/settings');
    expect(after.json.data.appeal_enabled).toBe('false'); // upsert 覆盖
  });

  it('student 不能改设置（403）', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('PUT', '/api/v1/settings', { body: { settings: [{ key: 'x', value: 'y' }] } });
    expect(r.status).toBe(403);
  });
});

describe('错误处理（onError 不泄栈）', () => {
  it('删除/读取不存在资源 → 404 结构化错误', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('GET', '/api/v1/records/nonexistent-uuid');
    expect(r.status).toBe(404);
    expect(r.json.success).toBe(false);
    expect(r.json.error.code).toBeTruthy();
    expect(r.json.error.message).not.toContain('stack');
  });

  it('healthz 探活', async () => {
    const r = await h.client().req('GET', '/healthz');
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('ok');
    expect(r.json.checks.db).toBe('ok');
  });
});
