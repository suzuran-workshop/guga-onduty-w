import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { authMiddleware, getCurrentUser } from '../middleware/auth.js';

export const gradeRoutes = new Hono();
gradeRoutes.use('*', authMiddleware);

// GET /api/v1/grades
gradeRoutes.get('/', (c) => {
  const db = getDb();
  const user = getCurrentUser(c);
  const campusId = c.req.query('campus_id') || String(user.campus_id);

  const rows = db.prepare(
    'SELECT g.*, c.name as campus_name FROM grades g JOIN campuses c ON g.campus_id = c.id WHERE g.campus_id = ? ORDER BY g.sort_order'
  ).all(Number(campusId));

  return c.json({ success: true, data: rows });
});

// POST /api/v1/grades
gradeRoutes.post('/', async (c) => {
  const body = await c.req.json<{ campus_id: number; name: string; sort_order?: number }>();
  const db = getDb();

  try {
    const result = db.prepare(
      'INSERT INTO grades (campus_id, name, sort_order) VALUES (?, ?, ?)'
    ).run(body.campus_id, body.name, body.sort_order || 0);
    const row = db.prepare('SELECT * FROM grades WHERE id = ?').get(Number(result.lastInsertRowid));
    return c.json({ success: true, data: row }, 201);
  } catch (e: any) {
    return c.json({ success: false, error: { code: 'CONFLICT', message: e.message } }, 409);
  }
});

// PUT /api/v1/grades/:id
gradeRoutes.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ name: string; sort_order?: number }>();
  const db = getDb();

  db.prepare('UPDATE grades SET name = ?, sort_order = ? WHERE id = ?').run(body.name, body.sort_order || 0, id);
  const row = db.prepare('SELECT * FROM grades WHERE id = ?').get(id);
  return c.json({ success: true, data: row });
});

// DELETE /api/v1/grades/:id
gradeRoutes.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const db = getDb();
  db.prepare('DELETE FROM grades WHERE id = ?').run(id);
  return c.json({ success: true, data: { deleted: true } });
});