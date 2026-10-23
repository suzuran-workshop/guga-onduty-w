/**
 * P5 端到端冒烟 —— 启动真实 HTTP 服务，走完整链路：
 *  cookie 登录 → 业务端点 → RBAC → 多校区隔离 → storage 上传+/files 读取 → SSE 实时推送。
 * 运行：pnpm tsx scripts/smoke-e2e.ts
 */
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeAdapter } from '@homurajs/app-kit/serve';
import { bootstrap } from '../src/bootstrap.js';
import { EventBus } from '../src/utils/event-bus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB = join(__dirname, '../data/smoke.db');
const FILES = join(__dirname, '../data/smoke-files');
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0;
function ok(label: string, extra?: unknown) { pass++; console.log(`  ✅ ${label}`, extra !== undefined ? JSON.stringify(extra) : ''); }
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

// 极简 cookie jar（按 host 存 cookie）
class Jar {
  private jar = new Map<string, string>();
  absorb(res: Response) {
    const sc = res.headers.getSetCookie?.() ?? [];
    for (const c of sc) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
  }
  header() { return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
}

async function req(jar: Jar, method: string, path: string, body?: unknown, isForm = false): Promise<{ status: number; json: any; res: Response }> {
  const headers: Record<string, string> = {};
  const ck = jar.header(); if (ck) headers['Cookie'] = ck;
  let payload: any;
  if (body !== undefined) {
    if (isForm) { payload = body; }
    else { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  }
  const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });
  jar.absorb(res);
  const ct = res.headers.get('content-type') || '';
  const json = ct.includes('json') ? await res.json().catch(() => null) : null;
  return { status: res.status, json, res };
}

