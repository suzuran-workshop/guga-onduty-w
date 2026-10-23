/**
 * 免登录申诉链接 E2E（2026-10-23，需求 4：教师不进系统，从钉钉推送点链接申诉）。
 *
 * 覆盖：
 *  - 令牌全生命周期：打开表单（peek 不消费）→ 提交（消费）→ 复用被拒
 *  - 四类失效态：not_found / expired / consumed / 记录不可申诉（not_appealable）
 *  - 班级换绑 / 解绑后旧令牌失效（推送后班主任变更的安全语义）
 *  - appeals.create 严格语义（并发/重复提交只产生一条申诉的结构化兜底）
 *  - 教师侧可**看到**免登录提交的申诉（list 按 teacherId OR teacherDingtalkId 过滤、
 *    详情同口径归属判定——修复「列表放得出来、详情 404」的自相矛盾）
 *  - 公开路由确实绕过登录闸门（/api/public/* 无 Cookie 可用，/api/v1/* 无 Cookie 401）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, seedStandard, type Harness } from './helpers/harness.js';

let h: Harness;
let seed: Awaited<ReturnType<typeof seedStandard>>;

beforeAll(async () => {
  h = await boot('appealtoken');
  seed = await seedStandard(h);
});
afterAll(async () => { await h.shutdown(); });

const TOKEN_TTL = 24 * 3600 * 1000;

/** 学生给 cls1 打一条扣分记录（扣分必拍照），返回 recordId */
async function makeDeduction(): Promise<string> {
  const stu = await h.loginAs('student1');
  const f = new FormData();
  f.append('class_ids', seed.cls1.id);
  f.set('week', '2026-W43');
  f.append('tag_ids', seed.tagNeg.id);
  f.append('images', new File([new Uint8Array([0x89, 0x50])], 'a.png', { type: 'image/png' }));
  const r = await stu.req('POST', '/api/v1/records', { body: f, isForm: true });
  expect(r.status).toBe(201);
  // 创建接口按 classIds 逐班落记录，data 是数组（即便单班）
  const records = r.json.data as Array<{ id: string }>;
  expect(records).toHaveLength(1);
  return records[0]!.id;
}

/** 以 notify 服务同款方式为记录签发免登录令牌，返回明文（出现在推送链接里的那份） */
async function issueToken(recordId: string, opts?: { ttlMs?: number; dingtalkId?: string }) {
  const { plainToken } = await h.booted.repos.appealTokens.create({
    recordId,
    teacherDingtalkId: opts?.dingtalkId ?? seed.dtTeacher1,
    expiresAt: Date.now() + (opts?.ttlMs ?? TOKEN_TTL),
  });
  return plainToken;
}

