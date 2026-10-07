import { getDb } from './connection.js';
import { runMigrations } from './schema.js';
import bcryptjs from 'bcryptjs';

export function seed(): void {
  runMigrations();
  const db = getDb();

  // Check if already seeded
  const existing = db.prepare('SELECT id FROM campuses LIMIT 1').get();
  if (existing) {
    console.log('Database already seeded, skipping.');
    return;
  }

  const hash = bcryptjs.hashSync('123456', 10);

  // Campus
  db.prepare(`INSERT INTO campuses (name, code) VALUES (?, ?)`).run('第一校区', 'campus_01');
  db.prepare(`INSERT INTO campuses (name, code) VALUES (?, ?)`).run('第二校区', 'campus_02');

  // Grades
  for (const campusId of [1, 2]) {
    for (let g = 1; g <= 6; g++) {
      db.prepare(`INSERT INTO grades (campus_id, name, sort_order) VALUES (?, ?, ?)`).run(
        campusId, `${g}年级`, g
      );
    }
  }

  // Classes (6 grades × 3 classes = 18 per campus)
  for (const campusId of [1, 2]) {
    for (let g = 1; g <= 6; g++) {
      const gradeId = (campusId - 1) * 6 + g;
      for (let c = 1; c <= 3; c++) {
        db.prepare(`INSERT INTO classes (grade_id, campus_id, name, class_teacher) VALUES (?, ?, ?, ?)`).run(
          gradeId, campusId, `${c}班`, `张老师${campusId}-${g}-${c}`
        );
      }
    }
  }

  // Users (admin + teacher + students per campus)
  const users = [
    // Campus 1
    { campus_id: 1, username: 'admin', display_name: '系统管理员', role: 'admin' },
    { campus_id: 1, username: 'teacher1', display_name: '李老师', role: 'teacher' },
    { campus_id: 1, username: 'teacher2', display_name: '王老师', role: 'teacher' },
    { campus_id: 1, username: 'student1', display_name: '值周生A', role: 'student' },
    { campus_id: 1, username: 'student2', display_name: '值周生B', role: 'student' },
    // Campus 2
    { campus_id: 2, username: 'admin2', display_name: '二校区管理员', role: 'admin' },
    { campus_id: 2, username: 'teacher3', display_name: '赵老师', role: 'teacher' },
    { campus_id: 2, username: 'student3', display_name: '值周生C', role: 'student' },
  ];

  for (const u of users) {
    db.prepare(
      `INSERT INTO users (campus_id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)`
    ).run(u.campus_id, u.username, hash, u.display_name, u.role);
  }

  // Duty groups
  db.prepare(`INSERT INTO duty_groups (campus_id, name, members) VALUES (?, ?, ?)`).run(
    1, '周一值周组', JSON.stringify([4, 5])
  );
  db.prepare(`INSERT INTO duty_groups (campus_id, name, members) VALUES (?, ?, ?)`).run(
    2, '周一值周组', JSON.stringify([8])
  );

  // Update student group_id
  db.prepare(`UPDATE users SET group_id = 1 WHERE id = 4`).run();
  db.prepare(`UPDATE users SET group_id = 1 WHERE id = 5`).run();
  db.prepare(`UPDATE users SET group_id = 2 WHERE id = 8`).run();

  // Tags
  const tags = [
    // Positive tags
    { campus_id: 1, name: '卫生优秀', score: 2, color: '#4CAF50', category: 'positive', is_system: 1 },
    { campus_id: 1, name: '纪律优秀', score: 2, color: '#2196F3', category: 'positive', is_system: 1 },
    { campus_id: 1, name: '好人好事', score: 3, color: '#FF9800', category: 'positive', is_system: 1 },
    { campus_id: 1, name: '两操整齐', score: 1, color: '#9C27B0', category: 'positive', is_system: 1 },
    // Negative tags
    { campus_id: 1, name: '迟到', score: -1, color: '#F44336', category: 'negative', is_system: 1 },
    { campus_id: 1, name: '未佩戴红领巾', score: -1, color: '#FF5722', category: 'negative', is_system: 1 },
    { campus_id: 1, name: '卫生差', score: -2, color: '#795548', category: 'negative', is_system: 1 },
    { campus_id: 1, name: '课间追逐打闹', score: -2, color: '#E91E63', category: 'negative', is_system: 1 },
    { campus_id: 1, name: '眼保健操不认真', score: -1, color: '#607D8B', category: 'negative', is_system: 1 },
    { campus_id: 1, name: '放学路队不齐', score: -1, color: '#FFC107', category: 'negative', is_system: 1 },
    // Campus 2 tags (same structure)
    { campus_id: 2, name: '卫生优秀', score: 2, color: '#4CAF50', category: 'positive', is_system: 1 },
    { campus_id: 2, name: '纪律优秀', score: 2, color: '#2196F3', category: 'positive', is_system: 1 },
    { campus_id: 2, name: '好人好事', score: 3, color: '#FF9800', category: 'positive', is_system: 1 },
    { campus_id: 2, name: '迟到', score: -1, color: '#F44336', category: 'negative', is_system: 1 },
    { campus_id: 2, name: '未佩戴红领巾', score: -1, color: '#FF5722', category: 'negative', is_system: 1 },
    { campus_id: 2, name: '卫生差', score: -2, color: '#795548', category: 'negative', is_system: 1 },
    { campus_id: 2, name: '课间追逐打闹', score: -2, color: '#E91E63', category: 'negative', is_system: 1 },
  ];

  for (const t of tags) {
    db.prepare(
      `INSERT INTO tags (campus_id, name, score, color, category, is_system) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(t.campus_id, t.name, t.score, t.color, t.category, t.is_system);
  }

  // Templates
  const morningTemplate = {
    campus_id: 1,
    name: '晨检模板',
    tag_ids: JSON.stringify([5, 6, 1]), // 迟到、未佩戴红领巾、卫生优秀
  };
  const recessTemplate = {
    campus_id: 1,
    name: '课间操检查模板',
    tag_ids: JSON.stringify([4, 8]), // 两操整齐、课间追逐打闹
  };
  db.prepare(`INSERT INTO templates (campus_id, name, tag_ids) VALUES (?, ?, ?)`).run(
    morningTemplate.campus_id, morningTemplate.name, morningTemplate.tag_ids
  );
  db.prepare(`INSERT INTO templates (campus_id, name, tag_ids) VALUES (?, ?, ?)`).run(
    recessTemplate.campus_id, recessTemplate.name, recessTemplate.tag_ids
  );

  // Settings
  db.prepare(`INSERT INTO settings (campus_id, key, value) VALUES (?, ?, ?)`).run(1, 'appeal_enabled', 'true');
  db.prepare(`INSERT INTO settings (campus_id, key, value) VALUES (?, ?, ?)`).run(1, 'auto_notify_teachers', 'true');
  db.prepare(`INSERT INTO settings (campus_id, key, value) VALUES (?, ?, ?)`).run(2, 'appeal_enabled', 'true');

  console.log('Seed data inserted successfully.');
  console.log('Default passwords: 123456 for all users.');
  console.log('Accounts: admin, teacher1, teacher2, student1, student2 (campus 1)');
  console.log('Accounts: admin2, teacher3, student3 (campus 2)');
}

// Run directly
seed();