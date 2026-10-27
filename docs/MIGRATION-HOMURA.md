# MIGRATION — 底层替换为 @homurajs/app-kit + 前端 Vite8/React19/shadcn-ui

> ⚠️ **时效性声明（2026-10-23）**：本文档是**历史迁移记录**，记载从旧底层替换为 @homurajs 家族
> 当时的决策与过程，具档案价值，故正文中关于**三轨数据方言（sqlite/pg/rest）、rest 轨（PostgREST）、
> qw-pages 双形态部署、restSchemaFromPg 派生、local-fs storage** 等叙述**保留原样、不代表当前架构**。
> rest 轨与 qw-pages 形态**已于 2026-10-23 移除**，收敛为 sqlite/pg 双方言、standalone 单形态
> （见 `DECISIONS.md` **ADR-7**）。**当前架构以 `ARCHITECTURE.md` 为准。**
>
> ⚠️ **追加（2026-10-27）**：本文档中的 schema 叙述同样**已过时**——`records.tagId`(int 单值) 已改为
> `tagIds`(JSON 数组) 且 score 由服务端按标签求和；`RECORD_STATUSES` 的 `appeal_approved` **已移除**
> （申诉成立改为「调分后回 active」，故下文「✅ `appeal_approved` 记录不计分」记载的是当时结论，
> 该状态如今不存在）；所有 id 均为 uuid（下文表格中的 `(int)` 标注是迁移当时的旧形态）。
> 另新增钉钉域 3 表（dingtalkContacts / notificationLogs / appealTokens），业务表 13→16、含 auth 共 21 表。
> 见 `DECISIONS.md` **ADR-8**。
>
> 状态：已完成 · 起始快照 `snapshot/pre-homura-baseline`(ad886f3)
> 目标：用 `@homurajs/*` 家族替换应用底层（core/db/auth/storage/app-kit 五模块尽用），
> 前端 UI/UX 迁移到 Vite 8 + React 19 + shadcn/ui (Tailwind CSS 3)。
> 数据方言：迁移当时为**三轨全写**（sqlite / pg / rest）；**现收敛为双方言**（sqlite / pg，见 ADR-7）。

---

## 0. Spike 验证结论（已完成，风险清零）

在动项目代码前，用两个隔离 spike 证伪了地基风险：

| 地基 | 验证内容 | 结论 |
|------|---------|------|
| 后端 | drizzle-orm@1.0.0-rc.4 + @homurajs/db + `assertSchemaParity` 门禁 + `restSchemaFromPg` 派生 + `createDb(sqlite)` 真实 CRUD + `drizzle-kit generate` 双方言迁移 | ✅ 全通 |
| 前端 | Vite 8.3.4 + React 19.3 + Tailwind 3.4.19 + shadcn/ui button(cva+radix-slot) `tsc` typecheck + `vite build` | ✅ 全通 |

**两条必须遵守的硬约束（spike 抓到的坑）**：

1. **迁移 SQL 必须用 `drizzle-kit generate` 从 schema 生成，绝不手写 DDL。**
   homura `pgCol`/`sqliteCol` 不传列名时，**SQL 列名 = JS 属性名（camelCase）**，
   如 `campusId`/`classId`/`recordedAt`。手写 snake_case DDL 会导致 drizzle 查询
   `no column named campusId`。rest 派生也用 camelCase 列名（PostgREST 实测可用）。
2. **`vite.config.ts` 用 `import.meta.dirname`，不用 `__dirname`。**
   Vite 8 的 `configLoader: 'native'`（未来默认）不支持 `__dirname`。

**关键类型契约**：`pgCol.id()` = `uuid()`，`sqliteCol.id()` = `text()`+randomUUID，
**两者运行时都是 string UUID**。这决定了身份模型必须从 `integer` 迁到 `uuid`（见 §2.2）。

---

## 1. 技术栈变更总览

### 后端 `apps/server`

