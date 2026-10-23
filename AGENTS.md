# AGENTS.md

校园值周管理平台——@homurajs(app-kit) + Hono + Drizzle 双方言 + React19/shadcn 全栈应用

> 本仓库由「值班 / 值周二合一」仓库拆分而来，只承载**值周域**（值周生巡查班级打分）。
> 值班域（教师巡查校园地点）已迁至 `guga-onduty` 仓库。见 `docs/DECISIONS.md` ADR-6。

## 概述
- 本项目面向中小学**值周生班级打分**：值周生巡查记录班级表现（文字 + 图片 + 标签打分），系统自动统计排名、班主任申诉、流动红旗颁发
- 值周域：值周记录、标签管理、自定义评分、统计排名、申诉流程、流动红旗、每日小结、数字大屏

## 边界与范围
- **范围内**：值周打分（文字+图片）、标签/模板自定义、值周小组、班主任申诉、多校区隔离、流动红旗自动评选、数字大屏
- **非目标**（明确排除）：对接真实短信/邮件推送通道、学生请假管理、课表系统；教师执勤值班（属 `guga-onduty`）

## Agent 操作指南
- **全局规则**：
  - 使用 pnpm 作为包管理器，不要使用 npm/yarn
  - 后端从零冷启动：`pnpm db:seed && pnpm dev:server`（无需手建 .env：`loadConfig()` 会经
    `src/ensure-env.ts` 自愈——真实 env 优先，否则自动生成 >=32 字节 SESSION_SECRET 并落盘；
    要自定义配置再 `cp apps/server/.env.example apps/server/.env` 改）
  - 前端端口 5173，Vite proxy 将 `/api`、`/auth`（SDK 登录链）、`/files`（图片代理）转发到 `localhost:3000`
  - git commit 遵循 Conventional Commits，subject 不超过 72 字符
- **数据库**：`@homurajs/db`（Drizzle）双方言——`DB_DIALECT=sqlite`（默认，node:sqlite，`apps/server/data/app.db`）/ `pg`（postgres-js）。**迁移 SQL 必须 `pnpm db:generate`（drizzle-kit 从 schema 生成），绝不手写 DDL**。（历史第三轨 `rest`/PostgREST + qw-pages 形态已于 2026-10-23 移除，见 docs/DECISIONS.md ADR-7）
- **Schema 铁律**：pg.ts / sqlite.ts 双方言手写、列名一律 **camelCase**、主键 uuid、`assertSchemaParity` 门禁校验表名/列名/主键一致（移除 rest 轨后这是双方言列名一致的唯一保障，务必保留）；不用 drizzle `references()`（跨实体完整性靠应用层 repo+事务，双方言语义一致且避免级联删除的隐式行为）
- **鉴权**：`@homurajs/auth` cookie 会话（HttpOnly access+refresh，非 localStorage token）；`sessionMiddleware` 设 `c.get('auth').sub`(=users.id uuid) → `requireProfile` 查 userProfiles 设 `c.get('profile')`(role/campusId) → `requireRole` RBAC。登录走 SDK `POST /auth/password/login`
- **多校区隔离**：读用 `resolveCampusId(c)`（非 admin 强制本人校区，忽略 ?campus_id=）；写用 `resolveWriteCampusId(c, body)`；按 id 写端点用 `assertEntityOwnership(c, entity)` 校验归属（非本校区返 404，不泄露存在性）
- **drizzle repo 两条硬约束**：① select 里的 sql 片段不生成别名 → orderBy 必须重复完整表达式；② pg 严格 groupBy → 补全所有非聚合列（sqlite 宽松，按最严的 pg 写）
- **i18n**：前端文案必须经过 `t()` 包裹，中英双语（`apps/web/src/i18n/index.ts`）
- **测试**：`pnpm test`（vitest，107 tests）。E2E 用 `tests/helpers/harness.ts` 起真实 HTTP 服务（ephemeral 端口+临时 sqlite+cookie jar）

## 目录速查
| 路径 | 职责 |
|------|------|
| `apps/server/src/index.ts` | standalone 入口（createNodeAdapter） |
| `apps/server/src/bootstrap.ts` | 启动装配（config→db→auth→repos→storage→app） |
| `apps/server/src/app.ts` | app-kit createApp 装配（CORS/onError/healthz/static+SPA） |
| `apps/server/src/config.ts` | defineConfig 配置装载（loadConfig 先调 ensureEnv 自愈 SESSION_SECRET） |
| `apps/server/src/ensure-env.ts` | 冷启动配置自愈（真实 env 优先，否则生成 >=32 字节 secret 落盘） |
| `apps/server/src/startup-error.ts` | 启动/种子失败分类报错（配置错误给指引，真实 bug 才 dump 栈） |
| `apps/server/src/schema/{pg,sqlite}.ts` | 双方言业务 schema（值周 13 表） |
| `apps/server/src/schema/index.ts` | parity 门禁 + auth 表合并（双方言一致性唯一保障） |
| `apps/server/drizzle/{pg,sqlite}/` | drizzle-kit 生成的迁移 |
| `apps/server/src/db/{client,seed}.ts` | db 工厂（双方言 openDatabase/migrate）+ 值周种子 |
| `apps/server/src/auth/build.ts` | SessionManager + PasswordProvider + SDK 路由装配 |
| `apps/server/src/middleware/profile.ts` | requireProfile/requireRole/resolveCampusId/assertEntityOwnership |
| `apps/server/src/repos/types.ts` | 值周 repo 契约（Repos 接口） |
| `apps/server/src/repos/drizzle/` | drizzle repo 实现（sqlite/pg 共用） |
| `apps/server/src/repos/index.ts` | createRepos（按方言注入表对象，单一 drizzle 实现） |
| `apps/server/src/routes/` | 路由模块（记录/统计/申诉/红旗/小结/标签/模板/配置/用户/sse） |
| `apps/server/src/storage/build.ts` | DB 分块 storage + /files 代理（域：records） |
| `apps/server/src/utils/{event-bus,week}.ts` | 类型化 SSE 事件总线 + 周次工具 |
| `apps/server/tests/` | E2E + 审查回归（helpers/harness.ts 起真实 HTTP 服务） |
| `apps/web/src/App.tsx` | 路由 + RBAC 守卫（ProtectedRoute/RequireRole） |
| `apps/web/src/components/Layout.tsx` | 侧边栏（值周导航）+ 顶栏 |
| `apps/web/src/components/ui/` | shadcn/ui 组件（源码内联） |
| `apps/web/src/pages/` | 业务页面（看板/记录/统计/小结/申诉/红旗/配置/设置/大屏/登录） |
| `apps/web/src/api/client.ts` | cookie 认证 fetch 封装（api + authApi + fileUrl + upload/download） |
| `apps/web/src/hooks/useAuth.tsx` | cookie 会话上下文（profile 驱动 RBAC） |
| `apps/web/src/i18n/index.ts` | 国际化资源 |
| `packages/shared/src/types.ts` | 值周域 wire 契约 |
| `docs/` | PRD / ARCHITECTURE / REVIEW-PHILOSOPHY / MIGRATION-HOMURA / DECISIONS |
