/**
 * 免登录申诉路由（2026-10-23，需求 4）—— 教师从钉钉推送点链接直接申诉，不进系统、不用账密。
 *
 * ⚠ 挂载位置刻意**不在 /api/v1/***：routes/index.ts 的 requireProfile 与 requireStudentScope
 *   只守 /api/v1/*，本模块挂 /api/public/appeal 即绕过登录闸门——这正是目的（教师可能根本没有
 *   系统账号，「不需要进系统」是需求 4 的前提）。前缀 /api 保证 Vite dev proxy 转发与生产同源。
 *
 * 身份模型：链接即凭证。明文 token 只出现在推送链接里，服务端只存 SHA-256；
 * 令牌绑定 recordId + 教师钉钉 userid + 过期时间，**一次性原子消费**（并发点两次只成功一次）。
 *
 * 端点：
 *  - GET  /:token  打开申诉表单时校验令牌并回显记录详情（**不消费**，刷新页面安全）。
 *                  用 200 + tokenState 而非 404/410：SPA 按 state 渲染精确提示，
 *                  避免对「过期/已消费」这类正常业务态走异常分支。
 *  - POST /:token  提交申诉。**校验在前、消费在后**：record 不存在/不可申诉/班级换绑/
 *                  理由为空等失败不烧令牌，教师刷新可重试；通过后才建申诉、再原子消费令牌。
 *                  消费的原子性保证并发提交只产生一条申诉。
 *
 * 安全边界（显式接受的取舍）：
 *  - 令牌 256-bit 随机，爆破不可行；哈希落库，拖库也无法构造可用链接。
 *  - 转发链接 = 转发申诉权：接受。钉钉工作通知只进班主任本人会话，链接泄露属客户端风险，
 *    由「一次性 + TTL + 班级绑定校验」把损害限制为单条记录的一次申诉。
 *  - 本模块不做频率限制：写路径全部需要有效令牌，而有效令牌不可批量获得。
 */
import { Hono } from 'hono';
import type { AppealTokenPeek, AppealTokenState, AppealTokenSubmitResult, PublicAppealRecord, RecordWithDetails } from '@guga-onduty-w/shared';
import type { RouteDeps } from './_deps.js';
import { ok, created, ApiError } from '../http/respond.js';
import { sha256Hex } from '../utils/token.js';

/** 申诉理由长度上限（防止把申诉表单当留言板灌库；正常申诉理由远短于此） */
const MAX_REASON_LENGTH = 2000;

/** 表单打开时回显的记录信息（不含 recorderId / objectKey 等内部字段——公开端点最小披露） */
function appealView(r: RecordWithDetails): PublicAppealRecord {
  return {
    id: r.id,
    className: r.className,
    week: r.week,
    score: r.score,
    comment: r.comment,
    tags: r.tags.map((t) => ({ name: t.name, score: t.score, color: t.color, category: t.category })),
    // 只给数量：取图走 /:token/image/:index（按序号寻址，见 PublicAppealRecord.imageCount 注释）
    imageCount: (r.images ?? []).length,
    recordedAt: r.recordedAt,
    status: r.status,
  };
}

/** 令牌校验的两种结局：可用（带记录 + 令牌绑定的教师钉钉身份）/ 不可用（带原因；部分原因仍附记录供展示） */
type TokenCheck =
  | { ok: true; state: 'ok'; record: RecordWithDetails; teacherDingtalkId: string }
  | { ok: false; state: AppealTokenState; record?: RecordWithDetails };

/**
 * 令牌态 → HTTP 错误（POST 提交路径用）。
 * GET 表单路径一律 200 + tokenState（业务态不是异常），但提交是写操作，
 * 必须用状态码区分「链接不可用」(404) / 「记录状态不允许」(409) / 「归属不符」(403)，
 * 便于前端与排障区分。这些码是既有契约（tests/appeal-token.test.ts 已断言）。
 */
