/**
 * 种子数据 —— 冷启动测试数据（新 uuid + scrypt 模型）。
 *
 * 迁移要点（对照旧 db/seed.ts）：
 *  - 全部 id 为 uuid；用户经 users-repo.create（auth SDK register + scrypt 密码 + profile）。
 *  - 密码统一 123456（测试用），账号 admin/teacher1/… 不变（AGENTS.md 契约）。
 *  - 结构与旧 seed 对齐：2 校区 × 6 年级 × 3 班 + 8 用户 + 17 标签 + 2 模板 + 3 设置 + 2 小组。
 *  - 幂等守卫：campuses 非空则跳过。
 *  - 不再 import 即执行（旧 seed.ts 末尾裸调 seed()）；显式 main() + import.meta 守卫。
 *
 * 运行：pnpm db:seed（= tsx src/db/seed.ts）。
 */
import { loadConfig, createAppLogger } from '../config.js';
import { openDatabase, migrate, closeDatabase } from './client.js';
import { buildAuth } from '../auth/build.js';
import { createRepos } from '../repos/index.js';
import { pathToFileURL } from 'node:url';

export async function seed(): Promise<void> {
  const cfg = loadConfig();
  const logger = createAppLogger(cfg);
  const handle = await openDatabase(cfg);
  await migrate(handle);

  if (handle.kind === 'rest') {
    logger.warn('seed: rest 轨（qw-pages）种子待 P4 rest repo 就绪后支持');
    return;
  }

  const auth = buildAuth(handle, cfg, { secure: false, loginPath: '/login' });
  const R = createRepos(handle, { passwordProvider: auth.passwordProvider, userStore: auth.userStore });

  // 幂等守卫
  const existing = await R.campuses.listAll();
  if (existing.length > 0) {
    logger.info('Database already seeded, skipping.');
    closeDatabase(handle);
    return;
  }

  const PW = '123456';

  // ── 校区 ──
  const c1 = await R.campuses.create({ name: '第一校区', code: 'campus_01' });
  const c2 = await R.campuses.create({ name: '第二校区', code: 'campus_02' });

  // ── 年级（每校区 6 个）──
  const gradesByCampus: Record<string, string[]> = { [c1.id]: [], [c2.id]: [] };
  for (const campus of [c1, c2]) {
    for (let g = 1; g <= 6; g++) {
      const grade = await R.grades.create({ campusId: campus.id, name: `${g}年级`, sortOrder: g });
      gradesByCampus[campus.id].push(grade.id);
    }
  }

  // ── 班级（每校区每年级 3 个）──
  for (const campus of [c1, c2]) {
    const gradeIds = gradesByCampus[campus.id];
    for (let gi = 0; gi < gradeIds.length; gi++) {
      for (let c = 1; c <= 3; c++) {
        await R.classes.create({
          campusId: campus.id,
          gradeId: gradeIds[gi],
          name: `${c}班`,
          classTeacher: `张老师${campus.code.slice(-2)}-${gi + 1}-${c}`,
        });
      }
    }
  }

  // ── 用户（auth register + profile）──
  const admin = await R.users.create({ campusId: c1.id, username: 'admin', password: PW, displayName: '系统管理员', role: 'admin' });
  const teacher1 = await R.users.create({ campusId: c1.id, username: 'teacher1', password: PW, displayName: '李老师', role: 'teacher' });
  await R.users.create({ campusId: c1.id, username: 'teacher2', password: PW, displayName: '王老师', role: 'teacher' });
  const student1 = await R.users.create({ campusId: c1.id, username: 'student1', password: PW, displayName: '值周生A', role: 'student' });
  const student2 = await R.users.create({ campusId: c1.id, username: 'student2', password: PW, displayName: '值周生B', role: 'student' });
  await R.users.create({ campusId: c2.id, username: 'admin2', password: PW, displayName: '二校区管理员', role: 'admin' });
  await R.users.create({ campusId: c2.id, username: 'teacher3', password: PW, displayName: '赵老师', role: 'teacher' });
  const student3 = await R.users.create({ campusId: c2.id, username: 'student3', password: PW, displayName: '值周生C', role: 'student' });

  // ── 值周小组（成员回填 groupId）──
  await R.groups.create({ campusId: c1.id, name: '周一值周组', members: [student1.id, student2.id] });
  await R.groups.create({ campusId: c2.id, name: '周一值周组', members: [student3.id] });

  // ── 标签 ──
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
    const tag = await R.tags.create({ campusId: c1.id, name: t.name, score: t.score, color: t.color, category: t.category, isSystem: true });
    c1Created[t.name] = tag.id;
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
    await R.tags.create({ campusId: c2.id, name: t.name, score: t.score, color: t.color, category: t.category, isSystem: true });
  }

  // ── 模板（引用标签 uuid）──
  await R.templates.create({
    campusId: c1.id, name: '晨检模板',
    tagIds: [c1Created['迟到'], c1Created['未佩戴红领巾'], c1Created['卫生优秀']].filter(Boolean),
  });
  await R.templates.create({
    campusId: c1.id, name: '课间操检查模板',
    tagIds: [c1Created['两操整齐'], c1Created['课间追逐打闹']].filter(Boolean),
  });

  // ── 设置 ──
  await R.settings.upsertMany(c1.id, [
    { key: 'appeal_enabled', value: 'true' },
    { key: 'auto_notify_teachers', value: 'true' },
  ]);
  await R.settings.upsertMany(c2.id, [{ key: 'appeal_enabled', value: 'true' }]);

  logger.info('Seed data inserted successfully.');
  console.log('Default passwords: 123456 for all users.');
  console.log('Accounts: admin, teacher1, teacher2, student1, student2 (campus 1)');
  console.log('Accounts: admin2, teacher3, student3 (campus 2)');
  console.log(`admin user id: ${admin.id}`);

  closeDatabase(handle);
}

// 直接运行守卫（旧 seed.ts 是 import 即执行，修复为显式；ESM 标准 idiom）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed().catch((e) => {
    console.error('Seed 失败:', e);
    process.exit(1);
  });
}
