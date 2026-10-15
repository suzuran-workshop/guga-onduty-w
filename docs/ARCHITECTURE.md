# ARCHITECTURE — 校园值周管理平台

> 值周生班级打分（细粒度巡查）——记录 → 统计排名 → 申诉 → 流动红旗 → 数字大屏。
> 底层为 @homurajs(app-kit) 五模块。
>
> 本仓库由「值班 / 值周二合一」仓库拆分而来（见 `DECISIONS.md` ADR-6），只承载**值周域**；
> 值班域（教师执勤巡查）已迁至 `guga-onduty` 仓库。

## 系统概述

```
┌──────────────────────────────────────────────────────────────┐
│                        Browser / Device                        │
│  ┌────────────────────────────┐  ┌──────────────────────────┐ │
│  │  React 19 SPA (Vite, 5173)  │  │  Digital Big Screen       │ │
│  │  shadcn/ui (TW) + router7   │  │  /bigscreen（值周）        │ │
│  └──────────────┬─────────────┘  └───────────┬──────────────┘ │
│                 │ HTTP(cookie) + SSE           │ HTTP + SSE      │
└─────────────────┼──────────────────────────────┼───────────────┘
                  ▼                              ▼
┌──────────────────────────────────────────────────────────────┐
│        @homurajs/app-kit · createApp 中间件链 (:3000)          │
│  basePath→requestId+日志→healthz                              │
│  →sessionMiddleware(SDK)→authRoutes(SDK /auth/*)              │
│  →[businessRoutes: requireProfile→/api/v1/*→/files]           │
│  →static(dist/client)→SPA fallback→onError(统一JSON,不泄栈)   │
│                                                                 │
│  ┌───────────────── 路由层 (routes/) ──────────────────┐       │
│  │ records/statistics/appeals/awards/summary/templates… │       │
│  │ campuses/grades/classes/users/groups/tags/settings/sse│      │
│  └───────────────────────┬─────────────────────────────┘       │
│                          ▼                                      │
│  ┌──────────── repos 层（repository 模式）─────────────┐       │
│  │ drizzle/（sqlite+pg 共用源码）  │  rest/（P4，qw-pages）│    │
│  └───────────────────────┬─────────────────────────────┘       │
│                          ▼                                      │
│  ┌──────── @homurajs/db · 三轨方言 ────────────────────┐       │
│  │ sqlite(node:sqlite) │ pg(postgres-js) │ rest(PostgREST)│    │
│  │ schema parity 门禁；迁移由 drizzle-kit 生成            │    │
│  └───────────────────────┬─────────────────────────────┘       │
│                          ▼                                      │
│  18 表（值周13 + auth5）· apps/server/data/app.db              │
│  @homurajs/storage local-fs · /files/<key> 代理（图片）        │
└──────────────────────────────────────────────────────────────┘
```

## 分层架构（关键设计）

| 层 | 职责 | 约束 |
|----|------|------|
| **路由** routes/ | HTTP 契约、RBAC、多校区隔离、输入校验 | 不碰 SQL/drizzle；只调 repos |
| **repo** repos/ | db 无关的领域接口；drizzle(sqlite/pg) + rest(qw-pages) 双实现 | 只取行/写行；事务边界在此 |
| **schema** schema/ | pg/sqlite 双方言手写 + rest 派生 | parity 门禁；camelCase 列名；uuid PK；无 references |

## 身份模型（auth SDK + 业务档案分离）

```
auth SDK（@homurajs/auth）           业务档案（本项目）
  users       { id uuid PK, username, nickname, avatarUrl }   ← 身份锚点「你是谁」
  passwords   { userId PK, passwordHash(scrypt) }
  refresh_tokens { tokenHash PK, familyId, sid, sub, … }       ← session rotate
  oauth2_identity_links / webauthn_credentials（未用，表结构纳入）
                          │
                          │ sub = users.id (uuid)
                          ▼
  userProfiles { userId PK/FK, campusId, displayName, role, groupId }  ← 「你能做什么」
```

- 登录：`POST /auth/password/login`（SDK）→ scrypt 校验 → 下发 HttpOnly access(JWT)+refresh cookie
- `sessionMiddleware`（SDK）校验 cookie/Bearer → `c.set('auth', {sub})`
- `requireProfile`（本项目）读 sub → 查 userProfiles → `c.set('profile', {role, campusId})`
- `requireRole(...roles)` RBAC；角色变更**即时生效**（profile 每请求查库，非缓存进 token）

