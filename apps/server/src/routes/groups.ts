import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { authMiddleware, getCurrentUser } from '../middleware/auth.js';

export const groupRoutes = new Hono();
groupRoutes.use('*', authMiddleware);

// GET /api/v1/groups
groupRoutes.get('/', (c) => {
  const db = getDb();
  const user = getCurrentUser(c);
  const campusId = c.req.query('campus_id') || String(user.campus_id);

  const rows = db.prepare(
    'SELECT * FROM duty_groups WHERE campus_id = ? ORDER BY name'
  ).all(Number(campusId));

  return c.json({ success: true, data: rows });
});

// POST /api/v1/groups
groupRoutes.post('/', async (c) => {
  const body = await c.req.json<{ campus_id: number; name: string; members?: number[] }>();
  const db = getDb();

  const result = db.prepare(
    'INSERT INTO duty_groups (campus_id, name, members) VALUES (?, ?, ?)'
  ).run(body.campus_id, body.name, JSON.stringify(body.members || []));

  const row = db.prepare('SELECT * FROM duty_groups WHERE id = ?').get(Number(result.lastInsertRowid));

  // Update members' group_id
  if (body.members) {
    const updateStmt = db.prepare('UPDATE users SET group_id = ? WHERE id = ?');
    for (const userId of body.members) {
      updateStmt.run(Number(result.lastInsertRowid), userId);
    }
  }

  return c.json({ success: true, data: row }, 201);
});

// PUT /api/v1/groups/:id
groupRoutes.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ name: string; members?: number[] }>();
  const db = getDb();

  // Clear old members' group_id
  const oldGroup = db.prepare('SELECT members FROM duty_groups WHERE id = ?').get(id) as any;
  if (oldGroup?.members) {
    const oldMembers = JSON.parse(oldGroup.members);
    const clearStmt = db.prepare('UPDATE users SET group_id = NULL WHERE group_id = ? AND id = ?');
    for (const userId of oldMembers) {
      clearStmt.run(id, userId);
    }
  }

  db.prepare('UPDATE duty_groups SET name = ?, members = ? WHERE id = ?').run(
    body.name, JSON.stringify(body.members || []), id
  );

  // Set new members' group_id
  if (body.members) {
    const setStmt = db.prepare('UPDATE users SET group_id = ? WHERE id = ?');
    for (const userId of body.members) {
      setStmt.run(id, userId);
    }
  }

  const row = db.prepare('SELECT * FROM duty_groups WHERE id = ?').get(id);
  return c.json({ success: true, data: row });
});

// DELETE /api/v1/groups/:id
groupRoutes.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const db = getDb();
  db.prepare('UPDATE users SET group_id = NULL WHERE group_id = ?').run(id);
  db.prepare('DELETE FROM duty_groups WHERE id = ?').run(id);
  return c.json({ success: true, data: { deleted: true } });
});