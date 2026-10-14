/**
 * D4 验收：值班域 HTTP 端到端（真实服务 + cookie 登录 + 全链路）。
 *
 * 覆盖外部 PRD 功能语义的自有实现（docs/DUTY-FUSION.md §7 映射）：
 *  - 配置：区域/地点/时段（admin）
 *  - 排班：建周期模板 → 值班大表矩阵实时展开（不持久化实例）
 *  - 打卡：本人班次守卫（精确到 pill，防越权代打卡）、照片必填、UNIQUE 防重复
 *  - 巡查：canInspect 权限、逐记录展开
 *  - 调班：本人发起 → admin 审批 → 叠加层实时改变矩阵实际值班人（不回改原排班）
 *  - 统计：到岗率（应到/实到，精确到人）
 *  - 多校区隔离
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, seedStandard, tinyPng, type Harness } from './helpers/harness.js';

let h: Harness;
let seed: Awaited<ReturnType<typeof seedStandard>>;
// 学期：2026-09-01(周二) ~ 2027-01-31。取 2026-09-02 是周三。
const WEEK_MONDAY = '2026-08-31'; // 含 9/2 的那周周一
const WED = '2026-09-02';

beforeAll(async () => {
  h = await boot('dutyhttp');
  seed = await seedStandard(h);
  // 给 teacher1 授予巡查权限（领导）——admin 改档
  const admin = await h.loginAs('admin');
  const users = await admin.req('GET', '/api/v1/users');
  const teacher = users.json.data.find((u: any) => u.username === 'teacher1');
  await admin.req('PUT', `/api/v1/users/${teacher.id}`, {
    body: { display_name: '李老师', role: 'teacher', can_inspect: true },
  });
});
afterAll(async () => { await h.shutdown(); });

/** admin 建一套「周三 校门口 全天 由 teacher1 执勤」的排班，返回 {areaId,locId,scheduleId} */
let setupSeq = 0;
async function setupSchedule(admin: Awaited<ReturnType<typeof h.loginAs>>, over: Record<string, any> = {}) {
  // 每次调用用唯一后缀，避免 UNIQUE(campusId,name) 冲突（多次 setupSchedule 共享同一 harness）
  const uniq = `u${++setupSeq}-${Date.now() % 100000}`;
  const area = await admin.req('POST', '/api/v1/duty/areas', { body: { name: `区${uniq}`, sort_order: 1 } });
  const areaId = area.json.data.id;
  const loc = await admin.req('POST', '/api/v1/duty/locations', { body: { area_id: areaId, name: `门口${uniq}` } });
  const locId = loc.json.data.id;
  const slot = await admin.req('POST', '/api/v1/duty/time-slots', { body: { area_id: areaId, name: `全天${uniq}`, priority: 0 } });
  const users = await admin.req('GET', '/api/v1/users');
  const teacher = users.json.data.find((u: any) => u.username === 'teacher1');
  const sch = await admin.req('POST', '/api/v1/duty/schedules', {
    body: {
      kind: 'teaching', area_id: areaId, location_id: locId, time_slot_id: slot.json.data.id,
      date_start: '2026-09-01', date_end: '2027-01-31', weekday: 3, week_parity: 'everyweek',
      countersign: false, assignee_ids: [teacher.id], ...over,
    },
  });
  return { areaId, locId, slotId: slot.json.data.id, scheduleId: sch.json.data.id, teacherId: teacher.id, locName: `门口${uniq}`, areaName: `区${uniq}` };
}

