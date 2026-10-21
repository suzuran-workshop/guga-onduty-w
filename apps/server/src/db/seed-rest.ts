/**
 * rest 轨种子数据（qw-pages / PostgREST）—— 幂等版 seed。
 *
 * 与 drizzle 轨 seed.ts 同构（2 校区 × 6 年级 × 3 班 + 8 用户 + 标签 + 模板 + 设置 + 2 小组），
 * 差异：
 *  - 逐条幂等（存在即跳过），支持重复启动：campuses 按 code、grades/classes 按 (campusId,name)、
 *    users 按 username、groups/tags/templates 按 (campusId,name)、settings 走 upsertMany 天然幂等。
 *  - 凭据：密码读 SEED_PASSWORD（缺省 123456，与 AGENTS.md 契约一致）；其余连接凭据
 *    由平台注入的 SUPABASE_URL/ANON_KEY（openDatabase 内消费），此处不触碰。
 *  - 无事务：逐条 best-effort；中途失败重启可续（幂等跳过已建项）。
 *
 * 由 bootstrap.ts 在 rest 形态时调用（drizzle 轨接线保持 seed.ts 现状）。
 */
import type { Logger } from '@homurajs/core';
import type { PasswordProvider, UserStore } from '@homurajs/auth';
import type { RestHandle } from './client.js';

export interface SeedRestAuthDeps {
  passwordProvider: PasswordProvider;
  userStore: UserStore;
}

