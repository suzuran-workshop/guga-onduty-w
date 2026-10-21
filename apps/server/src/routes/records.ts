/**
 * records 路由 —— 核心模块：multipart 图片上传（storage）+ SSE 推送 + 申诉状态机。
 *
 * 迁移要点（对照旧 routes/records.ts）：
 *  - 图片上传：writeFileSync 落盘 → storage.uploadFile（返回 objectKey），并加 MIME/大小/数量校验。
 *    修复旧缺陷：上传无校验、图片无读取端点（死数据）→ 读取走 /files/<key> 代理（app.ts 挂）。
 *  - campusId 强制隔离：resolveWriteCampusId（非 admin 用 profile.campusId，忽略请求体）。
 *  - create/revoke 走 repo（事务 + log）；撤回补 emit record_revoked（修复旧死代码）。
 *  - 申诉端点保持 /records/:id/appeal/* 路径契约，但调 appeals repo（事务联动）。
 *  - RBAC 收紧：revoke=admin，appeal=teacher，approve/reject=admin。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { getProfile, requireRole, resolveCampusId } from '../middleware/profile.js';
import { ok, created, ApiError, parsePagination } from '../http/respond.js';
import { EventBus } from '../utils/event-bus.js';
import type { RecordStatus } from '@guga-onduty-w/shared';

const IMAGE_NS = 'records'; // 命名空间基名；上传拼成 records/<campusId>（REVIEW #5）
const MAX_IMAGES = 9;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB/张
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export function createRecordRoutes(deps: RouteDeps): Hono {
  const { repos, storage } = deps;
  const app = new Hono();

  // GET / —— 分页列表（campusId 强制隔离）
  app.get('/', async (c) => {
    const campusId = resolveCampusId(c);
    const { page, pageSize } = parsePagination(c);
    const status = c.req.query('status') as RecordStatus | undefined;
    const result = await repos.records.list({
      campusId,
      classId: c.req.query('class_id') || undefined,
      week: c.req.query('week') || undefined,
      status: status || undefined,
      page,
      pageSize,
    });
    return ok(c, result.data, result.pagination);
  });

  // POST / —— multipart 创建记录（图片 → storage）
  app.post('/', async (c) => {
    const profile = getProfile(c);
    const form = await c.req.formData();
    const classId = String(form.get('class_id') ?? '');
    const week = String(form.get('week') ?? '');
    if (!classId || !week) throw ApiError.badRequest('缺少 class_id 或 week');

    // 班级归属：记录 campusId = 班级所在校区（与旧代码一致）；非 admin 不得跨校区打分
    const ownership = await repos.classes.findOwnership(classId);
    if (!ownership) throw ApiError.notFound('班级不存在');
    if (profile.role !== 'admin' && ownership.campusId !== profile.campusId) {
      throw ApiError.forbidden('不能跨校区记录');
    }

    const tagIdRaw = form.get('tag_id');
    const tagId = tagIdRaw ? String(tagIdRaw) : null;
    const scoreRaw = form.get('score');
    // REVIEW #6：score 零校验修复——'abc'→NaN 静默存 null、'1e308'→Infinity 撑爆 SUM、无范围限制。
    // 值周分值是小整数（标签默认分 ±1~3），限定 ±100 且必须有限数。
    let score = 0;
    if (scoreRaw !== null && scoreRaw !== '') {
      const parsed = Number(scoreRaw);
      if (!Number.isFinite(parsed)) throw ApiError.badRequest(`分数非法（非有限数）：${scoreRaw}`);
      if (parsed < -100 || parsed > 100) throw ApiError.badRequest('分数超出范围（应 -100~100）');
      score = parsed;
    }
    const commentRaw = form.get('comment');
    const comment = commentRaw ? String(commentRaw) : null;

    // REVIEW #6：tag_id 存在时校验属本校区（防跨校区引用标签）+ score 未显式给时取标签默认分
    if (tagId) {
      const tag = await repos.tags.findById(tagId);
      if (!tag) throw ApiError.badRequest('标签不存在');
      if (tag.campusId !== ownership.campusId) throw ApiError.forbidden('不能引用他校区标签');
    }

    // 图片上传 → storage（校验 MIME/大小/数量）
    const imageFiles = form.getAll('images').filter((f): f is File => f instanceof File && f.size > 0);
    if (imageFiles.length > MAX_IMAGES) throw ApiError.badRequest(`图片最多 ${MAX_IMAGES} 张`);
    const objectKeys: string[] = [];
    for (const file of imageFiles) {
      if (!ALLOWED_MIME.includes(file.type)) {
        throw ApiError.badRequest(`不支持的图片类型：${file.type || '未知'}（仅 jpg/png/gif/webp）`);
      }
      if (file.size > MAX_IMAGE_BYTES) {
        throw ApiError.badRequest(`图片 ${file.name} 超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 上限`);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const r = await storage.uploadFile(`${IMAGE_NS}/${ownership.campusId}`, file.name || 'image.jpg', bytes, file.type);
      objectKeys.push(r.objectKey);
    }

    // 分块上传路径：前端先经 /api/v1/files/{init,chunk,complete} 拿到 objectKey，再随记录提交 image_keys。
    // 记录 POST 请求体因此不含二进制，远小于 qw-pages 网关 ~1MB 入站上限。
    const preKeys = form.getAll('image_keys').filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (preKeys.length > 0) {
      if (objectKeys.length + preKeys.length > MAX_IMAGES) throw ApiError.badRequest(`图片最多 ${MAX_IMAGES} 张`);
      for (const k of preKeys) {
        const segs = k.split('/');
        const wellFormed = segs.length >= 3 && segs[0] === IMAGE_NS && segs[2] === 'files';
        if (!wellFormed) throw ApiError.badRequest('非法图片 key');
        if (segs[1] !== ownership.campusId) throw ApiError.forbidden('不能引用他校区图片');
        objectKeys.push(k);
      }
    }

    const record = await repos.records.create({
      campusId: ownership.campusId,
      classId,
      recorderId: profile.userId,
      tagId,
      score,
      comment,
      images: objectKeys.length > 0 ? objectKeys : null,
      week,
      recordedAt: Date.now(),
    });

    // SSE 推送（补 emit；旧代码 create 有 emit、revoke 无）
    EventBus.emit('record_created', {
      recordId: record.id,
      className: record.className,
      tagName: record.tagName,
      points: record.score ?? 0,
      timestamp: record.recordedAt,
      campusId: record.campusId,
    });

    return created(c, record);
  });

  // GET /:id —— 详情（校区隔离：非 admin 只能看本校区）
  app.get('/:id', async (c) => {
    const campusId = resolveCampusId(c);
    const record = await repos.records.findByIdWithDetails(c.req.param('id'));
    if (!record) throw ApiError.notFound('记录不存在');
    if (record.campusId !== campusId && getProfile(c).role !== 'admin') {
      throw ApiError.notFound('记录不存在'); // 不泄露跨校区记录的存在性
    }
    return ok(c, record);
  });

  // DELETE /:id —— admin 撤回（软删）
  app.delete('/:id', requireRole('admin'), async (c) => {
    await revokeAndEmit(c.req.param('id'), getProfile(c).userId, '管理员撤回');
    return ok(c, { revoked: true });
  });

  // POST /:id/revoke —— admin 撤回（带 reason）
  app.post('/:id/revoke', requireRole('admin'), async (c) => {
    const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
    await revokeAndEmit(c.req.param('id'), getProfile(c).userId, body.reason || '管理员撤回');
    return ok(c, { revoked: true });
  });

  // POST /:id/appeal —— teacher 申诉
  app.post('/:id/appeal', requireRole('teacher'), async (c) => {
    const profile = getProfile(c);
    const body = await c.req.json<{ reason: string }>().catch(() => ({ reason: '' }));
    if (!body.reason) throw ApiError.badRequest('申诉理由不能为空');
    const recordId = c.req.param('id');
    const record = await repos.records.findByIdWithDetails(recordId);
    if (!record) throw ApiError.notFound('记录不存在');
    if (record.campusId !== profile.campusId) throw ApiError.forbidden('不能跨校区申诉');
    if (record.status !== 'active') throw ApiError.badRequest('仅 active 记录可申诉');
    await repos.appeals.create({ recordId, teacherId: profile.userId, reason: body.reason, campusId: profile.campusId });
    return created(c, { appealed: true });
  });

  // POST /:id/appeal/approve —— admin 批准
  app.post('/:id/appeal/approve', requireRole('admin'), async (c) => {
    const body = await c.req.json<{ review_comment?: string }>().catch(() => ({}) as { review_comment?: string });
    await repos.appeals.approve(c.req.param('id'), getProfile(c).userId, body.review_comment ?? null);
    return ok(c, { approved: true });
  });

  // POST /:id/appeal/reject —— admin 驳回
  app.post('/:id/appeal/reject', requireRole('admin'), async (c) => {
    const body = await c.req.json<{ review_comment?: string }>().catch(() => ({}) as { review_comment?: string });
    await repos.appeals.reject(c.req.param('id'), getProfile(c).userId, body.review_comment ?? null);
    return ok(c, { rejected: true });
  });

  /** 撤回 + emit record_revoked（修复旧死代码） */
  async function revokeAndEmit(id: string, operatorId: string, reason: string) {
    const before = await repos.records.findByIdWithDetails(id);
    if (!before) throw ApiError.notFound('记录不存在');
    await repos.records.revoke(id, operatorId, reason);
    EventBus.emit('record_revoked', { recordId: id, campusId: before.campusId, timestamp: Date.now() });
  }

  return app;
}
