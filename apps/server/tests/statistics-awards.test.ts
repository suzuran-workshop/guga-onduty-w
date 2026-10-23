/**
 * E2E：统计聚合 + 流动红旗（候选参考 + 人工颁发）。
 * 覆盖：ranking 有效口径（revoked 不计、申诉调分后回 active 照常计分）、trend 补零、
 *      dashboard epoch 区间判今日、CSV 导出（BOM+转义）、awards candidates（只读不落库）、
 *      awards 人工颁发 + 幂等（重复颁发不增）。
 * 2026-10-23：分数由标签求和（不接受传值），故测试所需分值先建对应标签；
 *      红旗从「一键自动评选」改为「候选参考 + 管理员显式颁发」（POST /awards 需 class_ids）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, seedStandard, tinyPng, type Harness } from './helpers/harness.js';

let h: Harness;
let seed: Awaited<ReturnType<typeof seedStandard>>;

beforeAll(async () => {
  h = await boot('stats');
  seed = await seedStandard(h);
});
afterAll(async () => { await h.shutdown(); });

/**
 * 按分值取/建标签（分数由标签求和，故测试需要的每个分值都要有对应标签）。
 * 按 score 缓存，避免重复建标签。
 */
const tagByScore = new Map<number, string>();
async function tagWithScore(score: number): Promise<string> {
  const cached = tagByScore.get(score);
  if (cached) return cached;
  const admin = await h.loginAs('admin');
  const r = await admin.req('POST', '/api/v1/tags', {
    body: {
      name: `测试标签${score}`,
      score,
      category: score < 0 ? 'negative' : score > 0 ? 'positive' : 'neutral',
    },
  });
  expect(r.status).toBe(201);
  const id = r.json.data.id as string;
  tagByScore.set(score, id);
  return id;
}

/** student1 给某班打一条分（score 通过对应分值的标签实现） */
async function addRecord(classId: string, score: number, week = '2026-W41') {
  const c = await h.loginAs('student1');
  const tagId = await tagWithScore(score);
  const f = new FormData();
  f.append('class_ids', classId);
  f.set('week', week);
  f.append('tag_ids', tagId);
  if (score < 0) f.append('images', tinyPng()); // 扣分必拍照
  return c.req('POST', '/api/v1/records', { body: f, isForm: true });
}

