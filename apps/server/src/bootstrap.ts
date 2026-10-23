/**
 * 启动装配 —— 把 config/db/auth/repos/storage/app 串成完整应用。
 *
 * 顺序（docs §2.5）：
 *   loadConfig → logger → openDatabase(按方言) → migrate(建表) →
 *   buildAuth(SessionManager+PasswordProvider+SDK路由) → createRepos(注入 auth 依赖) →
 *   buildStorage(DB 分块后端) → buildApp(app-kit createApp)
 *
 * secure 由 adapter.trustProxy() 接线（standalone 由 TRUST_PROXY=1 开启）。
 */
import type { HomuraApp } from '@homurajs/app-kit';
import type { Logger } from '@homurajs/core';
import { loadConfig, createAppLogger, type AppConfig } from './config.js';
import { openDatabase, migrate, closeDatabase, type DbHandle } from './db/client.js';
import { buildAuth, type AuthBundle } from './auth/build.js';
import { createRepos } from './repos/index.js';
import type { Repos } from './repos/types.js';
import { buildStorage } from './storage/build.js';
import type { ChunkedFileStorage } from '@homurajs/storage';
import { buildApp } from './app.js';
import { buildPlatform, type PlatformBundle } from './platform/build.js';
import { createNotifyService, type NotifyService } from './services/notify.js';

export interface Bootstrapped {
  cfg: AppConfig;
  logger: Logger;
  handle: DbHandle;
  auth: AuthBundle;
  repos: Repos;
  storage: ChunkedFileStorage;
  /** 钉钉平台（凭证未配则 platform=null，推送降级为 pending） */
  platform: PlatformBundle;
  /** 通知服务（推送/周报/补发） */
  notify: NotifyService;
  homura: HomuraApp;
  /** 优雅关闭（停定时器 + 退订事件 + 关 db 连接） */
  shutdown(): void;
}

export interface BootstrapOptions {
  /** cookie Secure（adapter.trustProxy()） */
  secure: boolean;
  /** 前端静态资源目录（adapter.assetsDir(process.env)） */
  staticDir?: string;
  /** 未登录页面请求 302 目标（SPA 登录路由） */
  loginPath?: string;
}

export async function bootstrap(opts: BootstrapOptions): Promise<Bootstrapped> {
  const cfg = loadConfig();
  const logger = createAppLogger(cfg);

  const handle = await openDatabase(cfg);
  await migrate(handle);
  logger.info('database ready', { dialect: handle.dialect });

  const auth = buildAuth(handle, cfg, { secure: opts.secure, loginPath: opts.loginPath ?? '/login' });
  const repos = createRepos(handle, {
    passwordProvider: auth.passwordProvider,
    userStore: auth.userStore,
  });

  const storage = buildStorage(cfg, handle, logger);

  // 钉钉平台（凭证未配 → platform=null，通知服务据此降级为 pending，不阻塞启动）
  const platform = buildPlatform(cfg, logger);
  const notify = createNotifyService({ cfg, repos, platform, logger });
  // 订阅 EventBus（记录创建 → 推送）+ 启动周报定时器；两者的清理函数在 shutdown 里调用
  const unsubscribe = notify.subscribe();
  const stopScheduler = notify.startScheduler();

  const homura = buildApp({
    cfg,
    handle,
    auth,
    repos,
    storage,
    platform,
    notify,
    logger,
    staticDir: opts.staticDir,
    secure: opts.secure,
  });

  return {
    cfg,
    logger,
    handle,
    auth,
    repos,
    storage,
    platform,
    notify,
    homura,
    shutdown: () => {
      unsubscribe();
      stopScheduler();
      closeDatabase(handle);
    },
  };
}
