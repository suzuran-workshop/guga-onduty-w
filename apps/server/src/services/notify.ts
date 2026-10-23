/**
 * 通知服务 —— 钉钉工作通知（2026-10-23，需求 4：教师免登录收推送）。
 *
 * 三类推送：
 *  1. **扣分即时推送**（record_deduction）：含「申诉」链接（免登录令牌）
 *  2. **加分即时推送**（record_positive）：仅告知，不带申诉链接
 *  3. **周报**（weekly_report）：每周本班得分/扣分总计，进程内定时器触发 + 管理员可补发
 *
 * 三个必须处理对的坑（都是实测/勘查发现，不是假想）：
 *
 *  A. **推送失败绝不能影响打分主链路**。调用方在 EventBus 上触发，emit 是同步的；
 *     故对外只暴露 fire-and-forget 的 `notifyRecordAsync()`（内部 void + catch），
 *     需要 await 的场景（路由里补发/周报）才用返回 Promise 的版本。
 *     另 EventBus 自身已做 listener 错误隔离（见 utils/event-bus.ts），双重保障。
 *
 *  B. **`errcode:0` ≠ 已送达**。asyncsend_v2 是异步任务：发给不存在的 userid 也返 0。
 *     必须轮询 `getSendResult` 拿 `invalidUserIds`/`failedUserIds`/`read|unreadUserIds`
 *     才能判成败——否则「班主任收不到扣分推送」而系统显示「已发送」，是最难查的故障。
 *
 *  C. **凭证缺失要降级，不能崩**。未配 AppKey/AppSecret/AgentId（或班级未绑定班主任）时，
 *     通知仍**落库为 pending**（而非丢弃），凭证到位后可 `flushPending` 补发。
 *     这样「先上线打分、后配钉钉」的顺序不会丢通知。
 *
 * ⚠ 多实例部署会重复推送（EventBus 是进程内单例，见 utils/event-bus.ts）。
 *   周报有 dedupeKey 唯一约束兜底幂等；扣分推送无去重键，多实例场景需引入分布式锁
 *   或改为轮询 notificationLogs 的单实例 worker（见 ARCHITECTURE 技术边界）。
 */
import { supports } from '@homurajs/3p';
import type { AppConfig } from '../config.js';
import type { PlatformBundle } from '../platform/build.js';
import type { Repos } from '../repos/types.js';
import { EventBus } from '../utils/event-bus.js';
import { getCurrentWeek, weekOf } from '../utils/week.js';
import type { NotificationKind, RecordWithDetails } from '@guga-onduty-w/shared';

export interface NotifyDeps {
  cfg: AppConfig;
  repos: Repos;
  platform: PlatformBundle;
  logger: {
    info: (m: string, f?: any) => void;
    warn: (m: string, f?: any) => void;
    error: (m: string, f?: any) => void;
  };
}

export interface NotifyResult {
  /** 是否已投递成功（回执确认 read/unread） */
  delivered: boolean;
  /** 未推送原因（降级/跳过时可展示给管理员） */
  skippedReason?: string;
  notificationId?: string;
}

/** 轮询投递回执的参数（asyncsend_v2 是异步任务） */
const RECEIPT_POLL = { attempts: 6, intervalMs: 500 };

export interface NotifyService {
  /** 按记录 id 推送（读库拿完整详情）。供 EventBus listener 与路由补发共用 */
  notifyRecord(recordId: string): Promise<NotifyResult>;
  /** fire-and-forget 包装（EventBus listener 用；绝不让推送错误冒泡到打分请求） */
  notifyRecordAsync(recordId: string): void;
  /** 发某校区某周的周报（dedupeKey 幂等；管理员补发也走这里，重复点击安全） */
  sendWeeklyReport(campusId: string, week: string): Promise<{ sent: number; skipped: number; failed: number }>;
  /** 补发 pending 的通知（凭证到位后调用） */
  flushPending(campusId?: string): Promise<{ sent: number; failed: number }>;
  /** 订阅 EventBus，记录创建后自动推送。返回取消订阅函数（shutdown 时调用） */
  subscribe(): () => void;
  /** 启动周报定时器。返回停止函数（shutdown 时调用，否则进程不退出） */
  startScheduler(): () => void;
}

