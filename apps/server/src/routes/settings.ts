import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { authMiddleware, getCurrentUser } from '../middleware/auth.js';

export const settingRoutes = new Hono();
settingRoutes.use('*', authMiddleware);

// GET /api/v1/settings
settingRoutes.get('/', (c) => {
  const db = getDb();
  const user = getCurrentUser(c);
  const campusId = c.req.query('campus_id') || String(user.campus_id);

  const rows = db.prepare(
    'SELECT * FROM settings WHERE campus_id = ?'
  ).all(Number(campusId));

  // Return as key-value map
  const map: Record<string, string> = {};
  for (const r of rows as any[]) {
    map[r.key] = r.value;
  }

  return c.json({ success: true, data: map });
});

// PUT /api/v1/settings (batch update)
settingRoutes.put('/', async (c) => {
  const body = await c.req.json<{ campus_id: number; settings: { key: string; value: string }[] }>();
  const db = getDb();

  const stmt = db.prepare(
    'INSERT INTO settings (campus_id, key, value) VALUES (?, ?, ?) ON CONFLICT(campus_id, key) DO UPDATE SET value = excluded.value'
  );

  for (const s of body.settings) {
    stmt.run(body.campus_id, s.key, s.value);
  }

  return c.json({ success: true, data: { updated: true } });
});