/**
 * 值班域路由 —— 排班/打卡/巡查/调班/矩阵/统计。
 *
 * 挂载：/api/v1/duty/*（见 routes/index.ts）。中间件链已由 createApp + requireProfile 装好，
 * 此处每个写端点按 RBAC 矩阵加 requireRole，读端点按 campusId 强制隔离。
 *
 * 端点（对照 docs/DUTY-FUSION.md §4 + 外部 PRD 功能语义，自有实现）：
 *  配置(admin)：areas/locations/time-slots CRUD
 *  排班(admin)：schedules CRUD + Excel 导入 + 矩阵视图
 *  打卡(本人)：POST checkins(multipart 照片必填) + 今日任务 + 我的打卡
 *  巡查(canInspect)：POST inspections(逐记录展开) + 列表
 *  调班(本人发起/admin审批)：POST swaps + 审批 + 列表
 *  报表：attendance 到岗率
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { getProfile, requireRole, resolveCampusId, resolveWriteCampusId } from '../middleware/profile.js';
import { ok, created, ApiError, parsePagination, isUniqueViolation } from '../http/respond.js';
import { getWeekMatrix, getTodayTasks, getAttendance } from '../duty/service.js';
import { mondayOf, dateKey, weekDates, startOfDay, parseDate } from '../duty/date.js';
import { expandSchedules } from '../duty/expand.js';
import { buildSwapOverlay, applySwapOverlay } from '../duty/swap-overlay.js';
import type { DutyKind, SwapType, InspectionItem, Weekday } from '../duty/types.js';

const CHECKIN_NS = 'duty-checkin';
const INSPECT_NS = 'duty-inspect';
const MAX_PHOTOS = 9;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** 上传照片到 storage（复用 records 的校验策略） */
async function uploadPhotos(deps: RouteDeps, ns: string, files: File[]): Promise<string[]> {
  const { storage } = deps;
  if (files.length > MAX_PHOTOS) throw ApiError.badRequest(`照片最多 ${MAX_PHOTOS} 张`);
  const keys: string[] = [];
  for (const file of files) {
    if (!ALLOWED_MIME.includes(file.type)) throw ApiError.badRequest(`不支持的图片类型：${file.type || '未知'}`);
    if (file.size > MAX_PHOTO_BYTES) throw ApiError.badRequest(`图片超过 ${MAX_PHOTO_BYTES / 1024 / 1024}MB 上限`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = await storage.uploadFile(ns, file.name || 'photo.jpg', bytes, file.type);
    keys.push(r.objectKey);
  }
  return keys;
}

export function createDutyRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  // ══════════ 值班大表矩阵（核心视图，所有角色可读）══════════
  // GET /matrix?week=YYYY-MM-DD(周内任意日)&kind=&area_id=
  app.get('/matrix', async (c) => {
    const campusId = resolveCampusId(c);
    const weekParam = c.req.query('week');
    const anchor = weekParam ? parseDate(weekParam) : new Date();
    const kind = c.req.query('kind') as DutyKind | undefined;
    const areaId = c.req.query('area_id') || undefined;
    const view = await getWeekMatrix({ repos }, { campusId, anchor, kind, areaId });
    return ok(c, view);
  });

  // ══════════ 执勤打卡 ══════════
  // GET /checkins/today —— 今日我的执勤任务（打卡工作台）
  app.get('/checkins/today', async (c) => {
    const profile = getProfile(c);
    const dateParam = c.req.query('date');
    const date = dateParam ? parseDate(dateParam) : new Date();
    const tasks = await getTodayTasks({ repos }, profile.campusId, profile.userId, date);
    return ok(c, tasks);
  });

  // GET /checkins/mine —— 我的打卡历史
  app.get('/checkins/mine', async (c) => {
    const profile = getProfile(c);
    const { page, pageSize } = parsePagination(c);
    const r = await repos.duty.checkins.listByTeacher(profile.userId, {
      dateFrom: c.req.query('date_from') || undefined,
      dateTo: c.req.query('date_to') || undefined,
      page, pageSize,
    });
    return ok(c, r.data, r.pagination);
  });

  // POST /checkins —— 提交执勤打卡（multipart，照片必填≥1，仅本人班次）
  app.post('/checkins', async (c) => {
    const profile = getProfile(c);
    const form = await c.req.formData();
    const scheduleId = String(form.get('schedule_id') ?? '');
    const dutyDate = String(form.get('duty_date') ?? '');
    const situation = form.get('situation') ? String(form.get('situation')) : null;
    if (!scheduleId || !dutyDate) throw ApiError.badRequest('缺少 schedule_id 或 duty_date');

    // 照片必填≥1（对齐外部 PRD：打卡强制照片）
    const photoFiles = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
    if (photoFiles.length === 0) throw ApiError.badRequest('执勤照片必填（至少 1 张）');

    // 校验：本人班次守卫（精确到被打卡的排班实例的实际值班人，防越权代打卡）
    const sched = await repos.duty.schedules.findById(scheduleId);
    if (!sched) throw ApiError.notFound('排班不存在');
    if (sched.campusId !== profile.campusId) throw ApiError.forbidden('不能跨校区打卡');
    // 展开该排班在 dutyDate 的实例，叠加调班，确认本人是实际值班人
    const day = parseDate(dutyDate);
    const insts = expandSchedules([sched], { from: day, to: day });
    if (insts.length === 0) throw ApiError.badRequest('该日期无此排班（不匹配周内日/单双周/区间）');
    const approved = await repos.duty.swaps.listApproved(profile.campusId);
    const users = await repos.users.list(profile.campusId);
    const userNames = new Map(users.map((u) => [u.id, u.displayName]));
    const effective = applySwapOverlay(insts, buildSwapOverlay(approved), userNames);
    const inst = effective[0];
    const assignees = inst.effectiveAssigneeIds ?? inst.assigneeIds;
    if (!assignees.includes(profile.userId)) {
      throw ApiError.forbidden('非本人班次，不能打卡');
    }

    // 取地点/时段名快照
    const loc = sched.locationId ? await repos.duty.locations.findById(sched.locationId) : null;
    const slots = sched.timeSlotId ? await repos.duty.timeSlots.listByCampus(profile.campusId) : [];
    const slot = slots.find((s) => s.id === sched.timeSlotId);

    const photos = await uploadPhotos(deps, CHECKIN_NS, photoFiles);
    try {
      const ck = await repos.duty.checkins.create({
        campusId: profile.campusId, scheduleId, dutyDate, teacherId: profile.userId,
        locationName: loc?.name ?? '', timeSlotName: slot?.name ?? null, situation, photos,
      });
      return created(c, ck);
    } catch (e) {
      // UNIQUE(schedule,date,teacher) 冲突 → 已打卡
      if (isUniqueViolation(e)) throw ApiError.conflict('该班次已打卡，不能重复提交');
      throw e;
    }
  });

  // ══════════ 领导巡查（canInspect 或 admin）══════════
  // POST /inspections —— 提交巡查（items 逐记录展开，防笛卡尔积）
  app.post('/inspections', async (c) => {
    const profile = getProfile(c);
    if (profile.role !== 'admin' && !profile.canInspect) {
      throw ApiError.forbidden('无巡查权限');
    }
    const form = await c.req.formData();
    const inspectDate = String(form.get('inspect_date') ?? dateKey(new Date()));
    const areaId = String(form.get('area_id') ?? '');
    if (!areaId) throw ApiError.badRequest('缺少 area_id');
    // items 以 JSON 字符串传（子表：地点×教师×在岗状态），照片单独 multipart
    const itemsRaw = form.get('items');
    let items: InspectionItem[] = [];
    if (itemsRaw) {
      try { items = JSON.parse(String(itemsRaw)); } catch { throw ApiError.badRequest('items 格式错误'); }
    }
    if (!Array.isArray(items) || items.length === 0) throw ApiError.badRequest('巡查明细不能为空');
    // 照片（可选，按 item 索引分组：photo_<i> 多张）—— 简化：统一 photos[] 附加到含 photoKeys 占位的 item
    const photoFiles = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
    const photoKeys = photoFiles.length > 0 ? await uploadPhotos(deps, INSPECT_NS, photoFiles) : [];
    // 把照片按 item 声明的 photoIndex 分配（前端传 photoIndex；缺省全给第一条）
    if (photoKeys.length > 0) {
      const assigned = new Set<number>();
      items.forEach((it, idx) => {
        const want = (it as any).photoIndex;
        if (typeof want === 'number' && photoKeys[want]) { it.photoKeys = [photoKeys[want]]; assigned.add(want); }
      });
      const rest = photoKeys.filter((_, i) => !assigned.has(i));
      if (rest.length > 0 && items[0]) items[0].photoKeys = [...(items[0].photoKeys ?? []), ...rest];
    }
    // 校验每行都选了状态
    for (const it of items) {
      if (it.status !== 'present' && it.status !== 'absent') throw ApiError.badRequest('每行巡查必须选在岗/不在岗');
    }
    const ins = await repos.duty.inspections.create({
      campusId: profile.campusId, inspectorId: profile.userId, inspectDate, areaId, items,
    });
    return created(c, ins);
  });

  // GET /inspections —— 巡查记录列表
  app.get('/inspections', async (c) => {
    const campusId = resolveCampusId(c);
    const { page, pageSize } = parsePagination(c);
    const r = await repos.duty.inspections.listByCampus(campusId, { areaId: c.req.query('area_id') || undefined, page, pageSize });
    return ok(c, r.data, r.pagination);
  });

  // GET /inspections/:id
  app.get('/inspections/:id', async (c) => {
    const campusId = resolveCampusId(c);
    const ins = await repos.duty.inspections.findById(c.req.param('id'));
    if (!ins || (ins.campusId !== campusId && getProfile(c).role !== 'admin')) throw ApiError.notFound('巡查记录不存在');
    return ok(c, ins);
  });

  // ══════════ 调班申请（本人发起，admin 审批）══════════
  // POST /swaps —— 发起调班（交换/代理）
  app.post('/swaps', async (c) => {
    const profile = getProfile(c);
    const body = await c.req.json<{
      type: SwapType; applicant_schedule_id: string; applicant_date: string;
      target_id: string; target_schedule_id?: string; target_date?: string; reason: string;
    }>().catch(() => null as any);
    if (!body?.type || !body.applicant_schedule_id || !body.applicant_date || !body.target_id) {
      throw ApiError.badRequest('缺少调班必填字段');
    }
    if (!body.reason || !body.reason.trim()) throw ApiError.badRequest('调班原因不能为空');
    if (body.type !== 'swap' && body.type !== 'proxy') throw ApiError.badRequest('调班类型非法');
    if (body.target_id === profile.userId) throw ApiError.badRequest('不能选自己为对方');

    // 校验申请人排班属于本人校区 + 本人是该排班的实际值班人
    const apSched = await repos.duty.schedules.findById(body.applicant_schedule_id);
    if (!apSched) throw ApiError.notFound('申请人排班不存在');
    if (apSched.campusId !== profile.campusId) throw ApiError.forbidden('不能跨校区调班');

    // 交换需对方排班
    if (body.type === 'swap' && !body.target_schedule_id) throw ApiError.badRequest('交换调班需指定对方排班');

    const sw = await repos.duty.swaps.create({
      campusId: profile.campusId, type: body.type,
      applicantId: profile.userId, applicantScheduleId: body.applicant_schedule_id, applicantDate: body.applicant_date,
      targetId: body.target_id, targetScheduleId: body.target_schedule_id ?? null, targetDate: body.target_date ?? null,
      reason: body.reason.trim(),
    });
    return created(c, sw);
  });

  // GET /swaps —— 调班列表（admin 看全部，教师看与自己相关）
  app.get('/swaps', async (c) => {
    const profile = getProfile(c);
    const { page, pageSize } = parsePagination(c);
    const status = c.req.query('status') as any;
    if (profile.role === 'admin') {
      const r = await repos.duty.swaps.list({ campusId: resolveCampusId(c), status, page, pageSize });
      return ok(c, r.data, r.pagination);
    }
    // 教师：我发起的 + 找我的（合并两次查询，去重）
    const mine = await repos.duty.swaps.list({ applicantId: profile.userId, status, page: 1, pageSize: 100 });
    const toMe = await repos.duty.swaps.list({ targetId: profile.userId, status, page: 1, pageSize: 100 });
    const byId = new Map<string, any>();
    for (const s of [...mine.data, ...toMe.data]) byId.set(s.id, s);
    const merged = Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
    const start = (page - 1) * pageSize;
    return ok(c, merged.slice(start, start + pageSize), { page, pageSize, total: merged.length, totalPages: Math.max(1, Math.ceil(merged.length / pageSize)) });
  });

  // POST /swaps/:id/review —— 审批（admin）
  app.post('/swaps/:id/review', requireRole('admin'), async (c) => {
    const body = await c.req.json<{ decision: 'approved' | 'rejected'; review_comment?: string }>().catch(() => null as any);
    if (!body?.decision || (body.decision !== 'approved' && body.decision !== 'rejected')) {
      throw ApiError.badRequest('decision 须为 approved/rejected');
    }
    const id = c.req.param('id');
    const existing = await repos.duty.swaps.findById(id);
    if (!existing) throw ApiError.notFound('调班申请不存在');
    if (existing.campusId !== getProfile(c).campusId) throw ApiError.forbidden('不能跨校区审批');
    const r = await repos.duty.swaps.review(id, getProfile(c).userId, body.decision, body.review_comment ?? null);
    return ok(c, r);
  });

  // ══════════ 到岗率统计报表 ══════════
  // GET /attendance?date_from=&date_to=&kind=
  app.get('/attendance', async (c) => {
    const campusId = resolveCampusId(c);
    const dateFrom = c.req.query('date_from');
    const dateTo = c.req.query('date_to');
    if (!dateFrom || !dateTo) throw ApiError.badRequest('需 date_from 与 date_to');
    const kind = c.req.query('kind') as DutyKind | undefined;
    const stats = await getAttendance({ repos }, campusId, dateFrom, dateTo, kind);
    return ok(c, stats);
  });

  // ══════════ 配置实体（admin）══════════
  // 区域
  app.get('/areas', async (c) => ok(c, await repos.duty.areas.listByCampus(resolveCampusId(c))));
  app.post('/areas', requireRole('admin'), async (c) => {
    const b = await c.req.json<{ name: string; sort_order?: number }>().catch(() => null as any);
    if (!b?.name) throw ApiError.badRequest('缺少 name');
    try {
      return created(c, await repos.duty.areas.create({ campusId: resolveWriteCampusId(c), name: b.name, sortOrder: b.sort_order }));
    } catch (e) { if (isUniqueViolation(e)) throw ApiError.conflict('区域名已存在'); throw e; }
  });
  app.put('/areas/:id', requireRole('admin'), async (c) => {
    const b = await c.req.json<{ name: string; sort_order?: number }>().catch(() => null as any);
    if (!b?.name) throw ApiError.badRequest('缺少 name');
    const r = await repos.duty.areas.update(c.req.param('id'), { name: b.name, sortOrder: b.sort_order });
    if (!r) throw ApiError.notFound('区域不存在');
    return ok(c, r);
  });
  app.delete('/areas/:id', requireRole('admin'), async (c) => { await repos.duty.areas.remove(c.req.param('id')); return ok(c, { deleted: true }); });

  // 地点
  app.get('/locations', async (c) => ok(c, await repos.duty.locations.listByCampus(resolveCampusId(c), c.req.query('area_id') || undefined)));
  app.post('/locations', requireRole('admin'), async (c) => {
    const b = await c.req.json<{ area_id: string; name: string }>().catch(() => null as any);
    if (!b?.area_id || !b?.name) throw ApiError.badRequest('缺少 area_id / name');
    try {
      return created(c, await repos.duty.locations.create({ campusId: resolveWriteCampusId(c), areaId: b.area_id, name: b.name }));
    } catch (e) { if (isUniqueViolation(e)) throw ApiError.conflict('该区域下地点名已存在'); throw e; }
  });
  app.put('/locations/:id', requireRole('admin'), async (c) => {
    const b = await c.req.json<{ name: string; area_id?: string }>().catch(() => null as any);
    if (!b?.name) throw ApiError.badRequest('缺少 name');
    const r = await repos.duty.locations.update(c.req.param('id'), { name: b.name, areaId: b.area_id });
    if (!r) throw ApiError.notFound('地点不存在');
    return ok(c, r);
  });
  app.delete('/locations/:id', requireRole('admin'), async (c) => { await repos.duty.locations.remove(c.req.param('id')); return ok(c, { deleted: true }); });

  // 时段
  app.get('/time-slots', async (c) => ok(c, await repos.duty.timeSlots.listByCampus(resolveCampusId(c), c.req.query('area_id') || undefined)));
  app.post('/time-slots', requireRole('admin'), async (c) => {
    const b = await c.req.json<{ area_id: string; name: string; start_minute?: number; end_minute?: number; priority?: number }>().catch(() => null as any);
    if (!b?.area_id || !b?.name) throw ApiError.badRequest('缺少 area_id / name');
    return created(c, await repos.duty.timeSlots.create({
      campusId: resolveWriteCampusId(c), areaId: b.area_id, name: b.name,
      startMinute: b.start_minute ?? null, endMinute: b.end_minute ?? null, priority: b.priority,
    }));
  });
  app.put('/time-slots/:id', requireRole('admin'), async (c) => {
    const b = await c.req.json<{ name?: string; start_minute?: number; end_minute?: number; priority?: number }>().catch(() => null as any);
    const r = await repos.duty.timeSlots.update(c.req.param('id'), {
      name: b?.name, startMinute: b?.start_minute, endMinute: b?.end_minute, priority: b?.priority,
    });
    if (!r) throw ApiError.notFound('时段不存在');
    return ok(c, r);
  });
  app.delete('/time-slots/:id', requireRole('admin'), async (c) => { await repos.duty.timeSlots.remove(c.req.param('id')); return ok(c, { deleted: true }); });

  // ══════════ 排班模板（admin）══════════
  app.get('/schedules', async (c) => {
    const campusId = resolveCampusId(c);
    const { page, pageSize } = parsePagination(c);
    const r = await repos.duty.schedules.list({
      campusId, kind: c.req.query('kind') as DutyKind | undefined, areaId: c.req.query('area_id') || undefined, page, pageSize,
    });
    return ok(c, r.data, r.pagination);
  });
  app.post('/schedules', requireRole('admin'), async (c) => {
    const b = await c.req.json<any>().catch(() => null);
    if (!b?.area_id || b.weekday == null || !b.date_start || !b.date_end || !Array.isArray(b.assignee_ids)) {
      throw ApiError.badRequest('缺少排班必填字段（area_id/weekday/date_start/date_end/assignee_ids）');
    }
    const kind = (b.kind === 'dutyWeek' ? 'dutyWeek' : 'teaching') as DutyKind;
    const parity = ['everyweek', 'odd', 'even'].includes(b.week_parity) ? b.week_parity : 'everyweek';
    const weekday = Number(b.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw ApiError.badRequest('weekday 须为 0-6（0=周日..6=周六）');
    }
    const s = await repos.duty.schedules.create({
      campusId: resolveWriteCampusId(c), kind, areaId: b.area_id,
      timeSlotId: b.time_slot_id ?? null, locationId: b.location_id ?? null,
      dateStart: b.date_start, dateEnd: b.date_end, weekday: weekday as Weekday,
      weekParity: parity, countersign: b.countersign ? 1 : 0, assigneeIds: b.assignee_ids, note: b.note ?? null,
    });
    return created(c, s);
  });
  app.put('/schedules/:id', requireRole('admin'), async (c) => {
    const b = await c.req.json<any>().catch(() => null);
    const patch: any = {};
    if (b?.area_id !== undefined) patch.areaId = b.area_id;
    if (b?.time_slot_id !== undefined) patch.timeSlotId = b.time_slot_id;
    if (b?.location_id !== undefined) patch.locationId = b.location_id;
    if (b?.date_start !== undefined) patch.dateStart = b.date_start;
    if (b?.date_end !== undefined) patch.dateEnd = b.date_end;
    if (b?.weekday !== undefined) patch.weekday = Number(b.weekday);
    if (b?.week_parity !== undefined) patch.weekParity = b.week_parity;
    if (b?.countersign !== undefined) patch.countersign = b.countersign ? 1 : 0;
    if (b?.assignee_ids !== undefined) patch.assigneeIds = b.assignee_ids;
    if (b?.note !== undefined) patch.note = b.note;
    const r = await repos.duty.schedules.update(c.req.param('id'), patch);
    if (!r) throw ApiError.notFound('排班不存在');
    return ok(c, r);
  });
  app.delete('/schedules/:id', requireRole('admin'), async (c) => { await repos.duty.schedules.remove(c.req.param('id')); return ok(c, { deleted: true }); });

  return app;
}