function stateToError(state: AppealTokenState): ApiError {
  switch (state) {
    case 'not_found':
    case 'expired':
    case 'consumed':
      return ApiError.notFound(`申诉链接不可用（${state}）`, `APPEAL_TOKEN_${state.toUpperCase()}`);
    case 'record_gone':
      return ApiError.notFound('原记录已不存在，无法申诉');
    case 'not_appealable':
      return ApiError.conflict('该记录当前状态不可申诉（可能已撤回或申诉处理中）', 'RECORD_NOT_APPEALABLE');
    case 'unbound':
      return ApiError.conflict('该班级未绑定班主任，无法申诉', 'CLASS_UNBOUND');
    case 'rebound':
      return ApiError.forbidden('该班级已更换班主任，此链接已失效');
    default:
      // 'ok' 不会走到这里；兜底防止新增 AppealTokenState 成员时静默放行
      return ApiError.conflict('申诉链接不可用', 'APPEAL_TOKEN_INVALID');
  }
}

export function createAppealTokenRoutes(deps: RouteDeps): Hono {
  const { repos, storage } = deps;
  const app = new Hono();

  /**
   * 令牌 + 记录 + 班级绑定的**唯一判定链**（表单 GET 与取图端点共用）。
   *
   * 共用不是为省事，而是为了让「能看到表单 ⟺ 能看到照片」由构造保证：
   * 照片是「扣分必拍照」的证据，教师争辩扣分正是靠它；若两处校验各写一份，
   * 迟早漂移成「表单能开、照片 401」或反之。
   *
   * 注意 not_appealable / unbound / rebound 仍**附带 record**：教师至少能看到被申诉的是哪条、
   * 证据照片是什么，不必回钉钉翻消息——申诉不成立不等于信息不该给。
   */
  async function check(token: string): Promise<TokenCheck> {
    const state = await repos.appealTokens.peek(sha256Hex(token));
    // 令牌不可用：state.reason ∈ not_found/expired/consumed（repo 层保证）
    if (!state.ok) return { ok: false, state: state.reason };

    const record = await repos.records.findByIdWithDetails(state.recordId);
    if (!record) return { ok: false, state: 'record_gone' };
    if (record.status !== 'active') {
      // 记录已被撤回 / 申诉处理中 / 已调整——令牌仍有效但申诉语义不成立，如实告知
      return { ok: false, state: 'not_appealable', record };
    }
    // 班级换绑校验：推送后管理员把班交给了别的班主任，旧令牌应失效（不能替新班主任申诉）
    const ownership = await repos.classes.findOwnership(record.classId);
    if (!ownership?.teacherDingtalkId) return { ok: false, state: 'unbound', record };
    if (ownership.teacherDingtalkId !== state.teacherDingtalkId) return { ok: false, state: 'rebound', record };

    // teacherDingtalkId 来自**令牌**（不是班级当前绑定）——二者此刻必然相等（上一行刚校验过），
    // 用令牌那份是因为「谁申诉的」权威来源是令牌本身。
    return { ok: true, state: 'ok', record, teacherDingtalkId: state.teacherDingtalkId };
  }

  // GET /:token —— 表单数据（peek，不消费）
  app.get('/:token', async (c) => {
    const r = await check(c.req.param('token'));
    // 全部业务态都走 200 + tokenState（而非 404/410）：「过期」「已使用」是正常结局不是异常，
    // SPA 据此渲染精确提示，避免笼统的「链接失效」让人无法自助排障。
    if (!r.ok) return ok<AppealTokenPeek>(c, { tokenState: r.state, record: r.record ? appealView(r.record) : undefined });
    return ok<AppealTokenPeek>(c, { tokenState: 'ok', record: appealView(r.record) });
  });

  /**
   * GET /:token/image/:index —— 令牌作用域取图（公开，无会话）。
   *
   * 为什么必须有它：`/files/*` 自带 requireProfile + 校区校验，而教师走免登录路径**没有任何会话**，
   * 直接用 fileUrl(key) 会全 401（一片裂图）。
   *
   * 为什么按 index 而不是 key：key 里含 campusId/uuid 前缀，若接受 key 就等于让持有任一令牌的人
   * 有机会探测他班照片；按 index 只能取到**本令牌所属那条记录**的图，越权面为零。
   *
   * 令牌已消费/过期也**拒绝**取图：申诉已提交或已失效后，链接不应继续可用来翻阅证据。
   */
  app.get('/:token/image/:index', async (c) => {
    const r = await check(c.req.param('token'));
    // 只有完全可用（ok）才给图：not_appealable/unbound/rebound 等态下表单会展示 record 摘要，
    // 但照片属证据材料，链接失效即不再提供。
    // 错误码复用 stateToError —— 「共用同一条判定链」必须连错误码一起共用，
    // 否则同一个 not_appealable 在表单路径报 RECORD_NOT_APPEALABLE、在取图路径报
    // APPEAL_TOKEN_NOT_APPEALABLE，前端无法用一套映射处理。
    if (!r.ok) throw stateToError(r.state);

    const index = Number(c.req.param('index'));
    const images = r.record.images ?? [];
    if (!Number.isInteger(index) || index < 0 || index >= images.length) {
      throw ApiError.notFound('图片不存在');
    }
    const objectKey = images[index]!;
    const file = await storage.downloadStream(objectKey);
    // 流式返回（不整块进内存）；no-store 防缓存把证据图留在共享设备上
    return new Response(file.stream as ReadableStream, {
      headers: {
        'Content-Type': file.contentType,
        'Content-Length': String(file.size),
        'Cache-Control': 'no-store',
      },
    });
  });

  // POST /:token —— 提交申诉（消费令牌）
  app.post('/:token', async (c) => {
    const body = await c.req.json<{ reason?: string }>().catch(() => ({ reason: '' }));
    const reason = (body.reason ?? '').trim();
    if (!reason) throw ApiError.badRequest('申诉理由不能为空');
    if (reason.length > MAX_REASON_LENGTH) {
      throw ApiError.badRequest(`申诉理由不能超过 ${MAX_REASON_LENGTH} 字`);
    }

    const token = c.req.param('token');
    // 与 GET 表单、取图端点**共用同一条判定链**：三处对「这个链接能不能用」的答案必然一致。
    // 校验全部发生在消费令牌之前 —— 失败不烧令牌，教师改改理由还能重试。
    const r = await check(token);
    if (!r.ok) throw stateToError(r.state);

    // 通过校验：先建申诉（记录转 appealing），再原子消费令牌。顺序不可换——
    // 校验失败/状态竞态不烧令牌（教师刷新可重试），消费的原子性 + create 的严格语义共同保证
    // 双击提交只产生一条申诉：两个并发请求只有一个能抢到 active→appealing 转换，
    // 另一个从 create 拿 null（在消费之前就退出）；而「create 成功却消费失败」需要令牌恰在
    // 边界过期，且记录已非 active，二次提交会被 check() 拦下，不会产生重复申诉。
    const appeal = await repos.appeals.create({
      recordId: r.record.id,
      campusId: r.record.campusId,
      // 免登录：教师可能没有系统账号，teacherId 留空；teacherDingtalkId 是权威身份
      teacherDingtalkId: r.teacherDingtalkId,
      reason,
    });
    if (!appeal) {
      // 校验与落库之间记录状态被并发改变（撤回/他处申诉抢先）——令牌未消费，可刷新重试
      throw ApiError.conflict('该记录当前状态不可申诉（可能已撤回或申诉处理中）', 'RECORD_NOT_APPEALABLE');
    }
    const consumed = await repos.appealTokens.consume(sha256Hex(token));
    if (!consumed.ok) {
      // 理论不可达（create 成功者是唯一会走到消费的请求）；保守如实报错，申诉已落库不受影响
      throw ApiError.conflict('申诉链接已被使用', 'APPEAL_TOKEN_CONSUMED');
    }

    return created<AppealTokenSubmitResult>(c, { appealed: true, appealId: appeal.id });
  });

  return app;
}
