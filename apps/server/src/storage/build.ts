/**
 * 对象存储装配 —— @homurajs/storage DB 分块后端 + /files 代理路由。
 *
 * 迁移要点（docs §2.6）：
 *  - 旧代码 writeFileSync 落盘 + 无读取端点（图片死数据）→ storage + /files/<key> 代理。
 *  - records.images 存 objectKey（不再存自造相对路径）。
 *
 * 后端选型：createDrizzleFileStore —— 二进制分块 base64 写入 homura_files / homura_file_chunks
 * 两张表，运行时 CREATE TABLE IF NOT EXISTS 自建（sqlite/pg 双方言）。
 *
 * 关于分块上传：强制分块原本是为绕开 qw-pages 网关 body ≥1MB→413 与 PostgREST 单值 ~1MB→500
 * 两道限制。rest/qw-pages 轨已于 2026-10-23 移除（ADR-7），这两道限制在 standalone 下均不成立
 * （app.ts bodyLimit 50MB）。但分块逻辑（routes/files.ts + 前端 chunk-client）在 drizzle 轨照常
 * 工作、且已有完整实现，故本轮**保留**（最小改动、零回归）；是否退回纯 multipart + 恢复
 * ADR-3「图片存文件系统」一致性，列为独立后续决策，不与本次变更混淆。
 */
import type { ChunkedFileStorage } from '@homurajs/storage';
import { createDrizzleFileStore } from '@homurajs/storage/db';
import { createFileProxyRoutes } from '@homurajs/storage/proxy';
import { Hono } from 'hono';
import type { AppConfig } from '../config.js';
import type { DbHandle } from '../db/client.js';
import { requireProfile } from '../middleware/profile.js';
import type { UsersRepo } from '../repos/types.js';

/** 构造 DB 分块存储后端（sqlite/pg 双方言，运行时自建表）。 */
export function buildStorage(cfg: AppConfig, handle: DbHandle, logger?: { info: (m: string, f?: any) => void }): ChunkedFileStorage {
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
