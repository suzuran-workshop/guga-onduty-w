import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { runMigrations } from './db/schema.js';

// Initialize database schema on startup
runMigrations();

const app = createApp();

const port = Number(process.env.PORT) || 3000;

const server = serve({
  fetch: app.fetch,
  port,
});

console.log(`校园值周应用服务端已启动: http://localhost:${port}`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n正在关闭服务...');
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.close((err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    process.exit(0);
  });
});