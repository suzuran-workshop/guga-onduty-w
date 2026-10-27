/**
 * 通知服务 E2E（2026-10-23，需求 4：教师免登录收钉钉推送）。
 *
 * 注入策略：**真实 3p client + 真实 repos + `fetchImpl` 桩**——只桩网络边界，
 * URL 构造、oapi 的 query 认证、响应体解析、错误约定全部走真代码（不 mock 全局 fetch）。
 * 这样测到的是「本服务与钉钉的真实契约」，而不是「我以为的契约」。
 *
 * 三个必须锁死的坑（notify.ts 注释里的 A/B/C）：
 *  - 坑 A：EventBus listener 抛错绝不能冒泡到打分请求（emit 隔离 + fire-and-forget）
 *  - 坑 B：`asyncsend_v2` 的 errcode:0 只代表「已受理」，发给不存在的 userid 也返 0；
 *          必须查 `getsendresult` 回执才能判送达——否则失败会被静默记成成功
 *  - 坑 C：凭证缺失时降级为 pending 落库（不抛错、不阻塞），凭证到位后可补发
 *
 * 另覆盖业务语义：扣分带申诉链接（link 类型）且链接真能用、加分不带链接、
 * 含扣分标签但净分为 0 仍算扣分（判定看标签不看总分）、周报按教师聚合 + dedupeKey 幂等、
 * 未绑定班主任落 skipped 且不参与补发、撤回记录不推送。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDingtalkPlatform } from '@homurajs/3p/dingtalk';
import type { AppConfig } from '../src/config.js';
import type { PlatformBundle } from '../src/platform/build.js';
import { createNotifyService, type NotifyService } from '../src/services/notify.js';
import { EventBus } from '../src/utils/event-bus.js';
import { boot, seedStandard, type Harness } from './helpers/harness.js';

let h: Harness;
let seed: Awaited<ReturnType<typeof seedStandard>>;

const AGENT_ID = '4108390000'; // 实测合法的 agentId（见 docs/DECISIONS.md ADR-8）
const WEEK = '2026-W43';

beforeAll(async () => {
  h = await boot('notify');
  seed = await seedStandard(h);
});
afterAll(async () => { await h.shutdown(); });

// ── fetchImpl 桩：按 pathname 路由，记录每次调用的完整 URL/方法/请求体 ──────────
interface StubCall {
  path: string;
  method: string;
  /** oapi 端点的认证方式（access_token 必须在 query 里，这是 3p 修复的根因） */
  accessTokenInQuery: boolean;
  body: Record<string, unknown> | null;
}

interface Stub {
  calls: StubCall[];
  fetchImpl: typeof fetch;
  /** asyncsend_v2 的应答（默认 errcode:0 + task_id，与实测一致） */
  send: (body: Record<string, unknown>) => Record<string, unknown>;
  /** getsendresult 的应答；返回 undefined 表示「尚无结果」（触发轮询重试） */
  receipt: (taskId: string) => Record<string, unknown> | undefined;
}