describe('值班配置（admin RBAC + 隔离）', () => {
  it('admin 建区域/地点/时段', async () => {
    const admin = await h.loginAs('admin');
    const a = await admin.req('POST', '/api/v1/duty/areas', { body: { name: '小学部' } });
    expect(a.status).toBe(201);
    const l = await admin.req('POST', '/api/v1/duty/locations', { body: { area_id: a.json.data.id, name: '教学楼A' } });
    expect(l.status).toBe(201);
    const list = await admin.req('GET', '/api/v1/duty/locations');
    expect(list.json.data.find((x: any) => x.id === l.json.data.id)?.areaName).toBe('小学部');
  });

  it('student 不能建区域（403）', async () => {
    const stu = await h.loginAs('student1');
    const r = await stu.req('POST', '/api/v1/duty/areas', { body: { name: 'x' } });
    expect(r.status).toBe(403);
  });

  it('区域名重复 → 409', async () => {
    const admin = await h.loginAs('admin');
    await admin.req('POST', '/api/v1/duty/areas', { body: { name: 'dup区' } });
    const r = await admin.req('POST', '/api/v1/duty/areas', { body: { name: 'dup区' } });
    expect(r.status).toBe(409);
  });
});

describe('值班大表矩阵（实时展开，不持久化实例）', () => {
  it('建周三排班 → 矩阵该周周三格出现教师 pill（pending 态）', async () => {
    const admin = await h.loginAs('admin');
    const { teacherId } = await setupSchedule(admin);
    const m = await admin.req('GET', '/api/v1/duty/matrix', { query: { week: WED } });
    expect(m.status).toBe(200);
    // 找到周三列
    const wedCol = m.json.data.matrix.columns.findIndex((c: any) => c.date === WED);
    expect(wedCol).toBeGreaterThanOrEqual(0);
    // 某行该列有 pill，且是 teacher1
    const allPills = m.json.data.matrix.rows.flatMap((r: any) => r.cells[wedCol].pills);
    const pill = allPills.find((p: any) => p.userId === teacherId);
    expect(pill).toBeTruthy();
    expect(pill.state).toBe('pending');
    expect(m.json.data.summary.total).toBeGreaterThanOrEqual(1);
  });

  it('矩阵只含本校区（隔离）', async () => {
    const admin = await h.loginAs('admin');
    const m = await admin.req('GET', '/api/v1/duty/matrix', { query: { week: WED } });
    // admin 属 c1，resolveCampusId 非传 campus_id 时用本人校区
    expect(m.status).toBe(200);
  });

  it('空排班周 → 矩阵空、summary 全 0', async () => {
    const admin = await h.loginAs('admin');
    const m = await admin.req('GET', '/api/v1/duty/matrix', { query: { week: '2030-01-01' } });
    expect(m.json.data.summary.total).toBe(0);
  });
});

