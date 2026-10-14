/**
 * users repo（drizzle 实现）—— 唯一横跨 auth 身份锚点与业务档案的 repo。
 *
 * 身份模型（docs §2.2）：
 *  - auth SDK `users` 表 = 身份锚点（id uuid / username / nickname）。
 *  - auth SDK `passwords` 表 = scrypt 密码凭证（由 PasswordProvider 管，repo 不碰哈希）。
 *  - 业务 `userProfiles` 表 = role / campusId / displayName / groupId / canInspect。
 *
 * create 流程：passwordProvider.register（建 users+passwords）→ 建 userProfiles。
 * 两步跨 SDK/业务边界无法同事务，故 profile 失败时 best-effort 清理孤儿 auth user
 * （照 PasswordProvider.register 对 user/password 的清理先例）。
 *
 * list/findMe 的 username 来自 auth users，displayName/role/campusId/canInspect 来自 userProfiles，
 * createdAt 用 auth users.createdAt（userProfiles 无该列）。
 */
import { eq, and, asc, sql, inArray } from 'drizzle-orm';
import type { PasswordProvider, UserStore } from '@homurajs/auth';
import type { UserView, UserProfile, User, UserRole } from '@class-duty/shared';
import type { UsersRepo } from '../types.js';
import { DrizzleCtx, whereAll, num } from './_base.js';

export interface UsersRepoAuthDeps {
  passwordProvider: PasswordProvider;
  userStore: UserStore;
}

function toView(r: any): UserView {
  return {
    id: r.userId,
    username: r.username ?? null,
    campusId: r.campusId,
    displayName: r.displayName,
    role: r.role as UserRole,
    groupId: r.groupId ?? null,
    groupName: r.groupName ?? null,
    campusName: r.campusName ?? '',
    canInspect: num(r.canInspect),
    createdAt: num(r.createdAt),
  };
}