function makeStub(opts?: Partial<Pick<Stub, 'send' | 'receipt'>>): Stub {
  const calls: StubCall[] = [];
  const stub: Stub = {
    calls,
    send: opts?.send ?? (() => ({ errcode: 0, errmsg: 'ok', task_id: 9001 })),
    receipt: opts?.receipt ?? (() => ({
      errcode: 0,
      errmsg: 'ok',
      // 实测：已受理且已投递 → unread_user_id_list 含收件人
      send_result: { unread_user_id_list: [seed.dtTeacher1], read_user_id_list: [] },
    })),
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      const raw = init?.body;
      const body = typeof raw === 'string' && raw.length > 0 ? JSON.parse(raw) : null;
      calls.push({
        path: u.pathname,
        method: init?.method ?? 'GET',
        accessTokenInQuery: u.searchParams.has('access_token'),
        body,
      });

      if (u.pathname === '/gettoken') {
        return json({ errcode: 0, errmsg: 'ok', access_token: 'stub-token', expires_in: 7200 });
      }
      if (u.pathname === '/topapi/message/corpconversation/asyncsend_v2') {
        return json(stub.send(body ?? {}));
      }
      if (u.pathname === '/topapi/message/corpconversation/getsendresult') {
        const taskId = String(body?.task_id ?? '');
        const r = stub.receipt(taskId);
        if (r === undefined) return json({ errcode: 0, errmsg: 'ok', send_result: {} });
        return json(r);
      }
      throw new Error(`未预期的钉钉端点被调用: ${u.pathname}`);
    }) as unknown as typeof fetch,
  };
  return stub;
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** 用桩装配一个「凭证齐备」的 notify 服务（真实 repos + 真实 3p client） */
function notifyWithStub(stub: Stub, cfgOverrides: Record<string, unknown> = {}): NotifyService {
  const platform = createDingtalkPlatform({
    appKey: 'stub-key',
    appSecret: 'stub-secret',
    agentId: AGENT_ID,
    fetchImpl: stub.fetchImpl,
  });
  const bundle: PlatformBundle = { platform, agentId: AGENT_ID, canSend: true };
  // cfg 只被 get() 读取；测试注入 appBaseUrl 以启用申诉链接（真实 .env 未配）
  const cfg = {
    get: (k: string) => ({ appBaseUrl: 'https://duty.example.test', appealTokenTtlHours: 72, ...cfgOverrides })[k],
  } as unknown as AppConfig;
  return createNotifyService({
    cfg,
    repos: h.booted.repos,
    platform: bundle,
    logger: silentLogger(),
  });
}

function silentLogger() {
  const lines: Array<{ level: string; msg: string }> = [];
  const mk = (level: string) => (msg: string) => { lines.push({ level, msg }); };
  return Object.assign({ info: mk('info'), warn: mk('warn'), error: mk('error') }, { lines });
}

// ── 造数据 ─────────────────────────────────────────────────────────
/**
 * 直接经 repo 建记录（**不走 HTTP**）。
 *
 * 为什么不用 HTTP：`bootstrap()` 内部已 `notify.subscribe()`，而 EventBus 是进程内单例，
 * 经路由创建记录会额外触发一次「降级 pending」推送，污染本文件对 notificationLogs 的断言。
 * `EventBus.emit` 只在路由层发生（repo 不发事件），故走 repo 即可拿到干净隔离——
 * 需要验证「自动推送」的那条用例单独走 HTTP。
 */
async function scoreClass(classId: string, tagIds: string[], opts?: { images?: string[]; week?: string }): Promise<string> {
  const rec = await h.booted.repos.records.create({
    campusId: seed.c1.id,
    classId,
    recorderId: seed.student.id,
    tagIds,
    comment: null,
    images: opts?.images ?? ['records/stub.png'],
    week: opts?.week ?? WEEK,
    recordedAt: Date.now(),
  });
  return rec.id;
}

/** 学生经 HTTP 打分（触发 EventBus → 自动推送，专用于订阅测试） */
async function scoreViaHttp(classId: string, tagIds: string[]): Promise<string> {
  const stu = await h.loginAs('student1');
  const f = new FormData();
  f.append('class_ids', classId);
  f.set('week', WEEK);
  for (const t of tagIds) f.append('tag_ids', t);
  f.append('images', new File([new Uint8Array([0x89, 0x50])], 'a.png', { type: 'image/png' }));
  const r = await stu.req('POST', '/api/v1/records', { body: f, isForm: true });
  expect(r.status).toBe(201);
  return (r.json.data as Array<{ id: string }>)[0]!.id;
}

/** 建一个指定分值/类别的标签（c1 校区） */
async function makeTag(name: string, score: number, category: 'positive' | 'negative' | 'neutral'): Promise<string> {
  const t = await h.booted.repos.tags.create({
    campusId: seed.c1.id, name, score, category, isSystem: false,
  });
  return t.id;
}

