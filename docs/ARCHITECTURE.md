# ARCHITECTURE — 校园值班·值周管理平台

> 统一巡查职责平台（`docs/DUTY-FUSION.md`）：教师执勤值班（粗粒度巡查）+ 值周生班级打分（细粒度巡查），
> 共享「排班 → 履职 → 监督 → 变更」四层结构。底层为 @homurajs(app-kit) 五模块。

## 系统概述

```
┌──────────────────────────────────────────────────────────────┐
│                        Browser / Device                        │
│  ┌────────────────────────────┐  ┌──────────────────────────┐ │
│  │  React 19 SPA (Vite 8,5173) │  │  Digital Big Screen       │ │
│  │  shadcn/ui (TW3) + router7  │  │  /bigscreen（值周+值班融合）│ │
│  └──────────────┬─────────────┘  └───────────┬──────────────┘ │
│                 │ HTTP(cookie) + SSE           │ HTTP + SSE      │
└─────────────────┼──────────────────────────────┼───────────────┘
                  ▼                              ▼
┌──────────────────────────────────────────────────────────────┐
│        @homurajs/app-kit · createApp 中间件链 (:3000)          │
│  basePath→requestId+日志→healthz→[licenseGuard]               │
│  →sessionMiddleware(SDK)→authRoutes(SDK /auth/*)              │
│  →[businessRoutes: requireProfile→/api/v1/*(值周15+duty)→/files]│
│  →static(dist/client)→SPA fallback→onError(统一JSON,不泄栈)   │
│                                                                 │
│  ┌───────────────── 路由层 (routes/) ──────────────────┐       │
│  │ 值周域：records/statistics/appeals/awards/templates… │       │
│  │ 值班域：duty.ts（矩阵/打卡/巡查/调班/导入/配置/报表） │       │
│  └───────────────────────┬─────────────────────────────┘       │
│                          ▼                                      │
│  ┌──────────── service 层（duty/service.ts）───────────┐       │
│  │ 引擎(D2 纯函数) + repo(D3) 组合：实时计算矩阵/任务/统计│      │
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
│  25 表（值周13 + 值班7 + auth5）· apps/server/data/app.db      │
│  @homurajs/storage local-fs · /files/<key> 代理（图片）        │
└──────────────────────────────────────────────────────────────┘
```

## 分层架构（关键设计）