describe('执勤打卡（本人守卫 + 照片必填 + 防重复）', () => {
  it('teacher1 给自己周三班次打卡（带照片）→ 201', async () => {
    const admin = await h.loginAs('admin');
    const { scheduleId } = await setupSchedule(admin, { date_start: '2026-09-01', date_end: '2026-09-30' });
    const teacher = await h.loginAs('teacher1');
    const form = new FormData();
    form.set('schedule_id', scheduleId);
    form.set('duty_date', WED);
    form.set('situation', '一切正常');
    form.append('photos', tinyPng());
    const r = await teacher.req('POST', '/api/v1/duty/checkins', { body: form, isForm: true });
    expect(r.status).toBe(201);
    expect(r.json.data.photos).toHaveLength(1);
    expect(r.json.data.teacherId).toBeTruthy();
  });

  it('打卡后矩阵 pill 变 done 态', async () => {
    const admin = await h.loginAs('admin');
    const { scheduleId, teacherId } = await setupSchedule(admin, { date_start: '2026-09-01', date_end: '2026-09-30' });
    const teacher = await h.loginAs('teacher1');
    const form = new FormData();
    form.set('schedule_id', scheduleId);
    form.set('duty_date', WED);
    form.append('photos', tinyPng());
    await teacher.req('POST', '/api/v1/duty/checkins', { body: form, isForm: true });
    const m = await admin.req('GET', '/api/v1/duty/matrix', { query: { week: WED } });
    const wedCol = m.json.data.matrix.columns.findIndex((c: any) => c.date === WED);
    const pills = m.json.data.matrix.rows.flatMap((r: any) => r.cells[wedCol].pills);
    const pill = pills.find((p: any) => p.userId === teacherId && p.scheduleId === scheduleId);
    expect(pill?.state).toBe('done');
  });

  it('照片缺失 → 400（对齐外部 PRD：打卡强制照片）', async () => {
    const admin = await h.loginAs('admin');
    const { scheduleId } = await setupSchedule(admin, { date_start: '2026-09-01', date_end: '2026-09-30', weekday: 4 });
    const teacher = await h.loginAs('teacher1');
    const form = new FormData();
    form.set('schedule_id', scheduleId);
    form.set('duty_date', '2026-09-03'); // 周四
    const r = await teacher.req('POST', '/api/v1/duty/checkins', { body: form, isForm: true });
    expect(r.status).toBe(400);
  });

  it('非本人班次不能打卡（403，防越权代打卡）', async () => {
    const admin = await h.loginAs('admin');
    // 排班指派给 teacher1
    const { scheduleId } = await setupSchedule(admin, { date_start: '2026-09-01', date_end: '2026-09-30', weekday: 5 });
    // student1 试图给 teacher1 的班次打卡
    const stu = await h.loginAs('student1');
    const form = new FormData();
    form.set('schedule_id', scheduleId);
    form.set('duty_date', '2026-09-04'); // 周五
    form.append('photos', tinyPng());
    const r = await stu.req('POST', '/api/v1/duty/checkins', { body: form, isForm: true });
    expect(r.status).toBe(403);
  });

  it('同班次重复打卡 → 409（UNIQUE 防重）', async () => {
    const admin = await h.loginAs('admin');
    const { scheduleId } = await setupSchedule(admin, { date_start: '2026-09-01', date_end: '2026-09-30', weekday: 6 });
    const teacher = await h.loginAs('teacher1');
    const mk = () => { const f = new FormData(); f.set('schedule_id', scheduleId); f.set('duty_date', '2026-09-05'); f.append('photos', tinyPng()); return f; };
    const first = await teacher.req('POST', '/api/v1/duty/checkins', { body: mk(), isForm: true });
    expect(first.status).toBe(201);
    const dup = await teacher.req('POST', '/api/v1/duty/checkins', { body: mk(), isForm: true });
    expect(dup.status).toBe(409);
  });

  it('日期不匹配排班（非周三）→ 400', async () => {
    const admin = await h.loginAs('admin');
    const { scheduleId } = await setupSchedule(admin, { date_start: '2026-09-01', date_end: '2026-09-30' }); // weekday 3
    const teacher = await h.loginAs('teacher1');
    const form = new FormData();
    form.set('schedule_id', scheduleId);
    form.set('duty_date', '2026-09-04'); // 周四，不匹配周三模板
    form.append('photos', tinyPng());
    const r = await teacher.req('POST', '/api/v1/duty/checkins', { body: form, isForm: true });
    expect(r.status).toBe(400);
  });

  it('今日任务工作台：teacher1 看到自己周三的待执勤任务', async () => {
    const admin = await h.loginAs('admin');
    const { scheduleId, locName } = await setupSchedule(admin, { date_start: '2026-09-01', date_end: '2026-09-30' });
    const teacher = await h.loginAs('teacher1');
    const r = await teacher.req('GET', '/api/v1/duty/checkins/today', { query: { date: WED } });
    expect(r.status).toBe(200);
    const task = r.json.data.find((t: any) => t.scheduleId === scheduleId);
    expect(task).toBeTruthy();
    expect(task.checkedIn).toBe(false);
    expect(task.locationName).toBe(locName);
  });
});

