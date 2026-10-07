# ARCHITECTURE — 校园值周管理

## 系统概述

```
┌─────────────────────────────────────────────────────┐
│                    Browser / Device                  │
│  ┌──────────────────────┐  ┌─────────────────────┐  │
│  │   React SPA (5173)   │  │   Digital Big Screen │  │
│  │   Fluent UI v9       │  │   /bigscreen         │  │
│  └──────────┬───────────┘  └──────────┬──────────┘  │
│             │ HTTP + SSE              │ HTTP + SSE  │
│             ▼                         ▼             │
│  ┌─────────────────────────────────────────────────┐ │
│  │           Hono Server (Node.js :3000)           │ │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────┐  │ │
│  │  │ JWT Auth │ │  Routes  │ │  SSE EventBus  │  │ │
│  │  │ Middleware│ │  (15组)  │ │  (in-memory)   │  │ │
│  │  └──────────┘ └────┬─────┘ └────────────────┘  │ │
│  │                    ▼                             │ │
│  │  ┌─────────────────────────────────────────────┐ │ │
│  │  │       node:sqlite (DatabaseSync)            │ │ │
│  │  │       13 tables, WAL mode, FK enforced       │ │ │
│  │  │       apps/server/data/app.db                │ │ │
│  │  └─────────────────────────────────────────────┘ │ │
│  │  ┌─────────────────────────────────────────────┐ │ │
│  │  │       server/uploads/  (image files)        │ │ │
│  │  └─────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## 核心模块
| 模块 | 职责 |
|------|------|
| `db/schema.ts` | 13张表DDL + 索引，启动时执行 |
| `db/seed.ts` | 测试数据：2校区×6年级×3班 + 8用户 + 10+标签 + 2模板 |
| `middleware/auth.ts` | JWT签发/验证、`requireRole()` RBAC工厂 |
| `routes/auth.ts` | 登录/注册/me |
| `routes/campuses.ts` | 校区 CRUD |
| `routes/grades.ts` | 年级 CRUD |
| `routes/classes.ts` | 班级 CRUD（含班主任字段） |
| `routes/users.ts` | 用户 CRUD |
| `routes/groups.ts` | 值周小组 CRUD |
| `routes/tags.ts` | 评价标签 CRUD |
| `routes/templates.ts` | 模板 CRUD + 导入/导出 |
| `routes/records.ts` | **核心**：记录创建(multipart)、分页列表、撤回、申诉 |
| `routes/appeals.ts` | 申诉列表查询 |
| `routes/summary.ts` | 每日小结 CRUD |
| `routes/statistics.ts` | 排名/趋势/dashboard/CSV导出 |
| `routes/awards.ts` | 流动红旗自动评选 |
| `routes/settings.ts` | 系统设置键值对 |
| `routes/sse.ts` | SSE实时推送 |
| `utils/event-bus.ts` | Node EventEmitter 单例 |

## 模块关系
- **认证层** → 所有路由（除 auth 自身）
- **记录创建** → 触发 EventBus → SSE 推送
- **申诉** → 变更 records.status ←→ appeals.status
- **统计** → 聚合 records（排除 revoked 和 appeal_approved）
- **流动红旗** → 调用 statistics/ranking → 写入 awards

## 数据流
```
值周生 → POST /records (FormData: class_id, tag_id, score, comment, images[])
       → INSERT records + record_logs
       → EventBus.emit('record_created')
       → SSE → 大屏/看板实时更新
       → 统计服务实时重算 ranking

班主任 → POST /records/:id/appeal
       → records.status = 'appealing', INSERT appeals
       → 管理员 POST appeal/approve|reject
       → records.status ↔ appeals.status 联动
```

## 外部系统
- 无外部依赖，完全离线可运行
- SQLite 文件数据库，零配置
- 图片本地文件系统存储

## 重要技术边界
- node:sqlite 为同步API，不适合高并发（适合校内使用场景）
- SSE 为内存 EventEmitter，多进程部署需改为 Redis Pub/Sub
- 无 Docker/k8s 部署配置（原型阶段）