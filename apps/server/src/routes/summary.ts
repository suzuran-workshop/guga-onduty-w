import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { authMiddleware, getCurrentUser } from '../middleware/auth.js';

export const summaryRoutes = new Hono();
summaryRoutes.use('*', authMiddleware);

// GET /api/v1/summaries
summaryRoutes.get('/', (c) => {
  const db = getDb();
  const user = getCurrentUser(c);
  const campusId = c.req.query('campus_id') || String(user.campus_id);
  const week = c.req.query('week');

  let sql = 'SELECT * FROM daily_summaries WHERE campus_id = ?';
  const params: any[] = [Number(campusId)];

  if (week) {
    sql += ' AND week = ?';
    params.push(week);
  }

  sql += ' ORDER BY date DESC, created_at DESC';

  const rows = db.prepare(sql).all(...params);
  return c.json({ success: true, data: rows });
});

// POST /api/v1/summaries
summaryRoutes.post('/', async (c) => {
  const body = await c.req.json<{
    campus_id: number; week: string; date: string; content: string;
    notified_teachers?: number[];
  }>();
  const db = getDb();

  const result = db.prepare(
    'INSERT INTO daily_summaries (campus_id, week, date, content, notified_teachers) VALUES (?, ?, ?, ?, ?)'
  ).run(body.campus_id, body.week, body.date, body.content,
    body.notified_teachers ? JSON.stringify(body.notified_teachers) : null);

  const row = db.prepare('SELECT * FROM daily_summaries WHERE id = ?').get(Number(result.lastInsertRowid));
  return c.json({ success: true, data: row }, 201);
});