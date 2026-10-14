/**
 * HTTP 响应助手 —— 统一 {success, data, pagination} / {success, error} 包裹。
 *
 * 保持与现有前端契约一致（docs §4），减少前端改动面。
 * onError（app.ts）用 ApiError 类统一转 JSON，不泄堆栈。
 */
import type { Context } from 'hono';
import type { Pagination } from '@class-duty/shared';

/** 业务错误：带 HTTP 状态码 + 错误码 + 中文消息（onError 统一转 JSON） */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  static badRequest(message: string, code = 'VALIDATION_ERROR') {
    return new ApiError(400, code, message);
  }
  static unauthorized(message = '未认证') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = '权限不足') {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static notFound(message: string, code = 'NOT_FOUND') {
    return new ApiError(404, code, message);
  }
  static conflict(message: string, code = 'CONFLICT') {
    return new ApiError(409, code, message);
  }
}

/** 成功响应（可选分页） */
export function ok<T>(c: Context, data: T, pagination?: Pagination, status = 200) {
  return c.json(pagination ? { success: true, data, pagination } : { success: true, data }, status as 200);
}

/** 201 Created */
export function created<T>(c: Context, data: T) {
  return c.json({ success: true, data }, 201);
}

/** 解析分页 query（page 默认 1，pageSize 默认 20，上限 100 防滥用） */
export function parsePagination(c: Context): { page: number; pageSize: number } {
  const page = Math.max(1, Number(c.req.query('page') || '1') || 1);
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') || '20') || 20));
  return { page, pageSize };
}

/** 判断是否唯一约束冲突（drizzle/sqlite/pg 错误 → 409） */
export function isUniqueViolation(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e);
  return /UNIQUE constraint failed|duplicate key value|unique violation|23505/i.test(msg);
}
