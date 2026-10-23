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
import type { RecordWithDetails } from '@guga-onduty-w/shared';
import type { RouteDeps } from './_deps.js';
import { ok, created, ApiError } from '../http/respond.js';
import { sha256Hex } from '../utils/token.js';

/** 申诉理由长度上限（防止把申诉表单当留言板灌库；正常申诉理由远短于此） */
const MAX_REASON_LENGTH = 2000;

/** 表单打开时回显的记录信息（不含 recorderId 等内部字段——公开端点最小披露） */
function appealView(r: RecordWithDetails) {
  return {
    id: r.id,
    className: r.className,
    week: r.week,
    score: r.score,
    comment: r.comment,
    tags: r.tags.map((t) => ({ name: t.name, score: t.score, color: t.color, category: t.category })),
    /** storage objectKey 列表；前端自行拼 /files/<key> 代理地址 */
    images: r.images ?? [],
    recordedAt: r.recordedAt,
    status: r.status,
  };
}

export function createAppealTokenRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  // GET /:token —— 表单数据（peek，不消费）
  app.get('/:token', async (c) => {
    const tokenHash = sha256Hex(c.req.param('token'));
    const state = await repos.appealTokens.peek(tokenHash);
    if (!state.ok) return ok(c, { tokenState: state.reason });

    const record = await repos.records.findByIdWithDetails(state.recordId);
    if (!record) return ok(c, { tokenState: 'record_gone' });
    if (record.status !== 'active') {
      // 记录已被撤回 / 申诉处理中 / 已调整——令牌仍有效但申诉语义不成立，如实告知
      return ok(c, { tokenState: 'not_appealable', record: appealView(record) });
    }
    // 班级换绑校验：推送后管理员把班交给了别的班主任，旧令牌应失效（不能替新班主任申诉）
    const ownership = await repos.classes.findOwnership(record.classId);
    if (!ownership?.teacherDingtalkId) return ok(c, { tokenState: 'unbound' });
    if (ownership.teacherDingtalkId !== state.teacherDingtalkId) return ok(c, { tokenState: 'rebound' });

    return ok(c, { tokenState: 'ok', record: appealView(record) });
  });

  // POST /:token —— 提交申诉（消费令牌）
  app.post('/:token', async (c) => {
    const body = await c.req.json<{ reason?: string }>().catch(() => ({ reason: '' }));
    const reason = (body.reason ?? '').trim();
    if (!reason) throw ApiError.badRequest('申诉理由不能为空');
    if (reason.length > MAX_REASON_LENGTH) {
      throw ApiError.badRequest(`申诉理由不能超过 ${MAX_REASON_LENGTH} 字`);
    }

    const tokenHash = sha256Hex(c.req.param('token'));
    const state = await repos.appealTokens.peek(tokenHash);
    if (!state.ok) {
      // 与 GET 的 state 同口径，前端可给准确提示；404 表「此链接无法申诉」
      throw ApiError.notFound(`申诉链接不可用（${state.reason}）`, `APPEAL_TOKEN_${state.reason.toUpperCase()}`);
    }

    // 提交前的业务校验（全部不消费令牌）
    const record = await repos.records.findByIdWithDetails(state.recordId);
    if (!record) throw ApiError.notFound('原记录已不存在，无法申诉');
    if (record.status !== 'active') {
      throw ApiError.conflict('该记录当前状态不可申诉（可能已撤回或申诉处理中）', 'RECORD_NOT_APPEALABLE');
    }
    const ownership = await repos.classes.findOwnership(record.classId);
    if (!ownership?.teacherDingtalkId) throw ApiError.conflict('该班级未绑定班主任，无法申诉', 'CLASS_UNBOUND');
    if (ownership.teacherDingtalkId !== state.teacherDingtalkId) {
      throw ApiError.forbidden('该班级已更换班主任，此链接已失效');
    }

    // 通过校验：先建申诉（记录转 appealing），再原子消费令牌。顺序不可换——
    // 校验失败/状态竞态不烧令牌（教师刷新可重试），消费的原子性 + create 的严格语义共同保证
    // 双击提交只产生一条申诉：两个并发请求只有一个能抢到 active→appealing 转换，
    // 另一个从 create 拿 null（在消费之前就退出）；而「create 成功却消费失败」需要令牌恰在
    // 边界过期，且记录已非 active，二次提交会被上方状态校验拦下，不会产生重复申诉。
    const appeal = await repos.appeals.create({
      recordId: state.recordId,
      campusId: record.campusId,
      // 免登录：教师可能没有系统账号，teacherId 留空；teacherDingtalkId 是权威身份
      teacherDingtalkId: state.teacherDingtalkId,
      reason,
    });
    if (!appeal) {
      // 校验与落库之间记录状态被并发改变（撤回/他处申诉抢先）——令牌未消费，可刷新重试
      throw ApiError.conflict('该记录当前状态不可申诉（可能已撤回或申诉处理中）', 'RECORD_NOT_APPEALABLE');
    }
    const consumed = await repos.appealTokens.consume(tokenHash);
    if (!consumed.ok) {
      // 理论不可达（create 成功者是唯一会走到消费的请求）；保守如实报错，申诉已落库不受影响
      throw ApiError.conflict('申诉链接已被使用', 'APPEAL_TOKEN_CONSUMED');
    }

    return created(c, { appealed: true, appealId: appeal.id });
  });

  return app;
}