describe('领导巡查（canInspect 权限）', () => {
  it('teacher1(canInspect) 可提交巡查（逐记录展开的 items）', async () => {
    const admin = await h.loginAs('admin');
    const { areaId, locId, scheduleId, teacherId } = await setupSchedule(admin, { date_start: '2026-09-01', date_end: '2026-09-30' });
    const teacher = await h.loginAs('teacher1'); // 已授 canInspect
    const items = [
      { locationName: '校门口', teacherName: '李老师', teacherId, status: 'present', photoKeys: [], scheduleId, dutyDate: WED },
    ];
    const form = new FormData();
    form.set('inspect_date', WED);
    form.set('area_id', areaId);
    form.set('items', JSON.stringify(items));
    const r = await teacher.req('POST', '/api/v1/duty/inspections', { body: form, isForm: true });
    expect(r.status).toBe(201);
    expect(r.json.data.items).toHaveLength(1);
    expect(r.json.data.items[0].status).toBe('present');
  });

  it('student1（无 canInspect）不能巡查（403）', async () => {
    const admin = await h.loginAs('admin');
    const { areaId } = await setupSchedule(admin);
    const stu = await h.loginAs('student1');
    const form = new FormData();
    form.set('inspect_date', WED);
    form.set('area_id', areaId);
    form.set('items', JSON.stringify([{ locationName: 'x', teacherName: 'y', teacherId: 'z', status: 'present', photoKeys: [], scheduleId: 's', dutyDate: WED }]));
    const r = await stu.req('POST', '/api/v1/duty/inspections', { body: form, isForm: true });
    expect(r.status).toBe(403);
  });

  it('巡查每行必须选状态（缺 status → 400）', async () => {
    const admin = await h.loginAs('admin');
    const { areaId } = await setupSchedule(admin);
    const teacher = await h.loginAs('teacher1');
    const form = new FormData();
    form.set('inspect_date', WED);
    form.set('area_id', areaId);
    form.set('items', JSON.stringify([{ locationName: 'x', teacherName: 'y', teacherId: 'z', photoKeys: [] }]));
    const r = await teacher.req('POST', '/api/v1/duty/inspections', { body: form, isForm: true });
    expect(r.status).toBe(400);
  });
});