| 动作 | 包 | 说明 |
|------|----|----|
| ➖ 移除 | `bcryptjs` + `@types/bcryptjs` | 改用 `@homurajs/auth` 的 scrypt `PasswordProvider` |
| ➖ 移除 | `jsonwebtoken` + `@types/jsonwebtoken` | 改用 `@homurajs/auth` 的 `SessionManager`（HS256 短 JWT + refresh rotate） |
| ➖ 移除 | 手写 `db/schema.ts`(DDL 字符串) + `db/connection.ts`(DatabaseSync 单例) | 改用 drizzle schema 三轨 + `@homurajs/db` `createDb`/`createRestDb` |
| 🔁 升级 | `hono` `^4.6` → `^4.10` | app-kit peer 要求 |
| 🔁 保留 | `@hono/node-server` `^1.19` | app-kit `serve` 的 optional peer；standalone 形态监听用 |
| ➕ 新增 | `@homurajs/core` | 运行形态探测、配置装载、日志、TTL-KV |
| ➕ 新增 | `@homurajs/app-kit` | `createApp` 中间件链装配 + 双形态 RuntimeAdapter |
| ➕ 新增 | `@homurajs/db` | 持久层三轨 + schema-helpers + parity + drizzle-kit config 工厂 |
| ➕ 新增 | `@homurajs/auth` | 身份认证（Password + Session + Identity Resolver） |
| ➕ 新增 | `@homurajs/storage` | 对象存储（local-fs 后端 + `/files` 代理路由） |
| ➕ 新增 | `drizzle-orm@1.0.0-rc.4` | auth/db/storage 的 peer，业务 schema 依赖 |
| ➕ 新增 | `postgres@^3.4` | pg driver 的 optional peer（pg 轨需要） |
| ➕ devDeps | `drizzle-kit@1.0.0-rc.4`、`tsx`、`typescript`、`vitest` | 迁移生成 + 运行 + E2E |

> license / 3p 两模块**本次不纳入**（主人决策：只用 5 个核心模块）。
> 校内单机系统无商业激活需求；推送通道在 AGENTS.md 中列为非目标。

### 前端 `apps/web`

| 动作 | 包 | 说明 |
|------|----|----|
| ➖ 移除 | `@fluentui/react-components` + `@fluentui/react-icons` | 全面替换为 shadcn/ui + lucide-react |
| ➖ 移除 | `@m3e/react` + `@m3e/web` | 僵尸依赖（全项目零 import） |
| ➖ 移除 | `recharts` | 僵尸依赖（趋势图是手写 div 柱状图，未用 recharts） |
| 🔁 升级 | `react`/`react-dom` `^18` → `^19.2` | 目标栈 |
| 🔁 升级 | `vite` `^6` → `^8`，`@vitejs/plugin-react` `^4` → `^6` | 目标栈 |
| 🔁 升级 | `react-router-dom` `^6` → `^7` | React 19 配套 |
| ➕ 新增 | `tailwindcss@^3.4` + `postcss` + `autoprefixer` + `tailwindcss-animate` | shadcn/ui 样式基座（TW3，非 TW4） |
| ➕ 新增 | shadcn/ui 运行时依赖：`@radix-ui/*`、`class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react` | 组件基座 |
| 🔁 保留 | `i18next` + `react-i18next` | 国际化（AGENTS.md 要求 t() 包裹，中英双语） |

> shadcn/ui 采用**源码内联**方式（组件复制到 `src/components/ui/`），非 npm 包依赖，
> 这是 shadcn 的标准用法，可自由定制。

---

## 2. 后端目标架构

### 2.1 运行形态与数据方言（三轨）

`@homurajs/core` 的 `detectRuntime(env)` 探测形态，`@homurajs/db` 据此选方言：

```
                 detectRuntime(process.env)
                          │
        ┌─────────────────┴─────────────────┐
   standalone                            qw-pages
        │                                   │
  createDb({dialect})                 createRestDb(loadPostgrestEnv)
   ├─ 'sqlite' → node:sqlite             └─ PostgREST over HTTPS
   └─ 'pg'     → postgres-js                 （零依赖纯 fetch）
        │                                   │
   drizzle Database                    RestDb
   （sqlite/pg 同一套 drizzle query）   （rest.table().select() API）
```

