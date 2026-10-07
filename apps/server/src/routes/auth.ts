import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { signToken, authMiddleware, getCurrentUser } from '../middleware/auth.js';
import bcryptjs from 'bcryptjs';
import type { LoginRequest, LoginResponse, User } from '@class-duty/shared';

export const authRoutes = new Hono();

// POST /api/v1/auth/login
authRoutes.post('/login', async (c) => {
  const body = await c.req.json<LoginRequest>();
  const db = getDb();

  const row = db.prepare(
    'SELECT id, campus_id, username, password_hash, display_name, role, group_id, created_at FROM users WHERE username = ?'
  ).get(body.username) as any;

  if (!row || !bcryptjs.compareSync(body.password, row.password_hash)) {
    return c.json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' } }, 401);
  }

  const user: User = {
    id: row.id,
    campus_id: row.campus_id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    group_id: row.group_id,
    created_at: row.created_at,
  };

  const token = signToken({
    sub: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    campus_id: user.campus_id,
  });

  const response: LoginResponse = { token, user };
  return c.json({ success: true, data: response });
});

// POST /api/v1/auth/register (admin only)
authRoutes.post('/register', authMiddleware, async (c) => {
  const currentUser = getCurrentUser(c);
  if (currentUser.role !== 'admin') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: '仅管理员可创建用户' } }, 403);
  }

  const body = await c.req.json<{ username: string; password: string; display_name: string; role: string; campus_id: number }>();
  const db = getDb();

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(body.username);
  if (existing) {
    return c.json({ success: false, error: { code: 'CONFLICT', message: '用户名已存在' } }, 409);
  }

  const hash = bcryptjs.hashSync(body.password, 10);
  const result = db.prepare(
    'INSERT INTO users (campus_id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)'
  ).run(body.campus_id, body.username, hash, body.display_name, body.role);

  const row = db.prepare('SELECT id, campus_id, username, display_name, role, group_id, created_at FROM users WHERE id = ?').get(Number(result.lastInsertRowid)) as any;

  return c.json({ success: true, data: row }, 201);
});

// GET /api/v1/auth/me
authRoutes.get('/me', authMiddleware, async (c) => {
  const user = getCurrentUser(c);
  const db = getDb();

  const row = db.prepare(
    'SELECT id, campus_id, username, display_name, role, group_id, created_at FROM users WHERE id = ?'
  ).get(user.sub) as any;

  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '用户不存在' } }, 404);
  }

  const campus = db.prepare('SELECT name FROM campuses WHERE id = ?').get(row.campus_id) as any;

  return c.json({
    success: true,
    data: { ...row, campus_name: campus?.name || '' },
  });
});