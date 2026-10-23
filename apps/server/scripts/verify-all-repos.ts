/**
 * P3 全量 repo 验收 —— 经真实装配链（openDatabase → buildAuth → createRepos）
 * 跑通全部 13 个 repo 的每个方法，在 sqlite 上端到端验证。
 *
 * 这同时验证：装配接线 + auth 集成（PasswordProvider/UserStore）+ 事务 + join + 幂等 + N+1 修复。
 * 运行：pnpm tsx scripts/verify-all-repos.ts
 */
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, migrate, closeDatabase } from '../src/db/client.js';
import { buildAuth } from '../src/auth/build.js';
import { createRepos } from '../src/repos/index.js';
import type { AppConfig } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB = join(__dirname, '../data/verify-all.db');

// ── 伪造 config（验收用，不走 loadConfig 的 env 校验）──
const cfg = {
  get: (k: string) =>
    ({
      dbDialect: 'sqlite',
      dbPath: DB,
      sessionSecret: 'x'.repeat(40),
      storageRoot: join(__dirname, '../data/verify-files'),
    } as any)[k],
} as unknown as AppConfig;

let passed = 0;
function ok(label: string, extra?: unknown) {
  passed++;
  console.log(`  ✅ ${label}`, extra !== undefined ? JSON.stringify(extra) : '');
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log('\n[P3] 全量 repo 验收（sqlite，经 createRepos 装配）\n');
  rmSync(DB, { force: true }); rmSync(DB + '-wal', { force: true }); rmSync(DB + '-shm', { force: true });
  mkdirSync(dirname(DB), { recursive: true });

  const handle = await openDatabase(cfg);
  await migrate(handle);
  const auth = buildAuth(handle, cfg, { secure: false, loginPath: '/login' });
  const R = createRepos(handle, { passwordProvider: auth.passwordProvider, userStore: auth.userStore });

  // ═══════════ campuses ═══════════
  console.log('[campuses]');
  const c1 = await R.campuses.create({ name: '第一校区', code: 'campus_01' });
  const c2 = await R.campuses.create({ name: '第二校区', code: 'campus_02' });
  ok('create 返回 uuid + 字段', { id: c1.id.slice(0, 8), name: c1.name });
  assert(typeof c1.id === 'string' && c1.id.length === 36, 'campus id 应为 uuid');
  const allCampus = await R.campuses.listAll();
  assert(allCampus.length === 2, '应有 2 个校区');
  const oneCampus = await R.campuses.listForCampus(c1.id);
  assert(oneCampus.length === 1 && oneCampus[0].id === c1.id, 'listForCampus 应只返回自己');
  const upd = await R.campuses.update(c1.id, { name: '第一校区(改)', code: 'campus_01' });
  assert(upd?.name === '第一校区(改)', 'update 生效');
  ok('listAll/listForCampus/update');

  // ═══════════ grades ═══════════
  console.log('[grades]');
  const g1 = await R.grades.create({ campusId: c1.id, name: '1年级', sortOrder: 1 });
  const g2 = await R.grades.create({ campusId: c1.id, name: '2年级', sortOrder: 2 });
  const grades = await R.grades.listByCampus(c1.id);
  ok('listByCampus 带 campusName + 排序', { n: grades.length, first: grades[0].name, campusName: grades[0].campusName });
  assert(grades.length === 2 && grades[0].name === '1年级', '应按 sortOrder 排序');
  assert(grades[0].campusName === '第一校区(改)', 'join campusName 生效');
  await R.grades.update(g2.id, { name: '2年级(改)', sortOrder: 5 });
  const g2r = await R.grades.findById(g2.id);
  assert(g2r?.sortOrder === 5, 'grade update 生效');
  ok('create/update/findById');

  // ═══════════ classes ═══════════
  console.log('[classes]');
  const cls1 = await R.classes.create({ campusId: c1.id, gradeId: g1.id, name: '1班', classTeacher: '张老师' });
  const cls2 = await R.classes.create({ campusId: c1.id, gradeId: g1.id, name: '2班' });
  await R.classes.create({ campusId: c1.id, gradeId: g2.id, name: '3班' });
  const classes = await R.classes.listByCampus(c1.id);
  ok('listByCampus join gradeName', { n: classes.length, first: classes[0].name, gradeName: classes[0].gradeName });
  assert(classes.length === 3, '应有 3 个班');
  const byGrade = await R.classes.listByCampus(c1.id, g2.id);
  assert(byGrade.length === 1 && byGrade[0].name === '3班', 'gradeId 过滤生效');
  const own = await R.classes.findOwnership(cls1.id);
  assert(own?.campusId === c1.id && own?.gradeId === g1.id, 'findOwnership 生效');
  ok('findOwnership');

  // ═══════════ users（auth + profile）═══════════
  console.log('[users]');
  const admin = await R.users.create({ campusId: c1.id, username: 'admin', password: '123456', displayName: '系统管理员', role: 'admin' });
  const teacher = await R.users.create({ campusId: c1.id, username: 'teacher1', password: '123456', displayName: '李老师', role: 'teacher' });
  const student = await R.users.create({ campusId: c1.id, username: 'student1', password: '123456', displayName: '值周生A', role: 'student' });
  const student2 = await R.users.create({ campusId: c2.id, username: 'student2', password: '123456', displayName: '值周生B', role: 'student' });
  ok('create（auth register + profile）', { admin: admin.username, role: admin.role, campusName: admin.campusName });
  assert(admin.role === 'admin' && admin.campusName === '第一校区(改)', 'admin profile 正确');
  // 密码可验证（scrypt）
  const verified = await auth.passwordProvider.verify('admin', '123456');
  assert(verified !== null && verified.id === admin.id, 'scrypt 密码校验通过');
  const wrongPw = await auth.passwordProvider.verify('admin', 'wrong');
  assert(wrongPw === null, '错误密码应返回 null');
  ok('scrypt 密码校验（对/错）');
  const userList = await R.users.list(c1.id);
  assert(userList.length === 3, 'c1 应有 3 用户');
  const students = await R.users.list(c1.id, 'student');
  assert(students.length === 1 && students[0].username === 'student1', 'role 过滤生效');
  ok('list（campus + role 过滤）');
  const me = await R.users.findMe(teacher.id);
  assert(me?.user.username === 'teacher1' && me.profile.role === 'teacher' && me.campusName === '第一校区(改)', 'findMe 聚合正确');
  ok('findMe（身份+档案+校区名）');
  const prof = await R.users.findProfile(student.id);
  assert(prof?.role === 'student', 'findProfile 生效');

  // ═══════════ groups（成员双写事务）═══════════
  console.log('[groups]');
  const grp = await R.groups.create({ campusId: c1.id, name: '周一值周组', members: [student.id] });
  ok('create + 成员回填', { name: grp.name, members: grp.members });
  assert(Array.isArray(grp.members) && grp.members[0] === student.id, 'members JSON 反序列化');
  const profAfterGroup = await R.users.findProfile(student.id);
  assert(profAfterGroup?.groupId === grp.id, '成员 userProfiles.groupId 已回填');
  ok('成员 groupId 双写一致');
  // update：换成员
  await R.groups.update(grp.id, { name: '周一值周组(改)', members: [student.id, teacher.id] });
  const teacherProf = await R.users.findProfile(teacher.id);
  assert(teacherProf?.groupId === grp.id, 'update 后新成员回填');
  const grpList = await R.groups.listByCampus(c1.id);
  assert(grpList.length === 1 && grpList[0].name === '周一值周组(改)', 'group update 生效');
  ok('update（换成员，事务一致）');

  // ═══════════ tags ═══════════
  console.log('[tags]');
  const tNeg = await R.tags.create({ campusId: c1.id, name: '卫生差', score: -2, color: '#795548', category: 'negative', isSystem: true });
  const tPos = await R.tags.create({ campusId: c1.id, name: '卫生优秀', score: 2, color: '#4CAF50', category: 'positive', isSystem: true });
  const tNeu = await R.tags.create({ campusId: c1.id, name: '一般', score: 0, category: 'neutral' });
  const tagList = await R.tags.listByCampus(c1.id);
  ok('create + listByCampus', { n: tagList.length, first: tagList[0].name });
  assert(tagList.length === 3, '应有 3 标签');
  const negOnly = await R.tags.listByCampus(c1.id, 'negative');
  assert(negOnly.length === 1 && negOnly[0].name === '卫生差', 'category 过滤生效');
  // 部分更新（修复静默重置 bug）：只改 name，score/color/category 保持
  await R.tags.update(tNeg.id, { name: '卫生差(改)' });
  const tNegAfter = await R.tags.findById(tNeg.id);
  assert(tNegAfter?.name === '卫生差(改)' && tNegAfter.score === -2 && tNegAfter.category === 'negative', '部分更新不重置其他字段');
  ok('部分更新（修复静默重置 bug）');
  const byIds = await R.tags.findByIds([tNeg.id, tPos.id]);
  assert(byIds.length === 2, 'findByIds 批量');
  assert((await R.tags.findByIds([])).length === 0, 'findByIds 空数组安全');
  ok('findByIds（含空数组）');

  // ═══════════ templates（N+1 修复 + 导入事务）═══════════
  console.log('[templates]');
  const tpl = await R.templates.create({ campusId: c1.id, name: '晨检模板', tagIds: [tNeg.id, tPos.id] });
  const tplList = await R.templates.listByCampus(c1.id);
  ok('create + listByCampus（tags 展开）', { n: tplList.length, tagsOfFirst: tplList[0].tags?.length });
  assert(tplList[0].tags?.length === 2, 'tags 批量展开（无 N+1）');
  const exported = await R.templates.exportByCampus(c1.id);
  assert(exported.length === 1 && exported[0].tagIds.length === 2, 'export 剥离 id');
  const importedCount = await R.templates.importMany(c1.id, [
    { name: '导入模板A', tagIds: [tNeg.id] },
    { name: '导入模板B', tagIds: [tPos.id, 'fake-tag-id-not-in-campus'] }, // 跨校区/无效 tag 应被过滤
  ]);
  assert(importedCount === 2, 'importMany 返回导入数');
  const afterImport = await R.templates.listByCampus(c1.id);
  const tplB = afterImport.find((t) => t.name === '导入模板B')!;
  assert(tplB.tagIds.length === 1, 'importMany 过滤无效/跨校区 tagId');
  ok('importMany（事务 + tagId 校验过滤）');

  // ═══════════ records（事务 + join）═══════════
  console.log('[records]');
  const now = Date.now();
  // 2026-10-23：create 收 tagIds（数组），score 由 repo 按标签求和（标签分权威，不接受传值）
  const rec1 = await R.records.create({ campusId: c1.id, classId: cls1.id, recorderId: student.id, tagIds: [tNeg.id], comment: '地面垃圾', images: ['records/files/a.jpg'], week: '2026-W41', recordedAt: now });
  ok('create（事务 + join + images）', { className: rec1.className, recorderName: rec1.recorderName, tagNames: rec1.tags.map((t) => t.name) });
  assert(rec1.recorderName === '值周生A', 'recorderName 来自 userProfiles');
  assert(rec1.images?.length === 1, 'images JSON');
  assert(rec1.score === -2, `score 由标签求和（期望 -2，实际 ${rec1.score}）`);
  // 按 id 断言（不用 name：上方 tags 段的部分更新测试已把它改名为「卫生差(改)」）
  assert(rec1.tags.length === 1 && rec1.tags[0].id === tNeg.id, 'tags 展开为对象数组');
  await R.records.create({ campusId: c1.id, classId: cls1.id, recorderId: student.id, tagIds: [tPos.id], week: '2026-W41', recordedAt: now });
  await R.records.create({ campusId: c1.id, classId: cls2.id, recorderId: student.id, tagIds: [tNeg.id], week: '2026-W41', recordedAt: now });
  // createMany：多班级一次落多条独立记录（用独立周次 W43，避免污染下方 statistics 段 W41 基线）
  const many = await R.records.createMany({ campusId: c1.id, classIds: [cls1.id, cls2.id], recorderId: student.id, tagIds: [tPos.id], week: '2026-W43', recordedAt: now });
  assert(many.length === 2 && many[0].id !== many[1].id, 'createMany 每班级一条独立记录');
  assert(many[0].score === 2 && many[1].score === 2, 'createMany 各记录分数相同（同标签集）');
  ok('createMany（多班级批量 + 独立 id）');
  const recPage = await R.records.list({ campusId: c1.id, page: 1, pageSize: 2 });
  assert(recPage.pagination.total === 5 && recPage.data.length === 2, 'records 分页（3×W41 + 2×W43）');
  ok('list 分页');
  await R.records.revoke(rec1.id, admin.id, '误录');
  const revoked = await R.records.findByIdWithDetails(rec1.id);
  assert(revoked?.status === 'revoked', 'revoke 软删');
  ok('revoke（事务 + log）');
  // adjust：申诉通过=调分而非撤销（改 tagIds + 回 active + log adjust）；用 W43 的 many[0] 验证
  const adjRec = await R.records.adjust(many[0].id, { tagIds: [tNeu.id], operatorId: admin.id, reason: '申诉通过，改为一般' });
  assert(adjRec.status === 'active' && adjRec.score === 0, `adjust 回 active 且分数重算（期望 0，实际 ${adjRec.score}）`);
  ok('adjust（调分回 active，标签分权威）');
  const exportRows = await R.records.listForExport(c1.id, '2026-W40', '2026-W42');
  assert(exportRows.length === 3, 'listForExport 周区间过滤（W40-W42 只含 3×W41）');
  ok('listForExport');

  // ═══════════ appeals（状态机事务）═══════════
  console.log('[appeals]');
  // 确定性地用 cls2 的 active 记录申诉（rec1 已 revoked；cls1 的记录留给 statistics 段做分数基线，
  // 故申诉只碰 cls2，避免 approve 调分污染 cls1）。list 支持 classId 过滤。
  const activeRec = (await R.records.list({ campusId: c1.id, classId: cls2.id, status: 'active', page: 1, pageSize: 10 })).data[0];
  const appeal = await R.appeals.create({ recordId: activeRec.id, teacherId: teacher.id, reason: '扣分不合理', campusId: c1.id });
  ok('create（事务：record→appealing + appeal + log）', { status: appeal.status });
  const appealedRec = await R.records.findByIdWithDetails(activeRec.id);
  assert(appealedRec?.status === 'appealing', 'record 状态联动 appealing');
  const appealList = await R.appeals.list({ campusId: c1.id, page: 1, pageSize: 20 });
  ok('list（join record_info，无 N+1）', { n: appealList.data.length, hasRecordInfo: !!appealList.data[0].recordInfo });
  assert(appealList.data[0].recordInfo?.className !== undefined, 'record_info 一次 join 取回');
  // teacher 只看自己的
  const teacherAppeals = await R.appeals.list({ teacherId: teacher.id, page: 1, pageSize: 20 });
  assert(teacherAppeals.data.length === 1, 'teacher 过滤生效');
  await R.appeals.approve(activeRec.id, admin.id, { reviewComment: '情况属实', tagIds: [tNeu.id] });
  const approvedRec = await R.records.findByIdWithDetails(activeRec.id);
  assert(approvedRec?.status === 'active', 'approve 后记录回 active（修改而非撤销）');
  assert(approvedRec?.score === 0, `approve 调分后分数重算（期望 0，实际 ${approvedRec?.score}）`);
  const approvedAppeal = await R.appeals.findById(appeal.id);
  assert(approvedAppeal?.status === 'approved' && approvedAppeal.reviewerId === admin.id, 'appeal approved + reviewer');
  ok('approve（调分回 active，修改而非撤销）');
  // reject 另一条（仍用 cls2；reject 不改分，只回滚状态）
  const activeRec2 = (await R.records.list({ campusId: c1.id, classId: cls2.id, status: 'active', page: 1, pageSize: 10 })).data[0];
  if (activeRec2) {
    await R.appeals.create({ recordId: activeRec2.id, teacherId: teacher.id, reason: 'test', campusId: c1.id });
    await R.appeals.reject(activeRec2.id, admin.id, '证据不足');
    const rejectedRec = await R.records.findByIdWithDetails(activeRec2.id);
    assert(rejectedRec?.status === 'active', 'reject 回滚 record→active');
    ok('reject（事务回滚）');
  }

  // ═══════════ summary ═══════════
  console.log('[summary]');
  const sum = await R.summary.create({ campusId: c1.id, week: '2026-W41', date: '2026-10-12', content: '今日总体良好', notifiedTeachers: [teacher.id] });
  ok('create', { content: sum.content, notified: sum.notifiedTeachers?.length });
  assert(sum.notifiedTeachers?.length === 1, 'notifiedTeachers JSON');
  const sumList = await R.summary.listByCampus(c1.id, '2026-W41');
  assert(sumList.length === 1, 'summary listByCampus + week 过滤');
  ok('listByCampus（week 过滤）');

  // ═══════════ statistics（聚合口径）═══════════
  console.log('[statistics]');
  const ranking = await R.statistics.ranking(c1.id, '2026-W41');
  ok('ranking', ranking.map((r) => ({ cls: r.className, rank: r.rank, total: r.totalScore, cnt: r.recordCount })));
  // cls1(1班): -2(revoked 不计) + 2(active 计) = 2，cnt=1
  // cls2(2班): 原 -1 记录经申诉 approve 调分为 0（tNeu），active 计入 = 0，cnt=1
  const cls1Rank = ranking.find((r) => r.className === '1班')!;
  assert(cls1Rank.totalScore === 2, `1班应 2（revoked 的 -2 不计，剩 active +2），实际 ${cls1Rank.totalScore}`);
  assert(cls1Rank.recordCount === 1, `1班 recordCount 应 1（revoked 不计入 count），实际 ${cls1Rank.recordCount}`);
  ok('计分口径（revoked 不计；申诉调分后记录回 active 照常计分）');
  // 修正原有 bug：trend 签名是 (campusId, classId, weeks)，此前漏传 campusId 导致运行时崩
  const trend = await R.statistics.trend(c1.id, cls1.id, ['2026-W40', '2026-W41', '2026-W42']);
  assert(trend.length === 3 && trend[0].totalScore === 0, 'trend 补零');
  ok('trend（补零）');
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const dash = await R.statistics.dashboard(c1.id, dayStart.getTime(), dayEnd.getTime(), '2026-W41');
  ok('dashboard（epoch 区间判今日）', dash);

  // ═══════════ awards（候选参考 + 人工颁发）═══════════
  console.log('[awards]');
  // 2026-10-23：autoAward 拆成 candidates（只读参考）+ grant（人工颁发）
  const cands = await R.awards.candidates(c1.id, '2026-W41');
  ok('candidates（每年级第一名参考，只读不落库）', { n: cands.length, names: cands.map((x) => x.className) });
  assert(cands.length === 2, `应 2 个候选（2 年级），实际 ${cands.length}`);
  assert(cands.every((x) => x.rank === 1 && !x.alreadyAwarded), '候选均 rank=1 且未颁');
  const beforeGrant = await R.awards.listByCampus(c1.id, '2026-W41');
  assert(beforeGrant.length === 0, 'candidates 不落库（颁发前应为空）');
  // 人工颁发候选班级
  const awarded = await R.awards.grant(c1.id, '2026-W41', cands.map((x) => x.classId));
  ok('grant（人工颁发）', { n: awarded.length, notes: awarded.map((a) => a.note) });
  assert(awarded.length === 2, `应颁 2 面旗，实际 ${awarded.length}`);
  // 幂等：重复颁同一批不产生重复
  const awarded2 = await R.awards.grant(c1.id, '2026-W41', cands.map((x) => x.classId));
  assert(awarded2.length === 0, `幂等：重复颁发应新增 0，实际 ${awarded2.length}`);
  // 颁发后 candidates 标记 alreadyAwarded
  const candsAfter = await R.awards.candidates(c1.id, '2026-W41');
  assert(candsAfter.every((x) => x.alreadyAwarded), '颁发后候选标记 alreadyAwarded');
  ok('幂等（UNIQUE + onConflictDoNothing，重复颁发不增）');
  const awardList = await R.awards.listByCampus(c1.id, '2026-W41');
  assert(awardList.length === 2 && awardList[0].className, 'listByCampus join className/gradeName');
  await R.awards.remove(awardList[0].id);
  assert((await R.awards.listByCampus(c1.id, '2026-W41')).length === 1, 'award remove');
  ok('listByCampus + remove');

  // ═══════════ settings（upsert 事务）═══════════
  console.log('[settings]');
  await R.settings.upsertMany(c1.id, [{ key: 'appeal_enabled', value: 'true' }, { key: 'auto_notify_teachers', value: 'true' }]);
  const map = await R.settings.getMap(c1.id);
  ok('upsertMany + getMap', map);
  assert(map.appeal_enabled === 'true' && map.auto_notify_teachers === 'true', 'settings map 正确');
  // upsert 覆盖
  await R.settings.upsertMany(c1.id, [{ key: 'appeal_enabled', value: 'false' }]);
  const map2 = await R.settings.getMap(c1.id);
  assert(map2.appeal_enabled === 'false', 'upsert 覆盖生效');
  assert((await R.settings.upsertMany(c1.id, [])) === undefined, 'upsertMany 空数组安全');
  ok('upsert 覆盖 + 空数组安全');

  // ═══════════ remove（清理）═══════════
  console.log('[remove]');
  await R.tags.remove(tNeu.id);
  assert((await R.tags.listByCampus(c1.id)).length === 2, 'tag remove');
  await R.templates.remove(tpl.id);
  await R.groups.remove(grp.id);
  assert((await R.groups.listByCampus(c1.id)).length === 0, 'group remove（成员 groupId 清空）');
  const studentProfAfterGrpDel = await R.users.findProfile(student.id);
  assert(studentProfAfterGrpDel?.groupId === null, 'group remove 后成员 groupId 清空');
  await R.classes.remove(cls2.id);
  await R.grades.remove(g2.id);
  await R.users.remove(student2.id);
  await R.campuses.remove(c2.id);
  ok('remove（tags/templates/groups/classes/grades/users/campuses）');

  console.log(`\n✅✅✅ P3 全量 repo 验收通过：${passed} 项断言全绿（13 repo × 全方法 × sqlite 端到端）\n`);
  closeDatabase(handle);
  rmSync(DB, { force: true }); rmSync(DB + '-wal', { force: true }); rmSync(DB + '-shm', { force: true });
  rmSync(join(__dirname, '../data/verify-files'), { recursive: true, force: true });
}

main().catch((e) => { console.error('\n❌ P3 验收失败:', e instanceof Error ? e.stack : e); process.exit(1); });