async function main() {
  console.log('\n[P5] 端到端冒烟（真实 HTTP 服务）\n');
  rmSync(DB, { force: true }); rmSync(DB + '-wal', { force: true }); rmSync(DB + '-shm', { force: true });
  rmSync(FILES, { recursive: true, force: true });
  mkdirSync(dirname(DB), { recursive: true });

  // env（bootstrap 读 config）
  process.env.SESSION_SECRET = 'smoke-secret-key-32bytes-minimum-xxx';
  process.env.DB_DIALECT = 'sqlite';
  process.env.DB_PATH = DB;
  process.env.STORAGE_ROOT = FILES;
  process.env.PORT = String(PORT);
  process.env.CORS_ORIGINS = 'http://localhost:5173';

  const adapter = createNodeAdapter();
  const booted = await bootstrap({ secure: false, staticDir: undefined, loginPath: '/login' });

  // 用 bootstrap 的 repos 手动灌最小数据（smoke 专用，不复用完整 seed）
  const R = booted.repos;
  const c1 = await R.campuses.create({ name: '第一校区', code: 'campus_01' });
  const c2 = await R.campuses.create({ name: '第二校区', code: 'campus_02' });
  const g1 = await R.grades.create({ campusId: c1.id, name: '1年级', sortOrder: 1 });
  const cls1 = await R.classes.create({ campusId: c1.id, gradeId: g1.id, name: '1班' });
  const clsC2 = await R.classes.create({ campusId: c2.id, gradeId: (await R.grades.create({ campusId: c2.id, name: '1年级', sortOrder: 1 })).id, name: '1班' });
  await R.users.create({ campusId: c1.id, username: 'admin', password: '123456', displayName: '管理员', role: 'admin' });
  const teacher1 = await R.users.create({ campusId: c1.id, username: 'teacher1', password: '123456', displayName: '李老师', role: 'teacher' });
  const student1 = await R.users.create({ campusId: c1.id, username: 'student1', password: '123456', displayName: '值周生A', role: 'student' });
  await R.users.create({ campusId: c2.id, username: 'student2', password: '123456', displayName: '值周生B', role: 'student' });
  // 班主任绑定（申诉「只能申诉自己班」校验需要；见 routes/records.ts）。
  // classes.teacherDingtalkId 存**钉钉 userid**（非系统 users.id），系统内申诉需先把登录教师
  // 解析成钉钉 userid（经 oauth2_identity_links）→ 这里模拟「教师已用钉钉登录过」。
  // userid 形状照实测真实值（数字串，非 uuid）。
  const dtTeacher1 = '0252163856461532927016';
  await booted.auth.linkStore.create({ userId: teacher1.id, provider: 'dingtalk', providerSub: dtTeacher1 });
  // 通讯录缓存：绑定校验要求 userid 已在「引入的组织通讯录」中
  await R.dingtalkContacts.upsertMany([
    { userId: dtTeacher1, name: '李老师', mobile: '13800000001', title: '班主任', deptIds: [1], deptNames: ['一校区'], syncedAt: Date.now() },
  ]);
  await R.classes.update(cls1.id, { name: '1班', classTeacher: '李老师', teacherDingtalkId: dtTeacher1 });
  const tagNeg = await R.tags.create({ campusId: c1.id, name: '迟到', score: -1, category: 'negative', isSystem: true });

  // 启动监听
  const ac = new AbortController();
  await adapter.start(booted.homura.app, { port: PORT, signal: ac.signal });
  // 等端口就绪
  await new Promise((r) => setTimeout(r, 300));

  try {
    // ═════ healthz ═════
    console.log('[healthz]');
    const hz = await req(new Jar(), 'GET', '/healthz');
    ok('GET /healthz', { status: hz.status, body: hz.json });
    assert(hz.status === 200 && hz.json.status === 'ok', 'healthz 应 200 ok');

    // ═════ 登录（SDK cookie）═════
    console.log('\n[登录]');
    const adminJar = new Jar();
    const login = await req(adminJar, 'POST', '/auth/password/login', { username: 'admin', password: '123456' });
    ok('POST /auth/password/login (admin)', { status: login.status, body: login.json });
    assert(login.status === 200, '登录应 200');
    assert(adminJar.header().length > 0, '应下发 cookie');
    const badLogin = await req(new Jar(), 'POST', '/auth/password/login', { username: 'admin', password: 'wrong' });
    assert(badLogin.status === 401, '错误密码应 401');
    ok('错误密码 401');

    // ═════ /api/v1/auth/me ═════
    console.log('\n[/auth/me]');
    const me = await req(adminJar, 'GET', '/api/v1/auth/me');
    ok('GET /me（身份+档案+校区名）', { user: me.json?.data?.user?.username, role: me.json?.data?.profile?.role, campus: me.json?.data?.campusName });
    assert(me.json?.data?.profile?.role === 'admin', 'admin profile');
    assert(me.json?.data?.user?.username === 'admin', 'username 来自 auth users');

    // ═════ 未认证 401 ═════
    console.log('\n[未认证]');
    const noAuth = await req(new Jar(), 'GET', '/api/v1/campuses');
    assert(noAuth.status === 401, `未认证应 401，实际 ${noAuth.status}`);
    ok('无 cookie 访问业务路由 → 401');

    // ═════ RBAC：student 不能写 ═════
    console.log('\n[RBAC]');
    const stuJar = new Jar();
    await req(stuJar, 'POST', '/auth/password/login', { username: 'student1', password: '123456' });
    const stuCreateTag = await req(stuJar, 'POST', '/api/v1/tags', { name: '学生乱建', score: 5 });
    assert(stuCreateTag.status === 403, `student 建标签应 403，实际 ${stuCreateTag.status}`);
    ok('student POST /tags → 403（修复旧代码 student 可写）');
    const stuReadTags = await req(stuJar, 'GET', '/api/v1/tags');
    assert(stuReadTags.status === 200, 'student 读标签应 200');
    ok('student GET /tags → 200（读放行）');
    const stuSettings = await req(stuJar, 'PUT', '/api/v1/settings', { settings: [{ key: 'x', value: 'y' }] });
    assert(stuSettings.status === 403, `student 改设置应 403，实际 ${stuSettings.status}`);
    ok('student PUT /settings → 403');

    // ═════ 多校区隔离 ═════
    console.log('\n[多校区隔离]');
    // 2026-10-23：campuses 属非评价模块 → student 闸门 403（原代码此处只赋值不断言，是死代码）
    const stuCampuses = await req(stuJar, 'GET', '/api/v1/campuses');
    assert(stuCampuses.status === 403, `student 读校区应 403（闸门），实际 ${stuCampuses.status}`);
    ok('student GET /campuses → 403（非评价模块，闸门拦截）');
    // classes 在学生白名单内（打分需选班），student1 属 c1，非 admin 只能看自己校区
    const stuList = await req(stuJar, 'GET', '/api/v1/classes');
    const stuClassIds = stuList.json?.data?.map((x: any) => x.id) ?? [];
    assert(!stuClassIds.includes(clsC2.id), 'student1(c1) 不应看到 c2 的班级');
    ok('student 读班级只见本校区（强制隔离）');
    // student 试图用 ?campus_id= 跨校区读 → 被忽略，仍只返回本校区
    const crossRead = await req(stuJar, 'GET', `/api/v1/classes?campus_id=${c2.id}`);
    const crossIds = crossRead.json?.data?.map((x: any) => x.id) ?? [];
    assert(!crossIds.includes(clsC2.id), '?campus_id= 覆盖应被忽略（非 admin）');
    ok('student ?campus_id=c2 越权读被拦截（修复假隔离）');
    // admin 可跨校区
    const adminAll = await req(adminJar, 'GET', '/api/v1/campuses');
    assert((adminAll.json?.data?.length ?? 0) === 2, 'admin 应看全部 2 校区');
    ok('admin 看全部校区');

    // ═════ 记录创建（multipart + storage + SSE）═════
    console.log('\n[记录 + storage + SSE]');
    // 2026-10-23：SSE 属展示面，已对 student 关闭（需求 2「学生只能评价」）→ 改用 admin 订阅，
    // 贴合真实大屏场景（管理侧订阅、值周生只管打分）。先验证 student 确实被拒。
    const stuSse = await fetch(`${BASE}/api/v1/sse/records`, { headers: { Cookie: stuJar.header() } });
    assert(stuSse.status === 403, `student 订阅 SSE 应 403，实际 ${stuSse.status}`);
    stuSse.body?.cancel().catch(() => {});
    ok('student 订阅 SSE → 403（展示面不对学生开放）');

    const sseEvents: string[] = [];
    const sseAc = new AbortController();
    const ssePromise = (async () => {
      const res = await fetch(`${BASE}/api/v1/sse/records`, { headers: { Cookie: adminJar.header() }, signal: sseAc.signal });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value, { stream: true });
          if (chunk.includes('record_created')) sseEvents.push(chunk);
          if (sseEvents.length > 0) break; // 收到一条即够
        }
      } catch { /* abort */ }
    })();
    await new Promise((r) => setTimeout(r, 200)); // 等 SSE 连上

    // teacher 登录（打分通常 student/teacher 都可，这里用 student1 自己打分）
    // 2026-10-23：form 字段 class_ids[]/tag_ids[]（复数），分数服务端求和不传；响应是数组（每班级一条）
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append('class_ids', cls1.id);
    form.append('tag_ids', tagNeg.id); // 扣分标签（迟到 -1）→ 必须带图
    form.append('week', '2026-W41');
    form.append('comment', '迟到一人');
    form.append('images', new File([png], 'a.png', { type: 'image/png' }));
    const createRec = await req(stuJar, 'POST', '/api/v1/records', form, true);
    ok('POST /records（multipart + 图片 + 多标签）', { status: createRec.status, n: createRec.json?.data?.length });
    assert(createRec.status === 201, `创建记录应 201，实际 ${createRec.status}`);
    assert(Array.isArray(createRec.json.data) && createRec.json.data.length === 1, '响应应为数组（每班级一条）');
    const rec0 = createRec.json.data[0];
    const recId = rec0.id;
    assert(rec0.score === -1, `分数由标签求和（期望 -1，实际 ${rec0.score}）`);
    assert(Array.isArray(rec0.tags) && rec0.tags.length === 1, 'tags 展开为对象数组');
    const objectKey = rec0.images?.[0];
    assert(objectKey, '应返回 image objectKey');
    assert(rec0.recorderName === '值周生A', 'recorderName join 生效');

    // 扣分标签无图 → 400（扣分必拍照）
    const noPicForm = new FormData();
    noPicForm.append('class_ids', cls1.id);
    noPicForm.append('tag_ids', tagNeg.id);
    noPicForm.append('week', '2026-W41');
    const noPic = await req(stuJar, 'POST', '/api/v1/records', noPicForm, true);
    assert(noPic.status === 400, `扣分无图应 400，实际 ${noPic.status}`);
    ok('扣分标签无图 → 400（扣分必拍照）');

    // SSE 收到 record_created
    await Promise.race([ssePromise, new Promise((r) => setTimeout(r, 1000))]);
    sseAc.abort();
    assert(sseEvents.length > 0, 'SSE 应收到 record_created 事件');
    ok('SSE 实时推送 record_created（修复旧前端未接/死代码）');

    // /files 读取图片（修复死数据 bug）
    const fileRes = await fetch(`${BASE}/files/${objectKey}`, { headers: { Cookie: stuJar.header() } });
    assert(fileRes.status === 200, `图片应可经 /files 读取，实际 ${fileRes.status}`);
    const buf = new Uint8Array(await fileRes.arrayBuffer());
    assert(buf.length === png.length, '图片字节应一致');
    ok('GET /files/<key> 读取图片（修复上传死数据 bug）', { bytes: buf.length });

    // 非图片类型拒绝
    const badForm = new FormData();
    badForm.append('class_ids', cls1.id);
    badForm.append('week', '2026-W41');
    badForm.append('images', new File([new Uint8Array([1, 2, 3])], 'x.exe', { type: 'application/octet-stream' }));
    const badUpload = await req(stuJar, 'POST', '/api/v1/records', badForm, true);
    assert(badUpload.status === 400, `非图片应 400，实际 ${badUpload.status}`);
    ok('非图片类型上传 → 400（校验生效）');

    // ═════ 申诉流程（teacher）═════
    console.log('\n[申诉流程]');
    const tJar = new Jar();
    await req(tJar, 'POST', '/auth/password/login', { username: 'teacher1', password: '123456' });
    const appeal = await req(tJar, 'POST', `/api/v1/records/${recId}/appeal`, { reason: '情况特殊' });
    ok('teacher 申诉', { status: appeal.status });
    assert(appeal.status === 201, `申诉应 201，实际 ${appeal.status}`);
    const recAfterAppeal = await req(adminJar, 'GET', `/api/v1/records/${recId}`);
    assert(recAfterAppeal.json.data.status === 'appealing', '申诉后 record→appealing');
    ok('申诉后 record 状态联动 appealing');
    const approve = await req(adminJar, 'POST', `/api/v1/records/${recId}/appeal/approve`, { review_comment: '属实' });
    assert(approve.status === 200, 'approve 应 200');
    const recApproved = await req(adminJar, 'GET', `/api/v1/records/${recId}`);
    // 2026-10-23：申诉通过=「修改而非撤销」，记录回 active（分数保持，未传 tag_ids 则不调分）
    assert(recApproved.json.data.status === 'active', 'approve 后 record→active（修改而非撤销）');
    ok('admin 批准 → record 回 active（修改而非撤销）');

    // ═════ 统计 ═════
    console.log('\n[统计]');
    const ranking = await req(adminJar, 'GET', '/api/v1/statistics/ranking?week=2026-W41');
    ok('GET /statistics/ranking', { n: ranking.json?.data?.length, top: ranking.json?.data?.[0]?.className });
    assert(Array.isArray(ranking.json.data), 'ranking 返回数组');
    const dash = await req(adminJar, 'GET', '/api/v1/statistics/dashboard');
    ok('GET /statistics/dashboard', dash.json?.data);
    assert(dash.json.data.todayRecords >= 1, '今日记录应 >=1');
    // CSV 导出（⚠ Response.text() 会按 UTF-8-decode 规范剥掉 BOM，故查原始字节 EF BB BF）
    const csvRes = await fetch(`${BASE}/api/v1/statistics/export`, { headers: { Cookie: adminJar.header() } });
    const csvBytes = new Uint8Array(await csvRes.arrayBuffer());
    const hasBom = csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf;
    const csvText = new TextDecoder('utf-8').decode(csvBytes); // 保留 BOM 用于表头断言
    assert(hasBom, 'CSV 应以 UTF-8 BOM 开头（Excel 中文兼容）');
    assert(csvText.includes('班级') && csvRes.headers.get('content-type')?.includes('text/csv'), 'CSV 应含表头 + text/csv');
    ok('GET /statistics/export（BOM + 表头 + text/csv）', { bom: hasBom, bytes: csvBytes.length });

    // ═════ 撤回（admin）+ record_revoked SSE ═════
    console.log('\n[撤回]');
    const revoke = await req(adminJar, 'POST', `/api/v1/records/${recId}/revoke`, { reason: '误录' });
    assert(revoke.status === 200, 'revoke 应 200');
    const recRevoked = await req(adminJar, 'GET', `/api/v1/records/${recId}`);
    assert(recRevoked.json.data.status === 'revoked', '撤回后 status→revoked');
    ok('admin 撤回 → revoked（补 emit record_revoked）');

    // ═════ onError：不存在记录 404 ═════
    console.log('\n[错误处理]');
    const notFound = await req(adminJar, 'GET', '/api/v1/records/nonexistent-uuid');
    assert(notFound.status === 404 && notFound.json.success === false, '不存在记录应 404 结构化错误');
    ok('404 结构化错误（onError 不泄栈）', notFound.json.error);

    console.log(`\n✅✅✅ P5 端到端冒烟全绿：${pass} 项通过（登录/me/RBAC/校区隔离/记录+storage+SSE/申诉/统计/撤回/错误处理）\n`);
  } finally {
    ac.abort();
    booted.shutdown();
    rmSync(DB, { force: true }); rmSync(DB + '-wal', { force: true }); rmSync(DB + '-shm', { force: true });
    rmSync(FILES, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error('\n❌ P5 冒烟失败:', e instanceof Error ? e.stack : e); process.exit(1); });
