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
│  │ drizzle/（sqlite + pg 共用同一份源码，方言无感）      │       │
│  └───────────────────────┬─────────────────────────────┘       │
│                          ▼                                      │
│  ┌──────── @homurajs/db · 双方言 ─────────────────────┐       │
│  │ sqlite(node:sqlite)      │      pg(postgres-js)             │
│  │ schema parity 门禁；迁移由 drizzle-kit 生成            │    │
│  └───────────────────────┬─────────────────────────────┘       │
│                          ▼                                      │
│  18 表（值周13 + auth5）· apps/server/data/app.db              │
│  @homurajs/storage DB 分块后端 · /files/<key> 代理（图片）     │
└──────────────────────────────────────────────────────────────┘
```

## 分层架构（关键设计）

| 层 | 职责 | 约束 |
|----|------|------|
| **路由** routes/ | HTTP 契约、RBAC、多校区隔离、输入校验 | 不碰 SQL/drizzle；只调 repos |
| **repo** repos/ | db 无关的领域接口；drizzle(sqlite/pg) 单一实现（表对象按方言注入，源码方言无感） | 只取行/写行；事务边界在此 |
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

## 双方言数据（sqlite / pg）

| 方言 | 形态 | 数据路径 | repo 实现 |
|------|------|---------|----------|
| sqlite | standalone 单机（默认） | node:sqlite，`data/app.db` | drizzle/ |
| pg | standalone + 自建/自托管 PostgreSQL | postgres-js | drizzle/（同一份源码） |

- schema 双方言：pg.ts + sqlite.ts 手写；`assertSchemaParity` 启动期硬门禁（表名/列名/主键一致）
- 迁移：`pnpm db:generate`（drizzle-kit 双方言），**绝不手写 DDL**
- 单入口：`index.ts`（createNodeAdapter，runtime 固定 standalone）
- 历史第三轨 `rest`（PostgREST / qw-pages 托管形态）已于 2026-10-23 移除，见 DECISIONS.md ADR-7

## 存储与实时

- **图片**：`@homurajs/storage` DB 分块后端（`createDrizzleFileStore`，运行时自建 homura_files/chunks 表）
  → `storage.uploadFile(ns, name, bytes, mime)` → objectKey；读取走 `/files/<key>` 代理路由
  （命名空间校区限定 + 鉴权中间件）；MIME 白名单 + 大小/数量校验。分块上传历史为绕 qw-pages 网关上限，
  该形态移除后仍保留（照常工作，见 ADR-7）
- **SSE**：类型化 EventBus（进程内 EventEmitter），事件 `record_created`/`record_revoked`；
  前端 EventSource 同源带 cookie；大屏/看板实时刷新 + 60s 兜底轮询

## 重要技术边界

- **drizzle-orm@1.0.0-rc.4** 是 rc 版，API 可能变动；已锁版本 + spike 验证核心路径
- node:sqlite 同步 API，适合校内并发；多实例部署 SSE 需改 Redis Pub/Sub
- **@homurajs 包 26.10.19**；storage 的 ./db、./tables 子路径自该版本起已随包发布（此前 26.10.15 曾漏发）
- 无 Docker/k8s 部署配置（原型阶段）

## 测试策略（107 tests）

| 套件 | 覆盖 |
|------|------|
| `records-appeals` | 记录 + 申诉工作流 E2E（真实 HTTP+cookie） |
| `statistics-awards` | 统计排名 + 流动红旗 E2E |
| `crud-config` | 配置实体（校区/年级/班级/小组/标签/模板）CRUD |
| `auth-rbac` | 登录 + RBAC + 多校区隔离 |
| `wk-review` | 对抗性审查回归（同角色跨主体越权、复核已修缺陷） |
| `ensure-env` | 冷启动配置自愈（幂等、真实 env 优先、secret 生成） |

E2E 台架 `tests/helpers/harness.ts`：起真实 HTTP 服务（ephemeral 端口+临时 sqlite+cookie jar），
非 mock，测完整中间件链（sessionMiddleware→requireProfile→路由→repo→db）。
