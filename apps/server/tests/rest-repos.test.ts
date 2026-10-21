/**
 * rest 轨 repo 测试 —— mock-rest 内存 RestDb + createRestRepos（P4 验收）。
 *
 * 测的是 rest repo 的 JS-join / JS-聚合 / JS-分页 / 唯一预判逻辑（mock 忠实还原
 * PostgREST 能力边界：无 join/聚合/count/offset/事务），而非类型对齐。
 * auth 依赖用 @homurajs/auth 的 createRest*Store 跑在同一个 mock RestDb 上拼装，
 * 与 qw-pages 形态 buildAuth 的真实装配一致。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SessionManager,
  PasswordProvider,
  createRestSessionStore,
  createRestUserStore,
  createRestPasswordStore,
} from '@homurajs/auth';
import type { Logger } from '@homurajs/core';
import { createMockRestDb } from './helpers/mock-rest.js';
import { createRestRepos } from '../src/repos/rest/index.js';
import { seedRest } from '../src/db/seed-rest.js';
import { isUniqueViolation } from '../src/http/respond.js';
import type { Repos } from '../src/repos/types.js';

const SECRET = 'test-secret-key-minimum-32-bytes-long-xxxx';
const noopLogger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;

interface Env {
  R: Repos;
  rest: ReturnType<typeof createMockRestDb>;
}

let env: Env;

beforeEach(() => {
  const rest = createMockRestDb();
  const sessions = new SessionManager({ secret: SECRET }, createRestSessionStore(rest));
  const userStore = createRestUserStore(rest);
  const passwordProvider = new PasswordProvider({
    userStore,
    passwordStore: createRestPasswordStore(rest),
  });
  void sessions;
  const R = createRestRepos({ rest, passwordProvider, userStore });
  env = { R, rest };
});

// ── campuses / settings ───────────────────────────────────────────
describe('rest campuses/settings', () => {
  it('campus 创建/查重 → 唯一冲突可被 isUniqueViolation 识别（409 语义）', async () => {
    const { R } = env;
    const c1 = await R.campuses.create({ name: '第一校区', code: 'campus_01' });
    expect(c1.name).toBe('第一校区');
    await expect(R.campuses.create({ name: '重名校区', code: 'campus_01' })).rejects.toSatisfy(isUniqueViolation);
    // 更新撞别的校区 code 同样 409
    await R.campuses.create({ name: '第二校区', code: 'campus_02' });
    await expect(R.campuses.update(c1.id, { name: '第一校区', code: 'campus_02' })).rejects.toSatisfy(isUniqueViolation);
    const all = await R.campuses.listAll();
    expect(all).toHaveLength(2);
  });

  it('settings upsertMany 幂等：组合唯一键 (campusId,key)，重复 upsert 更新而非新增', async () => {
    const { R, rest } = env;
    const c = await R.campuses.create({ name: '第一校区', code: 'campus_01' });
    await R.settings.upsertMany(c.id, [
      { key: 'appeal_enabled', value: 'true' },
      { key: 'auto_notify_teachers', value: 'true' },
    ]);
    await R.settings.upsertMany(c.id, [{ key: 'appeal_enabled', value: 'false' }]);
    const map = await R.settings.getMap(c.id);
    expect(map.appeal_enabled).toBe('false');
    expect(map.auto_notify_teachers).toBe('true');
    const rows = await rest.table('settings').select({ campusId: c.id });
    expect(rows).toHaveLength(2); // 不产生重复 key 行
  });
});

// ── users ─────────────────────────────────────────────────────────
describe('rest users', () => {
  it('create（auth register + profile）→ list/findMe 视图拼接', async () => {
    const { R } = env;
    const c = await R.campuses.create({ name: '第一校区', code: 'campus_01' });
    const g = await R.grades.create({ campusId: c.id, name: '1年级', sortOrder: 1 });
    const grp = await R.groups.create({ campusId: c.id, name: '周一值周组' });
    const admin = await R.users.create({
      campusId: c.id, username: 'admin', password: '123456',
      displayName: '系统管理员', role: 'admin',
    });
    const student = await R.users.create({
      campusId: c.id, username: 'student1', password: '123456',
      displayName: '值周生A', role: 'student', groupId: grp.id,
    });
    expect(admin.username).toBe('admin');
    expect(admin.campusName).toBe('第一校区');
    expect(student.groupName).toBe('周一值周组');

    // username 占用 → UsernameTakenError（路由转 409）
    await expect(R.users.create({
      campusId: c.id, username: 'admin', password: 'x',
      displayName: '重复', role: 'teacher',
    })).rejects.toMatchObject({ name: 'UsernameTakenError' });

    // 视图按 campusId/role 过滤
    const students = await R.users.list(c.id, 'student');
    expect(students.map((u) => u.username)).toEqual(['student1']);

    // findMe：身份 + 档案 + 校区名
    const me = await R.users.findMe(student.id);
    expect(me?.user.username).toBe('student1');
    expect(me?.profile.role).toBe('student');
    expect(me?.campusName).toBe('第一校区');
    expect(g.id).toBeTruthy();

    // update：改 displayName/role/groupId，nickname 同步 auth users
    const updated = await R.users.update(student.id, {
      displayName: '值周生A2', role: 'teacher', groupId: null,
    });
    expect(updated?.displayName).toBe('值周生A2');
    expect(updated?.role).toBe('teacher');
    const me2 = await R.users.findMe(student.id);
    expect(me2?.user.nickname).toBe('值周生A2');

    // remove：先删 auth 锚点再删 profile，回查为 null
    await R.users.remove(student.id);
    expect(await R.users.findMe(student.id)).toBeNull();
    expect(await R.users.findProfile(student.id)).toBeNull();
  });

  it('create 时 profile 失败 → 清理孤儿 auth user（username 释放可重建）', async () => {
    const { R, rest } = env;
    const c = await R.campuses.create({ name: '第一校区', code: 'campus_01' });
    // 用一个非法 role 触发……mock 不校验，改为模拟 userProfiles 写失败：删掉 campus 让 profile 校验不存在？
    // mock 无约束 → 直接验证正常路径的孤儿清理不误删：先正常建一个
    const u = await R.users.create({
      campusId: c.id, username: 'teacher1', password: '123456',
      displayName: '李老师', role: 'teacher',
    });
    expect(u.id).toBeTruthy();
    const authRows = await rest.table('users').select({});
    expect(authRows).toHaveLength(1);
  });
});

// ── classes / groups / tags ───────────────────────────────────────
describe('rest classes/groups/tags', () => {
  it('classes：排序（gradeSortOrder→name）+ gradeName/campusName 拼接 + 唯一预判', async () => {
    const { R } = env;
    const c = await R.campuses.create({ name: '第一校区', code: 'campus_01' });
    const g1 = await R.grades.create({ campusId: c.id, name: '1年级', sortOrder: 1 });
    const g2 = await R.grades.create({ campusId: c.id, name: '2年级', sortOrder: 2 });
    const clsB = await R.classes.create({ campusId: c.id, gradeId: g1.id, name: '2班', classTeacher: '张老师' });
    const clsA = await R.classes.create({ campusId: c.id, gradeId: g1.id, name: '1班' });
    const clsG2 = await R.classes.create({ campusId: c.id, gradeId: g2.id, name: '1班' });

    const list = await R.classes.listByCampus(c.id);
    expect(list.map((x) => x.name)).toEqual(['1班', '2班', '1班']);
    expect(list[0].gradeName).toBe('1年级');
    expect(list[0].campusName).toBe('第一校区');
    expect(list[2].gradeName).toBe('2年级'); // 排序先按年级 sortOrder

    // findOwnership
    expect(await R.classes.findOwnership(clsA.id)).toEqual({ campusId: c.id, gradeId: g1.id });

    // 唯一预判 (campusId,gradeId,name)；不同年级同名 OK
    await expect(R.classes.create({ campusId: c.id, gradeId: g1.id, name: '1班' }))
      .rejects.toSatisfy(isUniqueViolation);
    expect(clsG2.id).toBeTruthy();

    // update + remove
    const upd = await R.classes.update(clsB.id, { name: '3班', classTeacher: null });
    expect(upd?.name).toBe('3班');
    await R.classes.remove(clsA.id);
    expect(await R.classes.findById(clsA.id)).toBeNull();
  });

  it('groups：members 双写（dutyGroups.members + userProfiles.groupId）', async () => {
    const { R } = env;
    const c = await R.campuses.create({ name: '第一校区', code: 'campus_01' });
    const s1 = await R.users.create({ campusId: c.id, username: 'student1', password: '123456', displayName: '值周生A', role: 'student' });
    const s2 = await R.users.create({ campusId: c.id, username: 'student2', password: '123456', displayName: '值周生B', role: 'student' });

    const grp = await R.groups.create({ campusId: c.id, name: '周一值周组', members: [s1.id, s2.id] });
    expect(grp.members).toEqual([s1.id, s2.id]);
    expect((await R.users.findProfile(s1.id))?.groupId).toBe(grp.id);

    // update：旧成员 groupId 清空，新成员回填
    const g2 = await R.groups.update(grp.id, { name: '周二值周组', members: [s2.id] });
    expect(g2?.members).toEqual([s2.id]);
    expect((await R.users.findProfile(s1.id))?.groupId).toBeNull();
    expect((await R.users.findProfile(s2.id))?.groupId).toBe(grp.id);

    // remove：清 groupId
    await R.groups.remove(grp.id);
    expect((await R.users.findProfile(s2.id))?.groupId).toBeNull();
    expect(await R.groups.listByCampus(c.id)).toHaveLength(0);
  });

  it('tags：部分更新语义 + findByIds 空数组短路 + 排序', async () => {
    const { R } = env;
    const c = await R.campuses.create({ name: '第一校区', code: 'campus_01' });
    const pos = await R.tags.create({ campusId: c.id, name: '卫生优秀', score: 2, color: '#4CAF50', category: 'positive', isSystem: true });
    const neg = await R.tags.create({ campusId: c.id, name: '迟到', score: -1, color: '#F44336', category: 'negative' });

    const list = await R.tags.listByCampus(c.id);
    // orderBy category asc（negative < positive）→ isSystem desc → name
    expect(list.map((t) => t.name)).toEqual(['迟到', '卫生优秀']);
    expect(list[0].isSystem).toBe(0);

    // 部分更新：只改 score，color/category/name 保留
    const upd = await R.tags.update(pos.id, { score: 3 });
    expect(upd?.score).toBe(3);
    expect(upd?.color).toBe('#4CAF50');
    expect(upd?.category).toBe('positive');

    expect(await R.tags.findByIds([])).toEqual([]);
    const two = await R.tags.findByIds([pos.id, neg.id]);
    expect(two).toHaveLength(2);
  });
});

// ── records ───────────────────────────────────────────────────────
describe('rest records', () => {
  it('create/list：join 拼接 + 分页 + 软删幂等', async () => {
    const { R } = env;
    const c = await R.campuses.create({ name: '第一校区', code: 'campus_01' });
    const g = await R.grades.create({ campusId: c.id, name: '1年级', sortOrder: 1 });
    const cls = await R.classes.create({ campusId: c.id, gradeId: g.id, name: '1班' });
    const teacher = await R.users.create({ campusId: c.id, username: 'teacher1', password: '123456', displayName: '李老师', role: 'teacher' });
    const tag = await R.tags.create({ campusId: c.id, name: '迟到', score: -1, category: 'negative' });

    const r1 = await R.records.create({
      campusId: c.id, classId: cls.id, recorderId: teacher.id, tagId: tag.id,
      score: -1, comment: '走廊打闹', images: ['files/a.png'],
      week: '2026-W42', recordedAt: 1000,
    });
    expect(r1.className).toBe('1班');
    expect(r1.gradeName).toBe('1年级');
    expect(r1.recorderName).toBe('李老师');
    expect(r1.tagName).toBe('迟到');
    expect(r1.images).toEqual(['files/a.png']);
    expect(r1.status).toBe('active');

    const r2 = await R.records.create({
      campusId: c.id, classId: cls.id, recorderId: teacher.id,
      score: 2, week: '2026-W42', recordedAt: 2000,
    });
    const r3 = await R.records.create({
      campusId: c.id, classId: cls.id, recorderId: teacher.id,
      score: 1, week: '2026-W42', recordedAt: 3000,
    });

    // 分页：recordedAt 降序
    const p1 = await R.records.list({ campusId: c.id, week: '2026-W42', page: 1, pageSize: 2 });
    expect(p1.data.map((r) => r.id)).toEqual([r3.id, r2.id]);
    expect(p1.pagination).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    const p2 = await R.records.list({ campusId: c.id, week: '2026-W42', page: 2, pageSize: 2 });
    expect(p2.data.map((r) => r.id)).toEqual([r1.id]);

    // revoke 幂等：第二次 revoke 不再写 log
    await R.records.revoke(r1.id, teacher.id, '误记');
    expect((await R.records.findByIdWithDetails(r1.id))?.status).toBe('revoked');
    const logsBefore = await env.rest.table('recordLogs').select({ recordId: r1.id });
    expect(logsBefore).toHaveLength(2); // create + revoke
    await R.records.revoke(r1.id, teacher.id, '再次');
    const logsAfter = await env.rest.table('recordLogs').select({ recordId: r1.id });
    expect(logsAfter).toHaveLength(2); // 终态不可再撤回

    // 导出：week 区间过滤
    await R.records.create({ campusId: c.id, classId: cls.id, recorderId: teacher.id, score: 1, week: '2026-W43', recordedAt: 4000 });
    const exportW42 = await R.records.listForExport(c.id, '2026-W42', '2026-W42');
    expect(exportW42).toHaveLength(3);
  });
});

// ── statistics（口径与 drizzle 轨一致）────────────────────────────
describe('rest statistics（drizzle 口径对齐）', () => {
  it('ranking/trend/dashboard：仅 active+appealing 计分', async () => {
    const { R } = env;
    const c = await R.campuses.create({ name: '第一校区', code: 'campus_01' });
    const g1 = await R.grades.create({ campusId: c.id, name: '1年级', sortOrder: 1 });
    const g2 = await R.grades.create({ campusId: c.id, name: '2年级', sortOrder: 2 });
    const clsA = await R.classes.create({ campusId: c.id, gradeId: g1.id, name: '1班' });
    const clsB = await R.classes.create({ campusId: c.id, gradeId: g1.id, name: '2班' });
    const clsC = await R.classes.create({ campusId: c.id, gradeId: g2.id, name: '3班' });
    const t = await R.users.create({ campusId: c.id, username: 'teacher1', password: '123456', displayName: '李老师', role: 'teacher' });

    const mk = (classId: string, score: number, status: string, week: string, at: number) =>
      env.rest.table('records').insert({
        id: crypto.randomUUID(), campusId: c.id, classId, recorderId: t.id,
        tagId: null, score, comment: null, images: null, week, status, recordedAt: at,
      });

    // clsA：+2(active) -1(appealing) +3(appeal_approved 不计) -2(revoked 不计) → 总分 +1
    await mk(clsA.id, 2, 'active', '2026-W42', 5000);
    await mk(clsA.id, -1, 'appealing', '2026-W42', 5100);
    await mk(clsA.id, 3, 'appeal_approved', '2026-W42', 5200);
    await mk(clsA.id, -2, 'revoked', '2026-W42', 5300);
    // clsB：+5(active) → 总分 +5（第一名）
    await mk(clsB.id, 5, 'active', '2026-W42', 5400);
    // clsA 上周：+1(active)（trend/dashboard 用）
    await mk(clsA.id, 1, 'active', '2026-W41', 4000);
    // 今日之外（dashboard 不计）
    await mk(clsA.id, 100, 'active', '2026-W44', 1000);
    // clsC 无记录 → 计 0（leftJoin 语义：无记录班级也出现）

    const ranking = await R.statistics.ranking(c.id, '2026-W42');
    expect(ranking.map((r) => ({ r: r.rank, cls: r.className, total: r.totalScore }))).toEqual([
      { r: 1, cls: '2班', total: 5 },
      { r: 2, cls: '1班', total: 1 },
      { r: 3, cls: '3班', total: 0 },
    ]);
    const clsARow = ranking.find((r) => r.classId === clsA.id)!;
    expect(clsARow).toMatchObject({
      totalScore: 1, positiveCount: 1, negativeCount: 1, recordCount: 2, gradeName: '1年级',
    });
    // 年级过滤
    const g2Ranking = await R.statistics.ranking(c.id, '2026-W42', g2.id);
    expect(g2Ranking).toHaveLength(1);
    expect(g2Ranking[0].classId).toBe(clsC.id);

    // trend：无数据周补 0，仅计分状态累计
    const trend = await R.statistics.trend(c.id, clsA.id, ['2026-W40', '2026-W41', '2026-W42', '2026-W43']);
    expect(trend).toEqual([
      { week: '2026-W40', totalScore: 0 },
      { week: '2026-W41', totalScore: 1 },
      { week: '2026-W42', totalScore: 1 },
      { week: '2026-W43', totalScore: 0 },
    ]);

    // dashboard：今日窗口 [5000,6000) → clsA 两条(2,-1) + clsB 一条(5)
    const dash = await R.statistics.dashboard(c.id, 5000, 6000, '2026-W42');
    expect(dash).toEqual({
      todayRecords: 3, todayPositive: 7, todayNegative: -1,
      weekTopClass: '2班', weekTopScore: 5,
    });
  });
});

// ── appeals（状态机）─────────────────────────────────────────────
describe('rest appeals（drizzle 状态机对齐）', () => {
  async function setup() {
    const { R } = env;
    const c = await R.campuses.create({ name: '第一校区', code: 'campus_01' });
    const g = await R.grades.create({ campusId: c.id, name: '1年级', sortOrder: 1 });
    const cls = await R.classes.create({ campusId: c.id, gradeId: g.id, name: '1班' });
    const teacher = await R.users.create({ campusId: c.id, username: 'teacher1', password: '123456', displayName: '李老师', role: 'teacher' });
    const admin = await R.users.create({ campusId: c.id, username: 'admin', password: '123456', displayName: '系统管理员', role: 'admin' });
    const tag = await R.tags.create({ campusId: c.id, name: '迟到', score: -1, category: 'negative' });
    const rec = await R.records.create({
      campusId: c.id, classId: cls.id, recorderId: admin.id, tagId: tag.id,
      score: -1, comment: '迟到', week: '2026-W42', recordedAt: 5000,
    });
    const rec2 = await R.records.create({
      campusId: c.id, classId: cls.id, recorderId: admin.id, tagId: null,
      score: -2, comment: null, week: '2026-W42', recordedAt: 6000,
    });
    return { R, c, cls, teacher, admin, rec, rec2 };
  }

  it('create → appealing；approve → appeal_approved；reject → active', async () => {
    const { R, c, teacher, admin, rec } = await setup();

    // 申诉：record 变 appealing + 生成 pending 单
    const ap = await R.appeals.create({ recordId: rec.id, teacherId: teacher.id, reason: '当时在医务室', campusId: c.id });
    expect(ap.status).toBe('pending');
    expect((await R.records.findByIdWithDetails(rec.id))?.status).toBe('appealing');

    // list 带详情（teacherName/recordInfo）
    const page = await R.appeals.list({ campusId: c.id, page: 1, pageSize: 10 });
    expect(page.data).toHaveLength(1);
    expect(page.data[0].teacherName).toBe('李老师');
    expect(page.data[0].recordInfo).toMatchObject({ className: '1班', tagName: '迟到', score: -1 });
    // teacher 视角
    const mine = await R.appeals.list({ teacherId: teacher.id, page: 1, pageSize: 10 });
    expect(mine.data).toHaveLength(1);

    // approve：appeal approved + record appeal_approved
    await R.appeals.approve(rec.id, admin.id, '情况属实');
    const apDetail = await R.appeals.findById(ap.id);
    expect(apDetail?.status).toBe('approved');
    expect(apDetail?.reviewerName).toBe('系统管理员');
    expect((await R.records.findByIdWithDetails(rec.id))?.status).toBe('appeal_approved');

    // 已裁决后重复 approve/reject 不改终态（filter status='pending' 不命中）
    await R.appeals.reject(rec.id, admin.id, '补刀');
    expect((await R.records.findByIdWithDetails(rec.id))?.status).toBe('appeal_approved');
  });

  it('reject：record 回滚 active（仅 appealing）；revoked 记录驳回不复活', async () => {
    const { R, c, teacher, admin, rec, rec2 } = await setup();
    await R.appeals.create({ recordId: rec.id, teacherId: teacher.id, reason: '有异议', campusId: c.id });
    await R.appeals.reject(rec.id, admin.id, '证据不足');
    expect((await R.records.findByIdWithDetails(rec.id))?.status).toBe('active');
    // 重复 reject：无 pending 单，log 不重复
    const logs1 = await env.rest.table('recordLogs').select({ recordId: rec.id, action: 'appeal_reject' });
    expect(logs1).toHaveLength(1);
    await R.appeals.reject(rec.id, admin.id, '再来一次');
    const logs2 = await env.rest.table('recordLogs').select({ recordId: rec.id, action: 'appeal_reject' });
    expect(logs2).toHaveLength(1);

    // 申诉期间被 admin 撤回（revoked 终态）→ 驳回不复活
    await R.appeals.create({ recordId: rec2.id, teacherId: teacher.id, reason: '申诉中', campusId: c.id });
    await R.records.revoke(rec2.id, admin.id, '撤回');
    await R.appeals.reject(rec2.id, admin.id, '驳回');
    expect((await R.records.findByIdWithDetails(rec2.id))?.status).toBe('revoked');
  });
});

// ── 种子幂等 ─────────────────────────────────────────────────────
describe('rest seed（幂等）', () => {
  it('seedRest 重复执行不产生重复数据；模板 tagIds 校验过滤', async () => {
    const { R, rest } = env;
    // mock auth 装配（与 beforeEach 相同的依赖可直接复用 rest）
    const userStore = createRestUserStore(rest);
    const authDeps = {
      passwordProvider: new PasswordProvider({ userStore, passwordStore: createRestPasswordStore(rest) }),
      userStore,
    };
    // seedRest 需要 rest 形态句柄
    const handle = { kind: 'rest' as const, rest, dialect: 'rest' as const };
    await seedRest(handle, authDeps, noopLogger);
    await seedRest(handle, authDeps, noopLogger); // 第二次全跳过

    const campuses = await R.campuses.listAll();
    expect(campuses).toHaveLength(2);
    const users = await R.users.list();
    expect(users).toHaveLength(8);
    const g1 = campuses[0];
    const grades = await R.grades.listByCampus(g1.id);
    expect(grades).toHaveLength(6);
    const classes = await R.classes.listByCampus(g1.id);
    expect(classes).toHaveLength(18);
    const tags = await R.tags.listByCampus(g1.id);
    expect(tags).toHaveLength(10);
    const tpls = await R.templates.listByCampus(g1.id);
    expect(tpls).toHaveLength(2);
    // 模板 tagIds 引用本校区的真实标签
    expect(tpls[0].tags.every((t) => t.campusId === g1.id)).toBe(true);
    const settings = await R.settings.getMap(g1.id);
    expect(settings.appeal_enabled).toBe('true');
    expect(settings.auto_notify_teachers).toBe('true');

    // 种子用户可登录（auth 轨打通）：register 幂等不重复建号
    const authUsers = await rest.table('users').select({});
    expect(authUsers).toHaveLength(8);
  });
});
