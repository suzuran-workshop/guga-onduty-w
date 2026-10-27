/**
 * E2E：值周记录 + 申诉状态机（核心业务流）。
 * 覆盖：multipart 创建（含图片→storage，多班级多标签）、分页/筛选、软删撤回、
 *      申诉全链路（teacher 只能申诉自己班→record appealing→admin 批准=调分回 active / 驳回→回滚 active）、
 *      事务原子性、SSE 事件触发、图片经 /files 可读、非图片类型拒绝、扣分必拍照。
 * 2026-10-23：POST /records 响应改为**数组**（每班级一条）；form 字段 class_ids[]/tag_ids[]（复数）；
 *      分数由服务端按标签求和（不再传 score）；appeal_approved 状态已移除（approve=调分回 active）。
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

/** 多班级 form：class_ids[] 可多个，tag_ids[] 可多个，score 由服务端求和（不接受传值） */
function recordForm(classIds: string | string[], extra?: Record<string, string>, images?: File[], tagIds?: string[]) {
  const f = new FormData();
  for (const cid of Array.isArray(classIds) ? classIds : [classIds]) f.append('class_ids', cid);
  f.set('week', '2026-W41');
  if (tagIds) for (const tid of tagIds) f.append('tag_ids', tid);
  if (extra) for (const [k, v] of Object.entries(extra)) f.set(k, v);
  if (images) images.forEach((img) => f.append('images', img));
  return f;
}

