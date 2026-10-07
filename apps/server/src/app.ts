import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authRoutes } from './routes/auth.js';
import { campusRoutes } from './routes/campuses.js';
import { gradeRoutes } from './routes/grades.js';
import { classRoutes } from './routes/classes.js';
import { userRoutes } from './routes/users.js';
import { groupRoutes } from './routes/groups.js';
import { tagRoutes } from './routes/tags.js';
import { templateRoutes } from './routes/templates.js';
import { recordRoutes } from './routes/records.js';
import { appealRoutes } from './routes/appeals.js';
import { summaryRoutes } from './routes/summary.js';
import { statisticsRoutes } from './routes/statistics.js';
import { awardRoutes } from './routes/awards.js';
import { settingRoutes } from './routes/settings.js';
import { sseRoutes } from './routes/sse.js';

export function createApp(): Hono {
  const app = new Hono();

  // Global middleware
  app.use('*', cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  }));
  app.use('*', logger());

  // Health check
  app.get('/api/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }));

  // Mount all route groups
  app.route('/api/v1/auth', authRoutes);
  app.route('/api/v1/campuses', campusRoutes);
  app.route('/api/v1/grades', gradeRoutes);
  app.route('/api/v1/classes', classRoutes);
  app.route('/api/v1/users', userRoutes);
  app.route('/api/v1/groups', groupRoutes);
  app.route('/api/v1/tags', tagRoutes);
  app.route('/api/v1/templates', templateRoutes);
  app.route('/api/v1/records', recordRoutes);
  app.route('/api/v1/appeals', appealRoutes);
  app.route('/api/v1/summaries', summaryRoutes);
  app.route('/api/v1/statistics', statisticsRoutes);
  app.route('/api/v1/awards', awardRoutes);
  app.route('/api/v1/settings', settingRoutes);
  app.route('/api/v1/sse', sseRoutes);

  return app;
}