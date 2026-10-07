import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { authMiddleware, getCurrentUser } from '../middleware/auth.js';

export const awardRoutes = new Hono();
awardRoutes.use('*', authMiddleware);

// GET /api/v1/awards
awardRoutes.get('/', (c) => {
  const db = getDb();
  const user = getCurrentUser(c);
  const campusId = c.req.query('campus_id') || String(user.campus_id);
  const week = c.req.query('week');

  let sql = `
    SELECT a.*, cl.name as class_name, g.name as grade_name
    FROM awards a
    JOIN classes cl ON a.class_id = cl.id
    JOIN grades g ON cl.grade_id = g.id
    WHERE a.campus_id = ?
  `;
  const params: any[] = [Number(campusId)];

  if (week) {
    sql += ' AND a.week = ?';
    params.push(week);
  }

  sql += ' ORDER BY a.awarded_at DESC';

  const rows = db.prepare(sql).all(...params);
  return c.json({ success: true, data: rows });
});

// POST /api/v1/awards — award red flag
awardRoutes.post('/', async (c) => {
  const body = await c.req.json<{ campus_id: number; week: string; grade_id?: number }>();
  const db = getDb();

  // Get rankings for the week
  let rankingSql = `
    SELECT cl.id as class_id, cl.name, g.id as grade_id, g.name as grade_name,
           COALESCE(SUM(CASE WHEN r.status IN ('active', 'appealing') THEN r.score ELSE 0 END), 0) as total_score
    FROM classes cl
    JOIN grades g ON cl.grade_id = g.id
    LEFT JOIN records r ON cl.id = r.class_id AND r.week = ? AND r.campus_id = cl.campus_id
    WHERE cl.campus_id = ?
  `;
  const params: any[] = [body.week, body.campus_id];

  if (body.grade_id) {
    rankingSql += ' AND g.id = ?';
    params.push(body.grade_id);
  }

  rankingSql += ' GROUP BY cl.id ORDER BY g.id, total_score DESC';

  const rankings = db.prepare(rankingSql).all(...params) as any[];

  // Award the top class in each grade
  const awardedGrades = new Set<number>();
  const awards: any[] = [];

  for (const r of rankings) {
    if (!awardedGrades.has(r.grade_id)) {
      awardedGrades.add(r.grade_id);

      const result = db.prepare(
        'INSERT INTO awards (campus_id, class_id, week, category, note) VALUES (?, ?, ?, ?, ?)'
      ).run(body.campus_id, r.class_id, body.week, 'overall',
        `${r.grade_name} ${r.name} 获第${body.week}周流动红旗`);

      awards.push(Number(result.lastInsertRowid));
    }
  }

  const rows = db.prepare(`
    SELECT a.*, cl.name as class_name, g.name as grade_name
    FROM awards a
    JOIN classes cl ON a.class_id = cl.id
    JOIN grades g ON cl.grade_id = g.id
    WHERE a.id IN (${awards.map(() => '?').join(',')})
  `).all(...awards);

  return c.json({ success: true, data: rows }, 201);
});

// DELETE /api/v1/awards/:id
awardRoutes.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const db = getDb();
  db.prepare('DELETE FROM awards WHERE id = ?').run(id);
  return c.json({ success: true, data: { deleted: true } });
});