## 数据模型（18 表 = 值周 13 + auth 5）

- **配置**：`campuses`（校区）/ `grades`（年级）/ `classes`（班级）/ `groups`（值周小组）/ `tags`（评价标签）/ `templates`（打分模板）/ `settings`（key-value）
- **履职**：`records`（值周记录，核心）+ `recordLogs`（操作日志）
- **监督**：`appeals`（申诉）
- **激励/展示**：`dailySummaries`（每日小结）/ `awards`（流动红旗）
- **身份**：`userProfiles`（业务档案）+ auth 5 表

## 数据流

```
值周生 → POST /api/v1/records (multipart: class_id, tag_id, score, comment, images[])
       → storage.uploadFile(图片→objectKey) → 事务 INSERT records+record_logs
       → EventBus.emit('record_created') → SSE → 大屏/看板实时刷新

班主任 → POST /records/:id/appeal → 事务: records.status=appealing + INSERT appeals + log
       → admin approve/reject → 事务: records.status ↔ appeals.status 联动（approve 不计分）

管理   → 统计排名 /statistics/*（ranking/trend/dashboard）→ 大屏 /bigscreen
       → 流动红旗 /awards（每年级第一名，幂等）/ 每日小结 /summaries
```

## 三轨数据方言（部署弹性）

| 方言 | 形态 | 数据路径 | repo 实现 |
|------|------|---------|----------|
| sqlite | standalone 单机（默认） | node:sqlite，`data/app.db` | drizzle/（完成） |
| pg | standalone + 自建/自托管 supabase | postgres-js | drizzle/（同一份源码） |
| rest | qw-pages 动态页 | PostgREST over HTTPS | rest/（P4，无 join/事务，JS 侧补偿） |

- schema 三轨：pg.ts + sqlite.ts 手写、`restSchemaFromPg` 派生；`assertSchemaParity` 启动期硬门禁
- 迁移：`pnpm db:generate`（drizzle-kit 双方言），**绝不手写 DDL**
- 双入口：`index.ts`（createNodeAdapter）/ `qw-pages.ts`（createQwPagesAdapter），差异全走 adapter

## 存储与实时

- **图片**：`@homurajs/storage` local-fs 后端 → `storage.uploadFile(ns, name, bytes, mime)` → objectKey；
  读取走 `/files/<key>` 代理路由（命名空间校区限定 + 鉴权中间件）；MIME 白名单 + 大小/数量校验
- **SSE**：类型化 EventBus（进程内 EventEmitter），事件 `record_created`/`record_revoked`；
  前端 EventSource 同源带 cookie；大屏/看板实时刷新 + 60s 兜底轮询

## 重要技术边界

- **drizzle-orm@1.0.0-rc.4** 是 rc 版，API 可能变动；已锁版本 + spike 验证核心路径
- **rest 轨**无法本地端到端验证（需 qw-pages 或自建 supabase）；用 `tests/helpers/mock-rest.ts`
  忠实模拟 PostgREST 契约做契约测试；rest repo 为 P4 规划项
- node:sqlite 同步 API，适合校内并发；多实例部署 SSE 需改 Redis Pub/Sub
- **@homurajs 包 26.10.15**；storage 的 ./db、./tables 子路径在该版本发布缺失（发包 bug），
  故 db 后端不可用，local-fs 后端不受影响
- 无 Docker/k8s 部署配置（原型阶段）

## 测试策略（99 tests）

| 套件 | 覆盖 |
|------|------|
| `records-appeals` | 记录 + 申诉工作流 E2E（真实 HTTP+cookie） |
| `statistics-awards` | 统计排名 + 流动红旗 E2E |
| `crud-config` | 配置实体（校区/年级/班级/小组/标签/模板）CRUD |
| `auth-rbac` | 登录 + RBAC + 多校区隔离 |
| `wk-review` | 对抗性审查回归（同角色跨主体越权、复核已修缺陷） |

E2E 台架 `tests/helpers/harness.ts`：起真实 HTTP 服务（ephemeral 端口+临时 sqlite+cookie jar），
非 mock，测完整中间件链（sessionMiddleware→requireProfile→路由→repo→db）。
