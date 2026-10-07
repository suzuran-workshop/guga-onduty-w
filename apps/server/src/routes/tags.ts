import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { authMiddleware, getCurrentUser } from '../middleware/auth.js';

export const tagRoutes = new Hono();
tagRoutes.use('*', authMiddleware);

// GET /api/v1/tags
tagRoutes.get('/', (c) => {
  const db = getDb();
  const user = getCurrentUser(c);
  const campusId = c.req.query('campus_id') || String(user.campus_id);
  const category = c.req.query('category');

  let sql = 'SELECT * FROM tags WHERE campus_id = ?';
  const params: any[] = [Number(campusId)];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  sql += ' ORDER BY category, is_system DESC, name';

  const rows = db.prepare(sql).all(...params);
  return c.json({ success: true, data: rows });
});

// POST /api/v1/tags
tagRoutes.post('/', async (c) => {
  const body = await c.req.json<{
    campus_id: number; name: string; score: number; color?: string;
    category?: string; is_system?: boolean;
  }>();
  const db = getDb();

  try {
    const result = db.prepare(
      'INSERT INTO tags (campus_id, name, score, color, category, is_system) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(body.campus_id, body.name, body.score, body.color || '#FFAACC', body.category || 'negative', body.is_system ? 1 : 0);

    const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(Number(result.lastInsertRowid));
    return c.json({ success: true, data: row }, 201);
  } catch (e: any) {
    return c.json({ success: false, error: { code: 'CONFLICT', message: e.message } }, 409);
  }
});

// PUT /api/v1/tags/:id
tagRoutes.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ name: string; score: number; color?: string; category?: string }>();
  const db = getDb();

  db.prepare('UPDATE tags SET name = ?, score = ?, color = ?, category = ? WHERE id = ?').run(
    body.name, body.score, body.color || '#FFAACC', body.category || 'negative', id
  );

  const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
  return c.json({ success: true, data: row });
});

// DELETE /api/v1/tags/:id (only non-system tags)
tagRoutes.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const db = getDb();

  const tag = db.prepare('SELECT is_system FROM tags WHERE id = ?').get(id) as any;
  if (tag?.is_system) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: '系统标签不可删除' } }, 403);
  }

  db.prepare('DELETE FROM tags WHERE id = ?').run(id);
  return c.json({ success: true, data: { deleted: true } });
});