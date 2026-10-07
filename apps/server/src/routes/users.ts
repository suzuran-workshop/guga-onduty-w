import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { authMiddleware, requireRole, getCurrentUser } from '../middleware/auth.js';
import bcryptjs from 'bcryptjs';

export const userRoutes = new Hono();
userRoutes.use('*', authMiddleware);

// GET /api/v1/users
userRoutes.get('/', requireRole('admin'), (c) => {
  const db = getDb();
  const campusId = c.req.query('campus_id');
  const role = c.req.query('role');

  let sql = `
    SELECT u.id, u.campus_id, u.username, u.display_name, u.role, u.group_id, u.created_at,
           dg.name as group_name, c.name as campus_name
    FROM users u
    LEFT JOIN duty_groups dg ON u.group_id = dg.id
    JOIN campuses c ON u.campus_id = c.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (campusId) {
    sql += ' AND u.campus_id = ?';
    params.push(Number(campusId));
  }
  if (role) {
    sql += ' AND u.role = ?';
    params.push(role);
  }

  sql += ' ORDER BY u.campus_id, u.role, u.id';

  const rows = db.prepare(sql).all(...params);
  return c.json({ success: true, data: rows });
});

// POST /api/v1/users (admin only)
userRoutes.post('/', requireRole('admin'), async (c) => {
  const body = await c.req.json<{
    campus_id: number; username: string; password?: string; display_name: string;
    role: string; group_id?: number;
  }>();
  const db = getDb();
  const password = body.password || '123456';
  const hash = bcryptjs.hashSync(password, 10);

  try {
    const result = db.prepare(
      'INSERT INTO users (campus_id, username, password_hash, display_name, role, group_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(body.campus_id, body.username, hash, body.display_name, body.role, body.group_id || null);

    const row = db.prepare(
      'SELECT u.id, u.campus_id, u.username, u.display_name, u.role, u.group_id, u.created_at FROM users u WHERE u.id = ?'
    ).get(Number(result.lastInsertRowid));
    return c.json({ success: true, data: row }, 201);
  } catch (e: any) {
    return c.json({ success: false, error: { code: 'CONFLICT', message: e.message } }, 409);
  }
});

// PUT /api/v1/users/:id
userRoutes.put('/:id', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ display_name: string; role: string; group_id?: number }>();
  const db = getDb();

  db.prepare('UPDATE users SET display_name = ?, role = ?, group_id = ? WHERE id = ?').run(
    body.display_name, body.role, body.group_id || null, id
  );

  const row = db.prepare(
    'SELECT u.id, u.campus_id, u.username, u.display_name, u.role, u.group_id, u.created_at FROM users u WHERE u.id = ?'
  ).get(id);
  return c.json({ success: true, data: row });
});

// DELETE /api/v1/users/:id
userRoutes.delete('/:id', requireRole('admin'), (c) => {
  const id = Number(c.req.param('id'));
  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return c.json({ success: true, data: { deleted: true } });
});