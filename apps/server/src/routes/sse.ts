import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { authMiddleware, getCurrentUser } from '../middleware/auth.js';
import { EventBus } from '../utils/event-bus.js';

export const sseRoutes = new Hono();

// GET /api/v1/sse/records — real-time record feed
sseRoutes.get('/records', authMiddleware, (c) => {
  const user = getCurrentUser(c);

  return stream(c, async (writer) => {
    // Send initial connection event
    await writer.write(`event: connected\ndata: ${JSON.stringify({ campus_id: user.campus_id })}\n\n`);

    const onRecordCreated = (data: any) => {
      if (data.campus_id === user.campus_id) {
        writer.write(`event: record_created\ndata: ${JSON.stringify(data)}\n\n`).catch(() => {});
      }
    };

    const onRecordRevoked = (data: any) => {
      if (data.campus_id === user.campus_id) {
        writer.write(`event: record_revoked\ndata: ${JSON.stringify(data)}\n\n`).catch(() => {});
      }
    };

    EventBus.on('record_created', onRecordCreated);
    EventBus.on('record_revoked', onRecordRevoked);

    // Heartbeat
    const heartbeat = setInterval(() => {
      writer.write(':heartbeat\n\n').catch(() => {});
    }, 15000);

    // Cleanup on disconnect
    c.req.raw.signal.addEventListener('abort', () => {
      clearInterval(heartbeat);
      EventBus.off('record_created', onRecordCreated);
      EventBus.off('record_revoked', onRecordRevoked);
    });
  });
});

// GET /api/v1/sse/ranking
sseRoutes.get('/ranking', authMiddleware, (c) => {
  const user = getCurrentUser(c);

  return stream(c, async (writer) => {
    await writer.write(`event: connected\ndata: ${JSON.stringify({ campus_id: user.campus_id })}\n\n`);

    // Send ranking update whenever a record changes
    const onRankingUpdate = (data: any) => {
      if (data.campus_id === user.campus_id) {
        writer.write(`event: ranking_update\ndata: ${JSON.stringify(data)}\n\n`).catch(() => {});
      }
    };

    EventBus.on('record_created', onRankingUpdate);
    EventBus.on('record_revoked', onRankingUpdate);

    const heartbeat = setInterval(() => {
      writer.write(':heartbeat\n\n').catch(() => {});
    }, 15000);

    c.req.raw.signal.addEventListener('abort', () => {
      clearInterval(heartbeat);
      EventBus.off('record_created', onRankingUpdate);
      EventBus.off('record_revoked', onRankingUpdate);
    });
  });
});