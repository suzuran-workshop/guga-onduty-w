import type { Context, Next } from 'hono';
import type { JwtPayload } from '@class-duty/shared';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'class-duty-dev-secret-key-2026';

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

// Auth middleware — attaches user to context
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: '未提供认证令牌' } }, 401);
  }

  try {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    c.set('user', payload);
    await next();
  } catch {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: '令牌无效或已过期' } }, 401);
  }
}

// Role check middleware factory
export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as JwtPayload | undefined;
    if (!user) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: '未认证' } }, 401);
    }
    if (!roles.includes(user.role)) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: '权限不足' } }, 403);
    }
    await next();
  };
}

// Helper to get current user from context
export function getCurrentUser(c: Context): JwtPayload {
  return c.get('user') as JwtPayload;
}