describe('记录创建（multipart + storage）', () => {
  it('student 创建带图片记录 → 201，图片存 objectKey，join 字段齐全', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('POST', '/api/v1/records', {
      body: recordForm(seed.cls1.id, { comment: '迟到' }, [tinyPng()], [seed.tagNeg.id]),
      isForm: true,
    });
    expect(r.status).toBe(201);
    // 响应是数组（每班级一条）；单班级 → 1 条
    expect(Array.isArray(r.json.data)).toBe(true);
    expect(r.json.data).toHaveLength(1);
    const rec = r.json.data[0];
    expect(rec.className).toBe('1班');
    expect(rec.recorderName).toBe('值周生A'); // 来自 userProfiles.displayName
    expect(rec.tags).toHaveLength(1);
    expect(rec.tags[0].name).toBe('迟到');
    expect(rec.score).toBe(-1); // 由标签分求和（迟到 -1）
    expect(rec.status).toBe('active');
    expect(rec.images).toHaveLength(1);
    expect(typeof rec.images[0]).toBe('string');
  });

  it('多标签求和：分数 = Σ 标签分，且不接受前端传 score（标签分权威）', async () => {
    const c = await h.loginAs('student1');
    // 选 迟到(-1) + 卫生优秀(+2) = +1；再故意传 score=999 应被忽略
    // （含扣分标签 → 按「扣分必拍照」规则须带图）
    const r = await c.req('POST', '/api/v1/records', {
      body: recordForm(seed.cls2.id, { score: '999' }, [tinyPng()], [seed.tagNeg.id, seed.tagPos.id]),
      isForm: true,
    });
    expect(r.status).toBe(201);
    const rec = r.json.data[0];
    expect(rec.score).toBe(1); // -1 + 2 = 1，不是 999
    expect(rec.tags.map((t: any) => t.name).sort()).toEqual(['卫生优秀', '迟到']);
  });

  it('班级多选：一次提交 N 个班级 → 落库 N 条独立记录', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('POST', '/api/v1/records', {
      body: recordForm([seed.cls1.id, seed.cls2.id], { comment: '两操整齐' }, [], [seed.tagPos.id]),
      isForm: true,
    });
    expect(r.status).toBe(201);
    expect(r.json.data).toHaveLength(2);
    const [a, b] = r.json.data;
    expect(a.id).not.toBe(b.id); // 独立 id
    expect(a.classId).not.toBe(b.classId);
    expect(a.score).toBe(2); // 同标签集 → 同分数
    expect(b.score).toBe(2);
    expect([a.className, b.className].sort()).toEqual(['1班', '2班']);
  });

  it('扣分标签无图 → 400（扣分必拍照）', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('POST', '/api/v1/records', {
      body: recordForm(seed.cls1.id, {}, [], [seed.tagNeg.id]), // 扣分标签但无图
      isForm: true,
    });
    expect(r.status).toBe(400);
  });

  it('加分标签无图 → 201（非扣分不强制拍照）', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('POST', '/api/v1/records', {
      body: recordForm(seed.cls2.id, {}, [], [seed.tagPos.id]),
      isForm: true,
    });
    expect(r.status).toBe(201);
  });

  it('图片可经 /files/<key> 读回（修复旧代码图片死数据）', async () => {
    const c = await h.loginAs('student1');
    const created = await c.req('POST', '/api/v1/records', {
      body: recordForm(seed.cls1.id, {}, [tinyPng()], [seed.tagPos.id]), isForm: true,
    });
    const key = created.json.data[0].images[0];
    const fileRes = await fetch(`${h.base}/files/${key}`, { headers: { Cookie: c.jar.header() } });
    expect(fileRes.status).toBe(200);
    const buf = new Uint8Array(await fileRes.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
  });

  it('非图片类型上传 → 400', async () => {
    const c = await h.loginAs('student1');
    const f = recordForm(seed.cls1.id, {}, [new File([new Uint8Array([1, 2, 3])], 'x.exe', { type: 'application/octet-stream' })]);
    const r = await c.req('POST', '/api/v1/records', { body: f, isForm: true });
    expect(r.status).toBe(400);
  });

  it('缺 class_ids → 400', async () => {
    const c = await h.loginAs('student1');
    const f = new FormData();
    f.set('week', '2026-W41');
    const r = await c.req('POST', '/api/v1/records', { body: f, isForm: true });
    expect(r.status).toBe(400);
  });

  it('班级不存在 → 404', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('POST', '/api/v1/records', { body: recordForm('nonexistent-uuid'), isForm: true });
    expect(r.status).toBe(404);
  });

  it('student 不能给 c2 班级打分（跨校区拒绝）', async () => {
    const c = await h.loginAs('student1'); // c1
    const r = await c.req('POST', '/api/v1/records', { body: recordForm(seed.clsC2.id), isForm: true });
    expect(r.status).toBe(403);
  });

  it('多选班级含跨校区 → 403（一次评价须同校区且本校区）', async () => {
    const c = await h.loginAs('student1'); // c1
    const r = await c.req('POST', '/api/v1/records', { body: recordForm([seed.cls1.id, seed.clsC2.id]), isForm: true });
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
    const created = await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, {}, [], [seed.tagPos.id]), isForm: true });
    const id = created.json.data[0].id;

    const admin = await h.loginAs('admin');
    const r = await admin.req('POST', `/api/v1/records/${id}/revoke`, { body: { reason: '误录' } });
    expect(r.status).toBe(200);
    const after = await admin.req('GET', `/api/v1/records/${id}`);
    expect(after.json.data.status).toBe('revoked');
  });

  it('撤回只撤被指定的那条，不连带同批其他班级（多班级独立）', async () => {
    const stu = await h.loginAs('student1');
    // 一次给两个班打同样的分 → 两条独立记录
    const created = await stu.req('POST', '/api/v1/records', {
      body: recordForm([seed.cls1.id, seed.cls2.id], {}, [], [seed.tagPos.id]), isForm: true,
    });
    const [a, b] = created.json.data;
    const admin = await h.loginAs('admin');
    await admin.req('POST', `/api/v1/records/${a.id}/revoke`, { body: { reason: '误录' } });
    const afterA = await admin.req('GET', `/api/v1/records/${a.id}`);
    const afterB = await admin.req('GET', `/api/v1/records/${b.id}`);
    expect(afterA.json.data.status).toBe('revoked');
    expect(afterB.json.data.status).toBe('active'); // 另一条不受影响
  });

  it('student 不能撤回（403）', async () => {
    const admin = await h.loginAs('admin');
    const created = await admin.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, {}, [], [seed.tagPos.id]), isForm: true });
    const id = created.json.data[0].id;
    const stu = await h.loginAs('student1');
    const r = await stu.req('POST', `/api/v1/records/${id}/revoke`, { body: {} });
    expect(r.status).toBe(403);
  });
});

