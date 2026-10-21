/**
 * users repo（rest 实现）—— 唯一横跨 auth 身份锚点与业务档案的 repo。
 *
 * 语义对齐 drizzle/users-repo：
 *  - 身份模型：auth SDK `users` 表（rest 侧列名 snake_case：username/nickname/created_at…，
 *    与 @homurajs/auth 的 createRestUserStore 写入列一致）= 身份锚点；
 *    业务 `userProfiles` 表（camelCase）= role/campusId/displayName/groupId。
 *  - create：passwordProvider.register（建 users+passwords）→ 建 userProfiles；
 *    profile 失败时 best-effort 清理孤儿 auth user。
 *  - join：无 SQL join → 主表页 → indexByIds 批查关联表 → JS 拼接。
 *  - remove：先删 auth 锚点（防「账号变砖」，REVIEW #12），再 best-effort 删密码，最后删 profile。
 */
import type { RestFilters } from '@homurajs/db';
import type { PasswordProvider, UserStore } from '@homurajs/auth';
import type { UserView, UserProfile, User, UserRole } from '@guga-onduty-w/shared';
import type { UsersRepo } from '../types.js';
import { type RestCtx, tbl, indexByIds, num } from './_base.js';

export interface UsersRepoAuthDeps {
  passwordProvider: PasswordProvider;
  userStore: UserStore;
}

function toView(r: { profile: any; user?: any; campus?: any; group?: any }): UserView {
  const p = r.profile;
  return {
    id: p.userId,
    username: r.user?.username ?? null,
    campusId: p.campusId,
    displayName: p.displayName,
    role: p.role as UserRole,
    groupId: p.groupId ?? null,
    groupName: r.group?.name ?? null,
    campusName: r.campus?.name ?? '',
    createdAt: num(r.user?.created_at),
  };
}

export function createUsersRepo(ctx: RestCtx, auth: UsersRepoAuthDeps): UsersRepo {
  const userProfiles = tbl<any>(ctx.rest, 'userProfiles');
  const campuses = tbl<any>(ctx.rest, 'campuses');
  const dutyGroups = tbl<any>(ctx.rest, 'dutyGroups');
  // auth users 表：rest store 用 snake_case 列（与 createRestUserStore 对齐）
  const users = tbl<any>(ctx.rest, 'users');

  /** userProfiles 页 → 批查 users/campuses/dutyGroups → JS 拼接（innerJoin 语义：缺 user/campus 的行丢弃） */
  async function joinedViews(filters?: RestFilters): Promise<UserView[]> {
    const profiles = await userProfiles.select(filters, {
      order: 'campusId.asc,role.asc,userId.asc',
    });
    const umap = await indexByIds(users, 'id', profiles.map((p) => p.userId));
    const cmap = await indexByIds(campuses, 'id', profiles.map((p) => p.campusId));
    const gmap = await indexByIds(dutyGroups, 'id', profiles.map((p) => p.groupId));
    const out: UserView[] = [];
    for (const p of profiles) {
      // drizzle innerJoin(users) + innerJoin(campuses)：任一缺失即整行不出现
      const u = umap.get(p.userId);
      const c = cmap.get(p.campusId);
      if (!u || !c) continue;
      out.push(toView({ profile: p, user: u, campus: c, group: gmap.get(p.groupId ?? '') }));
    }
    return out;
  }

  return {
    async list(campusId, role): Promise<UserView[]> {
      const filters: RestFilters = {};
      if (campusId) filters.campusId = campusId;
      if (role) filters.role = role;
      return joinedViews(Object.keys(filters).length > 0 ? filters : undefined);
    },

    async findProfile(userId): Promise<UserProfile | null> {
      const rows = await userProfiles.select({ userId }, { limit: 1 });
      const p = rows[0];
      if (!p) return null;
      return {
        userId: p.userId, campusId: p.campusId, displayName: p.displayName,
        role: p.role as UserRole, groupId: p.groupId ?? null,
      };
    },

    async create(input): Promise<UserView> {
      // 1. auth SDK 建身份锚点 + 密码（username 占用抛 UsernameTakenError，路由转 409）
      const localUser = await auth.passwordProvider.register({
        username: input.username,
        password: input.password,
        nickname: input.displayName,
      });
      // 2. 建业务档案；失败则 best-effort 清理孤儿 auth user
      try {
        await userProfiles.insert({
          userId: localUser.id,
          campusId: input.campusId,
          displayName: input.displayName,
          role: input.role,
          groupId: input.groupId ?? null,
        });
      } catch (e) {
        try { await auth.passwordProvider.deletePassword(localUser.id); } catch { /* 尽力清理 */ }
        try { await auth.userStore.delete(localUser.id); } catch { /* 尽力清理 */ }
        throw e;
      }
      const views = await joinedViews({ userId: localUser.id });
      if (!views[0]) throw new Error('用户创建后回查失败');
      return views[0];
    },

    async update(userId, input): Promise<UserView | null> {
      const res = await userProfiles.update(
        { displayName: input.displayName, role: input.role, groupId: input.groupId ?? null },
        { userId },
      );
      // nickname 同步到 auth users（displayName 与 nickname 保持一致，登录页展示用）
      try { await auth.userStore.update(userId, { nickname: input.displayName }); } catch { /* 非致命 */ }
      if (res.length === 0) return null;
      const views = await joinedViews({ userId });
      return views[0] ?? null;
    },

    async remove(userId): Promise<void> {
      // REVIEW #12：先删 auth 身份锚点（失败则抛错，profile 不动）；密码 best-effort；最后删 profile
      await auth.userStore.delete(userId);
      try { await auth.passwordProvider.deletePassword(userId); } catch { /* 可能无密码记录 */ }
      await userProfiles.remove({ userId });
    },

    async findMe(userId): Promise<{ user: User; profile: UserProfile; campusName: string } | null> {
      const urows = await users.select({ id: userId }, { limit: 1 });
      const u = urows[0];
      if (!u) return null;
      const prows = await userProfiles.select({ userId }, { limit: 1 });
      const p = prows[0];
      if (!p) return null; // drizzle innerJoin(userProfiles) 语义：无 profile 即 null
      const crows = await campuses.select({ id: p.campusId }, { limit: 1 });
      if (!crows[0]) return null; // innerJoin(campuses) 语义
      return {
        user: {
          id: u.id, username: u.username ?? null, nickname: u.nickname ?? null,
          avatarUrl: u.avatar_url ?? null, createdAt: num(u.created_at), updatedAt: num(u.updated_at),
        },
        profile: {
          userId: p.userId, campusId: p.campusId, displayName: p.displayName,
          role: p.role as UserRole, groupId: p.groupId ?? null,
        },
        campusName: crows[0].name ?? '',
      };
    },
  };
}