export function createUsersRepo(ctx: DrizzleCtx, auth: UsersRepoAuthDeps): UsersRepo {
  const { tables: T, authTables: A } = ctx;
  const db = ctx.db as any;
  const { userProfiles, campuses, dutyGroups } = T;
  const users = A.users;

  /** userProfiles + users(username/createdAt) + campuses + dutyGroups 的 join 投影 */
  const projection = {
    userId: userProfiles.userId,
    username: users.username,
    campusId: userProfiles.campusId,
    displayName: userProfiles.displayName,
    role: userProfiles.role,
    groupId: userProfiles.groupId,
    canInspect: userProfiles.canInspect,
    groupName: dutyGroups.name,
    campusName: campuses.name,
    createdAt: users.createdAt,
  };

  const joined = () =>
    db
      .select(projection)
      .from(userProfiles)
      .innerJoin(users, eq(userProfiles.userId, users.id))
      .innerJoin(campuses, eq(userProfiles.campusId, campuses.id))
      .leftJoin(dutyGroups, eq(userProfiles.groupId, dutyGroups.id));

  return {
    async list(campusId, role): Promise<UserView[]> {
      const cond = whereAll([
        campusId ? eq(userProfiles.campusId, campusId) : undefined,
        role ? eq(userProfiles.role, role) : undefined,
      ]);
      const q = joined();
      const rows = cond
        ? await q.where(cond).orderBy(asc(userProfiles.campusId), asc(userProfiles.role), asc(userProfiles.userId))
        : await q.orderBy(asc(userProfiles.campusId), asc(userProfiles.role), asc(userProfiles.userId));
      return rows.map(toView);
    },

    async findProfile(userId): Promise<UserProfile | null> {
      const rows = await db
        .select({
          userId: userProfiles.userId,
          campusId: userProfiles.campusId,
          displayName: userProfiles.displayName,
          role: userProfiles.role,
          groupId: userProfiles.groupId,
          canInspect: userProfiles.canInspect,
        })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1);
      const r = rows[0];
      return r
        ? {
            userId: r.userId, campusId: r.campusId, displayName: r.displayName,
            role: r.role as UserRole, groupId: r.groupId ?? null, canInspect: num(r.canInspect),
          }
        : null;
    },

    async create(input): Promise<UserView> {
      // 1. auth SDK 建身份锚点 + 密码（username 占用会抛 UsernameTakenError，路由转 409）
      const localUser = await auth.passwordProvider.register({
        username: input.username,
        password: input.password,
        nickname: input.displayName,
      });
      // 2. 建业务档案；失败则 best-effort 清理孤儿 auth user
      try {
        await db.insert(userProfiles).values({
          userId: localUser.id,
          campusId: input.campusId,
          displayName: input.displayName,
          role: input.role,
          groupId: input.groupId ?? null,
          canInspect: input.canInspect ?? 0,
        }).run();
      } catch (e) {
        try { await auth.passwordProvider.deletePassword(localUser.id); } catch { /* 尽力清理 */ }
        try { await auth.userStore.delete(localUser.id); } catch { /* 尽力清理 */ }
        throw e;
      }
      const view = await this.listByIds([localUser.id]);
      if (!view[0]) throw new Error('用户创建后回查失败');
      return view[0];
    },

    async update(userId, input): Promise<UserView | null> {
      const patch: any = { displayName: input.displayName, role: input.role, groupId: input.groupId ?? null };
      if (input.canInspect !== undefined) patch.canInspect = input.canInspect;
      await db.update(userProfiles)
        .set(patch)
        .where(eq(userProfiles.userId, userId))
        .run();
      // nickname 同步到 auth users（displayName 与 nickname 保持一致，登录页展示用）
      try { await auth.userStore.update(userId, { nickname: input.displayName }); } catch { /* 非致命 */ }
      const view = await this.listByIds([userId]);
      return view[0] ?? null;
    },

    async remove(userId): Promise<void> {
      // 先删业务档案，再删 auth 凭证与身份锚点（顺序：子→父）
      await db.delete(userProfiles).where(eq(userProfiles.userId, userId)).run();
      try { await auth.passwordProvider.deletePassword(userId); } catch { /* 可能无密码记录 */ }
      try { await auth.userStore.delete(userId); } catch { /* 尽力清理 */ }
    },

    async findMe(userId): Promise<{ user: User; profile: UserProfile; campusName: string } | null> {
      const rows = await db
        .select({
          // auth users
          id: users.id, username: users.username, nickname: users.nickname,
          avatarUrl: users.avatarUrl, userCreatedAt: users.createdAt, userUpdatedAt: users.updatedAt,
          // profile
          campusId: userProfiles.campusId, displayName: userProfiles.displayName,
          role: userProfiles.role, groupId: userProfiles.groupId, canInspect: userProfiles.canInspect,
          campusName: campuses.name,
        })
        .from(users)
        .innerJoin(userProfiles, eq(users.id, userProfiles.userId))
        .innerJoin(campuses, eq(userProfiles.campusId, campuses.id))
        .where(eq(users.id, userId))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return {
        user: {
          id: r.id, username: r.username ?? null, nickname: r.nickname ?? null,
          avatarUrl: r.avatarUrl ?? null, createdAt: num(r.userCreatedAt), updatedAt: num(r.userUpdatedAt),
        },
        profile: {
          userId: r.id, campusId: r.campusId, displayName: r.displayName,
          role: r.role as UserRole, groupId: r.groupId ?? null, canInspect: num(r.canInspect),
        },
        campusName: r.campusName ?? '',
      };
    },

    /** 内部助手：按 id 集合取 UserView（create/update 回查用） */
    async listByIds(ids: string[]): Promise<UserView[]> {
      if (ids.length === 0) return [];
      const rows = await joined().where(inArray(userProfiles.userId, ids));
      return rows.map(toView);
    },
  } as UsersRepo & { listByIds(ids: string[]): Promise<UserView[]> };
}
