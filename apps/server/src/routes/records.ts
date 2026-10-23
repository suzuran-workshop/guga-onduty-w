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
import { resolveDingtalkUserId } from '../platform/resolve-identity.js';
import type { RecordStatus } from '@guga-onduty-w/shared';

const IMAGE_NS = 'records'; // 命名空间基名；上传拼成 records/<campusId>（REVIEW #5）
const MAX_IMAGES = 9;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB/张
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export function createRecordRoutes(deps: RouteDeps): Hono {
  const { repos, storage, auth } = deps;
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
  // 2026-10-23 改造：班级平铺多选（每班级落一条独立记录）+ 标签多选（分数服务端求和，标签分权威）
  //   + 含任一扣分标签则强制拍照。字段：class_ids[]、tag_ids[]、week、comment?、images[]、image_keys[]。
  app.post('/', async (c) => {
    const profile = getProfile(c);
    const form = await c.req.formData();
    const week = String(form.get('week') ?? '');
    const classIds = form.getAll('class_ids').map(String).filter((s) => s.length > 0);
    const tagIds = Array.from(new Set(form.getAll('tag_ids').map(String).filter((s) => s.length > 0)));
    if (classIds.length === 0) throw ApiError.badRequest('至少选择一个班级');
    if (!week) throw ApiError.badRequest('缺少 week');

    // 班级归属：逐个校验存在性 + 校区（非 admin 不得跨校区打分）；一次批量评价须同校区（简化标签校验与存储命名空间）
    const ownerships = new Map<string, { campusId: string }>();
    for (const classId of classIds) {
      const ownership = await repos.classes.findOwnership(classId);
      if (!ownership) throw ApiError.notFound(`班级不存在：${classId}`);
      if (profile.role !== 'admin' && ownership.campusId !== profile.campusId) {
        throw ApiError.forbidden('不能跨校区记录');
      }
      ownerships.set(classId, { campusId: ownership.campusId });
    }
    const campusIds = Array.from(new Set(classIds.map((id) => ownerships.get(id)!.campusId)));
    if (campusIds.length !== 1) throw ApiError.badRequest('一次评价的班级须属同一校区');
    const campusId = campusIds[0]!;

    const commentRaw = form.get('comment');
    const comment = commentRaw ? String(commentRaw) : null;

    // 标签校验：全部存在 + 属本校区（防跨校区引用）。分数由 repo 按 tagIds 求和（标签分权威，不接受前端 score）。
    // 「含任一扣分标签则必须拍照」——扣分判定：category==='negative' 或 score<0（训练员确认：点了扣分标签即拍照）。
    let hasDeduction = false;
    if (tagIds.length > 0) {
      const foundTags = await repos.tags.findByIds(tagIds);
      const foundIds = new Set(foundTags.map((t) => t.id));
      for (const tid of tagIds) {
        if (!foundIds.has(tid)) throw ApiError.badRequest(`标签不存在：${tid}`);
      }
      for (const t of foundTags) {
        if (t.campusId !== campusId) throw ApiError.forbidden('不能引用他校区标签');
        if (t.category === 'negative' || t.score < 0) hasDeduction = true;
      }
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
      const r = await storage.uploadFile(`${IMAGE_NS}/${campusId}`, file.name || 'image.jpg', bytes, file.type);
      objectKeys.push(r.objectKey);
    }

    // 分块上传路径：前端先经 /api/v1/files/{init,chunk,complete} 拿到 objectKey，再随记录提交 image_keys。
    // 记录 POST 请求体因此不含二进制（历史为绕 qw-pages 网关上限，现保留见 routes/files.ts 说明）。
    const preKeys = form.getAll('image_keys').filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (preKeys.length > 0) {
      if (objectKeys.length + preKeys.length > MAX_IMAGES) throw ApiError.badRequest(`图片最多 ${MAX_IMAGES} 张`);
      for (const k of preKeys) {
        const segs = k.split('/');
        const wellFormed = segs.length >= 3 && segs[0] === IMAGE_NS && segs[2] === 'files';
        if (!wellFormed) throw ApiError.badRequest('非法图片 key');
        if (segs[1] !== campusId) throw ApiError.forbidden('不能引用他校区图片');
        objectKeys.push(k);
      }
    }

    // 扣分必拍照：两条上传路径（multipart images + 分块 image_keys）合并后再判，防分块路径绕过
    if (hasDeduction && objectKeys.length === 0) {
      throw ApiError.badRequest('选择扣分标签时必须拍照（至少一张图片）');
    }

    const images = objectKeys.length > 0 ? objectKeys : null;
    // 每班级落一条独立记录（单事务，全成或全败）；分数由 repo 按 tagIds 求和
    const createdRecords = await repos.records.createMany({
      campusId,
      classIds,
      recorderId: profile.userId,
      tagIds,
      comment,
      images,
      week,
      recordedAt: Date.now(),
    });

    // SSE 推送：每条记录一个事件（大屏/看板消费）
    for (const record of createdRecords) {
      EventBus.emit('record_created', {
        recordId: record.id,
        className: record.className,
        tagNames: record.tags.map((t) => t.name),
        points: record.score,
        timestamp: record.recordedAt,
        campusId: record.campusId,
      });
    }

    return created(c, createdRecords);
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

  // GET /:id/logs —— 记录操作日志（创建/撤回/申诉/调分史）。
  // 2026-10-23：申诉通过改为「调分回 active」后，调分史从 record.status 迁移到了 recordLogs，
  // 此前 recordLogs 是纯写表（全仓无读取路径）→ 调分不可追溯。故补此端点。
  // 权限：admin/teacher（含审批意见等监督面信息，不对值周生开放，与 RBAC 收紧方向一致）。
  app.get('/:id/logs', requireRole('admin', 'teacher'), async (c) => {
    const campusId = resolveCampusId(c);
    const record = await repos.records.findByIdWithDetails(c.req.param('id'));
    if (!record) throw ApiError.notFound('记录不存在');
    if (record.campusId !== campusId && getProfile(c).role !== 'admin') {
      throw ApiError.notFound('记录不存在'); // 不泄露跨校区记录的存在性
    }
    return ok(c, await repos.records.listLogs(record.id));
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

  // POST /:id/appeal —— teacher 申诉（2026-10-23：只能申诉自己班）
  app.post('/:id/appeal', requireRole('teacher'), async (c) => {
    const profile = getProfile(c);
    const body = await c.req.json<{ reason: string }>().catch(() => ({ reason: '' }));
    if (!body.reason) throw ApiError.badRequest('申诉理由不能为空');
    const recordId = c.req.param('id');
    const record = await repos.records.findByIdWithDetails(recordId);
    if (!record) throw ApiError.notFound('记录不存在');
    if (record.campusId !== profile.campusId) throw ApiError.forbidden('不能跨校区申诉');
    // 归属校验：班主任只能申诉自己任班主任的班。
    // classes.teacherDingtalkId 存的是**钉钉 userid**，而登录态是 profile.userId（系统 users.id），
    // 二者经 oauth2_identity_links 关联（教师用钉钉 OAuth 登录后 SDK 写入）→ 先解析成钉钉 userid 再比对。
    // fail-closed：未绑定班主任的班、或解析不出钉钉身份（如账密登录的教师），一律拒绝，
    // 并引导走钉钉推送里的免登录令牌链接（那条路径绑定 teacherDingtalkId，不依赖此解析）。
    const ownership = await repos.classes.findOwnership(record.classId);
    if (!ownership?.teacherDingtalkId) {
      throw ApiError.forbidden('该班级未绑定班主任，无法申诉');
    }
    const teacherDingtalkId = await resolveDingtalkUserId(auth.linkStore, profile.userId);
    if (!teacherDingtalkId) {
      // 账密登录的教师无法在系统内证明「我是那个钉钉班主任」→ 引导走钉钉免登录链接
      throw ApiError.forbidden('请用钉钉收到的申诉链接提交（系统内申诉需先用钉钉登录以关联身份）');
    }
    if (ownership.teacherDingtalkId !== teacherDingtalkId) {
      throw ApiError.forbidden('只能对本班记录发起申诉');
    }
    if (record.status !== 'active') throw ApiError.badRequest('仅 active 记录可申诉');
    // teacherDingtalkId 是「谁申诉的」权威来源（免登录路径同样回填它）；
    // teacherId 顺带留系统账号，有则便于关联，无则 null（见 appeals.teacherId 注释）。
    // create 严格语义：记录非 active（含并发抢转换失败）→ null。
    const appeal = await repos.appeals.create({
      recordId,
      teacherId: profile.userId,
      teacherDingtalkId,
      reason: body.reason,
      campusId: profile.campusId,
    });
    if (!appeal) throw ApiError.conflict('该记录当前状态不可申诉（可能已撤回或申诉处理中）', 'RECORD_NOT_APPEALABLE');
    return created(c, { appealed: true });
  });

  // POST /:id/appeal/approve —— admin 批准（2026-10-23：修改而非撤销）
  // 管理员给出调整后的 tag_ids（省略则保持原标签集），分数由 repo 按标签重算，记录回 active 照常计分。
  app.post('/:id/appeal/approve', requireRole('admin'), async (c) => {
    const body = await c.req
      .json<{ review_comment?: string; tag_ids?: string[] }>()
      .catch(() => ({}) as { review_comment?: string; tag_ids?: string[] });
    // 传了 tag_ids 则校验其存在性与校区归属（防跨校区引用/伪造分数）
    if (body.tag_ids) {
      if (!Array.isArray(body.tag_ids)) throw ApiError.badRequest('tag_ids 须为数组');
      const record = await repos.records.findByIdWithDetails(c.req.param('id'));
      if (!record) throw ApiError.notFound('记录不存在');
      const tagIds = Array.from(new Set(body.tag_ids.map(String).filter((s) => s.length > 0)));
      if (tagIds.length > 0) {
        const foundTags = await repos.tags.findByIds(tagIds);
        if (foundTags.length !== tagIds.length) throw ApiError.badRequest('存在不存在的标签');
        for (const t of foundTags) {
          if (t.campusId !== record.campusId) throw ApiError.forbidden('不能引用他校区标签');
        }
      }
      await repos.appeals.approve(c.req.param('id'), getProfile(c).userId, {
        reviewComment: body.review_comment ?? null,
        tagIds,
      });
    } else {
      await repos.appeals.approve(c.req.param('id'), getProfile(c).userId, {
        reviewComment: body.review_comment ?? null,
      });
    }
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
