import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { authMiddleware, getCurrentUser } from '../middleware/auth.js';

export const statisticsRoutes = new Hono();
statisticsRoutes.use('*', authMiddleware);

// GET /api/v1/statistics/ranking
statisticsRoutes.get('/ranking', (c) => {
  const db = getDb();
  const user = getCurrentUser(c);
  const campusId = c.req.query('campus_id') || String(user.campus_id);
  const week = c.req.query('week');
  const gradeId = c.req.query('grade_id');

  let sql = `
    SELECT
      cl.id as class_id, cl.name as class_name,
      g.id as grade_id, g.name as grade_name,
      COALESCE(SUM(CASE WHEN r.status IN ('active', 'appealing') THEN r.score ELSE 0 END), 0) as total_score,
      COALESCE(SUM(CASE WHEN r.status IN ('active', 'appealing') AND r.score > 0 THEN 1 ELSE 0 END), 0) as positive_count,
      COALESCE(SUM(CASE WHEN r.status IN ('active', 'appealing') AND r.score < 0 THEN 1 ELSE 0 END), 0) as negative_count,
      COALESCE(COUNT(CASE WHEN r.status IN ('active', 'appealing') THEN 1 END), 0) as record_count
    FROM classes cl
    JOIN grades g ON cl.grade_id = g.id
    LEFT JOIN records r ON cl.id = r.class_id AND r.campus_id = cl.campus_id
      ${week ? 'AND r.week = ?' : ''}
    WHERE cl.campus_id = ?
  `;
  const params: any[] = [];

  if (week) params.push(week);
  params.push(Number(campusId));

  if (gradeId) {
    sql += ' AND g.id = ?';
    params.push(Number(gradeId));
  }

  sql += ' GROUP BY cl.id ORDER BY total_score DESC';

  const rows = db.prepare(sql).all(...params);
  const rankings = (rows as any[]).map((r, i) => ({ ...r, rank: i + 1 }));

  return c.json({ success: true, data: rankings });
});

// GET /api/v1/statistics/trend
statisticsRoutes.get('/trend', (c) => {
  const db = getDb();
  const user = getCurrentUser(c);
  const classId = c.req.query('class_id');
  const weeks = c.req.query('weeks') || '4';

  if (!classId) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: '请指定班级' } }, 400);
  }

  // Generate last N weeks list
  const weekList: string[] = [];
  const now = new Date();
  for (let i = Number(weeks) - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7);
    weekList.push(`${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`);
  }

  const rows = db.prepare(`
    SELECT r.week, COALESCE(SUM(CASE WHEN r.status IN ('active', 'appealing') THEN r.score ELSE 0 END), 0) as total_score
    FROM records r
    WHERE r.class_id = ? AND r.week IN (${weekList.map(() => '?').join(',')})
    GROUP BY r.week ORDER BY r.week
  `).all(Number(classId), ...weekList) as any[];

  // Fill in zeros for weeks without data
  const trend = weekList.map(w => ({
    week: w,
    total_score: rows.find(r => r.week === w)?.total_score || 0,
  }));

  return c.json({ success: true, data: trend });
});

// GET /api/v1/statistics/dashboard
statisticsRoutes.get('/dashboard', (c) => {
  const db = getDb();
  const user = getCurrentUser(c);
  const campusId = Number(c.req.query('campus_id') || user.campus_id);

  const today = new Date().toISOString().slice(0, 10);

  const todayRecords = db.prepare(`
    SELECT COUNT(*) as total FROM records
    WHERE campus_id = ? AND date(recorded_at) = ? AND status = 'active'
  `).get(campusId, today) as any;

  const todayPositive = db.prepare(`
    SELECT COALESCE(SUM(score), 0) as total FROM records
    WHERE campus_id = ? AND date(recorded_at) = ? AND score > 0 AND status = 'active'
  `).get(campusId, today) as any;

  const todayNegative = db.prepare(`
    SELECT COALESCE(SUM(score), 0) as total FROM records
    WHERE campus_id = ? AND date(recorded_at) = ? AND score < 0 AND status = 'active'
  `).get(campusId, today) as any;

  // Top class this week
  const weekInfo = getCurrentWeek();
  const topClass = db.prepare(`
    SELECT cl.name as class_name, COALESCE(SUM(r.score), 0) as total_score
    FROM records r
    JOIN classes cl ON r.class_id = cl.id
    WHERE r.campus_id = ? AND r.week = ? AND r.status IN ('active', 'appealing')
    GROUP BY cl.id ORDER BY total_score DESC LIMIT 1
  `).get(campusId, weekInfo) as any;

  return c.json({
    success: true,
    data: {
      today_records: todayRecords?.total || 0,
      today_positive: todayPositive?.total || 0,
      today_negative: todayNegative?.total || 0,
      week_top_class: topClass?.class_name || null,
      week_top_score: topClass?.total_score || null,
    },
  });
});

// GET /api/v1/statistics/export
statisticsRoutes.get('/export', (c) => {
  const db = getDb();
  const user = getCurrentUser(c);
  const campusId = c.req.query('campus_id') || String(user.campus_id);
  const startWeek = c.req.query('start_week');
  const endWeek = c.req.query('end_week');

  let sql = `
    SELECT r.*, cl.name as class_name, g.name as grade_name,
           u.display_name as recorder_name, t.name as tag_name
    FROM records r
    JOIN classes cl ON r.class_id = cl.id
    JOIN grades g ON cl.grade_id = g.id
    JOIN users u ON r.recorder_id = u.id
    LEFT JOIN tags t ON r.tag_id = t.id
    WHERE r.campus_id = ?
  `;
  const params: any[] = [Number(campusId)];

  if (startWeek) { sql += ' AND r.week >= ?'; params.push(startWeek); }
  if (endWeek) { sql += ' AND r.week <= ?'; params.push(endWeek); }

  sql += ' ORDER BY r.recorded_at DESC';

  const rows = db.prepare(sql).all(...params) as any[];

  // Generate CSV
  const headers = ['ID', '班级', '年级', '标签', '分数', '备注', '周次', '记录时间', '记录人', '状态'];
  const csvRows = [
    '﻿' + headers.join(','),
    ...rows.map(r => [
      r.id, r.class_name, r.grade_name, r.tag_name || '', r.score, `"${(r.comment || '').replace(/"/g, '""')}"`,
      r.week, r.recorded_at, r.recorder_name, r.status,
    ].join(',')),
  ];

  const csv = csvRows.join('\n');

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="records_${new Date().toISOString().slice(0, 10)}.csv"`);
  return c.body(csv);
});

// Week utility
function getCurrentWeek(): string {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((now.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}