import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { authMiddleware, getCurrentUser } from '../middleware/auth.js';

export const classRoutes = new Hono();
classRoutes.use('*', authMiddleware);

// GET /api/v1/classes
classRoutes.get('/', (c) => {
  const db = getDb();
  const user = getCurrentUser(c);
  const campusId = c.req.query('campus_id') || String(user.campus_id);
  const gradeId = c.req.query('grade_id');

  let sql = `
    SELECT cl.*, g.name as grade_name, c.name as campus_name
    FROM classes cl
    JOIN grades g ON cl.grade_id = g.id
    JOIN campuses c ON cl.campus_id = c.id
    WHERE cl.campus_id = ?
  `;
  const params: any[] = [Number(campusId)];

  if (gradeId) {
    sql += ' AND cl.grade_id = ?';
    params.push(Number(gradeId));
  }

  sql += ' ORDER BY g.sort_order, cl.name';

  const rows = db.prepare(sql).all(...params);
  return c.json({ success: true, data: rows });
});

// POST /api/v1/classes
classRoutes.post('/', async (c) => {
  const body = await c.req.json<{ campus_id: number; grade_id: number; name: string; class_teacher?: string }>();
  const db = getDb();

  try {
    const result = db.prepare(
      'INSERT INTO classes (grade_id, campus_id, name, class_teacher) VALUES (?, ?, ?, ?)'
    ).run(body.grade_id, body.campus_id, body.name, body.class_teacher || null);
    const row = db.prepare(
      'SELECT cl.*, g.name as grade_name FROM classes cl JOIN grades g ON cl.grade_id = g.id WHERE cl.id = ?'
    ).get(Number(result.lastInsertRowid));
    return c.json({ success: true, data: row }, 201);
  } catch (e: any) {
    return c.json({ success: false, error: { code: 'CONFLICT', message: e.message } }, 409);
  }
});

// PUT /api/v1/classes/:id
classRoutes.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ name: string; class_teacher?: string }>();
  const db = getDb();

  db.prepare('UPDATE classes SET name = ?, class_teacher = ? WHERE id = ?').run(body.name, body.class_teacher || null, id);
  const row = db.prepare(
    'SELECT cl.*, g.name as grade_name FROM classes cl JOIN grades g ON cl.grade_id = g.id WHERE cl.id = ?'
  ).get(id);
  return c.json({ success: true, data: row });
});

// DELETE /api/v1/classes/:id
classRoutes.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const db = getDb();
  db.prepare('DELETE FROM classes WHERE id = ?').run(id);
  return c.json({ success: true, data: { deleted: true } });
});