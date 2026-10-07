import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { authMiddleware, requireRole, getCurrentUser } from '../middleware/auth.js';

export const campusRoutes = new Hono();

campusRoutes.use('*', authMiddleware);

// GET /api/v1/campuses
campusRoutes.get('/', (c) => {
  const db = getDb();
  const user = getCurrentUser(c);

  let rows;
  if (user.role === 'admin') {
    rows = db.prepare('SELECT * FROM campuses ORDER BY id').all();
  } else {
    rows = db.prepare('SELECT * FROM campuses WHERE id = ? ORDER BY id').all(user.campus_id);
  }

  return c.json({ success: true, data: rows });
});

// POST /api/v1/campuses (admin only)
campusRoutes.post('/', requireRole('admin'), async (c) => {
  const body = await c.req.json<{ name: string; code: string }>();
  const db = getDb();

  try {
    const result = db.prepare('INSERT INTO campuses (name, code) VALUES (?, ?)').run(body.name, body.code);
    const row = db.prepare('SELECT * FROM campuses WHERE id = ?').get(Number(result.lastInsertRowid));
    return c.json({ success: true, data: row }, 201);
  } catch (e: any) {
    return c.json({ success: false, error: { code: 'CONFLICT', message: e.message } }, 409);
  }
});

// PUT /api/v1/campuses/:id
campusRoutes.put('/:id', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ name: string; code: string }>();
  const db = getDb();

  db.prepare('UPDATE campuses SET name = ?, code = ? WHERE id = ?').run(body.name, body.code, id);
  const row = db.prepare('SELECT * FROM campuses WHERE id = ?').get(id);

  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '校区不存在' } }, 404);
  }

  return c.json({ success: true, data: row });
});

// DELETE /api/v1/campuses/:id
campusRoutes.delete('/:id', requireRole('admin'), (c) => {
  const id = Number(c.req.param('id'));
  const db = getDb();
  db.prepare('DELETE FROM campuses WHERE id = ?').run(id);
  return c.json({ success: true, data: { deleted: true } });
});