- **sqlite / pg 共享一套 drizzle repo 代码**（drizzle query builder 方言无关），这是 drizzle 的价值。
- **rest 是另一套 API**（`RestTable.select/insert/update/remove`），需独立的 rest repo 实现。
- 三轨的 schema：`schema/pg.ts`（手写）+ `schema/sqlite.ts`（手写）+ `schema/rest.ts`（`restSchemaFromPg` 派生，不手写）。
- `assertSchemaParity(pgSchema, sqliteSchema)` 作为启动期硬门禁，防止两份 schema 漂移。

**方言选择**（`DB_DIALECT` env，缺省 `sqlite`）：
- `sqlite`：默认，延续现状，零外部依赖，本地开发/单机部署。
- `pg`：自建 PostgreSQL / 自托管 supabase（需 `postgres` peer + 连接串）。
- `rest`：qw-pages 动态页平台（需 `SUPABASE_URL` + `SUPABASE_ANON_KEY`）。

> ⚠ 现实约束：rest 轨代码结构完整提供，但本地无 PostgREST 环境，端到端验证依赖
> qw-pages 平台或自建 supabase。**standalone(sqlite/pg) 是本地可完整验证的主路径**，
> E2E 测试覆盖它；rest 轨通过契约测试 + 类型对齐保证正确性。

### 2.2 身份模型迁移（核心难点）

**问题**：auth SDK 的 `users` 表只有 `{id(uuid), username, nickname, avatarUrl, createdAt, updatedAt}`，
**不含 role / campus_id / group_id / display_name**。而值周系统的 RBAC 和多校区隔离全靠这几个字段，
且现有 13 张表的外键（`recorder_id`/`teacher_id`/`reviewer_id`/`operator_id`）都是 `integer`。

**方案：身份锚点 + 业务档案分离**（auth SDK 管「你是谁」，业务表管「你能做什么」）：

```
auth SDK 提供（spread 进 schema，SDK 的 store 直接操作）：
  users                    { id: uuid PK, username, nickname, avatarUrl, createdAt, updatedAt }
  passwords                { userId: uuid PK/FK, passwordHash(scrypt), createdAt, updatedAt }
  refresh_tokens           { tokenHash PK, familyId, sid, sub, expiresAt, usedAt, profile }
  oauth2_identity_links    （本次不用 OAuth2，但表结构一并纳入迁移）
  webauthn_credentials     （本次不用 WebAuthn，表结构一并纳入迁移）

业务新增：
  user_profiles            { userId: uuid PK/FK→users.id, campusId: int, displayName: text,
                             role: text(admin|teacher|student), groupId: uuid|null }
```

**外键全面 uuid 化**：`records.recorderId`、`appeals.teacherId`、`appeals.reviewerId`、
`recordLogs.operatorId`、`dailySummaries.notifiedTeachers`（JSON 数组）、`dutyGroups.members`（JSON 数组）
全部从 `integer` 改为 `text(uuid)`。

**认证链路**：
1. 登录 `POST /auth/password/login`（auth SDK 路由）→ 校验 scrypt 密码 → `SessionManager.createSession`
   → 下发 access(JWT) + refresh cookie → `{ok:true}`。
2. `sessionMiddleware(sessions)`（app-kit 装配）→ 校验 cookie 或 `Authorization: Bearer`
   → `c.set('auth', {sub, sid, ...})`。`sub` = users.id(uuid)。
3. 业务中间件 `requireProfile()`（本项目新增）→ 读 `c.get('auth').sub` → 查 `user_profiles`
   → `c.set('profile', {userId, campusId, displayName, role, groupId})`。
4. `requireRole(...roles)`（本项目重写）→ 读 `c.get('profile').role` 做 RBAC。
5. 多校区隔离 → 读 `c.get('profile').campusId`（**不再信任请求体的 campus_id**，见 §5.2 安全修复）。