describe('免登录申诉：令牌生命周期', () => {
  it('GET 打开表单：无 Cookie 可用（公开路由），回显记录详情且不消费令牌', async () => {
    const recordId = await makeDeduction();
    const token = await issueToken(recordId);
    // 匿名客户端（空 Jar，无任何会话）——公开端点正是为「没有系统账号」的教师准备的
    const anon = h.client();
    const r = await anon.req('GET', `/api/public/appeal/${token}`);
    expect(r.status).toBe(200);
    expect(r.json.data.tokenState).toBe('ok');
    expect(r.json.data.record.className).toBe('1班');
    expect(r.json.data.record.status).toBe('active');
    expect(r.json.data.record.score).toBe(-1);
    expect(r.json.data.record.tags[0].name).toBe('迟到');
    expect(r.json.data.record.images.length).toBeGreaterThan(0); // 扣分记录的照片可供教师查看
    // 刷新安全：peek 不消费，再开还是 ok
    const again = await anon.req('GET', `/api/public/appeal/${token}`);
    expect(again.json.data.tokenState).toBe('ok');
  });

  it('POST 提交申诉：记录转 appealing，申诉以钉钉身份落库（teacherId 为 null）', async () => {
    const recordId = await makeDeduction();
    const token = await issueToken(recordId);
    const anon = h.client();
    const r = await anon.req('POST', `/api/public/appeal/${token}`, { body: { reason: '迟到是因为校车晚点' } });
    expect(r.status).toBe(201);
    expect(r.json.data.appealed).toBe(true);

    // 记录状态与申诉行
    const rec = await h.booted.repos.records.findByIdWithDetails(recordId);
    expect(rec?.status).toBe('appealing');
    const appeal = await h.booted.repos.appeals.findById(r.json.data.appealId);
    expect(appeal?.teacherDingtalkId).toBe(seed.dtTeacher1);
    expect(appeal?.teacherId).toBeNull(); // 免登录教师没有系统账号
    expect(appeal?.teacherName).toBe('李老师'); // 姓名从通讯录兜底（userProfiles 无此人）

    // 日志双身份留痕：operatorId 空、operatorDingtalkId 在——审计能回答「谁申诉的」
    const logs = await h.booted.repos.records.listLogs(recordId);
    const appealLog = logs.find((l) => l.action === 'appeal');
    expect(appealLog?.operatorId ?? null).toBeNull();
    expect(appealLog?.operatorDingtalkId).toBe(seed.dtTeacher1);
  });

  it('令牌一次性：提交后再 GET → consumed，再 POST → 404（链接不可用）', async () => {
    const recordId = await makeDeduction();
    const token = await issueToken(recordId);
    const anon = h.client();
    const first = await anon.req('POST', `/api/public/appeal/${token}`, { body: { reason: '第一次提交' } });
    expect(first.status).toBe(201);

    const peek = await anon.req('GET', `/api/public/appeal/${token}`);
    expect(peek.json.data.tokenState).toBe('consumed');

    const second = await anon.req('POST', `/api/public/appeal/${token}`, { body: { reason: '重复提交' } });
    expect(second.status).toBe(404);
    expect(second.json.error.code).toBe('APPEAL_TOKEN_CONSUMED');
    // 记录上只有一条申诉（消费原子性 + create 严格语义双保险）
    const logs = await h.booted.repos.records.listLogs(recordId);
    expect(logs.filter((l) => l.action === 'appeal')).toHaveLength(1);
  });

  it('校验失败不烧令牌：空理由 400 后，补上理由同令牌仍可提交成功', async () => {
    const recordId = await makeDeduction();
    const token = await issueToken(recordId);
    const anon = h.client();
    const bad = await anon.req('POST', `/api/public/appeal/${token}`, { body: { reason: '   ' } });
    expect(bad.status).toBe(400);
    const good = await anon.req('POST', `/api/public/appeal/${token}`, { body: { reason: '补上理由' } });
    expect(good.status).toBe(201);
  });

  it('记录不可申诉（已撤回）：409 且令牌未被烧——撤回是管理员行为，不该销毁教师的申诉入口', async () => {
    const recordId = await makeDeduction();
    const token = await issueToken(recordId);
    const admin = await h.loginAs('admin');
    const rv = await admin.req('POST', `/api/v1/records/${recordId}/revoke`, { body: { reason: '录入有误' } });
    expect(rv.status).toBe(200);

    const anon = h.client();
    const peek = await anon.req('GET', `/api/public/appeal/${token}`);
    expect(peek.json.data.tokenState).toBe('not_appealable');
    const post = await anon.req('POST', `/api/public/appeal/${token}`, { body: { reason: '还是要申诉' } });
    expect(post.status).toBe(409);
    expect(post.json.error.code).toBe('RECORD_NOT_APPEALABLE');
    // 关键：POST 失败源于记录状态而非令牌——令牌仍在，状态恢复后可重试
    const rec = await h.booted.repos.records.findByIdWithDetails(recordId);
    expect(rec?.status).toBe('revoked');
  });
});

describe('免登录申诉：失效态与绑定校验', () => {
  it('未知令牌 → not_found / 404', async () => {
    const anon = h.client();
    const bogus = 'x'.repeat(43); // 形状合法（base64url）但不存在
    const peek = await anon.req('GET', `/api/public/appeal/${bogus}`);
    expect(peek.json.data.tokenState).toBe('not_found');
    const post = await anon.req('POST', `/api/public/appeal/${bogus}`, { body: { reason: 'x' } });
    expect(post.status).toBe(404);
    expect(post.json.error.code).toBe('APPEAL_TOKEN_NOT_FOUND');
  });

  it('过期令牌 → expired / 404', async () => {
    const recordId = await makeDeduction();
    const token = await issueToken(recordId, { ttlMs: -1000 });
    const anon = h.client();
    const peek = await anon.req('GET', `/api/public/appeal/${token}`);
    expect(peek.json.data.tokenState).toBe('expired');
    const post = await anon.req('POST', `/api/public/appeal/${token}`, { body: { reason: 'x' } });
    expect(post.status).toBe(404);
    expect(post.json.error.code).toBe('APPEAL_TOKEN_EXPIRED');
  });

  it('班级换绑后旧令牌失效（rebound / 403）——防止离任班主任替新班主任申诉', async () => {
    const recordId = await makeDeduction();
    const token = await issueToken(recordId);
    // 管理员把 1班交给另一位（通讯录里真实存在的）班主任
    await h.booted.repos.classes.update(seed.cls1.id, {
      name: '1班', classTeacher: '李老师', teacherDingtalkId: seed.dtTeacherC2,
    });
    try {
      const anon = h.client();
      const peek = await anon.req('GET', `/api/public/appeal/${token}`);
      expect(peek.json.data.tokenState).toBe('rebound');
      const post = await anon.req('POST', `/api/public/appeal/${token}`, { body: { reason: 'x' } });
      expect(post.status).toBe(403);
      // 令牌未被烧，但已无意义；换回绑定后原令牌恢复可用（教师侧无感）
      await h.booted.repos.classes.update(seed.cls1.id, {
        name: '1班', classTeacher: '李老师', teacherDingtalkId: seed.dtTeacher1,
      });
      const after = await anon.req('GET', `/api/public/appeal/${token}`);
      expect(after.json.data.tokenState).toBe('ok');
    } finally {
      // 兜底还原，避免影响其他用例
      await h.booted.repos.classes.update(seed.cls1.id, {
        name: '1班', classTeacher: '李老师', teacherDingtalkId: seed.dtTeacher1,
      });
    }
  });

  it('班级解绑后旧令牌失效（unbound）——fail-closed，不猜测归属', async () => {
    const recordId = await makeDeduction();
    const token = await issueToken(recordId);
    await h.booted.repos.classes.update(seed.cls1.id, { name: '1班', classTeacher: '李老师', teacherDingtalkId: null });
    try {
      const anon = h.client();
      const peek = await anon.req('GET', `/api/public/appeal/${token}`);
      expect(peek.json.data.tokenState).toBe('unbound');
      const post = await anon.req('POST', `/api/public/appeal/${token}`, { body: { reason: 'x' } });
      expect(post.status).toBe(409);
    } finally {
      await h.booted.repos.classes.update(seed.cls1.id, {
        name: '1班', classTeacher: '李老师', teacherDingtalkId: seed.dtTeacher1,
      });
    }
  });
});

