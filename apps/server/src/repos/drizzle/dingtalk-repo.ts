/**
 * 钉钉域 repo（drizzle 实现）—— 通讯录缓存 / 通知日志 / 申诉令牌。
 *
 * 2026-10-23 新增（需求 4：教师免登录收钉钉推送）。三个关注点：
 *
 *  - dingtalkContacts：管理员「引入整个组织通讯录」（**不含家校**）的本地索引。
 *    钉钉无「按姓名查 userid」API，推送与班主任下拉选人都依赖这份缓存。
 *    upsertMany 按 userId 主键 upsert（钉钉侧改名/换部门后以最新为准）。
 *
 *  - notificationLogs：推送的幂等 + 重试 + 审计。
 *    ⚠ 周报幂等靠 dedupeKey：create 前先查该 key 是否已存在，存在则返回 null（而非抛错），
 *    调用方据此静默跳过——这样「管理员补发」可安全重复点击。
 *    扣分推送 dedupeKey 为 null，不受该约束影响（两个方言下 NULL 互不冲突）。
 *
 *  - appealTokens：教师免登录申诉的一次性令牌。**只存 SHA-256 哈希**，明文仅在
 *    create 时返回一次（用于拼钉钉消息里的链接）；数据库泄漏也无法构造可用链接。
 *    consume 必须原子：`UPDATE ... WHERE tokenHash=? AND consumedAt IS NULL` 并检查
 *    影响行数，否则并发点击同一链接会重复提交申诉。
 */
import { eq, and, or, isNull, desc, asc, like, lt } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { sha256Hex } from '../../utils/token.js';
import type {
  DingtalkContact,
  DingtalkContactInput,
  NotificationLog,
  NotificationLogInput,
  NotificationKind,
  NotificationStatus,
} from '@guga-onduty-w/shared';
import type {
  DingtalkContactsRepo,
  NotificationsRepo,
  AppealTokensRepo,
  Paged,
} from '../types.js';
import { DrizzleCtx, whereAll, eqIf, paginate, num, countAll } from './_base.js';