> **Breaking**：session.sub 从 integer user.id 改为 uuid；无 refresh token 的旧 JWT 全部失效，重登恢复。
> 现有 `apps/server/data/app.db` 会由新迁移重建，种子数据重置（原型阶段，AGENTS.md 认可）。

### 2.3 Schema 设计（业务表，双方言）

保留现有 13 张业务表的语义，字段类型适配 homura schema-helpers，**列名 camelCase**：

| 表 | 关键字段（camelCase 列名） | 类型要点 |
|----|--------------------------|---------|
| `campuses` | id(int PK autoinc), name, code(unique) | id 用 int（非 uuid，语义是校区序号） |
| `grades` | id(int PK), campusId(int FK), name, sortOrder(int) | UNIQUE(campusId,name) |
| `classes` | id(int PK), gradeId(int FK), campusId(int FK), name, classTeacher | UNIQUE(campusId,gradeId,name) |
| `dutyGroups` | id(uuid PK), campusId(int FK), name, members(json text[]) | members = userId uuid 数组 |
| `userProfiles` | userId(uuid PK/FK), campusId(int FK), displayName, role, groupId(uuid) | 见 §2.2 |
| `tags` | id(int PK), campusId(int FK), name, score(real), color, category, isSystem(int 0/1) | score 是 REAL |
| `templates` | id(int PK), campusId(int FK), name, tagIds(json int[]) | |
| `records` | id(uuid PK), campusId(int), classId(int), recorderId(uuid), tagId(int), score(real), comment, images(json text[]), week, status, recordedAt(epochMs) | 核心表；images 存 storage objectKey |
| `recordLogs` | id(uuid PK), recordId(uuid FK), action, operatorId(uuid), reason, createdAt | action 补 'create' |
| `appeals` | id(uuid PK), recordId(uuid FK), teacherId(uuid), reason, status, reviewerId(uuid), reviewComment, createdAt, reviewedAt | |
| `dailySummaries` | id(uuid PK), campusId(int), week, date, content, notifiedTeachers(json text[]), createdAt | UNIQUE(campusId,date) |
| `awards` | id(uuid PK), campusId(int), classId(int), week, category, note, awardedAt | UNIQUE(campusId,classId,week) 幂等 |
| `settings` | id(int PK), campusId(int FK), key, value | UNIQUE(campusId,key) |

+ auth 5 表 + storage 2 表（`homura_files`/`homura_file_chunks`，local 后端不需要但表结构纳入以支持 db 后端切换）。

> 修复的现有 schema 缺陷：`dailySummaries` 补 UNIQUE、`awards` 补 UNIQUE(幂等)、
> `recordLogs.action` 补 CHECK 含 'create'、补齐 7 张表缺失的 campus_id 索引。

### 2.4 数据访问层（Repository 双实现）

**引入 Repository 模式**（现状是 route handler 直接手写 SQL，无复用、无测试点）：

```
src/
  repos/
    types.ts          # 各领域 repo 接口（Db-agnostic 契约）
    drizzle/          # drizzle 实现（覆盖 sqlite + pg 两轨）
      records-repo.ts, tags-repo.ts, statistics-repo.ts, ...
    rest/             # rest 实现（覆盖 qw-pages 轨）
      records-repo.ts, tags-repo.ts, ...
    index.ts          # createRepos(db|rest) 按形态装配
```

- repo 接口只暴露领域方法（`recordsRepo.list(filter)`、`statisticsRepo.ranking(campusId, week)`），
  路由层不碰 SQL/drizzle/rest 细节。
- drizzle 实现一份覆盖 sqlite+pg；rest 实现一份覆盖 qw-pages。
- 事务：drizzle 侧用 `db.transaction()` 修复现有的非原子多语句操作
  （groups 双写、records+logs、appeal 状态联动、awards 批量、templates import、settings upsert）。

### 2.5 app-kit 装配与中间件链

`createApp` 固定中间件链（README 契约）：
```
basePath → requestId+访问日志 → healthz(豁免守卫) → [licenseGuard 本次不注入]
→ sessionMiddleware → authRoutes → App routes → 静态资源 → SPA fallback → onError
```

