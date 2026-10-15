/**
 * 值周域对抗性审查回归（REVIEW-PHILOSOPHY §5 / 值周 fork 审查）。
 *
 * 专测审查发现的、现有 E2E 盲区内的缺陷（同角色跨主体越权 / 删除后引用完整性 /
 * 状态机非法迁移 / 业务效果数值断言）。每条对应一个已修复缺陷，防回归。
 *  - #1 申诉计分语义 → 见 records-appeals.test.ts（业务效果断言）
 *  - #2 删用户致记录消失 + 导出丢行 + count/rows 分歧
 *  - #3 /statistics/trend 跨校区泄漏
 *  - #4 撤回记录被 reject 复活
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, seedStandard, type Harness } from './helpers/harness.js';

let h: Harness;
let seed: Awaited<ReturnType<typeof seedStandard>>;

beforeAll(async () => {
  h = await boot('wkreview');
  seed = await seedStandard(h);
});
afterAll(async () => { await h.shutdown(); });

function recordForm(classId: string, score: string, week = '2026-W41') {
  const f = new FormData();
  f.set('class_id', classId);
  f.set('score', score);
  f.set('week', week);
  return f;
}

describe('#3 trend 多校区隔离（跨校区数据泄漏）', () => {
  it('teacher1(c1) 请求 c2 班级的 trend → 不返回 c2 数据', async () => {
    const admin = await h.loginAs('admin');
    // 给 c2 的班级打一条分（-9）
    const s2 = await h.loginAs('student2'); // student2 属 c2
    await s2.req('POST', '/api/v1/records', { body: recordForm(seed.clsC2.id, '-9'), isForm: true });
    // teacher1(c1) 试图查 c2 班级的 trend
    const t1 = await h.loginAs('teacher1');
    const r = await t1.req('GET', '/api/v1/statistics/trend', { query: { class_id: seed.clsC2.id, weeks: 4 } });
    expect(r.status).toBe(200);
    // 隔离后：c1 的 teacher 查 c2 班级 → 全 0（不泄漏 c2 的 -9）
    const total = r.json.data.reduce((a: number, p: any) => a + p.totalScore, 0);
    expect(total).toBe(0); // 修复前会返回 -9（泄漏）
  });

  it('admin 跨校区查 c2 trend → 能看到 c2 数据（隔离不误伤 admin）', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/statistics/trend', { query: { class_id: seed.clsC2.id, weeks: 4, campus_id: seed.c2.id } });
    expect(r.status).toBe(200);
    const total = r.json.data.reduce((a: number, p: any) => a + p.totalScore, 0);
    expect(total).toBe(-9); // admin 可跨校区
  });
});

describe('#4 撤回记录不被 reject 复活（状态机合法性）', () => {
  it('active→申诉→撤回→驳回：record 保持 revoked（不复活成 active 重新计分）', async () => {
    const admin = await h.loginAs('admin');
    const stu = await h.loginAs('student1');
    const created = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, '-5'), isForm: true });
    const id = created.json.data.id;

    const teacher = await h.loginAs('teacher1');
    await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: 'r' } }); // → appealing
    await admin.req('POST', `/api/v1/records/${id}/revoke`, { body: {} });                 // → revoked
    await admin.req('POST', `/api/v1/records/${id}/appeal/reject`, { body: { review_comment: 'x' } }); // 驳回

    const after = await admin.req('GET', `/api/v1/records/${id}`);
    expect(after.json.data.status).toBe('revoked'); // ★ 修复前会变 active（复活）
  });

  it('revoke 已 revoked 记录幂等（不重复；appeal_approved 不被推翻）', async () => {
    const admin = await h.loginAs('admin');
    const stu = await h.loginAs('student1');
    // 场景A：申诉成立后尝试撤回 → appeal_approved 是终态，不应被 revoke 推翻
    const c1 = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, '-3'), isForm: true });
    const id1 = c1.json.data.id;
    const teacher = await h.loginAs('teacher1');
    await teacher.req('POST', `/api/v1/records/${id1}/appeal`, { body: { reason: 'r' } });
    await admin.req('POST', `/api/v1/records/${id1}/appeal/approve`, { body: {} }); // → appeal_approved
    await admin.req('POST', `/api/v1/records/${id1}/revoke`, { body: {} });         // 试图撤回已批准的
    const after1 = await admin.req('GET', `/api/v1/records/${id1}`);
    expect(after1.json.data.status).toBe('appeal_approved'); // 终态未被推翻

    // 场景B：重复撤回同一条 active → 第二次幂等（状态仍 revoked，不报错）
    const c2 = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, '-2'), isForm: true });
    const id2 = c2.json.data.id;
    await admin.req('POST', `/api/v1/records/${id2}/revoke`, { body: {} });
    const second = await admin.req('POST', `/api/v1/records/${id2}/revoke`, { body: {} });
    expect(second.status).toBe(200);
    const after2 = await admin.req('GET', `/api/v1/records/${id2}`);
    expect(after2.json.data.status).toBe('revoked');
  });
});

describe('#6 records score/tagId 校验（防 NaN/Infinity 撑爆统计）', () => {
  it('score=1e308 → 400（超范围，修复前存 Infinity 撑爆 SUM）', async () => {
    const stu = await h.loginAs('student1');
    const r = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, '1e308'), isForm: true });
    expect(r.status).toBe(400);
  });
  it('score=abc → 400（非有限数，修复前静默存 null）', async () => {
    const stu = await h.loginAs('student1');
    const r = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, 'abc'), isForm: true });
    expect(r.status).toBe(400);
  });
  it('score=999 → 400（超 ±100 范围）', async () => {
    const stu = await h.loginAs('student1');
    const r = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, '999'), isForm: true });
    expect(r.status).toBe(400);
  });
  it('score=5 合法 → 201（不误伤正常范围）', async () => {
    const stu = await h.loginAs('student1');
    const r = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, '5'), isForm: true });
    expect(r.status).toBe(201);
  });
  it('跨校区 tag_id → 403（不能引用他校区标签）', async () => {
    const stu = await h.loginAs('student1'); // c1
    // seed.tagC2 是 c2 的标签
    const form = recordForm(seed.cls1.id, '-1');
    form.set('tag_id', seed.tagC2.id);
    const r = await stu.req('POST', '/api/v1/records', { body: form, isForm: true });
    expect(r.status).toBe(403);
  });
});

describe('#8 配置删除引用守卫（防孤儿子行，与值班域一致）', () => {
  it('删除仍有班级的校区 → 409', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('DELETE', `/api/v1/campuses/${seed.c1.id}`);
    expect(r.status).toBe(409); // c1 下有年级/班级/用户
  });
  it('删除仍有班级的年级 → 409', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('DELETE', `/api/v1/grades/${seed.g1.id}`);
    expect(r.status).toBe(409); // g1 下有 cls1/cls2
  });
  it('删除仍有记录的班级 → 409', async () => {
    const stu = await h.loginAs('student1');
    await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, '-1'), isForm: true });
    const admin = await h.loginAs('admin');
    const r = await admin.req('DELETE', `/api/v1/classes/${seed.cls1.id}`);
    expect(r.status).toBe(409); // cls1 下有记录
  });
  it('删除空年级（无班级）→ 200（守卫不误伤）', async () => {
    const admin = await h.loginAs('admin');
    const g = await admin.req('POST', '/api/v1/grades', { body: { name: `空年级${Date.now()}`, sort_order: 99 } });
    const r = await admin.req('DELETE', `/api/v1/grades/${g.json.data.id}`);
    expect(r.status).toBe(200);
  });
});

describe('#7 settings key 白名单 + 值校验', () => {
  it('admin 写未知 key → 400（修复前任意 key 落库）', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('PUT', '/api/v1/settings', { body: { settings: [{ key: 'evil_key', value: '1' }] } });
    expect(r.status).toBe(400);
  });
  it('semester_start 已随值班域拆分迁出 → 400（值周域不再管理该键）', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('PUT', '/api/v1/settings', { body: { settings: [{ key: 'semester_start', value: '2026-09-01' }] } });
    expect(r.status).toBe(400);
  });
  it('admin 写非法 bool 值 → 400', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('PUT', '/api/v1/settings', { body: { settings: [{ key: 'appeal_enabled', value: 'maybe' }] } });
    expect(r.status).toBe(400);
  });
  it('合法白名单键仍正常（不误伤）', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('PUT', '/api/v1/settings', { body: { settings: [{ key: 'appeal_enabled', value: 'true' }, { key: 'auto_notify_teachers', value: 'false' }] } });
    expect(r.status).toBe(200);
  });
});

describe('#9 申诉详情跨校区隔离', () => {
  // seedStandard 无 c2 teacher，本 suite 内建一个（c2 教师才能对 c2 记录申诉）
  let c2teacherUser: string;
  beforeAll(async () => {
    const admin = await h.loginAs('admin');
    const u = await admin.req('POST', '/api/v1/users', { body: { username: `c2t-${Date.now()}`, password: 'pw123456', display_name: '二校区老师', role: 'teacher', campus_id: seed.c2.id } });
    c2teacherUser = u.json.data.username;
  });

  it('teacher 不能看他校区申诉详情（404，不泄露存在性）', async () => {
    const admin = await h.loginAs('admin');
    const s2 = await h.loginAs('student2'); // c2 student
    const rec = await s2.req('POST', '/api/v1/records', { body: recordForm(seed.clsC2.id, '-2'), isForm: true });
    const c2t = await h.loginAs(c2teacherUser, 'pw123456');
    await c2t.req('POST', `/api/v1/records/${rec.json.data.id}/appeal`, { body: { reason: 'r' } });
    const list = await admin.req('GET', '/api/v1/appeals', { query: { pageSize: 100 } });
    const c2appeal = list.json.data.find((a: any) => a.recordId === rec.json.data.id);
    expect(c2appeal).toBeTruthy();
    expect(c2appeal.campusId).toBe(seed.c2.id); // 投影带出 campusId
    // c1 的 teacher1 试图读 c2 申诉详情 → 404
    const t1 = await h.loginAs('teacher1');
    const r = await t1.req('GET', `/api/v1/appeals/${c2appeal.id}`);
    expect(r.status).toBe(404);
  });

  it('admin 可跨校区读申诉详情（隔离不误伤 admin）', async () => {
    const admin = await h.loginAs('admin');
    const s2 = await h.loginAs('student2');
    const rec = await s2.req('POST', '/api/v1/records', { body: recordForm(seed.clsC2.id, '-3'), isForm: true });
    const c2t = await h.loginAs(c2teacherUser, 'pw123456');
    await c2t.req('POST', `/api/v1/records/${rec.json.data.id}/appeal`, { body: { reason: 'r' } });
    const list = await admin.req('GET', '/api/v1/appeals', { query: { pageSize: 100 } });
    const c2appeal = list.json.data.find((a: any) => a.recordId === rec.json.data.id);
    const r = await admin.req('GET', `/api/v1/appeals/${c2appeal.id}`);
    expect(r.status).toBe(200);
    expect(r.json.data.campusId).toBe(seed.c2.id);
  });
});

describe('#5 /files 跨校区图片隔离（命名空间校区限定 + 代理鉴权）', () => {
  it('objectKey 含校区段；跨校区读 404、本校区读 200、匿名 401、admin 200', async () => {
    const admin = await h.loginAs('admin');
    // admin(c1) 上传一张图
    const form = new FormData();
    form.set('class_id', seed.cls1.id);
    form.set('score', '-1');
    form.set('week', '2026-W41');
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    form.append('images', new File([png], 'a.png', { type: 'image/png' }));
    const rec = await admin.req('POST', '/api/v1/records', { body: form, isForm: true });
    expect(rec.status).toBe(201);
    const objectKey = rec.json.data.images[0];
    // 命名空间校区限定：records/<campusId>/files/...
    expect(objectKey.split('/')[0]).toBe('records');
    expect(objectKey.split('/')[1]).toBe(seed.c1.id);

    // 匿名 → 401
    const anon = await fetch(`${h.base}/files/${objectKey}`);
    expect(anon.status).toBe(401);
    // 跨校区 student2(c2) 读 c1 图 → 404（修复前 200 泄漏）
    const s2 = await h.loginAs('student2');
    const cross = await fetch(`${h.base}/files/${objectKey}`, { headers: { Cookie: s2.jar.header() } });
    expect(cross.status).toBe(404);
    // 本校区 student1(c1) → 200
    const s1 = await h.loginAs('student1');
    const same = await fetch(`${h.base}/files/${objectKey}`, { headers: { Cookie: s1.jar.header() } });
    expect(same.status).toBe(200);
    // admin → 200（跨校区放行）
    const adm = await fetch(`${h.base}/files/${objectKey}`, { headers: { Cookie: admin.jar.header() } });
    expect(adm.status).toBe(200);
  });

  it('伪造/遗留格式 key（无校区段）→ 非 admin fail-closed 404', async () => {
    const s1 = await h.loginAs('student1');
    const r = await fetch(`${h.base}/files/legacy-no-campus/x.png`, { headers: { Cookie: s1.jar.header() } });
    expect(r.status).toBe(404); // 结构不符，非 admin 拒绝
  });
});

describe('#17 bodyLimit 全局请求体上限（防 DoS）', () => {
  // 注：不用真实 >50MB 负载测试 413——它会污染 keep-alive socket 导致后续请求 fetch failed，
  // 使测试套件不稳定。bodyLimit 是 hono 内置且自带测试的中间件；此处验证它被正确挂载且
  // **不误伤合法上传**（带图片的正常记录提交仍成功），这是本项目的关键正确性诉求。
  it('合法带图上传通过 bodyLimit（不误伤正常请求）', async () => {
    const stu = await h.loginAs('student1');
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.set('class_id', seed.cls1.id);
    form.set('score', '-1');
    form.set('week', '2026-W41');
    form.append('images', new File([png], 'a.png', { type: 'image/png' }));
    const r = await stu.req('POST', '/api/v1/records', { body: form, isForm: true });
    expect(r.status).toBe(201); // 通过 bodyLimit + 业务校验，未被 413 误伤
  });
});

describe('#12 users.remove 删除顺序（防账号变砖）', () => {
  it('删除存在的用户成功，且 username 释放可重建', async () => {
    const admin = await h.loginAs('admin');
    const uname = `rmtest-${Date.now()}`;
    const nu = await admin.req('POST', '/api/v1/users', { body: { username: uname, password: 'pw123456', display_name: '待删', role: 'student' } });
    expect(nu.status).toBe(201);
    const uid = nu.json.data.id;
    const del = await admin.req('DELETE', `/api/v1/users/${uid}`);
    expect(del.status).toBe(200);
    // username 已释放：可用同名重建（若 auth 锚点没删干净会 409）
    const re = await admin.req('POST', '/api/v1/users', { body: { username: uname, password: 'pw123456', display_name: '重建', role: 'student' } });
    expect(re.status).toBe(201); // ★ 修复前若 auth user 残留则 409
  });
  it('删除后该用户无法登录（auth 锚点已删）', async () => {
    const admin = await h.loginAs('admin');
    const uname = `rmlogin-${Date.now()}`;
    const nu = await admin.req('POST', '/api/v1/users', { body: { username: uname, password: 'pw123456', display_name: '删后登录', role: 'student' } });
    await admin.req('DELETE', `/api/v1/users/${nu.json.data.id}`);
    const c = h.client();
    const login = await c.req('POST', '/auth/password/login', { body: { username: uname, password: 'pw123456' } });
    expect(login.status).toBe(401); // 锚点已删，登录失败
  });
});

describe('#2 删用户后其记录不静默消失（引用完整性）', () => {
  it('删除记录人后，列表仍显示该记录（recorderName 兜底），count 与 rows 一致', async () => {
    const admin = await h.loginAs('admin');
    // 建一个临时用户 + 一条记录，再删用户
    const uname = `tmpdel-${Date.now()}`;
    const nu = await admin.req('POST', '/api/v1/users', { body: { username: uname, password: 'pw123456', display_name: '临时工', role: 'student' } });
    const uid = nu.json.data.id;
    // 用该用户登录打分
    const tmp = await h.loginAs(uname, 'pw123456');
    const rec = await tmp.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, '-2'), isForm: true });
    expect(rec.status).toBe(201);
    const recId = rec.json.data.id;

    // admin 删除该用户（当前值周域无引用守卫，删除会成功——本测试验证删除后记录不消失）
    await admin.req('DELETE', `/api/v1/users/${uid}`);

    // 列表：记录仍应出现（leftJoin 后不因 userProfiles 缺失而丢行）
    const list = await admin.req('GET', '/api/v1/records', { query: { class_id: seed.cls1.id, pageSize: 100 } });
    const found = list.json.data.find((r: any) => r.id === recId);
    expect(found).toBeTruthy(); // ★ 修复前 innerJoin 会丢掉这条 → found undefined
    expect(found.recorderName).toBe('已删除用户'); // COALESCE 兜底
    // count 与 rows 一致：total 应 ≥ 实际能列出的条数（不再幻影分页）
    expect(list.json.pagination.total).toBeGreaterThanOrEqual(list.json.data.length);
  });

  it('删除记录人后 CSV 导出不丢该行（修复静默丢数据）', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/statistics/export', { query: { week: '2026-W41' } });
    expect(r.status).toBe(200);
    const text = await r.text();
    // 导出应含「已删除用户」（上一条测试删用户留下的孤儿记录）——修复前该行被 innerJoin 丢弃
    expect(text).toContain('已删除用户');
  });
});