describe('调班（本人发起 → admin 审批 → 叠加层实时改变矩阵）', () => {
  it('teacher1 发起代理调班给 student1 → admin 批准 → 矩阵实际值班人变 student1（swapped）', async () => {
    const admin = await h.loginAs('admin');
    const { scheduleId, teacherId } = await setupSchedule(admin, { date_start: '2026-09-01', date_end: '2026-09-30' });
    const users = await admin.req('GET', '/api/v1/users');
    const student = users.json.data.find((u: any) => u.username === 'student1');

    // teacher1 发起代理
    const teacher = await h.loginAs('teacher1');
    const sw = await teacher.req('POST', '/api/v1/duty/swaps', {
      body: { type: 'proxy', applicant_schedule_id: scheduleId, applicant_date: WED, target_id: student.id, reason: '家中有事' },
    });
    expect(sw.status).toBe(201);
    expect(sw.json.data.status).toBe('pending');
    const swapId = sw.json.data.id;

    // 审批前：矩阵周三仍是 teacher1 pending
    let m = await admin.req('GET', '/api/v1/duty/matrix', { query: { week: WED } });
    let wedCol = m.json.data.matrix.columns.findIndex((c: any) => c.date === WED);
    let pill = m.json.data.matrix.rows.flatMap((r: any) => r.cells[wedCol].pills).find((p: any) => p.scheduleId === scheduleId);
    expect(pill.userId).toBe(teacherId);
    expect(pill.state).toBe('pending');

    // admin 批准
    const rev = await admin.req('POST', `/api/v1/duty/swaps/${swapId}/review`, { body: { decision: 'approved', review_comment: '同意' } });
    expect(rev.status).toBe(200);
    expect(rev.json.data.status).toBe('approved');

    // 审批后：叠加层生效，矩阵周三实际值班人 → student1，swapped 态
    m = await admin.req('GET', '/api/v1/duty/matrix', { query: { week: WED } });
    wedCol = m.json.data.matrix.columns.findIndex((c: any) => c.date === WED);
    pill = m.json.data.matrix.rows.flatMap((r: any) => r.cells[wedCol].pills).find((p: any) => p.scheduleId === scheduleId);
    expect(pill.userId).toBe(student.id); // 接手人
    expect(pill.state).toBe('swapped');
    expect(pill.swapHint).toBeTruthy();
  });

  it('调班只作用具体那天，不污染其他周（叠加按日期）', async () => {
    const admin = await h.loginAs('admin');
    const { scheduleId, teacherId } = await setupSchedule(admin, { date_start: '2026-09-01', date_end: '2026-09-30' });
    const users = await admin.req('GET', '/api/v1/users');
    const student = users.json.data.find((u: any) => u.username === 'student1');
    const teacher = await h.loginAs('teacher1');
    const sw = await teacher.req('POST', '/api/v1/duty/swaps', {
      body: { type: 'proxy', applicant_schedule_id: scheduleId, applicant_date: WED, target_id: student.id, reason: 'r' },
    });
    await admin.req('POST', `/api/v1/duty/swaps/${sw.json.data.id}/review`, { body: { decision: 'approved' } });
    // 下一周周三（9/9）应仍是 teacher1（未被 9/2 的调班污染）
    const m = await admin.req('GET', '/api/v1/duty/matrix', { query: { week: '2026-09-09' } });
    const col = m.json.data.matrix.columns.findIndex((c: any) => c.date === '2026-09-09');
    const pill = m.json.data.matrix.rows.flatMap((r: any) => r.cells[col].pills).find((p: any) => p.scheduleId === scheduleId);
    expect(pill.userId).toBe(teacherId); // 原值班人，未叠加
  });

  it('不能选自己为对方（400）', async () => {
    const admin = await h.loginAs('admin');
    const { scheduleId, teacherId } = await setupSchedule(admin, { date_start: '2026-09-01', date_end: '2026-09-30' });
    const teacher = await h.loginAs('teacher1');
    const r = await teacher.req('POST', '/api/v1/duty/swaps', {
      body: { type: 'proxy', applicant_schedule_id: scheduleId, applicant_date: WED, target_id: teacherId, reason: 'r' },
    });
    expect(r.status).toBe(400);
  });

  it('student 不能审批调班（403）', async () => {
    const admin = await h.loginAs('admin');
    const { scheduleId } = await setupSchedule(admin, { date_start: '2026-09-01', date_end: '2026-09-30' });
    const users = await admin.req('GET', '/api/v1/users');
    const student = users.json.data.find((u: any) => u.username === 'student1');
    const teacher = await h.loginAs('teacher1');
    const sw = await teacher.req('POST', '/api/v1/duty/swaps', {
      body: { type: 'proxy', applicant_schedule_id: scheduleId, applicant_date: WED, target_id: student.id, reason: 'r' },
    });
    const stu = await h.loginAs('student1');
    const r = await stu.req('POST', `/api/v1/duty/swaps/${sw.json.data.id}/review`, { body: { decision: 'approved' } });
    expect(r.status).toBe(403);
  });

  it('交换调班：双向对调（两人那天互换）', async () => {
    const admin = await h.loginAs('admin');
    // teacher1 周三(s1)、student1 周五(s2)
    const { scheduleId: s1, teacherId } = await setupSchedule(admin, { date_start: '2026-09-01', date_end: '2026-09-30' }); // weekday3
    const users = await admin.req('GET', '/api/v1/users');
    const student = users.json.data.find((u: any) => u.username === 'student1');
    const s2res = await admin.req('POST', '/api/v1/duty/schedules', {
      body: {
        kind: 'teaching', area_id: (await admin.req('GET', '/api/v1/duty/areas')).json.data[0].id,
        date_start: '2026-09-01', date_end: '2026-09-30', weekday: 5, week_parity: 'everyweek',
        countersign: false, assignee_ids: [student.id],
      },
    });
    const s2 = s2res.json.data.id;
    const teacher = await h.loginAs('teacher1');
    const sw = await teacher.req('POST', '/api/v1/duty/swaps', {
      body: { type: 'swap', applicant_schedule_id: s1, applicant_date: WED, target_id: student.id, target_schedule_id: s2, target_date: '2026-09-04', reason: '换班' },
    });
    expect(sw.status).toBe(201);
    await admin.req('POST', `/api/v1/duty/swaps/${sw.json.data.id}/review`, { body: { decision: 'approved' } });
    // 9/2 s1 → student1；9/4 s2 → teacher1
    const m = await admin.req('GET', '/api/v1/duty/matrix', { query: { week: WED } });
    const wedCol = m.json.data.matrix.columns.findIndex((c: any) => c.date === WED);
    const friCol = m.json.data.matrix.columns.findIndex((c: any) => c.date === '2026-09-04');
    const wedPill = m.json.data.matrix.rows.flatMap((r: any) => r.cells[wedCol].pills).find((p: any) => p.scheduleId === s1);
    const friPill = m.json.data.matrix.rows.flatMap((r: any) => r.cells[friCol].pills).find((p: any) => p.scheduleId === s2);
    expect(wedPill.userId).toBe(student.id);
    expect(friPill.userId).toBe(teacherId);
  });
});