describe('appeals.create 严格语义（并发/重复提交的结构化兜底）', () => {
  it('记录非 active 时 create 返回 null 且不落任何行', async () => {
    const recordId = await makeDeduction();
    // 先经正常路径申诉一次 → 记录变 appealing
    const token = await issueToken(recordId);
    const anon = h.client();
    await anon.req('POST', `/api/public/appeal/${token}`, { body: { reason: '第一次' } });
    // 直接调 repo 模拟并发输家：active→appealing 转换抢不到 → null
    const loser = await h.booted.repos.appeals.create({
      recordId, campusId: seed.c1.id, teacherDingtalkId: seed.dtTeacher1, reason: '并发输家',
    });
    expect(loser).toBeNull();
    // 数据库里也只有一条 appeal、一条 appeal 日志
    const detail = await h.booted.repos.records.findByIdWithDetails(recordId);
    expect(detail?.status).toBe('appealing');
    const logs = await h.booted.repos.records.listLogs(recordId);
    expect(logs.filter((l) => l.action === 'appeal')).toHaveLength(1);
  });

  it('不存在的记录 → null', async () => {
    const loser = await h.booted.repos.appeals.create({
      recordId: '00000000-0000-4000-8000-000000000000',
      campusId: seed.c1.id, teacherDingtalkId: seed.dtTeacher1, reason: 'x',
    });
    expect(loser).toBeNull();
  });
});

describe('教师侧可见性：免登录申诉对本人可见（身份 OR 过滤）', () => {
  it('teacher1 登录后能列出并查看免登录提交的申诉（该申诉 teacherId 为 null）', async () => {
    const recordId = await makeDeduction();
    const token = await issueToken(recordId);
    const anon = h.client();
    const sub = await anon.req('POST', `/api/public/appeal/${token}`, { body: { reason: '免登录提交的申诉' } });
    expect(sub.status).toBe(201);
    const appealId = sub.json.data.appealId as string;

    const t1 = await h.loginAs('teacher1');
    const list = await t1.req('GET', '/api/v1/appeals');
    expect(list.status).toBe(200);
    const mine = list.json.data.find((a: { id: string }) => a.id === appealId);
    expect(mine).toBeTruthy(); // 修复前：按 teacherId 过滤，null ≠ teacher1.id → 教师看不到自己的申诉

    const detail = await t1.req('GET', `/api/v1/appeals/${appealId}`);
    expect(detail.status).toBe(200); // 修复前：详情只比 teacherId → 404 自相矛盾
    expect(detail.json.data.teacherDingtalkId).toBe(seed.dtTeacher1);
  });

  it('teacher2（另一校区）看不到该申诉：列表不含、详情 404', async () => {
    const recordId = await makeDeduction();
    const token = await issueToken(recordId);
    const anon = h.client();
    const sub = await anon.req('POST', `/api/public/appeal/${token}`, { body: { reason: 'c1 的申诉' } });
    const appealId = sub.json.data.appealId as string;

    const t2 = await h.loginAs('teacher2');
    const list = await t2.req('GET', '/api/v1/appeals');
    expect(list.status).toBe(200);
    expect(list.json.data.find((a: { id: string }) => a.id === appealId)).toBeUndefined();
    const detail = await t2.req('GET', `/api/v1/appeals/${appealId}`);
    expect(detail.status).toBe(404); // 不泄露存在性
  });
});

describe('公开路由边界', () => {
  it('无会话访问 /api/v1/appeals → 401；/api/public/appeal/:token → 200（闸门内外的分界）', async () => {
    const anon = h.client();
    const guarded = await anon.req('GET', '/api/v1/appeals');
    expect(guarded.status).toBe(401);

    const recordId = await makeDeduction();
    const token = await issueToken(recordId);
    const publicOne = await anon.req('GET', `/api/public/appeal/${token}`);
    expect(publicOne.status).toBe(200);
  });
});