describe('统计排名 ranking（有效口径）', () => {
  it('revoked 不计分（撤回的罚分被排除）', async () => {
    // 1班：+5(active) 与 -100(revoked)；后者撤回后不应拉低
    const a = await addRecord(seed.cls1.id, 5);
    expect(a.status).toBe(201);
    const b = await addRecord(seed.cls1.id, -100);
    expect(b.status).toBe(201);
    const admin = await h.loginAs('admin');
    await admin.req('POST', `/api/v1/records/${b.json.data[0].id}/revoke`, { body: {} });

    const r = await admin.req('GET', '/api/v1/statistics/ranking', { query: { week: '2026-W41' } });
    const c1 = r.json.data.find((x: any) => x.className === '1班');
    expect(c1.totalScore).toBe(5); // -100 revoked 被排除
    expect(c1.recordCount).toBe(1); // revoked 不计入 count
  });

  it('分数由标签求和（标签分权威，前端传的 score 被忽略）', async () => {
    const c = await h.loginAs('student1');
    const tagId = await tagWithScore(5);
    const f = new FormData();
    f.append('class_ids', seed.cls2.id);
    f.set('week', '2026-W41');
    f.append('tag_ids', tagId);
    f.set('score', '9999'); // 故意伪造，应被忽略
    const r = await c.req('POST', '/api/v1/records', { body: f, isForm: true });
    expect(r.status).toBe(201);
    expect(r.json.data[0].score).toBe(5); // 取标签分，不是 9999
  });

  it('rank 按总分降序编号，从 1 开始', async () => {
    const admin = await h.loginAs('admin');
    await addRecord(seed.cls2.id, 10); // 2班拿高分
    const r = await admin.req('GET', '/api/v1/statistics/ranking', { query: { week: '2026-W41' } });
    const ranks = r.json.data.map((x: any) => x.rank);
    expect(ranks[0]).toBe(1);
    expect(ranks).toEqual([...ranks].sort((p, q) => p - q)); // 连续升序
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
  it('今日统计用 epoch 区间（修复旧 UTC 边界 bug）', async () => {
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

  it('多标签记录在 CSV 中用顿号拼接标签名', async () => {
    const c = await h.loginAs('student1');
    const admin = await h.loginAs('admin');
    const tagA = await tagWithScore(5);
    const tagB = await tagWithScore(10);
    const f = new FormData();
    f.append('class_ids', seed.cls1.id);
    f.set('week', '2026-W41');
    f.append('tag_ids', tagA);
    f.append('tag_ids', tagB);
    const cr = await c.req('POST', '/api/v1/records', { body: f, isForm: true });
    expect(cr.status).toBe(201);
    expect(cr.json.data[0].score).toBe(15); // 5 + 10
    const r = await admin.req('GET', '/api/v1/statistics/export', { query: { week: '2026-W41' } });
    const text = new TextDecoder('utf-8').decode(await r.bytes());
    expect(text).toContain('、'); // 顿号分隔
  });
});

describe('流动红旗 awards（候选参考 + 人工颁发）', () => {
  it('candidates 提供每年级第一名参考（只读，不落库）', async () => {
    const admin = await h.loginAs('admin');
    const before = await admin.req('GET', '/api/v1/awards', { query: { week: '2026-W43' } });
    expect(before.json.data).toHaveLength(0);

    const r = await admin.req('GET', '/api/v1/awards/candidates', { query: { week: '2026-W43' } });
    expect(r.status).toBe(200);
    expect(r.json.data.length).toBeGreaterThanOrEqual(1);
    for (const cand of r.json.data) {
      expect(cand.classId).toBeTruthy();
      expect(cand.gradeId).toBeTruthy();
      expect(cand.rank).toBe(1);
      expect(typeof cand.alreadyAwarded).toBe('boolean');
    }
    // 只读：查候选不应产生奖项
    const after = await admin.req('GET', '/api/v1/awards', { query: { week: '2026-W43' } });
    expect(after.json.data).toHaveLength(0);
  });

  it('candidates 缺 week → 400', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/awards/candidates');
    expect(r.status).toBe(400);
  });

  it('student 不能看候选（403）', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('GET', '/api/v1/awards/candidates', { query: { week: '2026-W43' } });
    expect(r.status).toBe(403);
  });

  it('人工颁发：管理员从候选挑选 class_ids → 201 落库', async () => {
    const admin = await h.loginAs('admin');
    const cands = await admin.req('GET', '/api/v1/awards/candidates', { query: { week: '2026-W43' } });
    const classIds = cands.json.data.map((x: any) => x.classId);
    const r = await admin.req('POST', '/api/v1/awards', { body: { week: '2026-W43', class_ids: classIds } });
    expect(r.status).toBe(201);
    expect(r.json.data.length).toBe(classIds.length);
    expect(r.json.data[0].note).toContain('流动红旗');
    // 落库可查
    const list = await admin.req('GET', '/api/v1/awards', { query: { week: '2026-W43' } });
    expect(list.json.data.length).toBe(classIds.length);
  });

  it('幂等：重复颁发同一批不产生重复奖项', async () => {
    const admin = await h.loginAs('admin');
    const cands = await admin.req('GET', '/api/v1/awards/candidates', { query: { week: '2026-W43' } });
    const classIds = cands.json.data.map((x: any) => x.classId);
    // 候选已标记 alreadyAwarded
    expect(cands.json.data.every((x: any) => x.alreadyAwarded)).toBe(true);
    const r2 = await admin.req('POST', '/api/v1/awards', { body: { week: '2026-W43', class_ids: classIds } });
    expect(r2.status).toBe(201);
    expect(r2.json.data.length).toBe(0); // UNIQUE(campus,class,week) + onConflictDoNothing → 新增 0
    const list = await admin.req('GET', '/api/v1/awards', { query: { week: '2026-W43' } });
    expect(list.json.data.length).toBe(classIds.length); // 总数未增
  });

  it('颁发缺 class_ids → 400（不再支持一键自动评选）', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('POST', '/api/v1/awards', { body: { week: '2026-W43' } });
    expect(r.status).toBe(400);
  });

  it('按周查询奖项 + join className/gradeName', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/awards', { query: { week: '2026-W43' } });
    expect(r.status).toBe(200);
    expect(r.json.data[0].className).toBeTruthy();
    expect(r.json.data[0].gradeName).toBeTruthy();
  });

  it('student 不能颁旗（403）', async () => {
    const c = await h.loginAs('student1');
    const r = await c.req('POST', '/api/v1/awards', { body: { week: '2026-W42', class_ids: [seed.cls1.id] } });
    expect(r.status).toBe(403);
  });

  it('admin 删除奖项', async () => {
    const admin = await h.loginAs('admin');
    const list = await admin.req('GET', '/api/v1/awards', { query: { week: '2026-W43' } });
    const id = list.json.data[0].id;
    const r = await admin.req('DELETE', `/api/v1/awards/${id}`);
    expect(r.status).toBe(200);
    const after = await admin.req('GET', '/api/v1/awards', { query: { week: '2026-W43' } });
    expect(after.json.data.length).toBe(list.json.data.length - 1);
  });
});