async function notificationsOf(recordId: string) {
  const paged = await h.booted.repos.notifications.list({
    campusId: seed.c1.id, recordId, page: 1, pageSize: 50,
  });
  return paged.data;
}

describe('坑 B：errcode:0 ≠ 送达（必须查回执）', () => {
  it('asyncsend 受理成功但回执报 invalid userid → 记为 failed 而非 sent', async () => {
    const recordId = await scoreClass(seed.cls1.id, [seed.tagNeg.id]);
    // 实测复现：发给不存在的 userid，asyncsend_v2 仍返 errcode:0 + task_id
    const stub = makeStub({
      receipt: () => ({
        errcode: 0, errmsg: 'ok',
        send_result: { invalid_user_id_list: ['0252163856461532927016'], read_user_id_list: [], unread_user_id_list: [] },
      }),
    });
    const notify = notifyWithStub(stub);
    const r = await notify.notifyRecord(recordId);

    expect(r.delivered).toBe(false);
    expect(r.skippedReason).toContain('userid 无效');
    const [log] = await notificationsOf(recordId);
    expect(log?.status).toBe('failed'); // ←  naive 实现会写 'sent'
    expect(log?.providerTaskId).toBe('9001');
    expect(log?.error).toContain('invalid');
  });

  it('回执含 unread（已投递未读）→ 记为 sent 并落 sentAt', async () => {
    const recordId = await scoreClass(seed.cls1.id, [seed.tagNeg.id]);
    const notify = notifyWithStub(makeStub());
    const r = await notify.notifyRecord(recordId);
    expect(r.delivered).toBe(true);

    const [log] = await notificationsOf(recordId);
    expect(log?.status).toBe('sent');
    expect(log?.sentAt).toBeGreaterThan(0);
    expect(log?.error).toBeNull();
    expect(log?.recipientPlatformId).toBe(seed.dtTeacher1);
    expect(log?.kind).toBe('record_deduction');
  });

  it('回执始终无定论（6 次轮询）→ 保守记 failed，绝不假装成功', async () => {
    const recordId = await scoreClass(seed.cls1.id, [seed.tagNeg.id]);
    const stub = makeStub({ receipt: () => undefined }); // send_result 恒为空
    const notify = notifyWithStub(stub);
    const r = await notify.notifyRecord(recordId);

    expect(r.delivered).toBe(false);
    const [log] = await notificationsOf(recordId);
    expect(log?.status).toBe('failed');
    expect(log?.error).toContain('回执未确认送达');
    // 确实轮询了多次（attempts=6）而非一次就放弃
    const receiptCalls = stub.calls.filter((c) => c.path.endsWith('getsendresult'));
    expect(receiptCalls.length).toBe(6);
  }, 15_000);

  it('发送端点抛错 → 记 failed 且 notifyRecord 不抛（推送故障不影响主链路）', async () => {
    const recordId = await scoreClass(seed.cls1.id, [seed.tagNeg.id]);
    const stub = makeStub({ send: () => { throw new Error('钉钉网关 502'); } });
    const notify = notifyWithStub(stub);
    const r = await notify.notifyRecord(recordId); // 不 reject
    expect(r.delivered).toBe(false);
    const [log] = await notificationsOf(recordId);
    expect(log?.status).toBe('failed');
    expect(log?.error).toContain('502');
  });

  it('认证走 query 参数（oapi 端点），且 agent_id/userid_list/msg 形状正确', async () => {
    const recordId = await scoreClass(seed.cls1.id, [seed.tagNeg.id]);
    const stub = makeStub();
    await notifyWithStub(stub).notifyRecord(recordId);

    const send = stub.calls.find((c) => c.path.endsWith('asyncsend_v2'));
    expect(send).toBeTruthy();
    expect(send!.accessTokenInQuery).toBe(true); // 放 header 会 errcode:88 access_token is blank
    expect(send!.body?.agent_id).toBe(Number(AGENT_ID));
    expect(send!.body?.userid_list).toBe(seed.dtTeacher1);
    const msg = send!.body?.msg as { msgtype: string; link?: { messageUrl?: string } };
    expect(msg.msgtype).toBe('link'); // 扣分 → link 类型（带申诉入口）
    expect(msg.link?.messageUrl).toMatch(/^https:\/\/duty\.example\.test\/appeal\//);
  });
});

describe('坑 A：推送故障与打分请求隔离', () => {
  it('listener 抛错时 EventBus.emit 不冒泡，其他 listener 照常执行', () => {
    const seen: string[] = [];
    const boom = () => { throw new Error('listener 炸了'); };
    const good = () => { seen.push('good'); };
    EventBus.on('record_created', boom);
    EventBus.on('record_created', good);
    try {
      // emit 是同步的：若隔离失效，这里会直接抛出
      expect(() => EventBus.emit('record_created', {
        recordId: 'x', className: '1班', tagNames: [], points: 0, timestamp: 0, campusId: seed.c1.id,
      })).not.toThrow();
      expect(seen).toEqual(['good']);
    } finally {
      EventBus.off('record_created', boom);
      EventBus.off('record_created', good);
    }
  });

  it('subscribe 后创建记录会自动推送；unsubscribe 后不再推送', async () => {
    const stub = makeStub();
    const notify = notifyWithStub(stub);
    const unsub = notify.subscribe();
    try {
      const recordId = await scoreViaHttp(seed.cls1.id, [seed.tagNeg.id]);
      await waitFor(() => stub.calls.some((c) => c.path.endsWith('asyncsend_v2')));
      // 同一条记录会有两行：本桩服务发出的 sent，以及 bootstrap 自带服务（无凭证）留下的 pending——
      // EventBus 是进程内单例，两个订阅者都会收到事件。故断言「存在 sent 行」而非首行状态。
      const rows = await notificationsOf(recordId);
      expect(rows.some((n) => n.status === 'sent' && n.providerTaskId === '9001')).toBe(true);
    } finally {
      unsub();
    }

    // 退订后：新记录不再触发推送（shutdown 路径的正确性——避免热重载/测试间串扰）
    const before = stub.calls.filter((c) => c.path.endsWith('asyncsend_v2')).length;
    await scoreViaHttp(seed.cls1.id, [seed.tagNeg.id]);
    await new Promise((r) => setTimeout(r, 150));
    expect(stub.calls.filter((c) => c.path.endsWith('asyncsend_v2')).length).toBe(before);
  });
});

describe('坑 C：凭证缺失降级 + 到位后补发', () => {
  it('未配凭证时落 pending（不抛错、不阻塞），凭证到位后 flush 补发成功', async () => {
    const recordId = await scoreClass(seed.cls1.id, [seed.tagNeg.id]);

    // h.booted.notify 用的是真实 bootstrap 装配：测试环境无钉钉凭证 → 降级
    expect(h.booted.platform.canSend).toBe(false);
    const r = await h.booted.notify.notifyRecord(recordId);
    expect(r.delivered).toBe(false);
    expect(r.skippedReason).toBeTruthy();

    const [pending] = await notificationsOf(recordId);
    expect(pending?.status).toBe('pending');
    expect(pending?.error).toContain('DINGTALK_APP_KEY');
    expect(pending?.providerTaskId).toBeNull(); // 从未真正发出

    // 凭证到位：用桩装配的服务补发
    const stub = makeStub();
    const flush = await notifyWithStub(stub).flushPending(seed.c1.id);
    expect(flush.sent).toBeGreaterThanOrEqual(1);

    const rows = await notificationsOf(recordId);
    // 原 pending 行仍在（审计留痕），补发产生新的 sent 行
    expect(rows.some((n) => n.status === 'pending')).toBe(true);
    expect(rows.some((n) => n.status === 'sent')).toBe(true);
  });

  it('未绑定班主任的班级 → 落 skipped（管理员可见「哪些班没绑」），且不参与补发', async () => {
    // cls2 在 seedStandard 里刻意不绑班主任
    const recordId = await scoreClass(seed.cls2.id, [seed.tagNeg.id]);
    const stub = makeStub();
    const notify = notifyWithStub(stub);
    const r = await notify.notifyRecord(recordId);

    expect(r.delivered).toBe(false);
    expect(r.skippedReason).toBe('班级未绑定班主任');
    const [log] = await notificationsOf(recordId);
    expect(log?.status).toBe('skipped');
    expect(log?.recipientPlatformId).toBe('');
    expect(log?.error).toContain('未绑定班主任');
    // 没有真的调用钉钉（无收件人）
    expect(stub.calls.filter((c) => c.path.endsWith('asyncsend_v2'))).toHaveLength(0);

    // skipped 不在 listPending 里，故 flush 不会尝试补发它
    const flushed = await notify.flushPending(seed.c1.id);
    expect(flushed.failed).toBe(0);
    expect((await notificationsOf(recordId))[0]?.status).toBe('skipped');
  });
});

describe('推送内容语义', () => {
  it('加分记录 → markdown 类型且不带申诉链接（加分无需申诉）', async () => {
    const recordId = await scoreClass(seed.cls1.id, [seed.tagPos.id]);
    const stub = makeStub();
    const r = await notifyWithStub(stub).notifyRecord(recordId);
    expect(r.delivered).toBe(true);

    const send = stub.calls.find((c) => c.path.endsWith('asyncsend_v2'))!;
    const msg = send.body?.msg as { msgtype: string; markdown?: { title: string; text: string }; link?: unknown };
    expect(msg.msgtype).toBe('markdown');
    expect(msg.link).toBeUndefined();
    expect(msg.markdown?.title).toContain('值周加分');
    expect(msg.markdown?.text).not.toContain('申诉');
    expect((await notificationsOf(recordId))[0]?.kind).toBe('record_positive');
  });

  it('含扣分标签但净分为 0 → 仍按扣分推送并带申诉链接（判定看标签不看总分）', async () => {
    const plusOne = await makeTag('主动帮助同学', 1, 'positive');
    // 迟到(-1) + 主动帮助(+1) = 0 分，但含扣分标签 → 产品规则：算扣分（须拍照、可申诉）
    const recordId = await scoreClass(seed.cls1.id, [seed.tagNeg.id, plusOne]);
    const rec = await h.booted.repos.records.findByIdWithDetails(recordId);
    expect(rec?.score).toBe(0);

    const stub = makeStub();
    await notifyWithStub(stub).notifyRecord(recordId);
    const send = stub.calls.find((c) => c.path.endsWith('asyncsend_v2'))!;
    const msg = send.body?.msg as { msgtype: string; link?: { messageUrl?: string } };
    expect(msg.msgtype).toBe('link');
    expect(msg.link?.messageUrl).toBeTruthy();
    expect((await notificationsOf(recordId))[0]?.kind).toBe('record_deduction');
  });

  it('撤回的记录不推送（不给教师发已作废的通知）', async () => {
    const recordId = await scoreClass(seed.cls1.id, [seed.tagNeg.id]);
    const admin = await h.loginAs('admin');
    expect((await admin.req('POST', `/api/v1/records/${recordId}/revoke`, { body: { reason: '录入有误' } })).status).toBe(200);

    const stub = makeStub();
    const r = await notifyWithStub(stub).notifyRecord(recordId);
    expect(r.delivered).toBe(false);
    expect(r.skippedReason).toContain('revoked');
    expect(stub.calls.filter((c) => c.path.endsWith('asyncsend_v2'))).toHaveLength(0);
    expect(await notificationsOf(recordId)).toHaveLength(0); // 连日志都不落（不是发送失败，是不该发）
  });

  it('扣分推送里的申诉链接可直接免登录提交（推送↔申诉闭环）', async () => {
    const recordId = await scoreClass(seed.cls1.id, [seed.tagNeg.id]);
    const stub = makeStub();
    await notifyWithStub(stub).notifyRecord(recordId);

    const send = stub.calls.find((c) => c.path.endsWith('asyncsend_v2'))!;
    const msg = send.body?.msg as { link: { messageUrl: string } };
    const url = new URL(msg.link.messageUrl);
    const token = url.pathname.split('/').pop()!;
    expect(token.length).toBeGreaterThan(20);

    // 教师点链接：匿名打开表单 → 提交申诉，全程无会话
    const anon = h.client();
    const peek = await anon.req('GET', `/api/public/appeal/${token}`);
    expect(peek.json.data.tokenState).toBe('ok');
    expect(peek.json.data.record.className).toBe('1班');
    const sub = await anon.req('POST', `/api/public/appeal/${token}`, { body: { reason: '校车晚点导致迟到' } });
    expect(sub.status).toBe(201);
    expect((await h.booted.repos.records.findByIdWithDetails(recordId))?.status).toBe('appealing');
  });

  it('未配 APP_BASE_URL 时仍推送，只是消息里说明无申诉链接（降级不静默）', async () => {
    const recordId = await scoreClass(seed.cls1.id, [seed.tagNeg.id]);
    const stub = makeStub();
    const notify = notifyWithStub(stub, { appBaseUrl: '' });
    const r = await notify.notifyRecord(recordId);
    expect(r.delivered).toBe(true); // 推送照发

    const send = stub.calls.find((c) => c.path.endsWith('asyncsend_v2'))!;
    const msg = send.body?.msg as { msgtype: string; markdown?: { text: string } };
    expect(msg.msgtype).toBe('markdown'); // 无链接 → 退化为 markdown
    expect(msg.markdown?.text).toContain('未配置 APP_BASE_URL');
  });
});

describe('周报：按教师聚合 + dedupeKey 幂等', () => {
  it('一位班主任带多个班 → 只收一条周报，含各班明细与合计', async () => {
    // 让 teacher1 同时是 cls2 的班主任（一人两班）
    await h.booted.repos.classes.update(seed.cls2.id, {
      name: '2班', classTeacher: '李老师', teacherDingtalkId: seed.dtTeacher1,
    });
    try {
      const wk = '2026-W50'; // 独立周次：避免与同文件其他周报用例的 dedupeKey 相撞
      await scoreClass(seed.cls1.id, [seed.tagPos.id], { week: wk }); // +2
      await scoreClass(seed.cls2.id, [seed.tagNeg.id], { week: wk }); // -1

      const stub = makeStub();
      const notify = notifyWithStub(stub);
      const r = await notify.sendWeeklyReport(seed.c1.id, wk);
      expect(r.sent).toBe(1); // 一位教师一条，不是两条

      const sends = stub.calls.filter((c) => c.path.endsWith('asyncsend_v2'));
      expect(sends).toHaveLength(1);
      const msg = sends[0]!.body?.msg as { msgtype: string; markdown: { title: string; text: string } };
      expect(msg.msgtype).toBe('markdown'); // 周报无需申诉入口
      expect(msg.markdown.title).toContain('值周周报');
      expect(msg.markdown.text).toContain('1班');
      expect(msg.markdown.text).toContain('2班');
      expect(msg.markdown.text).toContain('合计');

      const paged = await h.booted.repos.notifications.list({
        campusId: seed.c1.id, kind: 'weekly_report', page: 1, pageSize: 50,
      });
      expect(paged.data).toHaveLength(1);
      expect(paged.data[0]!.recipientPlatformId).toBe(seed.dtTeacher1);
      expect(paged.data[0]!.dedupeKey).toBe(`weekly:${seed.c1.id}:${seed.dtTeacher1}:${wk}`);
    } finally {
      await h.booted.repos.classes.update(seed.cls2.id, { name: '2班', classTeacher: null, teacherDingtalkId: null });
    }
  });

  it('重复发送同一周 → 第二次全部 skipped（管理员补发可安全重复点击）', async () => {
    const wk = '2026-W51'; // 独立周次：dedupeKey 含 week，与其他周报用例互不干扰
    await scoreClass(seed.cls1.id, [seed.tagPos.id], { week: wk });
    const stub = makeStub();
    const notify = notifyWithStub(stub);

    const first = await notify.sendWeeklyReport(seed.c1.id, wk);
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const sendsAfterFirst = stub.calls.filter((c) => c.path.endsWith('asyncsend_v2')).length;

    const second = await notify.sendWeeklyReport(seed.c1.id, wk);
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(first.sent);
    // 钉钉侧零新增调用（幂等在落库层就拦住了，不是发了再丢弃）
    expect(stub.calls.filter((c) => c.path.endsWith('asyncsend_v2')).length).toBe(sendsAfterFirst);

    // 只数本周次的周报行（kind 过滤会混入其他用例发的周报）
    const paged = await h.booted.repos.notifications.list({
      campusId: seed.c1.id, kind: 'weekly_report', page: 1, pageSize: 50,
    });
    const thisWeek = paged.data.filter((n) => n.week === wk);
    expect(thisWeek).toHaveLength(first.sent); // 行数没变：第二次一条都没新增
  });

  it('不同周次各自独立推送（dedupeKey 含 week）', async () => {
    const stub = makeStub();
    const notify = notifyWithStub(stub);
    await notify.sendWeeklyReport(seed.c1.id, '2026-W44');
    const n1 = stub.calls.filter((c) => c.path.endsWith('asyncsend_v2')).length;
    await notify.sendWeeklyReport(seed.c1.id, '2026-W45');
    const n2 = stub.calls.filter((c) => c.path.endsWith('asyncsend_v2')).length;
    expect(n2).toBeGreaterThan(n1);
  });
});

describe('管理面路由（/api/v1/dingtalk，admin only）', () => {
  it('GET /status 报告未启用与降级原因；student/teacher 访问被拒', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('GET', '/api/v1/dingtalk/status');
    expect(r.status).toBe(200);
    expect(r.json.data.enabled).toBe(false);
    expect(r.json.data.reason).toContain('DINGTALK_APP_KEY');
    expect(r.json.data.capabilities).toEqual([]); // platform=null

    expect((await (await h.loginAs('teacher1')).req('GET', '/api/v1/dingtalk/status')).status).toBe(403);
    expect((await (await h.loginAs('student1')).req('GET', '/api/v1/dingtalk/status')).status).toBe(403);
  });

  it('GET /notifications 返回推送审计（分页 + 可按 kind 过滤）', async () => {
    const admin = await h.loginAs('admin');
    const all = await admin.req('GET', '/api/v1/dingtalk/notifications');
    expect(all.status).toBe(200);
    expect(all.json.pagination.total).toBeGreaterThan(0);

    const weekly = await admin.req('GET', '/api/v1/dingtalk/notifications', { query: { kind: 'weekly_report' } });
    expect(weekly.status).toBe(200);
    expect(weekly.json.data.every((n: { kind: string }) => n.kind === 'weekly_report')).toBe(true);

    // 校区隔离：teacher2 属 c2，读 c1 的通知必须 403
    const t2 = await h.loginAs('teacher2');
    expect((await t2.req('GET', '/api/v1/dingtalk/notifications')).status).toBe(403);
  });

  it('POST /sync 未配凭证 → 400 且给出可操作的错误码（不是 500）', async () => {
    const admin = await h.loginAs('admin');
    const r = await admin.req('POST', '/api/v1/dingtalk/sync');
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('DINGTALK_NOT_CONFIGURED');
  });
});

/** 轮询等待条件成立（推送是异步 fire-and-forget，需要等 listener 跑完） */
async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时');
    await new Promise((r) => setTimeout(r, 20));
  }
}
