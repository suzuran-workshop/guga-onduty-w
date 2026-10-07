import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { authMiddleware, requireRole, getCurrentUser } from '../middleware/auth.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, '../../uploads');

mkdirSync(UPLOADS_DIR, { recursive: true });

export const recordRoutes = new Hono();
recordRoutes.use('*', authMiddleware);

// GET /api/v1/records
recordRoutes.get('/', (c) => {
  const db = getDb();
  const user = getCurrentUser(c);
  const campusId = c.req.query('campus_id') || String(user.campus_id);
  const classId = c.req.query('class_id');
  const week = c.req.query('week');
  const status = c.req.query('status');
  const page = Number(c.req.query('page') || '1');
  const pageSize = Number(c.req.query('pageSize') || '20');

  let sql = `
    SELECT r.*, cl.name as class_name, g.name as grade_name,
           u.display_name as recorder_name, t.name as tag_name, t.color as tag_color
    FROM records r
    JOIN classes cl ON r.class_id = cl.id
    JOIN grades g ON cl.grade_id = g.id
    JOIN users u ON r.recorder_id = u.id
    LEFT JOIN tags t ON r.tag_id = t.id
    WHERE r.campus_id = ?
  `;
  const params: any[] = [Number(campusId)];

  if (classId) { sql += ' AND r.class_id = ?'; params.push(Number(classId)); }
  if (week) { sql += ' AND r.week = ?'; params.push(week); }
  if (status) { sql += ' AND r.status = ?'; params.push(status); }

  // Count total — wrap the entire query as a subquery
  const countSql = `SELECT COUNT(*) as total FROM (${sql})`;
  const { total } = db.prepare(countSql).all(...params)[0] as any;

  sql += ' ORDER BY r.recorded_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, (page - 1) * pageSize);

  const rows = db.prepare(sql).all(...params);

  return c.json({
    success: true,
    data: rows,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
});

// POST /api/v1/records (multipart form data)
recordRoutes.post('/', async (c) => {
  const user = getCurrentUser(c);
  const db = getDb();

  // Parse multipart form data
  const formData = await c.req.formData();
  const classId = Number(formData.get('class_id'));
  const tagId = formData.get('tag_id') ? Number(formData.get('tag_id')) : null;
  const score = formData.get('score') ? Number(formData.get('score')) : 0;
  const comment = formData.get('comment') as string | null;
  const week = formData.get('week') as string;

  // Get class info for campus_id
  const classInfo = db.prepare('SELECT campus_id, grade_id FROM classes WHERE id = ?').get(classId) as any;
  if (!classInfo) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '班级不存在' } }, 404);
  }

  // Handle image uploads
  const imagePaths: string[] = [];
  const imageFiles = formData.getAll('images') as File[];

  for (const file of imageFiles) {
    if (file && file.size > 0) {
      const ext = file.name.split('.').pop() || 'jpg';
      const filename = `${crypto.randomUUID()}.${ext}`;
      const dateDir = new Date().toISOString().slice(0, 7).replace('-', '/'); // YYYY/MM
      const uploadDir = join(UPLOADS_DIR, dateDir);
      mkdirSync(uploadDir, { recursive: true });

      const buffer = Buffer.from(await file.arrayBuffer());
      writeFileSync(join(uploadDir, filename), buffer);
      imagePaths.push(`${dateDir}/${filename}`);
    }
  }

  const result = db.prepare(`
    INSERT INTO records (campus_id, class_id, recorder_id, tag_id, score, comment, images, week)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    classInfo.campus_id, classId, user.sub, tagId, score,
    comment || null,
    imagePaths.length > 0 ? JSON.stringify(imagePaths) : null,
    week
  );

  // Also write to record_logs
  db.prepare(`INSERT INTO record_logs (record_id, action, operator_id) VALUES (?, 'create', ?)`).run(
    Number(result.lastInsertRowid), user.sub
  );

  // Emit SSE event
  const { EventBus } = await import('../utils/event-bus.js');
  EventBus.emit('record_created', {
    record_id: Number(result.lastInsertRowid),
    class_name: (db.prepare('SELECT name FROM classes WHERE id = ?').get(classId) as any)?.name,
    tag_name: tagId ? (db.prepare('SELECT name FROM tags WHERE id = ?').get(tagId) as any)?.name : null,
    points: score,
    timestamp: new Date().toISOString(),
    campus_id: classInfo.campus_id,
  });

  const row = db.prepare(`
    SELECT r.*, cl.name as class_name, g.name as grade_name,
           u.display_name as recorder_name, t.name as tag_name
    FROM records r
    JOIN classes cl ON r.class_id = cl.id
    JOIN grades g ON cl.grade_id = g.id
    JOIN users u ON r.recorder_id = u.id
    LEFT JOIN tags t ON r.tag_id = t.id
    WHERE r.id = ?
  `).get(Number(result.lastInsertRowid));

  return c.json({ success: true, data: row }, 201);
});

// GET /api/v1/records/:id
recordRoutes.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const db = getDb();

  const row = db.prepare(`
    SELECT r.*, cl.name as class_name, g.name as grade_name,
           u.display_name as recorder_name, t.name as tag_name, t.color as tag_color
    FROM records r
    JOIN classes cl ON r.class_id = cl.id
    JOIN grades g ON cl.grade_id = g.id
    JOIN users u ON r.recorder_id = u.id
    LEFT JOIN tags t ON r.tag_id = t.id
    WHERE r.id = ?
  `).get(id);

  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '记录不存在' } }, 404);
  }

  return c.json({ success: true, data: row });
});

// DELETE /api/v1/records/:id (admin revoke) — soft delete, sets status = 'revoked'
recordRoutes.delete('/:id', requireRole('admin'), (c) => {
  const id = Number(c.req.param('id'));
  const user = getCurrentUser(c);
  const db = getDb();

  db.prepare(`UPDATE records SET status = 'revoked' WHERE id = ?`).run(id);
  db.prepare(`INSERT INTO record_logs (record_id, action, operator_id, reason) VALUES (?, 'revoke', ?, '管理员撤回')`).run(id, user.sub);

  return c.json({ success: true, data: { revoked: true } });
});

// POST /api/v1/records/:id/revoke
recordRoutes.post('/:id/revoke', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const user = getCurrentUser(c);
  const body = await c.req.json<{ reason?: string }>();
  const db = getDb();

  db.prepare(`UPDATE records SET status = 'revoked' WHERE id = ? AND status = 'active'`).run(id);
  db.prepare(
    `INSERT INTO record_logs (record_id, action, operator_id, reason) VALUES (?, 'revoke', ?, ?)`
  ).run(id, user.sub, body.reason || '管理员撤回');

  return c.json({ success: true, data: { revoked: true } });
});

// POST /api/v1/records/:id/appeal (teacher)
recordRoutes.post('/:id/appeal', requireRole('teacher'), async (c) => {
  const id = Number(c.req.param('id'));
  const user = getCurrentUser(c);
  const body = await c.req.json<{ reason: string }>();
  const db = getDb();

  // Verify record exists and belongs to teacher's campus
  const record = db.prepare('SELECT * FROM records WHERE id = ?').get(id) as any;
  if (!record) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '记录不存在' } }, 404);
  }

  // Update record status
  db.prepare(`UPDATE records SET status = 'appealing' WHERE id = ? AND status = 'active'`).run(id);

  // Create appeal
  db.prepare(
    'INSERT INTO appeals (record_id, teacher_id, reason) VALUES (?, ?, ?)'
  ).run(id, user.sub, body.reason);

  // Log
  db.prepare(
    `INSERT INTO record_logs (record_id, action, operator_id, reason) VALUES (?, 'appeal', ?, ?)`
  ).run(id, user.sub, body.reason);

  return c.json({ success: true, data: { appealed: true } }, 201);
});

// POST /api/v1/records/:id/appeal/approve (admin)
recordRoutes.post('/:id/appeal/approve', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const user = getCurrentUser(c);
  const body = await c.req.json<{ review_comment?: string }>();
  const db = getDb();

  // Update appeal
  db.prepare(`
    UPDATE appeals SET status = 'approved', reviewer_id = ?, review_comment = ?, reviewed_at = datetime('now')
    WHERE record_id = ? AND status = 'pending'
  `).run(user.sub, body.review_comment || null, id);

  // Update record status
  db.prepare(`UPDATE records SET status = 'appeal_approved' WHERE id = ?`).run(id);

  // Log
  db.prepare(
    `INSERT INTO record_logs (record_id, action, operator_id, reason) VALUES (?, 'appeal_approve', ?, ?)`
  ).run(id, user.sub, body.review_comment || '申诉审批通过');

  return c.json({ success: true, data: { approved: true } });
});

// POST /api/v1/records/:id/appeal/reject (admin)
recordRoutes.post('/:id/appeal/reject', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const user = getCurrentUser(c);
  const body = await c.req.json<{ review_comment?: string }>();
  const db = getDb();

  // Update appeal
  db.prepare(`
    UPDATE appeals SET status = 'rejected', reviewer_id = ?, review_comment = ?, reviewed_at = datetime('now')
    WHERE record_id = ? AND status = 'pending'
  `).run(user.sub, body.review_comment || null, id);

  // Revert record status back to active
  db.prepare(`UPDATE records SET status = 'active' WHERE id = ?`).run(id);

  // Log
  db.prepare(
    `INSERT INTO record_logs (record_id, action, operator_id, reason) VALUES (?, 'appeal_reject', ?, ?)`
  ).run(id, user.sub, body.review_comment || '申诉被驳回');

  return c.json({ success: true, data: { rejected: true } });
});