```ts
const { app, runtime, healthzPath } = createApp({
  runtime: 'auto',
  auth: { sessions, sessionMiddleware, authRoutes },   // 注入登录链
  storage,                                             // deps.storage 暴露给路由
  db,                                                  // deps.db（drizzle 形态）
  healthz: { checks: [{ name: 'db', check: () => pingDb() }] },
  staticDir: adapter.assetsDir(process.env),           // 生产托管前端 dist/client
  logger,
  onError: (err, {path}) => c.json({success:false, error:{...}}),  // 统一错误包裹，不泄栈
  routes: (deps) => buildApiRoutes(deps),              // /api/v1/* 业务路由
});
```

- **CORS**：改为读 env（`CORS_ORIGINS`），不再硬编码 localhost（修复现有缺陷）。
- **onError**：统一 `{success:false, error:{code,message}}` 包裹，外键约束错误转 409，不泄堆栈（修复现有 500 泄栈）。
- **静态资源 + SPA fallback**：app-kit 提供，**补上现有后端完全缺失的生产托管能力**（现状前端要单独部署）。
- 双入口：`src/index.ts`(standalone, `createNodeAdapter`) + `src/qw-pages.ts`(qw-pages, `createQwPagesAdapter`)。

### 2.6 storage 接入（顺手修图片死数据 bug）

现状：图片 `writeFileSync` 落盘到 `apps/server/uploads/YYYY/MM/uuid.ext`，
但**无任何读取端点，上传的图片 HTTP 不可达（死数据）**；且无类型/大小/数量校验。

迁移：
- `createLocalStorage({rootDir})` → `storage.uploadFile('records', fileName, bytes, contentType)`
  → 返回 `{objectKey, url: '/files/<key>'}`。