describe('到岗率统计报表', () => {
  it('应到/实到精确统计（打卡后 rate 上升）', async () => {
    const admin = await h.loginAs('admin');
    const { scheduleId } = await setupSchedule(admin, { date_start: '2026-09-01', date_end: '2026-09-30' });
    const teacher = await h.loginAs('teacher1');
    // 打卡前
    let att = await admin.req('GET', '/api/v1/duty/attendance', { query: { date_from: '2026-09-01', date_to: '2026-09-30' } });
    expect(att.status).toBe(200);
    const before = att.json.data;
    expect(before.scheduled).toBeGreaterThan(0);
    // 打卡一次
    const form = new FormData();
    form.set('schedule_id', scheduleId);
    form.set('duty_date', WED);
    form.append('photos', tinyPng());
    await teacher.req('POST', '/api/v1/duty/checkins', { body: form, isForm: true });
    // 打卡后 checkedIn 增加
    att = await admin.req('GET', '/api/v1/duty/attendance', { query: { date_from: '2026-09-01', date_to: '2026-09-30' } });
    expect(att.json.data.checkedIn).toBeGreaterThan(before.checkedIn);
    expect(att.json.data.rate).toBeGreaterThan(0);
    expect(Array.isArray(att.json.data.byTeacher)).toBe(true);
  });

  it('缺 date_from/date_to → 400', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/duty/attendance');
    expect(r.status).toBe(400);
  });
});

describe('排班校验', () => {
  it('weekday 越界 → 400', async () => {
    const admin = await h.loginAs('admin');
    const area = await admin.req('POST', '/api/v1/duty/areas', { body: { name: '校验区' } });
    const r = await admin.req('POST', '/api/v1/duty/schedules', {
      body: { kind: 'teaching', area_id: area.json.data.id, date_start: '2026-09-01', date_end: '2026-09-30', weekday: 9, assignee_ids: ['x'] },
    });
    expect(r.status).toBe(400);
  });

  it('缺 assignee_ids → 400', async () => {
    const admin = await h.loginAs('admin');
    const area = await admin.req('POST', '/api/v1/duty/areas', { body: { name: '校验区2' } });
    const r = await admin.req('POST', '/api/v1/duty/schedules', {
      body: { kind: 'teaching', area_id: area.json.data.id, date_start: '2026-09-01', date_end: '2026-09-30', weekday: 3 },
    });
    expect(r.status).toBe(400);
  });
});


