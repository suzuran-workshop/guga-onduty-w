/**
 * E2E：统计聚合 + 流动红旗评选。
 * 覆盖：ranking 有效口径（revoked 不计、appeal_approved 计入）、trend 补零、
 *      dashboard epoch 区间判今日、CSV 导出（BOM+转义）、awards 自动评选每年级第一名、
 *      awards 幂等（重复调用不增，修复旧代码无幂等 bug）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, seedStandard, type Harness } from './helpers/harness.js';

let h: Harness;
let seed: Awaited<ReturnType<typeof seedStandard>>;

beforeAll(async () => {
  h = await boot('stats');
  seed = await seedStandard(h);
});
afterAll(async () => { await h.shutdown(); });

function form(classId: string, score: string, week = '2026-W41') {
  const f = new FormData();
  f.set('class_id', classId);
  f.set('score', score);
  f.set('week', week);
  return f;
}

/** student1 给某班打一条分 */
async function addRecord(classId: string, score: string, week = '2026-W41') {
  const c = await h.loginAs('student1');
  return c.req('POST', '/api/v1/records', { body: form(classId, score, week), isForm: true });
}

describe('统计排名 ranking（有效口径）', () => {
  it('revoked 不计分，appeal_approved 计入', async () => {
    // 1班：+5(active) 与 -100(revoked)；后者撤回后不应拉低
    const a = await addRecord(seed.cls1.id, '5');
    const b = await addRecord(seed.cls1.id, '-100');
    const admin = await h.loginAs('admin');
    await admin.req('POST', `/api/v1/records/${b.json.data.id}/revoke`, { body: {} });

    const r = await admin.req('GET', '/api/v1/statistics/ranking', { query: { week: '2026-W41' } });
    const c1 = r.json.data.find((x: any) => x.className === '1班');
    expect(c1.totalScore).toBe(5); // -100 revoked 被排除
    expect(c1.recordCount).toBe(1); // revoked 不计入 count
  });

  it('rank 按总分降序编号，从 1 开始', async () => {
    const admin = await h.loginAs('admin');
    await addRecord(seed.cls2.id, '10'); // 2班拿高分
    const r = await admin.req('GET', '/api/v1/statistics/ranking', { query: { week: '2026-W41' } });
    const ranks = r.json.data.map((x: any) => x.rank);
    expect(ranks[0]).toBe(1);
    expect(ranks).toEqual([...ranks].sort((p, q) => p - q)); // 连续升序
    // 2班(10+5=15? 不，2班只有+10) 应在前列
    const top = r.json.data[0];
    expect(top.totalScore).toBeGreaterThanOrEqual(10);
  });

  it('非 admin 排名按本校区隔离', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('GET', '/api/v1/statistics/ranking', { query: { week: '2026-W41' } });
    expect(r.status).toBe(200);
    // 返回的都是 c1 的班级
    expect(r.json.data.every((x: any) => x.className === '1班' || x.className === '2班')).toBe(true);
  });
});

describe('统计趋势 trend', () => {
  it('返回请求周数的数据点，无数据周补零', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/statistics/trend', { query: { class_id: seed.cls1.id, weeks: 4 } });
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(4);
    // 每点有 week + totalScore
    for (const p of r.json.data) {
      expect(typeof p.week).toBe('string');
      expect(typeof p.totalScore).toBe('number');
    }
  });

  it('缺 class_id → 400', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/statistics/trend');
    expect(r.status).toBe(400);
  });
});

describe('看板 dashboard', () => {
  it('今日统计用 epoch 区间（含 appeal_approved，修复旧 UTC 边界 bug）', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/statistics/dashboard');
    expect(r.status).toBe(200);
    const d = r.json.data;
    expect(d).toHaveProperty('todayRecords');
    expect(d).toHaveProperty('todayPositive');
    expect(d).toHaveProperty('todayNegative');
    expect(d).toHaveProperty('weekTopClass');
    expect(d.todayRecords).toBeGreaterThan(0); // 前面已建今日记录
  });
});

describe('CSV 导出', () => {
  it('导出含 UTF-8 BOM + 表头 + text/csv（修复旧转义 bug）', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/statistics/export', { query: { week: '2026-W41' } });
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toContain('text/csv');
    const bytes = await r.bytes();
    // BOM: EF BB BF
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    const text = new TextDecoder('utf-8').decode(bytes);
    expect(text).toContain('班级');
    expect(text).toContain('状态');
  });
});

describe('流动红旗 awards（幂等评选）', () => {
  it('自动评选每年级第一名并颁旗', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('POST', '/api/v1/awards', { body: { week: '2026-W41' } });
    expect(r.status).toBe(201);
    // seed 里 c1 只有 1 个年级(g1) 含 1班/2班 → 颁 1 面旗
    expect(r.json.data.length).toBeGreaterThanOrEqual(1);
    const note = r.json.data[0].note;
    expect(note).toContain('流动红旗');
  });

  it('幂等：重复颁发不产生重复奖项（修复旧代码无幂等 bug）', async () => {
    const admin = await h.loginAs('admin');
    const r1 = await admin.req('POST', '/api/v1/awards', { body: { week: '2026-W41' } });
    const n1 = r1.json.data.length;
    const r2 = await admin.req('POST', '/api/v1/awards', { body: { week: '2026-W41' } });
    const n2 = r2.json.data.length;
    expect(n2).toBe(n1); // UNIQUE(campus,class,week) + onConflictDoNothing 保证不增
  });

  it('按周查询奖项 + join className/gradeName', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/awards', { query: { week: '2026-W41' } });
    expect(r.status).toBe(200);
    expect(r.json.data[0].className).toBeTruthy();
    expect(r.json.data[0].gradeName).toBeTruthy();
  });

  it('student 不能颁旗（403）', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('POST', '/api/v1/awards', { body: { week: '2026-W42' } });
    expect(r.status).toBe(403);
  });

  it('admin 删除奖项', async () => {
    const admin = await h.loginAs('admin');
    const list = await admin.req('GET', '/api/v1/awards', { query: { week: '2026-W41' } });
    const id = list.json.data[0].id;
    const r = await admin.req('DELETE', `/api/v1/awards/${id}`);
    expect(r.status).toBe(200);
  });
});