describe('申诉状态机（事务联动）', () => {
  /** 建一条 cls1 的扣分记录（迟到 -1，带图满足「扣分必拍照」），返回记录 id */
  async function createDeductionOnCls1(): Promise<string> {
    const stu = await h.loginAs('student1');
    const created = await stu.req('POST', '/api/v1/records', {
      body: recordForm(seed.cls1.id, {}, [tinyPng()], [seed.tagNeg.id]), isForm: true,
    });
    return created.json.data[0].id;
  }

  const rankOfCls1 = async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/statistics/ranking', { query: { week: '2026-W41' } });
    return r.json.data.find((x: any) => x.classId === seed.cls1.id)?.totalScore ?? 0;
  };

  it('teacher 申诉自己班(cls1) 的 active 记录 → record 变 appealing', async () => {
    const id = await createDeductionOnCls1();
    const teacher = await h.loginAs('teacher1');
    const r = await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: '情况特殊' } });
    expect(r.status).toBe(201);

    const admin = await h.loginAs('admin');
    const after = await admin.req('GET', `/api/v1/records/${id}`);
    expect(after.json.data.status).toBe('appealing');
  });

  it('teacher 不能申诉非自己班(cls2 未绑定班主任) → 403（只能申诉自己班）', async () => {
    const stu = await h.loginAs('student1');
    const created = await stu.req('POST', '/api/v1/records', {
      body: recordForm(seed.cls2.id, {}, [tinyPng()], [seed.tagNeg.id]), isForm: true,
    });
    const id = created.json.data[0].id;
    const teacher = await h.loginAs('teacher1'); // cls1 的班主任，非 cls2
    const r = await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: 'x' } });
    expect(r.status).toBe(403);
    // 记录状态未被改动（申诉未成立）
    const admin = await h.loginAs('admin');
    const after = await admin.req('GET', `/api/v1/records/${id}`);
    expect(after.json.data.status).toBe('active');
  });

  it('申诉理由为空 → 400', async () => {
    const id = await createDeductionOnCls1();
    const teacher = await h.loginAs('teacher1');
    const r = await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: '' } });
    expect(r.status).toBe(400);
  });

  it('student 不能申诉（403，仅 teacher）', async () => {
    const id = await createDeductionOnCls1();
    const stu = await h.loginAs('student1');
    const r = await stu.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: 'x' } });
    expect(r.status).toBe(403);
  });

  it('admin 批准（带调整后标签）→ record 回 active + 分数重算 + appeal approved', async () => {
    const id = await createDeductionOnCls1(); // -1
    const teacher = await h.loginAs('teacher1');
    await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: 'r' } });

    const admin = await h.loginAs('admin');
    // 申诉成立：把「迟到(-1)」改为「卫生优秀(+2)」——修改而非撤销
    const r = await admin.req('POST', `/api/v1/records/${id}/appeal/approve`, {
      body: { review_comment: '属实，改为表扬', tag_ids: [seed.tagPos.id] },
    });
    expect(r.status).toBe(200);
    const after = await admin.req('GET', `/api/v1/records/${id}`);
    expect(after.json.data.status).toBe('active'); // 不再是 appeal_approved（该状态已移除）
    expect(after.json.data.score).toBe(2);         // 分数按新标签重算
    expect(after.json.data.tags.map((t: any) => t.name)).toEqual(['卫生优秀']);
    // appeal 表状态
    const appeals = await admin.req('GET', '/api/v1/appeals', { query: { pageSize: 100 } });
    const mine = appeals.json.data.find((a: any) => a.recordId === id);
    expect(mine.status).toBe('approved');
    expect(mine.reviewerId).toBeTruthy();
  });

  // 「清空标签」是 UI 上的一个真实操作（申诉对话框有「清空标签（0 分）」按钮），
  // 其语义必须与「不传 tag_ids」**区分开**：后者保持原集（分数不变），前者是「本次不扣分」
  // —— score 归 0 但记录仍 active、仍计入记录数（不是撤销）。这条用例锁住二者不混淆。
  it('admin 批准（tag_ids 为空数组）→ score 归 0，但记录仍 active 且计入统计', async () => {
    const id = await createDeductionOnCls1(); // -1
    const teacher = await h.loginAs('teacher1');
    await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: '当时已整改' } });

    const admin = await h.loginAs('admin');

    // 排名的聚合口径是「该班当周全部记录」，而本文件的其它用例已在同一周给 cls1 打过扣分，
    // 故**不能**断言 negativeCount 的绝对值（那依赖执行顺序，是假隔离）。
    // 正确写法是取 approve 前后的**差值**：清空标签应当让这条记录不再贡献一次扣分。
    const rankOf = async () => {
      const rk = await admin.req('GET', '/api/v1/statistics/ranking', { query: { week: '2026-W41' } });
      const row = rk.json.data.find((x: any) => x.classId === seed.cls1.id);
      if (!row) throw new Error('排名里没有 cls1');
      return row as { recordCount: number; negativeCount: number; totalScore: number };
    };
    const before = await rankOf();

    const r = await admin.req('POST', `/api/v1/records/${id}/appeal/approve`, {
      body: { review_comment: '属实，撤销本次扣分', tag_ids: [] },
    });
    expect(r.status).toBe(200);

    const after = await admin.req('GET', `/api/v1/records/${id}`);
    expect(after.json.data.score).toBe(0);        // 空标签集 → 0 分（分数由标签派生）
    expect(after.json.data.status).toBe('active'); // 不是撤销：记录仍然存在且生效
    expect(after.json.data.tags).toEqual([]);      // 标签被清空

    // 仍计入统计（active 与 appealing 都属 SCORED_STATUSES）：
    //  - recordCount 不变 —— 记录没被撤销，只是分数归零
    //  - negativeCount 少 1 —— 分数不再 < 0，这条不再是「扣分」
    //  - totalScore 多 1     —— 从 -1 变 0，正是「修改而非撤销」的可观测后果
    const rankAfter = await rankOf();
    expect(rankAfter.recordCount).toBe(before.recordCount);
    expect(rankAfter.negativeCount).toBe(before.negativeCount - 1);
    expect(rankAfter.totalScore).toBe(before.totalScore + 1);

    // 调分史留痕：logs 含 adjust，管理员之后能看出「这条曾经扣过分，被申诉调成 0」
    const logs = await admin.req('GET', `/api/v1/records/${id}/logs`);
    expect(logs.status).toBe(200);
    expect(logs.json.data.map((l: any) => l.action)).toContain('adjust');
  });

  it('admin 批准（不带 tag_ids）→ 保持原标签，仅状态回 active', async () => {
    const id = await createDeductionOnCls1(); // -1
    const teacher = await h.loginAs('teacher1');
    await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: 'r' } });
    const admin = await h.loginAs('admin');
    await admin.req('POST', `/api/v1/records/${id}/appeal/approve`, { body: { review_comment: '属实' } });
    const after = await admin.req('GET', `/api/v1/records/${id}`);
    expect(after.json.data.status).toBe('active');
    expect(after.json.data.score).toBe(-1); // 标签未变 → 分数不变
  });

  // ── 调分史可追溯（recordLogs 此前是纯写表，全仓无读取路径 → 调分不可追溯）──
  it('调分史可追溯：logs 依次含 create → appeal → adjust，且带操作人姓名', async () => {
    const id = await createDeductionOnCls1(); // create（迟到 -1）
    const teacher = await h.loginAs('teacher1');
    await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: '情况特殊' } }); // appeal
    const admin = await h.loginAs('admin');
    await admin.req('POST', `/api/v1/records/${id}/appeal/approve`, {
      body: { review_comment: '核实后改为表扬', tag_ids: [seed.tagPos.id] },
    }); // adjust

    const r = await admin.req('GET', `/api/v1/records/${id}/logs`);
    expect(r.status).toBe(200);
    const actions = r.json.data.map((l: any) => l.action);
    expect(actions).toEqual(['create', 'appeal', 'adjust']); // 按时间升序
    const adjustLog = r.json.data[2];
    expect(adjustLog.reason).toBe('核实后改为表扬'); // 审批意见记入 reason
    expect(adjustLog.operatorName).toBe('系统管理员'); // join userProfiles 取操作人名
    expect(typeof adjustLog.createdAt).toBe('number');
  });

  it('logs：student 不可读（403，含审批意见的监督面信息）', async () => {
    const id = await createDeductionOnCls1();
    const stu = await h.loginAs('student1');
    const r = await stu.req('GET', `/api/v1/records/${id}/logs`);
    expect(r.status).toBe(403);
  });

  it('logs：跨校区记录 → 404（不泄露存在性）', async () => {
    const s2 = await h.loginAs('student2'); // c2
    const f = new FormData();
    f.append('class_ids', seed.clsC2.id);
    f.set('week', '2026-W41');
    f.append('tag_ids', seed.tagC2.id);
    f.append('images', tinyPng()); // 扣分必拍照
    const created = await s2.req('POST', '/api/v1/records', { body: f, isForm: true });
    const c2recId = created.json.data[0].id;

    const t1 = await h.loginAs('teacher1'); // c1 的教师
    const r = await t1.req('GET', `/api/v1/records/${c2recId}/logs`);
    expect(r.status).toBe(404);
    // admin 跨校区可读（隔离不误伤 admin）
    const admin = await h.loginAs('admin');
    const ra = await admin.req('GET', `/api/v1/records/${c2recId}/logs`);
    expect(ra.status).toBe(200);
    expect(ra.json.data[0].action).toBe('create');
  });

  // ── 业务效果回归（原 REVIEW #1 的两条，按「修改而非撤销」语义重写）──
  // 旧语义：approve = 把记录踢出计分（全额撤销），排名只能回升「原罚分」那么多。
  // 新语义：approve = 调分，排名变化量 = 新分 − 旧分，**可以为正也可以为负**。
  // 下面这条把 -1 调成 +2（排名 +3）——纯「撤销」语义最多只能 +1，永远做不到 +3，
  // 因此若有人把语义改回撤销，此测试必炸。
  it('申诉成立 → 排名按调整后分数变化（-1 调 +2 → 排名 +3，证明是「修改」非「撤销」）', async () => {
    const id = await createDeductionOnCls1();
    const before = await rankOfCls1();               // 含 -1
    const teacher = await h.loginAs('teacher1');
    await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: 'r' } });
    const duringAppeal = await rankOfCls1();         // appealing 仍计分 → 罚分暂仍生效
    expect(duringAppeal).toBe(before);
    const admin = await h.loginAs('admin');
    await admin.req('POST', `/api/v1/records/${id}/appeal/approve`, {
      body: { review_comment: '属实', tag_ids: [seed.tagPos.id] },
    });
    const after = await rankOfCls1();
    expect(after).toBe(before + 3);                  // ★ -1 → +2，净变化 +3（撤销语义做不到）
  });

  it('申诉驳回 → 罚分保留（与批准形成对照，approve≠reject）', async () => {
    const id = await createDeductionOnCls1();
    const teacher = await h.loginAs('teacher1');
    await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: 'r' } });
    const before = await rankOfCls1();               // -1 计入（appealing）
    const admin = await h.loginAs('admin');
    await admin.req('POST', `/api/v1/records/${id}/appeal/reject`, { body: { review_comment: '证据不足' } });
    const after = await rankOfCls1();                // 驳回 → 回滚 active，-1 仍计入
    expect(after).toBe(before);                      // ★ 罚分保留（与批准的 +3 形成对照）
  });

  it('admin 驳回 → record 回滚 active + appeal rejected', async () => {
    const id = await createDeductionOnCls1();
    const teacher = await h.loginAs('teacher1');
    await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: 'r' } });

    const admin = await h.loginAs('admin');
    await admin.req('POST', `/api/v1/records/${id}/appeal/reject`, { body: { review_comment: '证据不足' } });
    const after = await admin.req('GET', `/api/v1/records/${id}`);
    expect(after.json.data.status).toBe('active');
  });

  it('approve 带他校区标签 → 403（防跨校区引用伪造分数）', async () => {
    const id = await createDeductionOnCls1();
    const teacher = await h.loginAs('teacher1');
    await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: 'r' } });
    const admin = await h.loginAs('admin');
    const r = await admin.req('POST', `/api/v1/records/${id}/appeal/approve`, {
      body: { review_comment: 'x', tag_ids: [seed.tagC2.id] }, // c2 的标签
    });
    expect(r.status).toBe(403);
  });

  it('非 active 记录不能申诉（400）', async () => {
    const id = await createDeductionOnCls1();
    const admin = await h.loginAs('admin');
    await admin.req('POST', `/api/v1/records/${id}/revoke`, { body: {} }); // 先撤回
    const teacher = await h.loginAs('teacher1');
    const r = await teacher.req('POST', `/api/v1/records/${id}/appeal`, { body: { reason: 'r' } });
    expect(r.status).toBe(400);
  });
});