/** JSON 数组列反序列化兜底（number[] / string[] 共用） */
function toArr<T>(v: unknown): T[] | null {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'string' && v.length > 0) {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as T[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

// ── 通讯录缓存 ──────────────────────────────────────────────────────
export function createDingtalkContactsRepo(ctx: DrizzleCtx): DingtalkContactsRepo {
  const db = ctx.db as any;
  const { dingtalkContacts: T } = ctx.tables;

  const toContact = (r: any): DingtalkContact => ({
    userId: r.userId,
    unionId: r.unionId ?? null,
    name: r.name,
    mobile: r.mobile ?? null,
    title: r.title ?? null,
    avatarUrl: r.avatarUrl ?? null,
    deptIds: toArr<number>(r.deptIds),
    deptNames: toArr<string>(r.deptNames),
    syncedAt: num(r.syncedAt),
  });

  return {
    async upsertMany(contacts): Promise<number> {
      if (contacts.length === 0) return 0;
      let written = 0;
      // 事务批量：按 userId 主键 upsert（钉钉侧改名/换部门以最新为准）。
      // onConflictDoUpdate 双方言均支持（sqlite: ON CONFLICT DO UPDATE / pg: ON CONFLICT DO UPDATE）。
      await ctx.tx(async (tx: any) => {
        for (const c of contacts) {
          const values = {
            userId: c.userId,
            unionId: c.unionId ?? null,
            name: c.name,
            mobile: c.mobile ?? null,
            title: c.title ?? null,
            avatarUrl: c.avatarUrl ?? null,
            deptIds: c.deptIds ?? null,
            deptNames: c.deptNames ?? null,
            syncedAt: c.syncedAt,
          };
          await tx
            .insert(T)
            .values(values)
            .onConflictDoUpdate({
              target: T.userId,
              set: {
                unionId: values.unionId,
                name: values.name,
                mobile: values.mobile,
                title: values.title,
                avatarUrl: values.avatarUrl,
                deptIds: values.deptIds,
                deptNames: values.deptNames,
                syncedAt: values.syncedAt,
              },
            })
            .run();
          written++;
        }
      });
      return written;
    },

    async list(filter?): Promise<DingtalkContact[]> {
      const limit = filter?.limit ?? 500;
      const rows = await db
        .select()
        .from(T)
        .where(filter?.nameLike ? like(T.name, `%${filter.nameLike}%`) : undefined)
        .orderBy(asc(T.name))
        .limit(limit);
      return rows.map(toContact);
    },

    async findByUserId(userId): Promise<DingtalkContact | null> {
      const rows = await db.select().from(T).where(eq(T.userId, userId)).limit(1);
      return rows[0] ? toContact(rows[0]) : null;
    },

    async findByName(name): Promise<DingtalkContact[]> {
      // 重名会返回多条——由调用方决定（下拉选人可让用户挑，自动匹配则须人工确认）
      const rows = await db.select().from(T).where(eq(T.name, name));
      return rows.map(toContact);
    },
  };
}

// ── 通知日志 ────────────────────────────────────────────────────────
export function createNotificationsRepo(ctx: DrizzleCtx): NotificationsRepo {
  const db = ctx.db as any;
  const { notificationLogs: T } = ctx.tables;

  const toLog = (r: any): NotificationLog => ({
    id: r.id,
    campusId: r.campusId,
    recipientUserId: r.recipientUserId ?? null,
    recipientPlatformId: r.recipientPlatformId,
    kind: r.kind as NotificationKind,
    status: r.status as NotificationStatus,
    recordId: r.recordId ?? null,
    week: r.week ?? null,
    title: r.title ?? null,
    dedupeKey: r.dedupeKey ?? null,
    providerTaskId: r.providerTaskId ?? null,
    error: r.error ?? null,
    createdAt: num(r.createdAt),
    sentAt: r.sentAt === null || r.sentAt === undefined ? null : num(r.sentAt),
  });

  return {
    async create(input): Promise<NotificationLog | null> {
      // 周报幂等：dedupeKey 已存在 → 返回 null，调用方据此静默跳过（「管理员补发」可安全重复点击）。
      // 用「先查后插」而非捕获唯一约束异常：repo 是 db 无关的领域层，不应依赖 http 层的
      // isUniqueViolation（全仓既有 repo 无一 import http/respond）。
      // 极端并发下仍可能撞 dedupeKey 唯一索引 → 让冲突正常抛出（比静默吞成「已发过」更安全）。
      if (input.dedupeKey) {
        const dup = await db.select({ id: T.id }).from(T).where(eq(T.dedupeKey, input.dedupeKey)).limit(1);
        if (dup[0]) return null;
      }
      const id = crypto.randomUUID();
      await db.insert(T).values({
        id,
        campusId: input.campusId,
        recipientUserId: input.recipientUserId ?? null,
        recipientPlatformId: input.recipientPlatformId,
        kind: input.kind,
        status: 'pending',
        recordId: input.recordId ?? null,
        week: input.week ?? null,
        title: input.title ?? null,
        dedupeKey: input.dedupeKey ?? null,
        providerTaskId: null,
        error: null,
        sentAt: null,
      }).run();
      const rows = await db.select().from(T).where(eq(T.id, id)).limit(1);
      return rows[0] ? toLog(rows[0]) : null;
    },

    async update(id, input): Promise<void> {
      // 部分更新：只改传入的字段。⚠ status 也可选（拿到 taskId 时先只记 taskId，回执后再定状态），
      // 若无条件 set 会把状态写成 undefined，冲掉 pending/sent。
      const patch: Record<string, unknown> = {};
      if (input.status !== undefined) patch.status = input.status;
      if (input.providerTaskId !== undefined) patch.providerTaskId = input.providerTaskId;
      if (input.error !== undefined) patch.error = input.error;
      if (input.sentAt !== undefined) patch.sentAt = input.sentAt;
      if (Object.keys(patch).length === 0) return; // 空 patch：跳过（避免生成非法 SQL `SET` 后为空）
      await db.update(T).set(patch).where(eq(T.id, id)).run();
    },

    async findById(id): Promise<NotificationLog | null> {
      const rows = await db.select().from(T).where(eq(T.id, id)).limit(1);
      return rows[0] ? toLog(rows[0]) : null;
    },

    async list(filter): Promise<Paged<NotificationLog>> {
      const { campusId, status, kind, recordId, page, pageSize } = filter;
      const cond = whereAll([
        eq(T.campusId, campusId),
        eqIf(T.status, status),
        eqIf(T.kind, kind),
        eqIf(T.recordId, recordId),
      ]);
      const [{ total }] = await db
        .select({ total: countAll })
        .from(T)
        .where(cond!);
      const rows = await db
        .select()
        .from(T)
        .where(cond!)
        .orderBy(desc(T.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return { data: rows.map(toLog), pagination: paginate(page, pageSize, num(total)) };
    },

    async listPending(campusId?, limit = 100): Promise<NotificationLog[]> {
      const rows = await db
        .select()
        .from(T)
        .where(whereAll([eq(T.status, 'pending'), eqIf(T.campusId, campusId)])!)
        .orderBy(asc(T.createdAt))
        .limit(limit);
      return rows.map(toLog);
    },
  };
}

// ── 申诉令牌 ────────────────────────────────────────────────────────
export function createAppealTokensRepo(ctx: DrizzleCtx): AppealTokensRepo {
  const db = ctx.db as any;
  const { appealTokens: T } = ctx.tables;

  /** 判定令牌状态：不存在 / 已消费 / 已过期 / 可用 */
  async function inspect(tokenHash: string): Promise<
    { ok: true; recordId: string; teacherDingtalkId: string } | { ok: false; reason: 'not_found' | 'expired' | 'consumed' }
  > {
    const rows = await db.select().from(T).where(eq(T.tokenHash, tokenHash)).limit(1);
    const row = rows[0];
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.consumedAt !== null && row.consumedAt !== undefined) return { ok: false, reason: 'consumed' };
    if (num(row.expiresAt) <= Date.now()) return { ok: false, reason: 'expired' };
    return { ok: true, recordId: row.recordId, teacherDingtalkId: row.teacherDingtalkId };
  }

  return {
    async create(input): Promise<{ plainToken: string }> {
      // 明文令牌高熵随机，只存哈希（sha256Hex 由 service 层传入前算好）
      const plainToken = randomToken();
      await db.insert(T).values({
        tokenHash: sha256Hex(plainToken),
        recordId: input.recordId,
        teacherDingtalkId: input.teacherDingtalkId,
        expiresAt: input.expiresAt,
        consumedAt: null,
      }).run();
      return { plainToken };
    },

    async consume(tokenHash) {
      // ⚠ 原子消费：WHERE consumedAt IS NULL + 检查影响行数。
      // 先查后改（check-then-act）在并发下会让同一链接被消费两次 → 重复申诉。
      const res = await db
        .update(T)
        .set({ consumedAt: Date.now() })
        .where(and(eq(T.tokenHash, tokenHash), isNull(T.consumedAt)))
        .run();
      const changed = Number(res?.changes ?? res?.rowsAffected ?? 0);
      if (changed > 0) {
        const rows = await db.select().from(T).where(eq(T.tokenHash, tokenHash)).limit(1);
        const row = rows[0];
        if (row) return { ok: true as const, recordId: row.recordId, teacherDingtalkId: row.teacherDingtalkId };
      }
      // 未更新成功：区分原因（已消费 / 已过期 / 不存在），供前端给准确提示
      const state = await inspect(tokenHash);
      // inspect 若仍报 ok（极罕见的过期边界竞态），保守归为 consumed——宁可让教师重试，不重复建申诉
      return state.ok ? ({ ok: false as const, reason: 'consumed' as const }) : state;
    },

    async peek(tokenHash) {
      return inspect(tokenHash);
    },

    async purgeExpired(now = Date.now()): Promise<number> {
      // 清理：已过期的，或已消费超过 7 天的（留一周供审计追溯）。
      // lt(consumedAt, cutoff) 对 NULL 不成立，故未消费的令牌只由 expiresAt 条件覆盖。
      const consumedCutoff = now - 7 * 24 * 60 * 60 * 1000;
      const res = await db.delete(T).where(or(
        lt(T.expiresAt, now),
        lt(T.consumedAt, consumedCutoff),
      )).run();
      return Number(res?.changes ?? res?.rowsAffected ?? 0);
    },
  };
}

/** 高熵随机令牌（32 字节 base64url，URL 安全无填充） */
function randomToken(): string {
  return randomBytes(32).toString('base64url');
}
