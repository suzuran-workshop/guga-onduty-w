import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { authMiddleware, getCurrentUser } from '../middleware/auth.js';

export const appealRoutes = new Hono();
appealRoutes.use('*', authMiddleware);

// GET /api/v1/appeals
appealRoutes.get('/', (c) => {
  const db = getDb();
  const user = getCurrentUser(c);
  const status = c.req.query('status');
  const page = Number(c.req.query('page') || '1');
  const pageSize = Number(c.req.query('pageSize') || '20');

  let sql = `
    SELECT a.*, u1.display_name as teacher_name, u2.display_name as reviewer_name
    FROM appeals a
    JOIN users u1 ON a.teacher_id = u1.id
    LEFT JOIN users u2 ON a.reviewer_id = u2.id
    WHERE 1=1
  `;
  const params: any[] = [];

  // Teachers can only see their own appeals
  if (user.role === 'teacher') {
    sql += ' AND a.teacher_id = ?';
    params.push(user.sub);
  }

  if (status) {
    sql += ' AND a.status = ?';
    params.push(status);
  }

  // Get total count
  const countSql = `SELECT COUNT(*) as total FROM (${sql})`;
  const { total } = db.prepare(countSql).all(...params)[0] as any;

  sql += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, (page - 1) * pageSize);

  const rows = db.prepare(sql).all(...params);

  // Attach record info to each appeal
  const appeals = (rows as any[]).map((a) => {
    const record = db.prepare(`
      SELECT r.score, r.comment, r.week, r.recorded_at, r.status as record_status,
             cl.name as class_name, t.name as tag_name
      FROM records r
      JOIN classes cl ON r.class_id = cl.id
      LEFT JOIN tags t ON r.tag_id = t.id
      WHERE r.id = ?
    `).get(a.record_id) as any;

    return {
      ...a,
      record_info: record || null,
    };
  });

  return c.json({
    success: true,
    data: appeals,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
});

// GET /api/v1/appeals/:id
appealRoutes.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const db = getDb();

  const row = db.prepare(`
    SELECT a.*, u1.display_name as teacher_name, u2.display_name as reviewer_name
    FROM appeals a
    JOIN users u1 ON a.teacher_id = u1.id
    LEFT JOIN users u2 ON a.reviewer_id = u2.id
    WHERE a.id = ?
  `).get(id);

  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '申诉不存在' } }, 404);
  }

  return c.json({ success: true, data: row });
});