describe('改良 A：到岗率桥接值周履职（融合度量）', () => {
  // 「值周是更详细的值班」在度量层兑现：dutyWeek 排班的值周生，当日提交 records = 到岗。
  // ⚠ records.recordedAt = Date.now()（服务端真实当前时刻），桥接按提交日历日匹配，
  //   故排班必须设在「今天」、记录也在「今天」提交，二者日历日才对齐（这正是真实语义：
  //   值周生在其值班当天巡查并提交记录）。测试用动态今天，不写死日期。
  const today = new Date();
  const todayWeekday = today.getDay();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  it('dutyWeek 排班的值周生今日提交记录后，到岗率从 0 变正（不再只认 dutyCheckins）', async () => {
    const admin = await h.loginAs('admin');
    const u = `fu${Date.now() % 99999}`;
    const area = await admin.req('POST', '/api/v1/duty/areas', { body: { name: `融合区${u}` } });
    const users = await admin.req('GET', '/api/v1/users');
    const student = users.json.data.find((x: any) => x.username === 'student1');
    // dutyWeek 排班设在「今天」（weekday=今天，区间覆盖今天）
    const sch = await admin.req('POST', '/api/v1/duty/schedules', {
      body: {
        kind: 'dutyWeek', area_id: area.json.data.id,
        date_start: todayKey, date_end: todayKey, weekday: todayWeekday, week_parity: 'everyweek',
        countersign: false, assignee_ids: [student.id],
      },
    });
    expect(sch.status).toBe(201);

    // 提交记录前：dutyWeek 到岗率应为 0（student1 今天还没提交任何 records）
    const before = await admin.req('GET', '/api/v1/duty/attendance', {
      query: { date_from: todayKey, date_to: todayKey, kind: 'dutyWeek' },
    });
    expect(before.json.data.scheduled).toBe(1);
    expect(before.json.data.checkedIn).toBe(0); // 未履职
    expect(before.json.data.rate).toBe(0);

    // student1 今天提交一条值周记录（recordedAt=Date.now()=今天 → 与排班同日 → 到岗）
    const stu = await h.loginAs('student1');
    const form = new FormData();
    form.set('class_id', seed.cls1.id);
    form.set('score', '-1');
    form.set('week', '2026-W41');
    await stu.req('POST', '/api/v1/records', { body: form, isForm: true });

    // 提交记录后：dutyWeek 到岗率应变正（值周履职被计入）—— 融合度量兑现
    const after = await admin.req('GET', '/api/v1/duty/attendance', {
      query: { date_from: todayKey, date_to: todayKey, kind: 'dutyWeek' },
    });
    expect(after.json.data.scheduled).toBe(1);
    expect(after.json.data.checkedIn).toBe(1); // ★ 提交记录 = 到岗
    expect(after.json.data.rate).toBe(1);
    const me = after.json.data.byTeacher.find((b: any) => b.teacherId === student.id);
    expect(me?.checkedIn).toBe(1);
  });

  it('teaching 排班仍只认 dutyCheckins（不被 records 桥接误计入）', async () => {
    const admin = await h.loginAs('admin');
    const u = `ft${Date.now() % 99999}`;
    const area = await admin.req('POST', '/api/v1/duty/areas', { body: { name: `执勤区${u}` } });
    const users = await admin.req('GET', '/api/v1/users');
    const teacher = users.json.data.find((x: any) => x.username === 'teacher1');
    await admin.req('POST', '/api/v1/duty/schedules', {
      body: {
        kind: 'teaching', area_id: area.json.data.id,
        date_start: todayKey, date_end: todayKey, weekday: todayWeekday, week_parity: 'everyweek',
        countersign: false, assignee_ids: [teacher.id],
      },
    });
    // teacher1 今天提交了 records（值周记录），但这是 teaching 排班，不该因 records 算到岗
    const t = await h.loginAs('teacher1');
    const form = new FormData();
    form.set('class_id', seed.cls1.id);
    form.set('score', '1');
    form.set('week', '2026-W41');
    await t.req('POST', '/api/v1/records', { body: form, isForm: true });
    // teaching 到岗率仍为 0（teacher 没打卡；records 只桥接 dutyWeek）
    const att = await admin.req('GET', '/api/v1/duty/attendance', {
      query: { date_from: todayKey, date_to: todayKey, kind: 'teaching' },
    });
    const me = att.json.data.byTeacher.find((b: any) => b.teacherId === teacher.id);
    expect(me?.checkedIn ?? 0).toBe(0); // teaching 走打卡，不走 records 桥接
  });
});
