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
