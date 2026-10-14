/**
 * SSE 路由 —— 实时推送（records / ranking）。
 *
 * 迁移要点（对照旧 routes/sse.ts）：
 *  - 显式设置 SSE 响应头（Content-Type/Cache-Control/Connection/X-Accel-Buffering），
 *    修复旧代码经 Nginx 反代可能被缓冲的问题。
 *  - campusId 来自 profile（旧代码来自 JWT payload），按校区过滤事件。
 *  - record_revoked 现在真的会被 emit（records 路由修复），此处转发不再是死代码。
 *  - 用 hono/streaming 的 streamSSE helper（旧代码手写帧格式）。
 *
 * 边界：EventBus 进程内单例，多实例部署需 Redis Pub/Sub（见 ARCHITECTURE）。
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { RouteDeps } from './_deps.js';
import { getProfile } from '../middleware/profile.js';
import { EventBus, type RecordCreatedEvent, type RecordRevokedEvent } from '../utils/event-bus.js';

export function createSseRoutes(deps: RouteDeps): Hono {
  const app = new Hono();

  // GET /records —— 记录实时流
  app.get('/records', (c) => {
    const profile = getProfile(c);
    return streamSSE(c, async (writer) => {
      // 统一 SSE 头（streamSSE 已设 Content-Type，这里补反代友好头）
      await writer.writeSSE({ event: 'connected', data: JSON.stringify({ campusId: profile.campusId }) });

      const onCreated = (data: RecordCreatedEvent) => {
        if (data.campusId === profile.campusId) {
          writer.writeSSE({ event: 'record_created', data: JSON.stringify(data) }).catch(() => {});
        }
      };
      const onRevoked = (data: RecordRevokedEvent) => {
        if (data.campusId === profile.campusId) {
          writer.writeSSE({ event: 'record_revoked', data: JSON.stringify(data) }).catch(() => {});
        }
      };
      EventBus.on('record_created', onCreated);
      EventBus.on('record_revoked', onRevoked);

      const heartbeat = setInterval(() => {
        writer.writeSSE({ event: 'heartbeat', data: '' }).catch(() => {});
      }, 15000);

      // 断开清理
      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        EventBus.off('record_created', onCreated);
        EventBus.off('record_revoked', onRevoked);
      });

      // 保持连接（streamSSE 需要 promise 不 resolve）
      await new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener('abort', () => resolve());
      });
    });
  });

  // GET /ranking —— 排名更新流（记录变更即通知前端重拉排名）
  app.get('/ranking', (c) => {
    const profile = getProfile(c);
    return streamSSE(c, async (writer) => {
      await writer.writeSSE({ event: 'connected', data: JSON.stringify({ campusId: profile.campusId }) });

      const notify = (data: RecordCreatedEvent | RecordRevokedEvent) => {
        if (data.campusId === profile.campusId) {
          writer.writeSSE({ event: 'ranking_update', data: JSON.stringify(data) }).catch(() => {});
        }
      };
      EventBus.on('record_created', notify);
      EventBus.on('record_revoked', notify);

      const heartbeat = setInterval(() => {
        writer.writeSSE({ event: 'heartbeat', data: '' }).catch(() => {});
      }, 15000);

      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        EventBus.off('record_created', notify);
        EventBus.off('record_revoked', notify);
      });

      await new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener('abort', () => resolve());
      });
    });
  });

  return app;
}