export function createNotifyService(deps: NotifyDeps): NotifyService {
  const { cfg, repos, platform, logger } = deps;
  const appBaseUrl = (cfg.get('appBaseUrl') as string | undefined)?.replace(/\/$/, '') ?? '';
  const ttlHours = (cfg.get('appealTokenTtlHours') as number | undefined) ?? 72;

  // ── 申诉链接（免登录令牌）────────────────────────────────────────
  /**
   * 为一条记录生成免登录申诉链接。
   * 令牌绑定 recordId + 教师钉钉 userid + 过期时间，一次性消费；
   * 链接指向 SPA 的公开路由 /appeal/:token（不经 ProtectedRoute，教师无需登录）。
   * 未配 APP_BASE_URL 时返回 null（钉钉消息仍可发，只是没有可点的链接）。
   */
  async function makeAppealUrl(record: RecordWithDetails, teacherDingtalkId: string): Promise<string | null> {
    if (!appBaseUrl) return null;
    const expiresAt = Date.now() + ttlHours * 3600 * 1000;
    const { plainToken } = await repos.appealTokens.create({
      recordId: record.id,
      teacherDingtalkId,
      expiresAt,
    });
    return `${appBaseUrl}/appeal/${plainToken}`;
  }

  // ── 投递回执轮询（坑 B）──────────────────────────────────────────
  /**
   * 轮询 getsendresult 判定真实投递结果。
   * 返回 'sent' / 'failed'（+ 原因）。⚠ 不能只看 sendWorkMessage 的 errcode:0。
   */
  async function pollReceipt(agentId: string, taskId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!platform.platform || !supports(platform.platform, 'message')) {
      return { ok: false, reason: '无 message 能力，无法查回执' };
    }
    let last = '';
    for (let i = 0; i < RECEIPT_POLL.attempts; i++) {
      try {
        const r = await platform.platform.getSendResult(agentId, taskId);
        if (r.readUserIds.length > 0 || r.unreadUserIds.length > 0) return { ok: true };
        if (r.invalidUserIds.length > 0) {
          return { ok: false, reason: `userid 无效（invalid: ${r.invalidUserIds.join(',')}）` };
        }
        if (r.failedUserIds.length > 0) {
          return { ok: false, reason: `投递失败（failed: ${r.failedUserIds.join(',')}）` };
        }
        if (r.forbiddenUserIds.length > 0) {
          return { ok: false, reason: `被企业策略禁止（forbidden: ${r.forbiddenUserIds.join(',')}）` };
        }
        last = '回执尚无结果';
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
      }
      // 未出结果 → 等一下再查（异步任务需要时间）
      await new Promise((r) => setTimeout(r, RECEIPT_POLL.intervalMs));
    }
    // 轮询结束仍无定论：保守标记 failed（可补发），而不是假装成功
    return { ok: false, reason: `回执未确认送达（${last}）` };
  }

  // ── 底层发送 ─────────────────────────────────────────────────────
  /**
   * 实际发送一条工作通知并写日志状态。所有推送路径共用，确保「落库 → 发送 → 回执 → 定状态」一致。
   * 降级（凭证缺失/无收件人）时只落库 pending 或 skipped，不抛错。
   */
  async function dispatch(input: {
    campusId: string;
    recipientPlatformId: string;
    recipientUserId?: string | null;
    kind: NotificationKind;
    title: string;
    markdownText: string;
    messageUrl?: string;
    recordId?: string | null;
    week?: string | null;
    dedupeKey?: string | null;
  }): Promise<NotifyResult> {
    // 1) 先落库（pending）。周报靠 dedupeKey 幂等：已存在则 create 返回 null → 直接跳过。
    const log = await repos.notifications.create({
      campusId: input.campusId,
      recipientUserId: input.recipientUserId ?? null,
      recipientPlatformId: input.recipientPlatformId,
      kind: input.kind,
      recordId: input.recordId ?? null,
      week: input.week ?? null,
      title: input.title,
      dedupeKey: input.dedupeKey ?? null,
    });
    if (!log) {
      return { delivered: false, skippedReason: '重复推送已跳过（幂等）' };
    }

    // 2) 凭证未配 → 停在 pending，待 flushPending 补发（坑 C）
    if (!platform.canSend || !platform.platform || !platform.agentId) {
      const reason = platform.reason ?? '钉钉未启用';
      await repos.notifications.update(log.id, { status: 'pending', error: reason });
      logger.warn('notify: 钉钉未启用，通知留存待补发', { notificationId: log.id, kind: input.kind, reason });
      return { delivered: false, skippedReason: reason, notificationId: log.id };
    }
    if (!supports(platform.platform, 'message')) {
      await repos.notifications.update(log.id, { status: 'pending', error: '平台无 message 能力' });
      return { delivered: false, skippedReason: '平台无 message 能力', notificationId: log.id };
    }

    // 3) 发送（扣分带申诉链接用 link 类型，其余用 markdown）
    try {
      const { taskId } = await platform.platform.sendWorkMessage({
        agentId: platform.agentId,
        userIds: [input.recipientPlatformId],
        msg: input.messageUrl
          ? { type: 'link', content: { title: input.title, text: input.markdownText, messageUrl: input.messageUrl } }
          : { type: 'markdown', content: { title: input.title, text: input.markdownText } },
      });
      await repos.notifications.update(log.id, { providerTaskId: taskId });

      // 4) 轮询回执判真实投递（坑 B：errcode:0 只代表已受理）
      const receipt = await pollReceipt(platform.agentId, taskId);
      if (receipt.ok) {
        await repos.notifications.update(log.id, { status: 'sent', sentAt: Date.now(), error: null });
        return { delivered: true, notificationId: log.id };
      }
      await repos.notifications.update(log.id, { status: 'failed', error: receipt.reason });
      logger.warn('notify: 回执显示未送达', { notificationId: log.id, reason: receipt.reason });
      return { delivered: false, skippedReason: receipt.reason, notificationId: log.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await repos.notifications.update(log.id, { status: 'failed', error: msg });
      logger.error('notify: 发送异常', { notificationId: log.id, error: msg });
      return { delivered: false, skippedReason: msg, notificationId: log.id };
    }
  }

  // ── 记录推送（扣分 / 加分）───────────────────────────────────────
  async function notifyRecord(recordId: string): Promise<NotifyResult> {
    const record = await repos.records.findByIdWithDetails(recordId);
    if (!record) return { delivered: false, skippedReason: '记录不存在' };
    if (record.status !== 'active') {
      return { delivered: false, skippedReason: `记录状态 ${record.status}，不推送` };
    }

    const ownership = await repos.classes.findOwnership(record.classId);
    if (!ownership) return { delivered: false, skippedReason: '班级不存在' };
    if (!ownership.teacherDingtalkId) {
      // 未绑定班主任：落一条 skipped 便于管理员在后台看到「哪些班没绑班主任」
      const log = await repos.notifications.create({
        campusId: record.campusId,
        recipientPlatformId: '',
        kind: isDeduction(record) ? 'record_deduction' : 'record_positive',
        recordId: record.id,
        week: record.week,
        title: `${record.className} 值周记录（班主任未绑定）`,
      });
      if (log) {
        await repos.notifications.update(log.id, {
          status: 'skipped',
          error: '班级未绑定班主任（teacherDingtalkId 为空）',
        });
      }
      logger.warn('notify: 班级未绑定班主任，跳过推送', { classId: record.classId, className: record.className });
      return { delivered: false, skippedReason: '班级未绑定班主任', notificationId: log?.id };
    }

    const deduction = isDeduction(record);
    const tagText = record.tags.length > 0 ? record.tags.map((t) => t.name).join('、') : '（无标签）';
    const scoreText = `${record.score >= 0 ? '+' : ''}${record.score}`;
    const title = `${record.className} ${deduction ? '值周扣分' : '值周加分'} ${scoreText}`;
    const lines = [
      `### ${title}`,
      `- 班级：${record.gradeName} ${record.className}`,
      `- 标签：${tagText}`,
      `- 分数：**${scoreText}**`,
      `- 周次：${record.week}`,
      `- 值周生：${record.recorderName}`,
      record.comment ? `- 说明：${record.comment}` : '',
      deduction && record.images?.length ? `- 已附现场照片 ${record.images.length} 张` : '',
    ].filter(Boolean);

    // 扣分才带申诉链接（加分无需申诉）
    let messageUrl: string | undefined;
    if (deduction) {
      const url = await makeAppealUrl(record, ownership.teacherDingtalkId);
      if (url) {
        messageUrl = url;
        lines.push('', `如对本次扣分有异议，请在 ${ttlHours} 小时内[点此提交申诉](${url})（免登录，一次性链接）。`);
      } else {
        lines.push('', '（未配置 APP_BASE_URL，本次不含申诉链接）');
      }
    }

    return dispatch({
      campusId: record.campusId,
      recipientPlatformId: ownership.teacherDingtalkId,
      kind: deduction ? 'record_deduction' : 'record_positive',
      title,
      markdownText: lines.join('\n'),
      messageUrl,
      recordId: record.id,
      week: record.week,
    });
  }

  /** 是否扣分记录：分数为负，或含任一 negative 标签（与 routes/records.ts 的「扣分必拍照」判定同口径） */
  function isDeduction(record: RecordWithDetails): boolean {
    return record.score < 0 || record.tags.some((t) => t.category === 'negative' || t.score < 0);
  }

  // ── 周报 ────────────────────────────────────────────────────────
  async function sendWeeklyReport(campusId: string, week: string) {
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    // 按班级聚合本周排名，再按班主任分组（一位班主任可能带多个班）
    const ranking = await repos.statistics.ranking(campusId, week);
    const byTeacher = new Map<string, typeof ranking>();
    for (const row of ranking) {
      const ownership = await repos.classes.findOwnership(row.classId);
      const dt = ownership?.teacherDingtalkId;
      if (!dt) continue; // 未绑定班主任的班级无人可推
      const list = byTeacher.get(dt) ?? [];
      list.push(row);
      byTeacher.set(dt, list);
    }

    for (const [teacherDingtalkId, rows] of byTeacher) {
      const total = rows.reduce((acc, r) => acc + r.totalScore, 0);
      const positive = rows.reduce((acc, r) => acc + r.positiveCount, 0);
      const negative = rows.reduce((acc, r) => acc + r.negativeCount, 0);
      const lines = [
        `### ${week} 值周周报`,
        ...rows.map(
          (r) => `- ${r.gradeName} ${r.className}：**${r.totalScore >= 0 ? '+' : ''}${r.totalScore}** 分`
            + `（表扬 ${r.positiveCount} 次 / 扣分 ${r.negativeCount} 次，共 ${r.recordCount} 条记录）`,
        ),
        '',
        `**合计：${total >= 0 ? '+' : ''}${total} 分**（表扬 ${positive} 次、扣分 ${negative} 次）`,
      ];
      const r = await dispatch({
        campusId,
        recipientPlatformId: teacherDingtalkId,
        kind: 'weekly_report',
        title: `${week} 值周周报`,
        markdownText: lines.join('\n'),
        week,
        // 幂等键：同一校区 + 同一收件人 + 同一周只发一次（重复点「补发」安全）
        dedupeKey: `weekly:${campusId}:${teacherDingtalkId}:${week}`,
      });
      if (r.delivered) sent++;
      else if (r.skippedReason?.includes('幂等')) skipped++;
      else failed++;
    }
    logger.info('notify: 周报推送完成', { campusId, week, sent, skipped, failed, teachers: byTeacher.size });
    return { sent, skipped, failed };
  }

  // ── 补发 ────────────────────────────────────────────────────────
  async function flushPending(campusId?: string) {
    if (!platform.canSend) {
      return { sent: 0, failed: 0, reason: platform.reason ?? '钉钉未启用' };
    }
    const pending = await repos.notifications.listPending(campusId, 200);
    let sent = 0;
    let failed = 0;
    for (const n of pending) {
      // 只补发有收件人的（未绑定班主任的 skipped 记录不参与补发）
      if (!n.recipientPlatformId) continue;
      const record = n.recordId ? await repos.records.findByIdWithDetails(n.recordId) : null;
      if (n.kind === 'weekly_report' && n.week) {
        const r = await sendWeeklyReport(n.campusId, n.week);
        sent += r.sent;
        failed += r.failed;
        continue;
      }
      if (!record) {
        await repos.notifications.update(n.id, { status: 'skipped', error: '关联记录已不存在' });
        continue;
      }
      const r = await notifyRecord(record.id);
      if (r.delivered) sent++;
      else failed++;
    }
    logger.info('notify: 补发完成', { campusId, sent, failed, candidates: pending.length });
    return { sent, failed };
  }

  // ── EventBus 订阅（坑 A：fire-and-forget）────────────────────────
  function subscribe(): () => void {
    const onCreated = (payload: { recordId: string }) => {
      // 绝不 await：EventBus.emit 是同步的，await 会阻塞「创建记录」响应；
      // 错误已在 notifyRecord 内部消化，这里再兜一层防 unhandledRejection。
      void notifyRecord(payload.recordId).catch((e) => {
        logger.error('notify: 记录推送未捕获异常', { recordId: payload.recordId, error: e instanceof Error ? e.message : String(e) });
      });
    };
    EventBus.on('record_created', onCreated);
    return () => EventBus.off('record_created', onCreated);
  }

  // ── 周报定时器 ──────────────────────────────────────────────────
  function startScheduler(): () => void {
    const enabled = cfg.get('weeklyReportEnabled') as boolean;
    if (!enabled) {
      logger.info('notify: 周报定时器未启用（WEEKLY_REPORT_ENABLED=false）');
      return () => {};
    }
    const day = cfg.get('weeklyReportDay') as number; // 0=周日…5=周五
    const hour = cfg.get('weeklyReportHour') as number;

    // 每 5 分钟检查一次「是否到点」，而不是用 setTimeout 算到目标的毫秒差：
    // 后者在进程休眠/时钟调整后可能永不触发，前者自愈（下次 tick 自然命中）。
    // 幂等由 dedupeKey 保证，故 tick 重叠也不会重复推送。
    let lastFiredWeek = '';
    const timer = setInterval(() => {
      const now = new Date();
      if (now.getDay() !== day || now.getHours() !== hour) return;
      // 周报统计的是**已结束的那一周**（周五发上周更合理），故取上一周
      const prev = new Date(now.getTime() - 7 * 86400000);
      const week = weekOf(prev);
      if (week === lastFiredWeek) return; // 同一小时内多次 tick 只发一次
      lastFiredWeek = week;
      void (async () => {
        try {
          const campuses = await repos.campuses.listAll();
          for (const campus of campuses) {
            await sendWeeklyReport(campus.id, week);
          }
        } catch (e) {
          logger.error('notify: 周报定时器异常', { error: e instanceof Error ? e.message : String(e) });
        }
      })();
    }, 5 * 60 * 1000);
    // unref：定时器不阻止进程退出（优雅关闭）
    timer.unref?.();
    logger.info('notify: 周报定时器已启动', { day, hour, note: '每周五 17 点发上一周（可用 WEEKLY_REPORT_* 调整）' });
    return () => clearInterval(timer);
  }

  return {
    notifyRecord,
    notifyRecordAsync: (recordId: string) => {
      void notifyRecord(recordId).catch((e) =>
        logger.error('notify: 推送未捕获异常', { recordId, error: e instanceof Error ? e.message : String(e) }),
      );
    },
    sendWeeklyReport,
    flushPending: async (campusId?: string) => {
      const r = await flushPending(campusId);
      return { sent: r.sent, failed: r.failed };
    },
    subscribe,
    startScheduler,
  };
}

/** 便捷导出：getCurrentWeek 供路由算「本周」 */
export { getCurrentWeek };
