# AGENTS.md

校园值周管理平台——Hono + React + node:sqlite 全栈应用

## 概述
- 本项目是面向中小学的校园值周打分与统计管理系统
- 覆盖：值周记录、标签管理、自定义评分、统计排名、申诉流程、流动红旗、数字大屏

## 边界与范围
- **范围内**：值周打分（文字+图片）、标签/模板自定义、班主任申诉、多校区隔离、流动红旗自动评选、数字大屏
- **非目标**（明确排除）：对接真实短信/邮件推送通道、学生请假管理、课表系统

## Agent 操作指南
- **全局规则**：
  - 使用 pnpm 作为包管理器，不要使用 npm/yarn
  - 后端从零冷启动：`pnpm db:seed && pnpm dev:server`
  - 前端端口 5173，Vite proxy 将 `/api` 代理到 `localhost:3000`
  - git commit 遵循 Conventional Commits，subject 不超过 72 字符
- **数据库**：node:sqlite (DatabaseSync)，同步 API，文件路径 `apps/server/data/app.db`
- **鉴权**：所有 `/api/v1/*`（除 auth）需 `Bearer <JWT>`；测试密码统一 `123456`
- **i18n**：前端文案必须经过 `t()` 包裹，中英双语

## 目录速查
| 路径 | 职责 |
|------|------|
| `apps/server/src/index.ts` | 服务入口，启动 Hono 服务 |
| `apps/server/src/db/schema.ts` | DDL 建表语句 |
| `apps/server/src/db/seed.ts` | 种子数据 |
| `apps/server/src/middleware/auth.ts` | JWT 签发/验证 + RBAC |
| `apps/server/src/routes/` | 15 个路由模块 |
| `apps/server/src/utils/event-bus.ts` | SSE 事件总线 |
| `apps/web/src/components/Layout.tsx` | 侧边栏 + 顶栏布局 |
| `apps/web/src/pages/` | 10 个业务页面 |
| `apps/web/src/i18n/index.ts` | 国际化资源文件 |
| `packages/shared/src/types.ts` | 前后端共享类型 |
| `docs/` | 项目文档 |