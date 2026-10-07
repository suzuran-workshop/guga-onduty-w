import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { authMiddleware, getCurrentUser } from '../middleware/auth.js';

export const templateRoutes = new Hono();
templateRoutes.use('*', authMiddleware);

// GET /api/v1/templates
templateRoutes.get('/', (c) => {
  const db = getDb();
  const user = getCurrentUser(c);
  const campusId = c.req.query('campus_id') || String(user.campus_id);

  const rows = db.prepare(
    'SELECT * FROM templates WHERE campus_id = ? ORDER BY name'
  ).all(Number(campusId));

  const templates = (rows as any[]).map((t) => {
    const tagIds = JSON.parse(t.tag_ids || '[]') as number[];
    const tags = tagIds.length > 0
      ? db.prepare(`SELECT * FROM tags WHERE id IN (${tagIds.map(() => '?').join(',')})`).all(...tagIds)
      : [];
    return { ...t, tags };
  });

  return c.json({ success: true, data: templates });
});

// IMPORTANT: /export before /:id to avoid route conflict
// GET /api/v1/templates/export
templateRoutes.get('/export', (c) => {
  const db = getDb();
  const user = getCurrentUser(c);
  const campusId = c.req.query('campus_id') || String(user.campus_id);

  const rows = db.prepare(
    'SELECT id, name, tag_ids FROM templates WHERE campus_id = ?'
  ).all(Number(campusId));

  const exportData = (rows as any[]).map((r) => ({
    name: r.name,
    tag_ids: JSON.parse(r.tag_ids || '[]'),
  }));

  return c.json({ success: true, data: exportData });
});

// POST /api/v1/templates/import
templateRoutes.post('/import', async (c) => {
  const body = await c.req.json<{ campus_id: number; data: { name: string; tag_ids: number[] }[] }>();
  const db = getDb();
  const stmt = db.prepare('INSERT INTO templates (campus_id, name, tag_ids) VALUES (?, ?, ?)');
  const imported: any[] = [];

  for (const tpl of body.data) {
    const result = stmt.run(body.campus_id, tpl.name, JSON.stringify(tpl.tag_ids));
    imported.push(Number(result.lastInsertRowid));
  }

  return c.json({ success: true, data: { imported: imported.length } });
});

// GET /api/v1/templates/:id
templateRoutes.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const db = getDb();

  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as any;
  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '模板不存在' } }, 404);
  }

  const tagIds = JSON.parse(row.tag_ids || '[]') as number[];
  const tags = tagIds.length > 0
    ? db.prepare(`SELECT * FROM tags WHERE id IN (${tagIds.map(() => '?').join(',')})`).all(...tagIds)
    : [];

  return c.json({ success: true, data: { ...row, tags } });
});

// POST /api/v1/templates
templateRoutes.post('/', async (c) => {
  const body = await c.req.json<{ campus_id: number; name: string; tag_ids: number[] }>();
  const db = getDb();

  const result = db.prepare(
    'INSERT INTO templates (campus_id, name, tag_ids) VALUES (?, ?, ?)'
  ).run(body.campus_id, body.name, JSON.stringify(body.tag_ids));

  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(Number(result.lastInsertRowid));
  return c.json({ success: true, data: row }, 201);
});

// PUT /api/v1/templates/:id
templateRoutes.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ name: string; tag_ids: number[] }>();
  const db = getDb();

  db.prepare('UPDATE templates SET name = ?, tag_ids = ? WHERE id = ?').run(
    body.name, JSON.stringify(body.tag_ids), id
  );

  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  return c.json({ success: true, data: row });
});

// DELETE /api/v1/templates/:id
templateRoutes.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const db = getDb();
  db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  return c.json({ success: true, data: { deleted: true } });
});