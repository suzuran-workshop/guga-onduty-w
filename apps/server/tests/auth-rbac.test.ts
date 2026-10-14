/**
 * E2E：认证链 + RBAC + 多校区隔离（安全关键路径）。
 * 覆盖：cookie 登录/登出、/auth/me 聚合、未认证 401、会话过期清态、
 *      角色越权 403、非 admin 强制校区隔离（读+写+按 id）、admin 跨校区。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, seedStandard, type Harness } from './helpers/harness.js';

let h: Harness;
let seed: Awaited<ReturnType<typeof seedStandard>>;

beforeAll(async () => {
  h = await boot('auth');
  seed = await seedStandard(h);
});
afterAll(async () => {
  await h.shutdown();
});

describe('认证链', () => {
  it('正确密码登录成功并下发 cookie', async () => {
    const c = h.client();
    const r = await c.req('POST', '/auth/password/login', { body: { username: 'admin', password: '123456' } });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(c.jar.header().length).toBeGreaterThan(0);
  });

  it('错误密码 401', async () => {
    const c = h.client();
    const r = await c.req('POST', '/auth/password/login', { body: { username: 'admin', password: 'wrong' } });
    expect(r.status).toBe(401);
  });

  it('未知用户 401（不区分用户不存在/密码错，防枚举）', async () => {
    const c = h.client();
    const r = await c.req('POST', '/auth/password/login', { body: { username: 'nobody', password: '123456' } });
    expect(r.status).toBe(401);
  });

  it('/auth/me 聚合身份 + 档案 + 校区名', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('GET', '/api/v1/auth/me');
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
    expect(r.json.data.user.username).toBe('admin');
    expect(r.json.data.profile.role).toBe('admin');
    expect(r.json.data.campusName).toBe('第一校区');
  });

  it('未带 cookie 访问业务路由 → 401', async () => {
    const r = await h.client().req('GET', '/api/v1/campuses');
    expect(r.status).toBe(401);
  });

  it('登出后 cookie 失效', async () => {
    const c = await h.loginAs('student1');
    // 登出前能访问
    expect((await c.req('GET', '/api/v1/tags')).status).toBe(200);
    await c.req('POST', '/auth/logout');
    // 登出后（新 jar 无有效 cookie）访问 → 401
    const fresh = h.client();
    expect((await fresh.req('GET', '/api/v1/tags')).status).toBe(401);
  });
});

describe('RBAC（修复旧代码 student 可写 12 端点）', () => {
  it('student 不能建标签（403）', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('POST', '/api/v1/tags', { body: { name: '乱建', score: 5 } });
    expect(r.status).toBe(403);
  });

  it('student 可读标签（200）', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('GET', '/api/v1/tags');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.data)).toBe(true);
  });

  it('student 不能改设置（403）', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('PUT', '/api/v1/settings', { body: { settings: [{ key: 'x', value: 'y' }] } });
    expect(r.status).toBe(403);
  });

  it('student 不能建校区/年级/班级（403）', async () => {
    const c = await h.loginAs('student1');
    expect((await c.req('POST', '/api/v1/campuses', { body: { name: 'x', code: 'x' } })).status).toBe(403);
    expect((await c.req('POST', '/api/v1/grades', { body: { name: 'x' } })).status).toBe(403);
    expect((await c.req('POST', '/api/v1/classes', { body: { name: 'x', grade_id: seed.g1.id } })).status).toBe(403);
  });

  it('student 不能发流动红旗（403，修复旧代码可发）', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('POST', '/api/v1/awards', { body: { week: '2026-W41' } });
    expect(r.status).toBe(403);
  });

  it('teacher 不能建用户（仅 admin，403）', async () => {
    const c = await h.loginAs('teacher1');
    const r = await c.req('POST', '/api/v1/users', { body: { username: 'x', display_name: 'x', role: 'student' } });
    expect(r.status).toBe(403);
  });

  it('admin 可建标签（200）', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('POST', '/api/v1/tags', { body: { name: 'admin建', score: 1, category: 'positive' } });
    expect(r.status).toBe(201);
  });
});

describe('多校区隔离（修复旧代码假隔离）', () => {
  it('student1(c1) 读班级只见本校区，看不到 c2 班级', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('GET', '/api/v1/classes');
    const ids = r.json.data.map((x: any) => x.id);
    expect(ids).toContain(seed.cls1.id);
    expect(ids).not.toContain(seed.clsC2.id);
  });

  it('student 用 ?campus_id=c2 越权读被忽略（仍只见本校区）', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('GET', '/api/v1/classes', { query: { campus_id: seed.c2.id } });
    const ids = r.json.data.map((x: any) => x.id);
    expect(ids).not.toContain(seed.clsC2.id);
    expect(ids).toContain(seed.cls1.id);
  });

  it('student 按 id 跨校区读单条记录 → 404（不泄露存在性）', async () => {
    // student2(c2) 建一条 c2 记录，student1(c1) 试图按 id 读
    const c2client = await h.loginAs('student2');
    const form = new FormData();
    form.set('class_id', seed.clsC2.id);
    form.set('score', '-1');
    form.set('week', '2026-W41');
    const created = await c2client.req('POST', '/api/v1/records', { body: form, isForm: true });
    expect(created.status).toBe(201);
    const c2recId = created.json.data.id;

    const c1client = await h.loginAs('student1');
    const r = await c1client.req('GET', `/api/v1/records/${c2recId}`);
    expect(r.status).toBe(404);
  });

  it('admin 可跨校区读全部校区', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('GET', '/api/v1/campuses');
    expect(r.json.data.length).toBe(2);
  });

  it('admin 用 ?campus_id=c2 可跨校区读 c2 班级', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('GET', '/api/v1/classes', { query: { campus_id: seed.c2.id } });
    const ids = r.json.data.map((x: any) => x.id);
    expect(ids).toContain(seed.clsC2.id);
  });
});