- `records.images` 存 `objectKey`（不再存自造相对路径）。
- `createFileProxyRoutes(storage)` 挂 `/files/:key` 代理下载 → **图片终于可访问**。
- 上传校验：MIME 白名单（image/*）、单文件 ≤ 5MB、单次 ≤ 9 张（前端已限 9 张）。
- local 后端根目录读 `STORAGE_ROOT` env（qw-pages 上 local 不可写，届时切 db 后端——storage 的 db 后端表已纳入 schema）。

---

## 3. 前端目标架构

### 3.1 技术栈

Vite 8 + React 19 + TypeScript + Tailwind CSS 3 + shadcn/ui（源码内联）+ react-router 7 + i18next。

```
apps/web/src/
  components/ui/       # shadcn/ui 组件（button/card/table/dialog/tabs/select/input/...）
  components/          # 业务组件（Layout/Sidebar/StatCard/RankTable/RecordForm/...）
  lib/utils.ts         # cn() 等
  lib/api.ts           # API client（fetch 封装，cookie + Bearer）
  hooks/useAuth.tsx    # 认证上下文
  i18n/                # 中英双语资源
  pages/               # 10 个页面
```

### 3.2 认证适配（cookie 优先 + Bearer 兼容）

现状：登录返回 `{token}` 存 localStorage，请求头带 `Authorization: Bearer`。
迁移后 auth SDK 下发 **cookie**（access+refresh），并兼容 Bearer：

- 登录：`POST /auth/password/login` `{username,password}` → `{ok:true}` + Set-Cookie（HttpOnly）。
- API client：`fetch(url, {credentials:'include'})`（带 cookie）；无需再手动管 token。
- 身份：`GET /api/v1/auth/me` → 返回 `{user: users行, profile: user_profiles行}`（含 role/campusId）。
- 401 处理：跳 `/login`；access 过期由 sessionMiddleware 透明 rotate 续期（cookie 有效时）。
- `useAuth` 暴露 `{user, profile, loading, login, logout}`；`profile.role` 驱动 RBAC。

### 3.3 页面迁移映射（Fluent → shadcn/ui）

| 页面 | 复杂度 | Fluent 组件 → shadcn/ui | 迁移要点 |
|------|-------|------------------------|---------|
| LoginPage | 低 | Card/Input/Button | cookie 登录，去 token |
| DashboardPage | 中 | Card/Table/Badge | 统计卡 + Top5 + 最新记录 |
| **RecordPage** | **高** | Form/Select/Textarea/Badge/Table/Button/Toast + 图片上传 | 标签 chip、模板快选、分页、撤回/申诉、图片上传预览 |
| StatisticsPage | 中高 | Tabs/Table/Select | 三 Tab + 手写柱状图（或引 recharts 重做趋势图） |
| SummaryPage | 中 | Card/Textarea/Table | 表单 + 周排名 + 历史 |
| AppealsPage | 中低 | Card/Badge/Select/Button | 卡片列表 + 审批 |
| AwardsPage | 低 | Card/Input/Button | 周次 + 一键评选 + 获奖网格 |
| **ConfigPage** | **高** | Tabs/Table/Dialog/Form/Select/Input | 7 实体配置驱动 CRUD 引擎 + 动态表单 + Dialog |
| SettingsPage | 低中 | Card/Switch/Button | 开关 + 模板导入导出 |
| **BigScreenPage** | 中 | 全屏自定义（TW + CSS 变量） | **改用 SSE 实时推送**（后端已有 EventBus，前端从没接） |

**一并修复的前端技术债**（子代理测绘发现）：
- 全内联样式 → Tailwind 原子类。
- i18n 覆盖不全（多处硬编码中文）→ 全部走 `t()`。
- 前端无路由级 RBAC（仅隐藏菜单）→ 加 `<RequireRole>` 守卫。
- BigScreen 30s 轮询 → SSE（`EventSource('/api/v1/sse/records')`）。
- `campus_id` 多处硬编码为 1 → 从 profile 取真实校区。
- api client `any` 泛滥 → 用 shared 类型收紧。

---

## 4. API 契约（保持 vs 变更）

**保持不变**（减少前端改动面 + 契约稳定）：
- 前缀 `/api/v1/*`，资源复数名词。
- 响应包裹 `{success:true, data, pagination?}` / `{success:false, error:{code,message}}`。
- 分页 `{page, pageSize, total, totalPages}`，query 参数 snake_case。
- 端点语义、子资源动词路径（`/records/:id/revoke` 等）。

**变更**：
- 登录：`POST /api/v1/auth/login` → `POST /auth/password/login`（auth SDK 路径，cookie 下发）；
  保留 `/api/v1/auth/me`（聚合 users+profile）、`/api/v1/auth/logout`（SDK `/auth/logout`）。
- id 类型：user 相关 id 全部 integer → uuid（前端透传，不感知）。
- 图片：`records.images` 存 objectKey，读取走 `GET /files/:key`（新增，修复死数据）。
- 新增 `GET /api/v1/auth/profile`（当前用户业务档案）。

---

## 5. 安全与正确性修复（借重构一并处理）

子代理测绘发现现有后端 28 项缺陷，本次重构修复其中与底层相关的：

### 5.1 身份/鉴权
- ✅ JWT_SECRET 硬编码 fallback → `defineConfig` required + 启动校验（缺失即 fail fast）。
- ✅ 角色变更后旧 token 7 天有效 → 业务档案每请求查库（`requireProfile`），改角色即时生效。
- ✅ bcryptjs 同步阻塞 → auth SDK scrypt（异步，Node crypto）。

### 5.2 多校区隔离（现有是「默认值」不是「隔离」）
- ✅ `?campus_id=` 任意覆盖跨校区读 → 非 admin 强制用 `profile.campusId`，忽略请求参数。
- ✅ 写操作 campus_id 取自请求体 → 取自 profile，请求体值仅 admin 可覆盖。
- ✅ 按 `:id` 端点无校区校验 → repo 层统一 `WHERE campusId = profile.campusId`。
- ✅ student 可增删改年级/班级/标签/模板/奖项/设置（12 端点无 requireRole）→ 补 RBAC 矩阵。

### 5.3 正确性
- ✅ 零事务 → drizzle `transaction()` 包裹多语句操作（groups/records/appeal/awards/import/settings）。
- ✅ `record_revoked` 事件从未 emit（SSE 死代码）→ 撤回时补 emit。
- ✅ 图片无读取端点 → storage `/files` 代理。
- ✅ 所有 DELETE 无 try-catch 泄栈 → onError 统一转 409/404。
- ✅ `appeal_approved` 记录不计分（语义可疑）→ 统计口径改 `active`+`appealing`+`appeal_approved`。
- ✅ tags/templates PUT 缺字段静默重置 → 部分更新语义。
- ✅ awards 无幂等 + 空数组 `IN ()` 语法错误 → UNIQUE 约束 + 空集短路。
- ✅ N+1 查询（appeals/templates）→ JOIN 或批量。

---

## 6. 分阶段实施计划

每阶段完成后建 `snapshot/*` git tag，可回退。

| 阶段 | 内容 | 交付物 | 验证 |
|------|------|-------|------|
| **P0** | 迁移方案文档（本文） | `docs/MIGRATION-HOMURA.md` | — |
| **P1** | 后端地基：依赖、schema 三轨、db 工厂、drizzle 迁移生成、种子 | `apps/server/src/db/*`、`schema/{pg,sqlite,rest}.ts`、`drizzle/{pg,sqlite}/` | parity 门禁过、迁移生成、seed 跑通 |
| **P2** | 后端身份：auth SDK 接入、user_profiles、requireProfile/requireRole 中间件、config(env) | `src/auth/*`、`src/middleware/*`、`src/config.ts` | 登录/鉴权链路通 |
| **P3** | 后端 repo 层 drizzle 实现（全领域） | `src/repos/drizzle/*` | 单元/契约测试 |
| **P4** | 后端 repo 层 rest 实现 + 形态切换 | `src/repos/rest/*`、`createRepos` | 契约测试（mock PostgREST） |
| **P5** | 后端路由：app-kit 装配、41 端点迁移、storage 文件代理、SSE、双入口 | `src/routes/*`、`src/app.ts`、`src/{index,qw-pages}.ts` | 服务启动、端点冒烟 |
| **P6** | 后端 E2E 测试（覆盖主路径 + 安全修复 + 多校区隔离） | `tests/e2e/*` | 全绿 |
| **P7** | 前端地基：Vite8+React19+TW3+shadcn/ui、API client、useAuth、Layout、i18n、路由守卫 | `apps/web/*` 基座 | typecheck + build |
| **P8** | 前端页面重写（10 页，按复杂度） | `apps/web/src/pages/*` | typecheck + build + 视觉 |
| **P9** | 全栈联调 + E2E（登录→打分→统计→申诉→颁奖→大屏 SSE） | — | 手动 + 自动 |
| **P10** | 文档收尾：更新 ARCHITECTURE/DECISIONS/README，整理快照 | `docs/*` | — |

---

## 7. 风险与已知限制

1. **drizzle-orm@1.0.0-rc.4 是 rc 版**：API 可能在正式版变动。已用 spike 验证当前 rc 可用，锁版本。
2. **rest 轨无法本地端到端验证**：需 qw-pages 平台或自建 supabase + PostgREST。
   缓解：schema 从 pg 派生（单一真源）、repo 接口契约测试、类型对齐。
3. **uuid 迁移是 Breaking**：现有 integer 外键全改 uuid，数据库重建、种子重置。
   原型阶段可接受（AGENTS.md 认可），快照可回退。
4. **身份模型双表**（users + user_profiles）：每请求多一次 profile 查询。
   缓解：profile 可加进程内 TTL 缓存（`@homurajs/core` 的 TTL-KV），角色变更时失效。
5. **homura 包 45 分钟前刚发布**：版本新，社区验证少。缓解：锁精确版本 26.10.15，spike 已验证核心路径。
6. **前端全量重写**（~1.2k 行 + 组件库更换）：工作量大。缓解：API 契约保持不变，页面逐个迁移可增量验证。