describe('SSE 实时推送（修复旧前端从没接的死代码）', () => {
  it('创建记录时 EventSource 收到 record_created', async () => {
    // 2026-10-23：SSE 属展示面，不在 student 白名单（学生只能评价）。
    // 本测试意图是「建记录 → 触发事件」，故拆开角色：student 建记录，admin 订阅（贴合真实大屏场景）。
    const admin = await h.loginAs('admin');
    const stu = await h.loginAs('student1');
    const events: string[] = [];
    const ac = new AbortController();
    const ssePromise = (async () => {
      const res = await fetch(`${h.base}/api/v1/sse/records`, { headers: { Cookie: admin.jar.header() }, signal: ac.signal });
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
    await stu.req('POST', '/api/v1/records', { body: recordForm(seed.cls1.id, {}, [], [seed.tagPos.id]), isForm: true });
    await Promise.race([ssePromise, new Promise((r) => setTimeout(r, 2000))]);
    ac.abort();
    expect(events.length).toBeGreaterThan(0);
  });

  it('student 订阅 SSE → 403（展示面不对学生开放）', async () => {
    const stu = await h.loginAs('student1');
    const res = await fetch(`${h.base}/api/v1/sse/records`, { headers: { Cookie: stu.jar.header() } });
    expect(res.status).toBe(403);
    res.body?.cancel().catch(() => {});
  });
});
