/**
 * 认证装配 —— @homurajs/auth 的 SessionManager + PasswordProvider + SDK 路由。
 *
 * 身份模型（docs/MIGRATION-HOMURA.md §2.2）：
 *  - auth SDK 的 `users`/`passwords`/`refresh_tokens` 表管「你是谁」（uuid 身份锚点 + scrypt 密码）。
 *  - 业务 `userProfiles` 表管「你能做什么」（role / campusId / displayName / groupId）。
 *  - session.sub = users.id(uuid)；业务中间件 requireProfile 再查 userProfiles 补角色/校区。
 *
 * store 用 drizzle 版（sqlite/pg 双方言共用），接口语义与 auth SDK 严格对齐。
 *
 * 登录走 SDK 的 `POST /auth/password/login`（scrypt 校验 + 下发 access/refresh cookie）。
 * 注册**不走** SDK 自助注册（allowRegister=false）——值周系统是 admin 建号带 role/campus，
 * 由业务路由 POST /api/v1/users 调 passwordProvider.register + 建 profile（见 routes/users.ts）。
 */
import { Hono, type MiddlewareHandler } from 'hono';
import {
  SessionManager,
  PasswordProvider,
  createDrizzleSessionStore,
  createDrizzleUserStore,
  createDrizzlePasswordStore,
  createDrizzleOAuth2LinkStore,
  type UserStore,
  type OAuth2LinkStore,
} from '@homurajs/auth';
import { createAuthRoutes, sessionMiddleware } from '@homurajs/auth/hono';

import type { DbHandle } from '../db/client.js';
import type { AppConfig } from '../config.js';

export interface AuthBundle {
  sessions: SessionManager;
  sessionMiddleware: MiddlewareHandler;
  /** SDK 路由：/auth/password/login、/auth/refresh、/auth/logout（挂到根，非 /api/v1） */
  authRoutes: Hono;
  /** 业务建号用（admin 创建用户）：register 建 user+password，profile 另建 */
  passwordProvider: PasswordProvider;
  userStore: UserStore;
  /**
   * OAuth2 身份关联存储（oauth2_identity_links 表）。
   * 用途：把「当前登录教师」解析成钉钉 userid（findByUserId → providerSub），
   * 以校验其是否为某班班主任（classes.teacherDingtalkId 存的是钉钉 userid）。
   * ⚠ providerSub 是否等于钉钉企业 userid 取决于 oauth2-dingtalk 服务端的 mapUser，
   * 尚未实测确认（该 IdP 仓库不在本机）；故申诉校验对解析失败一律 fail-closed，
   * 并引导教师使用钉钉推送里的免登录令牌链接（不依赖此解析）。
   */
  linkStore: OAuth2LinkStore;
}

export interface BuildAuthOptions {
  /** cookie Secure：https 部署传 true，本地 http dev 传 false（由 adapter.trustProxy 接线） */
  secure: boolean;
  /** 未登录页面请求 302 的目标（SDK 不渲染登录页，指向 SPA 登录路由） */
  loginPath: string;
}

export function buildAuth(handle: DbHandle, cfg: AppConfig, opts: BuildAuthOptions): AuthBundle {
  const secret = cfg.get('sessionSecret');

  // store：drizzle 双方言（sqlite/pg）共用
  const sessionStore = createDrizzleSessionStore(handle.db as never);
  const userStore = createDrizzleUserStore(handle.db as never);
  const passwordStore = createDrizzlePasswordStore(handle.db as never);
  // oauth2_identity_links 表已在首个迁移中建好（双方言），故 store 可直接装配
  const linkStore = createDrizzleOAuth2LinkStore(handle.db as never);

  const sessions = new SessionManager({ secret }, sessionStore);
  const passwordProvider = new PasswordProvider({ userStore, passwordStore });

  const mw = sessionMiddleware(sessions, { bearer: true, secure: opts.secure });

  const authRoutes = createAuthRoutes({
    sessions,
    password: passwordProvider,
    allowRegister: false, // 值周系统：admin 建号，禁自助注册
    secure: opts.secure,
  });

  return { sessions, sessionMiddleware: mw, authRoutes, passwordProvider, userStore, linkStore };
}
