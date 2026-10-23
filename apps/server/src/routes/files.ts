/**
 * 分块上传路由 —— 配合 @homurajs/storage/chunk-client（浏览器逐块 raw PUT）+ DB 分块后端。
 *
 * 历史：强制分块原本是为绕开 qw-pages 边缘网关单请求 body ~1MB 硬上限（实测 ≥1MB openresty 413）。
 * rest/qw-pages 轨已于 2026-10-23 移除（ADR-7），standalone 下 app.ts bodyLimit 为 50MB，
 * 分块不再是必需。但本路由 + 前端 chunk-client 在 drizzle 轨照常工作、实现完整，故保留
 * （最小改动、零回归）；是否退回纯 multipart 见 storage/build.ts 的独立后续决策说明。
 * 服务端把块 base64 落进 homura_files/homura_file_chunks（createDrizzleFileStore 运行时自建）。
 *
 * 协议（与 chunk-client 严格对齐；init/complete 返回**裸协议对象**，不套 {success,data} 信封）：
 *   POST /init    { ns?, fileName, contentType, totalSize, chunkSize? } → { objectKey, url, chunkCount, chunkSize }
 *   PUT  /chunk?key=&index=   body=原始字节(application/octet-stream) → 200
 *   POST /complete{ objectKey } → { ok, status }
 *
 * 安全：三条都在 requireProfile 之后（挂在 /api/v1/* 下）。objectKey 服务端按 profile.campusId
 * 强制生成（records/<campusId>/files/...），chunk/complete 校验 key 校区归属（非 admin 仅限本校区）。
 */
import { Hono } from 'hono';
import { generateObjectKey, proxyUrl } from '@homurajs/storage';
import type { RouteDeps } from './_deps.js';
import { getProfile } from '../middleware/profile.js';
import { ApiError } from '../http/respond.js';
import type { UserProfile } from '@guga-onduty-w/shared';

const IMAGE_NS = 'records';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB/张（与 records.ts 旧 multipart 上限一致）
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const FILE_DOMAINS = ['records'];

/** objectKey 校区归属校验：结构须为 <domain>/<campusId>/files/...，非 admin 仅限本校区。 */
function assertKeyCampus(objectKey: string, profile: UserProfile): void {
  const segs = objectKey.split('/');
  const wellFormed = segs.length >= 3 && FILE_DOMAINS.includes(segs[0]) && segs[2] === 'files';
  if (!wellFormed) throw ApiError.forbidden('非法文件 key');
  if (profile.role !== 'admin' && segs[1] !== profile.campusId) {
    throw ApiError.notFound('文件不存在');
  }
}

export function createFileChunkRoutes(deps: RouteDeps): Hono {
  const { storage } = deps;
  const app = new Hono();

  // POST /init —— 建清单（status=uploading），服务端定 key + 校区
  app.post('/init', async (c) => {
    const profile = getProfile(c);
    const body = await c.req.json<{ ns?: string; fileName?: string; contentType?: string; totalSize?: number; chunkSize?: number }>()
      .catch(() => ({}) as Record<string, unknown>);
    const contentType = String(body.contentType ?? '');
    const totalSize = Number(body.totalSize);
    if (!ALLOWED_MIME.includes(contentType)) {
      throw ApiError.badRequest(`不支持的图片类型：${contentType || '未知'}（仅 jpg/png/gif/webp）`);
    }
    if (!Number.isFinite(totalSize) || totalSize <= 0) throw ApiError.badRequest('totalSize 非法');
    if (totalSize > MAX_IMAGE_BYTES) throw ApiError.badRequest(`图片超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 上限`);

    const ns = `${IMAGE_NS}/${profile.campusId}`;
    const fileName = String(body.fileName || 'image.jpg').replace(/[/\\]/g, '_');
    const objectKey = generateObjectKey(ns, fileName, Date.now());
    const r = await storage.initUpload({
      objectKey,
      contentType,
      totalSize,
      chunkSize: body.chunkSize ? Number(body.chunkSize) : undefined,
    });
    // 裸协议对象：chunk-client 直接读 init.objectKey / init.chunkCount / init.url
    return c.json({ objectKey, url: proxyUrl(objectKey), chunkCount: r.chunkCount, chunkSize: r.chunkSize });
  });

  // PUT /chunk?key=&index= —— 写单块（幂等 upsert，可重试）
  app.put('/chunk', async (c) => {
    const profile = getProfile(c);
    const key = c.req.query('key');
    const indexRaw = c.req.query('index');
    if (!key) throw ApiError.badRequest('缺少 key');
    const index = Number(indexRaw);
    if (!Number.isInteger(index) || index < 0) throw ApiError.badRequest('index 非法');
    assertKeyCampus(key, profile);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    await storage.putChunk(key, index, bytes);
    return c.body(null, 200);
  });

  // POST /complete { objectKey } —— 校验块齐 → status=complete
  app.post('/complete', async (c) => {
    const profile = getProfile(c);
    const body = await c.req.json<{ objectKey?: string }>().catch(() => ({}) as { objectKey?: string });
    const objectKey = String(body.objectKey ?? '');
    if (!objectKey) throw ApiError.badRequest('缺少 objectKey');
    assertKeyCampus(objectKey, profile);
    const m = await storage.completeUpload(objectKey);
    return c.json({ ok: true, status: m.status });
  });

  return app;
}