export async function seedRest(handle: RestHandle, auth: SeedRestAuthDeps, logger: Logger): Promise<void> {
  const rest = handle.rest;
  const campusesT = rest.table<any>('campuses');
  const gradesT = rest.table<any>('grades');
  const classesT = rest.table<any>('classes');
  const userProfilesT = rest.table<any>('userProfiles');
  const dutyGroupsT = rest.table<any>('dutyGroups');
  const tagsT = rest.table<any>('tags');
  const templatesT = rest.table<any>('templates');
  const settingsT = rest.table<any>('settings');
  const uid = () => crypto.randomUUID();
  const PW = process.env.SEED_PASSWORD || '123456';

  // ── 校区（按 code 幂等）──
  async function ensureCampus(name: string, code: string): Promise<any> {
    const found = await campusesT.select({ code }, { limit: 1 });
    if (found[0]) return found[0];
    const rows = await campusesT.insert({ id: uid(), name, code });
    logger.info('seed-rest: 校区已创建', { code });
    return rows[0];
  }

  const c1 = await ensureCampus('第一校区', 'campus_01');
  const c2 = await ensureCampus('第二校区', 'campus_02');

  // ── 年级（每校区 6 个，按 (campusId,name) 幂等）──
  async function ensureGrade(campusId: string, name: string, sortOrder: number): Promise<any> {
    const found = await gradesT.select({ campusId, name }, { limit: 1 });
    if (found[0]) return found[0];
    const rows = await gradesT.insert({ id: uid(), campusId, name, sortOrder });
    return rows[0];
  }

  const gradesByCampus: Record<string, string[]> = { [c1.id]: [], [c2.id]: [] };
  for (const campus of [c1, c2]) {
    for (let g = 1; g <= 6; g++) {
      const grade = await ensureGrade(campus.id, `${g}年级`, g);
      gradesByCampus[campus.id].push(grade.id);
    }
  }

  // ── 班级（每校区每年级 3 个）──
  for (const campus of [c1, c2]) {
    const gradeIds = gradesByCampus[campus.id];
    for (let gi = 0; gi < gradeIds.length; gi++) {
      for (let c = 1; c <= 3; c++) {
        const name = `${c}班`;
        const found = await classesT.select(
          { campusId: campus.id, gradeId: gradeIds[gi], name }, { limit: 1 },
        );
        if (found[0]) continue;
        await classesT.insert({
          id: uid(),
          campusId: campus.id,
          gradeId: gradeIds[gi],
          name,
          classTeacher: `张老师${campus.code.slice(-2)}-${gi + 1}-${c}`,
        });
      }
    }
  }

  // ── 用户（auth register + profile；按 username 幂等）──
  async function ensureUser(input: {
    campusId: string; username: string; displayName: string;
    role: 'admin' | 'teacher' | 'student';
  }): Promise<any> {
    // username 幂等锚点：auth users 表查占用（profile 已在则直接返回）
    const usersT = rest.table<any>('users');
    const uFound = await usersT.select({ username: input.username }, { limit: 1 });
    if (uFound[0]) {
      const pFound = await userProfilesT.select({ userId: uFound[0].id }, { limit: 1 });
      if (pFound[0]) return pFound[0];
    }
    const localUser = await auth.passwordProvider.register({
      username: input.username, password: PW, nickname: input.displayName,
    });
    const rows = await userProfilesT.insert({
      userId: localUser.id,
      campusId: input.campusId,
      displayName: input.displayName,
      role: input.role,
      groupId: null,
    });
    return rows[0];
  }

  const admin = await ensureUser({ campusId: c1.id, username: 'admin', displayName: '系统管理员', role: 'admin' });
  const student1 = await ensureUser({ campusId: c1.id, username: 'teacher1', displayName: '李老师', role: 'teacher' });
  await ensureUser({ campusId: c1.id, username: 'teacher2', displayName: '王老师', role: 'teacher' });
  const studentA = await ensureUser({ campusId: c1.id, username: 'student1', displayName: '值周生A', role: 'student' });
  const studentB = await ensureUser({ campusId: c1.id, username: 'student2', displayName: '值周生B', role: 'student' });
  await ensureUser({ campusId: c2.id, username: 'admin2', displayName: '二校区管理员', role: 'admin' });
  await ensureUser({ campusId: c2.id, username: 'teacher3', displayName: '赵老师', role: 'teacher' });
  const studentC = await ensureUser({ campusId: c2.id, username: 'student3', displayName: '值周生C', role: 'student' });

  // ── 值周小组（成员回填 groupId；按 (campusId,name) 幂等）──
  async function ensureGroup(campusId: string, name: string, members: string[]): Promise<void> {
    const found = await dutyGroupsT.select({ campusId, name }, { limit: 1 });
    if (found[0]) return;
    const rows = await dutyGroupsT.insert({
      id: uid(), campusId, name, members: members.length > 0 ? members : null,
    });
    if (members.length > 0) {
      await userProfilesT.update({ groupId: rows[0].id }, { userId: members });
    }
  }

  await ensureGroup(c1.id, '周一值周组', [studentA.userId, studentB.userId]);
  await ensureGroup(c2.id, '周一值周组', [studentC.userId]);

  // ── 标签（按 (campusId,name) 幂等）──
  const c1Tags: { name: string; score: number; color: string; category: 'positive' | 'negative' }[] = [
    { name: '卫生优秀', score: 2, color: '#4CAF50', category: 'positive' },
    { name: '纪律优秀', score: 2, color: '#2196F3', category: 'positive' },
    { name: '好人好事', score: 3, color: '#FF9800', category: 'positive' },
    { name: '两操整齐', score: 1, color: '#9C27B0', category: 'positive' },
    { name: '迟到', score: -1, color: '#F44336', category: 'negative' },
    { name: '未佩戴红领巾', score: -1, color: '#FF5722', category: 'negative' },
    { name: '卫生差', score: -2, color: '#795548', category: 'negative' },
    { name: '课间追逐打闹', score: -2, color: '#E91E63', category: 'negative' },
    { name: '眼保健操不认真', score: -1, color: '#607D8B', category: 'negative' },
    { name: '放学路队不齐', score: -1, color: '#FFC107', category: 'negative' },
  ];
  const c1Created: Record<string, string> = {};
  for (const t of c1Tags) {
    const found = await tagsT.select({ campusId: c1.id, name: t.name }, { limit: 1 });
    if (found[0]) { c1Created[t.name] = found[0].id; continue; }
    const rows = await tagsT.insert({
      id: uid(), campusId: c1.id, name: t.name, score: t.score,
      color: t.color, category: t.category, isSystem: 1,
    });
    c1Created[t.name] = rows[0].id;
  }
  const c2Tags = [
    { name: '卫生优秀', score: 2, color: '#4CAF50', category: 'positive' as const },
    { name: '纪律优秀', score: 2, color: '#2196F3', category: 'positive' as const },
    { name: '好人好事', score: 3, color: '#FF9800', category: 'positive' as const },
    { name: '迟到', score: -1, color: '#F44336', category: 'negative' as const },
    { name: '未佩戴红领巾', score: -1, color: '#FF5722', category: 'negative' as const },
    { name: '卫生差', score: -2, color: '#795548', category: 'negative' as const },
    { name: '课间追逐打闹', score: -2, color: '#E91E63', category: 'negative' as const },
  ];
  for (const t of c2Tags) {
    const found = await tagsT.select({ campusId: c2.id, name: t.name }, { limit: 1 });
    if (found[0]) continue;
    await tagsT.insert({
      id: uid(), campusId: c2.id, name: t.name, score: t.score,
      color: t.color, category: t.category, isSystem: 1,
    });
  }

  // ── 模板（引用标签 uuid）──
  const tpl1 = { campusId: c1.id, name: '晨检模板', tagIds: [c1Created['迟到'], c1Created['未佩戴红领巾'], c1Created['卫生优秀']].filter(Boolean) };
  const tpl2 = { campusId: c1.id, name: '课间操检查模板', tagIds: [c1Created['两操整齐'], c1Created['课间追逐打闹']].filter(Boolean) };
  for (const tpl of [tpl1, tpl2]) {
    const found = await templatesT.select({ campusId: tpl.campusId, name: tpl.name }, { limit: 1 });
    if (found[0]) continue;
    await templatesT.insert({ id: uid(), ...tpl });
  }

  // ── 设置（upsert 天然幂等）──
  async function upsertSetting(campusId: string, key: string, value: string): Promise<void> {
    const found = await settingsT.select({ campusId, key }, { limit: 1 });
    if (found[0]) {
      if (found[0].value !== value) await settingsT.update({ value }, { id: found[0].id });
      return;
    }
    await settingsT.insert({ id: uid(), campusId, key, value });
  }

  await upsertSetting(c1.id, 'appeal_enabled', 'true');
  await upsertSetting(c1.id, 'auto_notify_teachers', 'true');
  await upsertSetting(c2.id, 'appeal_enabled', 'true');

  logger.info('seed-rest: 种子数据就绪', { adminUserId: admin.userId, passwordLength: PW.length });
}
