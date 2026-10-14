/**
 * E2E：值周记录 + 申诉状态机（核心业务流）。
 * 覆盖：multipart 创建（含图片→storage）、分页/筛选、软删撤回、
 *      申诉全链路（teacher 申诉→record appealing→admin 批准→appeal_approved / 驳回→回滚 active）、
 *      事务原子性、SSE 事件触发、图片经 /files 可读、非图片类型拒绝。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, seedStandard, tinyPng, type Harness } from './helpers/harness.js';

let h: Harness;
let seed: Awaited<ReturnType<typeof seedStandard>>;

beforeAll(async () => {
  h = await boot('records');
  seed = await seedStandard(h);
});
afterAll(async () => { await h.shutdown(); });

function recordForm(classId: string, extra?: Record<string, string>, images?: File[]) {
  const f = new FormData();
  f.set('class_id', classId);
  f.set('week', '2026-W41');
  if (extra) for (const [k, v] of Object.entries(extra)) f.set(k, v);
  if (images) images.forEach((img) => f.append('images', img));
  return f;
}

describe('记录创建（multipart + storage）', () => {
  it('student 创建带图片记录 → 201，图片存 objectKey，join 字段齐全', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('POST', '/api/v1/records', {
      body: recordForm(seed.cls1.id, { tag_id: seed.tagNeg.id, score: '-1', comment: '迟到' }, [tinyPng()]),
      isForm: true,
    });
    expect(r.status).toBe(201);
    expect(r.json.data.className).toBe('1班');
    expect(r.json.data.recorderName).toBe('值周生A'); // 来自 userProfiles.displayName
    expect(r.json.data.tagName).toBe('迟到');
    expect(r.json.data.score).toBe(-1);
    expect(r.json.data.status).toBe('active');
    expect(r.json.data.images).toHaveLength(1);
    expect(typeof r.json.data.images[0]).toBe('string');
  });

  it('图片可经 /files/<key> 读回（修复旧代码图片死数据）', async () => {
    const c = await h.loginAs('student1');
    const created = await c.req('POST', '/api/v1/records', {
      body: recordForm(seed.cls1.id, { score: '1' }, [tinyPng()]), isForm: true,
    });
    const key = created.json.data.images[0];
    const fileRes = await fetch(`${h.base}/files/${key}`, { headers: { Cookie: c.jar.header() } });
    expect(fileRes.status).toBe(200);
    const buf = new Uint8Array(await fileRes.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
  });

  it('非图片类型上传 → 400', async () => {
    const c = await h.loginAs('student1');
    const f = recordForm(seed.cls1.id, { score: '1' }, [new File([new Uint8Array([1, 2, 3])], 'x.exe', { type: 'application/octet-stream' })]);
    const r = await c.req('POST', '/api/v1/records', { body: f, isForm: true });
    expect(r.status).toBe(400);
  });

  it('缺 class_id → 400', async () => {
    const c = await h.loginAs('student1');
    const f = new FormData();
    f.set('week', '2026-W41');
    const r = await c.req('POST', '/api/v1/records', { body: f, isForm: true });
    expect(r.status).toBe(400);
  });

  it('班级不存在 → 404', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('POST', '/api/v1/records', { body: recordForm('nonexistent-uuid', { score: '1' }), isForm: true });
    expect(r.status).toBe(404);
  });

  it('student 不能给 c2 班级打分（跨校区拒绝）', async () => {
    const c = await h.loginAs('student1'); // c1
    const r = await c.req('POST', '/api/v1/records', { body: recordForm(seed.clsC2.id, { score: '1' }), isForm: true });
    expect(r.status).toBe(403);
  });
});

describe('记录列表 + 分页 + 筛选', () => {
  it('分页返回 data + pagination', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('GET', '/api/v1/records', { query: { page: 1, pageSize: 2, week: '2026-W41' } });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.data)).toBe(true);
    expect(r.json.pagination).toMatchObject({ page: 1, pageSize: 2 });
    expect(r.json.pagination.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('按 class_id 筛选', async () => {
    const c = await h.loginAs('admin');
    const r = await c.req('GET', '/api/v1/records', { query: { class_id: seed.cls1.id, pageSize: 50 } });
    for (const rec of r.json.data) expect(rec.classId).toBe(seed.cls1.id);
  });

  it('非 admin 列表强制本校区隔离', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('GET', '/api/v1/records', { query: { pageSize: 100 } });
    for (const rec of r.json.data) expect(rec.campusId).toBe(seed.c1.id);
  });
});

describe('撤回（软删 + SSE record_revoked）', () => {
  it('admin 撤回记录 → status revoked', async () => {
    const stu = await h.loginAs('student1');
    const created = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, { score: '2' }), isForm: true });
    const id = created.json.data.id;

    const admin = await h.loginAs('admin');
    const r = await admin.req('POST', `/api/v1/records/${id}/revoke`, { body: { reason: '误录' } });
    expect(r.status).toBe(200);
    const after = await admin.req('GET', `/api/v1/records/${id}`);
    expect(after.json.data.status).toBe('revoked');
  });

  it('student 不能撤回（403）', async () => {
    const admin = await h.loginAs('admin');
    const created = await admin.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, { score: '1' }), isForm: true });
    const id = created.json.data.id;
    const stu = await h.loginAs('student1');
    const r = await stu.req('POST', `/api/v1/records/${id}/revoke`, { body: {} });
    expect(r.status).toBe(403);
  });
});

describe('申诉状态机（事务联动）', () => {
  it('teacher 申诉 active 记录 → record 变 appealing', async () => {
    const stu = await h.loginAs('student1');
    const created = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, { score: '-2' }), isForm: true });
    const id = created.json.data.id;

    const teacher = await h.loginAs('teacher1');
    const r = await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: '情况特殊' } });
    expect(r.status).toBe(201);

    const admin = await h.loginAs('admin');
    const after = await admin.req('GET', `/api/v1/records/${id}`);
    expect(after.json.data.status).toBe('appealing');
  });

  it('申诉理由为空 → 400', async () => {
    const stu = await h.loginAs('student1');
    const created = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, { score: '-1' }), isForm: true });
    const teacher = await h.loginAs('teacher1');
    const r = await teacher.req('POST', `/api/v1/records/${created.json.data.id}/appeal`, { body: { reason: '' } });
    expect(r.status).toBe(400);
  });

  it('student 不能申诉（403，仅 teacher）', async () => {
    const stu = await h.loginAs('student1');
    const created = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, { score: '-1' }), isForm: true });
    const r = await stu.req('POST', `/api/v1/records/${created.json.data.id}/appeal`, { body: { reason: 'x' } });
    expect(r.status).toBe(403);
  });

  it('admin 批准 → record appeal_approved + appeal approved', async () => {
    const stu = await h.loginAs('student1');
    const created = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, { score: '-3' }), isForm: true });
    const id = created.json.data.id;
    const teacher = await h.loginAs('teacher1');
    await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: 'r' } });

    const admin = await h.loginAs('admin');
    const r = await admin.req('POST', `/api/v1/records/${id}/appeal/approve`, { body: { review_comment: '属实' } });
    expect(r.status).toBe(200);
    const after = await admin.req('GET', `/api/v1/records/${id}`);
    expect(after.json.data.status).toBe('appeal_approved');
    // appeal 表状态
    const appeals = await admin.req('GET', '/api/v1/appeals', { query: { pageSize: 100 } });
    const mine = appeals.json.data.find((a: any) => a.recordId === id);
    expect(mine.status).toBe('approved');
    expect(mine.reviewerId).toBeTruthy();
  });

  // ── REVIEW #1 回归：断言申诉的「业务效果」而非仅状态迁移 ──
  // 旧缺陷：迁移误把 appeal_approved 计入分，导致批准申诉后分数照旧、approve 与 reject 效果相同。
  // 这两条测试断言排名总分实际变化，杜绝「状态对了但效果错了」的盲区。
  it('申诉成立 → 罚分从班级排名中撤销（业务效果，REVIEW #1）', async () => {
    const admin = await h.loginAs('admin');
    const stu = await h.loginAs('student1');
    const created = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, { score: '-7' }), isForm: true });
    const id = created.json.data.id;

    const rankOf = async () => {
      const r = await admin.req('GET', '/api/v1/statistics/ranking', { query: { week: '2026-W41' } });
      return r.json.data.find((x: any) => x.classId === seed.cls1.id)?.totalScore ?? 0;
    };

    const before = await rankOf();                 // 含 -7
    const teacher = await h.loginAs('teacher1');
    await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: 'r' } });
    const duringAppeal = await rankOf();           // appealing 仍计分 → 罚分暂仍生效
    expect(duringAppeal).toBe(before);
    await admin.req('POST', `/api/v1/records/${id}/appeal/approve`, { body: { review_comment: '属实' } });
    const after = await rankOf();                  // appeal_approved 退出计分 → -7 被撤销
    expect(after).toBe(before + 7);                // ★ 总分回升 7 = 罚分真被撤销
  });

  it('申诉驳回 → 罚分保留（与批准形成对照，approve≠reject）', async () => {
    const admin = await h.loginAs('admin');
    const stu = await h.loginAs('student1');
    const created = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, { score: '-4' }), isForm: true });
    const id = created.json.data.id;
    const rankOf = async () => {
      const r = await admin.req('GET', '/api/v1/statistics/ranking', { query: { week: '2026-W41' } });
      return r.json.data.find((x: any) => x.classId === seed.cls1.id)?.totalScore ?? 0;
    };
    const teacher = await h.loginAs('teacher1');
    await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: 'r' } });
    const before = await rankOf();                 // -4 计入（appealing）
    await admin.req('POST', `/api/v1/records/${id}/appeal/reject`, { body: { review_comment: '证据不足' } });
    const after = await rankOf();                  // 驳回 → 回滚 active，-4 仍计入
    expect(after).toBe(before);                    // ★ 罚分保留（与批准的 +7 形成对照）
  });

  it('admin 驳回 → record 回滚 active + appeal rejected', async () => {
    const stu = await h.loginAs('student1');
    const created = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, { score: '-1' }), isForm: true });
    const id = created.json.data.id;
    const teacher = await h.loginAs('teacher1');
    await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: 'r' } });

    const admin = await h.loginAs('admin');
    await admin.req('POST', `/api/v1/records/${id}/appeal/reject`, { body: { review_comment: '证据不足' } });
    const after = await admin.req('GET', `/api/v1/records/${id}`);
    expect(after.json.data.status).toBe('active');
  });

  it('非 active 记录不能申诉（400）', async () => {
    const stu = await h.loginAs('student1');
    const created = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, { score: '-1' }), isForm: true });
    const id = created.json.data.id;
    const admin = await h.loginAs('admin');
    await admin.req('POST', `/api/v1/records/${id}/revoke`, { body: {} }); // 先撤回
    const teacher = await h.loginAs('teacher1');
    const r = await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: 'r' } });
    expect(r.status).toBe(400);
  });
});

describe('SSE 实时推送（修复旧前端从没接的死代码）', () => {
  it('创建记录时 EventSource 收到 record_created', async () => {
    const stu = await h.loginAs('student1');
    const events: string[] = [];
    const ac = new AbortController();
    const ssePromise = (async () => {
      const res = await fetch(`${h.base}/api/v1/sse/records`, { headers: { Cookie: stu.jar.header() }, signal: ac.signal });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value, { stream: true });
          if (chunk.includes('record_created')) { events.push(chunk); break; }
        }
      } catch { /* abort */ }
    })();
    await new Promise((r) => setTimeout(r, 200));
    await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, { score: '1' }), isForm: true });
    await Promise.race([ssePromise, new Promise((r) => setTimeout(r, 2000))]);
    ac.abort();
    expect(events.length).toBeGreaterThan(0);
  });
});
