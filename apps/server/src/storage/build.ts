/**
 * 对象存储装配 —— @homurajs/storage DB 分块后端 + /files 代理路由。
 *
 * 迁移要点（docs §2.6）：
 *  - 旧代码 writeFileSync 落盘 + 无读取端点（图片死数据）→ storage + /files/<key> 代理。
 *  - records.images 存 objectKey（不再存自造相对路径）。
 *
 * 后端选型（26.10.19 起 ./db 子路径已随包发布，此前 26.10.15 漏发）：
 *  - rest 轨（qw-pages）：createRestFileStore —— 二进制分块 base64 写入 homura_files / homura_file_chunks
 *    两张 PostgREST 表 → 持久化，不随冷启动/重发布丢失（local-fs 在只读应用根不可用）。
 *    表由部署期受控迁移预建（createRestFileStore 无 DDL 权限、不建表）。
 *  - drizzle 轨（standalone sqlite/pg）：createDrizzleFileStore —— 同一分块模型，运行时 CREATE TABLE
 *    IF NOT EXISTS 自建，使 dev 与线上共用同一条「分块上传 / 流式下载」代码路径。
 *  - 强制分块绕开两道平台限制：网关单请求 body ≥1MB→413、PostgREST 单值 ~1MB→500。
 *    前端配套 @homurajs/storage/chunk-client 逐块 raw PUT，见 routes/files.ts。
 */
import type { ChunkedFileStorage } from '@homurajs/storage';
import { createRestFileStore, createDrizzleFileStore } from '@homurajs/storage/db';
import { createFileProxyRoutes } from '@homurajs/storage/proxy';
import { Hono } from 'hono';
import type { AppConfig } from '../config.js';
import type { DbHandle } from '../db/client.js';
import { requireProfile } from '../middleware/profile.js';
import type { UsersRepo } from '../repos/types.js';

/** 构造 DB 分块存储后端（两轨统一 ChunkedFileStorage）。 */
export function buildStorage(cfg: AppConfig, handle: DbHandle, logger?: { info: (m: string, f?: any) => void }): ChunkedFileStorage {
  if (handle.kind === 'rest') {
    logger?.info('storage: rest 轨使用 DB 分块后端（createRestFileStore，表须受控迁移预建）');
    return createRestFileStore(handle.rest);
  }
  logger?.info('storage: drizzle 轨使用 DB 分块后端（createDrizzleFileStore，运行时自建表）');
  return createDrizzleFileStore(handle.db as any);
}

/**
 * /files/<key> 代理下载路由 + 校区鉴权（REVIEW #5：修复跨校区图片泄漏）。
 *
 * objectKey 格式：`<domain>/<campusId>/files/<ts>_<name>`（上传时命名空间已校区限定）。
 * 鉴权中间件按 key 的 campusId 段做 O(1) 隔离（无需查库）：
 *  - 未认证 → 401。
 *  - 非 admin 且 key 校区 ≠ 本人校区 → 404（不泄露跨校区文件存在性）。
 *  - 结构不符（遗留/伪造 key）→ 仅 admin 放行，其余 fail-closed 404。
 */
const FILE_DOMAINS = ['records'];

export function buildFileRoutes(storage: ChunkedFileStorage, usersRepo: UsersRepo): Hono {
  const app = new Hono();
  // /files/* 不在 /api/v1/* 下，故本子应用自带 requireProfile 设 c.profile（否则下方鉴权恒 401）。
  app.use('/files/*', requireProfile(usersRepo));
  app.use('/files/*', async (c, next) => {
    const profile = c.get('profile') as import('@guga-onduty-w/shared').UserProfile | undefined;
    if (!profile) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: '未认证' } }, 401);
    }
    const pathname = new URL(c.req.url).pathname;
    const objectKey = decodeURIComponent(pathname.replace(/^\/files\//, ''));
    const segs = objectKey.split('/');
    // 期望 [<domain>, <campusId>, 'files', ...]
    const wellFormed = segs.length >= 3 && FILE_DOMAINS.includes(segs[0]) && segs[2] === 'files';
    if (!wellFormed) {
      if (profile.role !== 'admin') {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: '文件不存在' } }, 404);
      }
      return next();
    }
    const fileCampusId = segs[1];
    if (profile.role !== 'admin' && fileCampusId !== profile.campusId) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: '文件不存在' } }, 404);
    }
    return next();
  });
  app.route('/', createFileProxyRoutes(storage));
  return app;
}