| 层 | 职责 | 约束 |
|----|------|------|
| **路由** routes/ | HTTP 契约、RBAC、多校区隔离、输入校验 | 不碰 SQL/drizzle；只调 repos/service |
| **service** duty/service.ts | 组合引擎+repo 产出业务能力（矩阵/今日任务/到岗率） | 「状态不持久化、实时计算」哲学的落点 |
| **引擎** duty/*.ts | 纯函数（展开/叠加/打卡索引/矩阵/日期/Excel解析） | 无 I/O，可单测（34 项引擎单测） |
| **repo** repos/ | db 无关的领域接口；drizzle(sqlite/pg) + rest(qw-pages) 双实现 | 只取行/写行，不算业务；事务边界在此 |
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
  userProfiles { userId PK/FK, campusId, displayName, role, groupId, canInspect }  ← 「你能做什么」
```

- 登录：`POST /auth/password/login`（SDK）→ scrypt 校验 → 下发 HttpOnly access(JWT)+refresh cookie
- `sessionMiddleware`（SDK）校验 cookie/Bearer → `c.set('auth', {sub})`
- `requireProfile`（本项目）读 sub → 查 userProfiles → `c.set('profile', {role, campusId, canInspect})`
- `requireRole(...roles)` RBAC；角色变更**即时生效**（profile 每请求查库，非缓存进 token）

## 值班域核心：纯函数引擎（D2）

「排班模板 + 调班叠加 = 最终值班表」，视图态**不持久化**，查询时实时计算：

```
listForExpand(周期模板)
  → expandSchedules(weekday+日期区间+单双周[校区级 parityAnchor]) → DutyInstance[]
  → buildSwapOverlay(已批准调班) + applySwapOverlay(按 scheduleId+具体日期命中)
      · 代理：申请人那天→被申请人；交换：双向对调；后者覆盖前者；不回改原模板
  → buildScheduleDoneChecker(打卡，精确到 scheduleId+date+teacherId，会签不串台)
  → buildMatrix(地点×周7天，pill 三态 swapped/done/pending) / getAttendance(到岗率)
```

- **融合点**：`dutySchedules.kind` = `teaching`(教师执勤) | `dutyWeek`(值周生巡查)，两域同表同引擎同矩阵
- **单双周锚点**：校区级 `settings.semester_start`（消除各排班 dateStart 不一致的错位，REVIEW #4）

## 数据流

```
值周生 → POST /api/v1/records (multipart: class_id, tag_id, score, comment, images[])
       → storage.uploadFile(图片→objectKey) → 事务 INSERT records+record_logs
       → EventBus.emit('record_created') → SSE → 大屏/看板实时刷新

教师   → POST /api/v1/duty/checkins (multipart: schedule_id, duty_date, photos[]必填)
       → resolveDutyGuard(展开+叠加→校验本人是实际值班人) → 事务 INSERT duty_checkins(UNIQUE防重)

教师   → POST /api/v1/duty/swaps (发起调班) → status=pending
       → admin POST /swaps/:id/review → approved → 叠加层实时改变矩阵（原排班不动）

领导   → POST /api/v1/duty/inspections (逐记录展开 items，防笛卡尔积) → INSERT duty_inspections

班主任 → POST /records/:id/appeal → 事务: records.status=appealing + INSERT appeals + log
       → admin approve/reject → 事务: records.status ↔ appeals.status 联动
```

## 三轨数据方言（部署弹性）

| 方言 | 形态 | 数据路径 | repo 实现 |
|------|------|---------|----------|
| sqlite | standalone 单机（默认） | node:sqlite，`data/app.db` | drizzle/（完成） |
| pg | standalone + 自建/自托管 supabase | postgres-js | drizzle/（同一份源码） |
| rest | qw-pages 动态页 | PostgREST over HTTPS | rest/（P4，无 join/事务，JS 侧补偿） |

- schema 三轨：pg.ts + sqlite.ts 手写、`restSchemaFromPg` 派生；`assertSchemaParity` 启动期硬门禁
- 迁移：`pnpm db:generate`（drizzle-kit 双方言），**绝不手写 DDL**（列名 camelCase 由 schema 决定）
- 双入口：`index.ts`（createNodeAdapter）/ `qw-pages.ts`（createQwPagesAdapter），差异全走 adapter

## 存储与实时

- **图片**：`@homurajs/storage` local-fs 后端 → `storage.uploadFile(ns, name, bytes, mime)` → objectKey；
  读取走 `/files/<key>` 代理路由（修复旧代码图片写盘无读取端点的死数据 bug）；MIME 白名单 + 大小/数量校验
- **SSE**：类型化 EventBus（进程内 EventEmitter），事件 `record_created`/`record_revoked`；
  前端 EventSource 同源带 cookie；大屏/看板实时刷新 + 60s 兜底轮询

## 重要技术边界

- **drizzle-orm@1.0.0-rc.4** 是 rc 版，API 可能变动；已锁版本 + spike 验证核心路径
- **rest 轨**无法本地端到端验证（需 qw-pages 或自建 supabase）；用 `tests/helpers/mock-rest.ts`
  忠实模拟 PostgREST 契约做契约测试；rest repo 为 P4 规划项
- node:sqlite 同步 API，适合校内并发；多实例部署 SSE 需改 Redis Pub/Sub
- **@homurajs 包 45 分钟前发布**（26.10.15）；storage 的 ./db、./tables、./chunk-client 子路径
  在该版本发布缺失（发包 bug），故 db 后端不可用，local-fs 后端不受影响
- 无 Docker/k8s 部署配置（原型阶段）

## 测试策略（176 tests）

| 套件 | 覆盖 |
|------|------|
| `records-appeals` / `statistics-awards` / `crud-config` / `auth-rbac` | 值周域 E2E（71，真实 HTTP+cookie） |
| `duty-engine` | 值班纯函数引擎单测（34，展开/叠加/打卡/矩阵/单双周锚点） |
| `duty-repo` | 值班 repo（16，经 createRepos 装配） |
| `duty-http` | 值班域 E2E（25，矩阵/打卡/巡查/调班/报表/导入全链路） |
| `duty-import` | Excel 导入（10，SheetJS 自主解析） |
| `duty-review` | 对抗性审查回归（20，同角色跨主体越权——现有测试盲区） |

E2E 台架 `tests/helpers/harness.ts`：起真实 HTTP 服务（ephemeral 端口+临时 sqlite+cookie jar），
非 mock，测完整中间件链（sessionMiddleware→requireProfile→路由→repo→db）。
