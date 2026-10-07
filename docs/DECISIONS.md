# DECISIONS

## ADR-1：使用 node:sqlite (DatabaseSync) 而非 better-sqlite3
- **日期**：2026-10-07
- **状态**：已采纳
- **背景**：需要嵌入式数据库，零运维成本
- **考虑过的方案**：better-sqlite3（需编译原生模块）、lowdb（JSON文件）、PostgreSQL（太重）
- **决策**：Node.js 26 内置的 `node:sqlite` DatabaseSync
- **为什么选这个**：零依赖、无需编译、同步API简单直接、足够校内场景使用
- **为什么不选其他**：better-sqlite3 需要 node-gyp 编译；PostgreSQL 需要独立部署
- **后果**：同步API阻塞事件循环（但在校内并发量级下无害）
- **何时重新审视**：当并发超过50 QPS 或需跨进程共享数据库时

## ADR-2：前端使用 Fluent UI v9 + 内联样式
- **日期**：2026-10-07
- **状态**：已采纳
- **背景**：需要现代、洁净的UI框架，支持亮色/暗色主题
- **考虑过的方案**：@m3e/react、Ant Design、纯手写CSS
- **决策**：Fluent UI v9 (`@fluentui/react-components`) + `tokens` + 内联样式
- **为什么选这个**：v9 组件API现代化且稳定、`tokens.color*` 天然支持亮暗主题切换、洁净风格符合教育场景
- **为什么不选其他**：m3e 是 Web Components 封装与 React 范式冲突；Ant Design 风格偏重商业
- **后果**：放弃 makeStyles 而用内联样式（避免 Griffel 类型问题），代码稍长但构建通过率100%
- **何时重新审视**：当需要复杂主题定制或迁移到 React 19 Fluent v10

## ADR-3：图片存储于文件系统而非数据库
- **日期**：2026-10-07
- **状态**：已采纳
- **背景**：值周记录需支持拍照上传作为扣分证据
- **考虑过的方案**：base64存DB、文件系统+DB路径、对象存储
- **决策**：文件系统 `server/uploads/YYYY/MM/uuid.ext` + DB存路径
- **为什么选这个**：避免SQLite膨胀（影响WAL性能）、备份时可选排除图片、原型阶段够用
- **后果**：跨服务器部署需共享文件系统或独立的对象存储
- **何时重新审视**：当需要多服务器部署时

## ADR-4：使用 pnpm workspace monorepo
- **日期**：2026-10-07
- **状态**：已采纳
- **背景**：前后端共享类型定义
- **决策**：`apps/server` + `apps/web` + `packages/shared` 三级结构
- **为什么选这个**：pnpm 速度最快、workspace 协议引用零成本共享、目录清晰

## ADR-5：i18n 使用 i18next 中英双语
- **日期**：2026-10-07
- **状态**：已采纳
- **背景**：需同时支持中文（日常使用）和英文（演示/国际化）
- **决策**：i18next + react-i18next，资源文件内联于 `src/i18n/index.ts`
- **后果**：新增文案需同步中英文 key；当前仅有 zh-CN 和 en 两种语言