/**
 * SPA 深链可达性 —— 免登录申诉页能不能被「点开」。
 *
 * 为什么单独一个文件：需求 4 的整条链路依赖教师**从钉钉直接点链接**打开
 * `/appeal/<token>`。这是深链，服务端必须回 index.html 让 React Router 接管；
 * 若 SPA fallback 把它当未知路径 404 掉，教师看到的就是服务器错误页——
 * 后端接口再完备也是死的（她根本没机会看到表单）。
 *
 * 而 app-kit 的 SPA fallback **只在提供 staticDir 时挂载**，tests/helpers/harness.ts
 * 与 scripts/smoke-e2e.ts 历来都传 `undefined`（纯 API 模式），故这条路径此前**零覆盖**。
 * 本文件用 staticDir 起服务，把「生产同源部署」的形态纳入测试。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, seedStandard, type Harness } from './helpers/harness.js';

let h: Harness;
let staticDir: string;

beforeAll(async () => {
  // 最小可托管前端：只需 index.html 存在（fallback 用 existsSync 判定），
  // 内容无关紧要——我们测的是「服务端回不回 HTML」，不是前端渲染。
  staticDir = mkdtempSync(join(tmpdir(), 'guga-spa-'));
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>SPA</title><div id="root"></div>');
  h = await boot('spa-deeplink', { staticDir });
  await seedStandard(h);
});

afterAll(async () => {
  await h.shutdown();
  rmSync(staticDir, { recursive: true, force: true });
});

describe('SPA fallback 深链可达', () => {
  it('GET /appeal/<token> → index.html（教师点钉钉链接不会吃 404）', async () => {
    const anon = h.client();
    const r = await anon.req('GET', '/appeal/some-opaque-token-value');
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toContain('text/html');
    const html = await r.text();
    expect(html).toContain('id="root"'); // 确实是我们的 index.html，不是错误页
    // 不得缓存：令牌链接每次都应拿到最新页面
    expect(r.res.headers.get('cache-control')).toBe('no-cache');
  });

  it('任意深度的前端路由都回 index.html（/records、/statistics/…）', async () => {
    const anon = h.client();
    for (const path of ['/records', '/appeals', '/bigscreen', '/login']) {
      const r = await anon.req('GET', path);
      expect(r.status, `${path} 应回 index.html`).toBe(200);
      expect(r.res.headers.get('content-type')).toContain('text/html');
    }
  });

  it('保留前缀不吃 fallback：/api 未知路径回 JSON 错误而非 HTML', async () => {
    // 无会话：requireProfile 先于路由匹配拦下 → 401（不是 404，因为守卫在 notFound 之前跑）。
    // 关键点是**不回 HTML**——若 fallback 把 /api 当页面请求，教师端会拿到一个看似正常却空白的页面。
    const anon = h.client();
    const r1 = await anon.req('GET', '/api/v1/definitely-not-a-route');
    expect(r1.status).toBe(401);
    expect(r1.res.headers.get('content-type')).toContain('application/json');

    // 有会话：过了守卫，路由确实不存在 → 404 JSON（同样不回 HTML）
    const admin = await h.loginAs('admin');
    const r2 = await admin.req('GET', '/api/v1/definitely-not-a-route');
    expect(r2.status).toBe(404);
    expect(r2.res.headers.get('content-type')).toContain('application/json');
  });

  it('公开申诉 API 与页面路径互不干扰：/api/public/appeal/<token> 回 JSON', async () => {
    const anon = h.client();
    // 同一 token 形状：页面路径回 HTML，API 路径回 JSON（两者都在 /appeal 下但前缀不同）
    const r = await anon.req('GET', '/api/public/appeal/some-opaque-token-value');
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toContain('application/json');
    expect(r.json.data.tokenState).toBe('not_found'); // 令牌不存在，但走的是 API 契约
  });

  it('非 GET 的未知页面路径 → 404（fallback 只服务页面请求）', async () => {
    const anon = h.client();
    const r = await anon.req('POST', '/appeal/whatever', { body: {} });
    expect(r.status).toBe(404);
  });
});
