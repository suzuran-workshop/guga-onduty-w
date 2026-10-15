# 校园值周管理平台

面向中小学的**值周生班级打分化管理**——值周生巡查记录班级表现（文字 + 图片 + 标签打分），系统自动统计排名、
班主任申诉、流动红旗颁发，并为校园信息化大屏提供实时数据源。

> 本仓库由原「值班 / 值周二合一」仓库拆分而来，只承载**值周域**（值周生巡查班级）。
> 值班域（教师巡查校园地点）已迁至 `guga-onduty` 仓库。见 `docs/DECISIONS.md` ADR-6。

## 这是什么？
- **定位**：校内值周评分的数字化工具，替代纸质打分表
- **解决的核心问题**：
  - 值周打分靠纸笔，易丢失、难统计
  - 跨周汇总排名手工算，费时且容易出错
  - 班主任对扣分有异议时缺乏规范申诉通道
  - 多校区数据割裂
  - 校园信息化展示缺少实时数据源

## 功能
| 功能 | 解决什么 |
|------|----------|
| 标签 + 积分实时记录 | 替代纸质打分表（结构化才能自动统计） |
| 自定义值周小组 | 不同学校/周次值周安排不同 |
| 自定义评价标签与分值 | 卫生/纪律/两操各校标准不同 |
| 标签模板 | 快速套用常用标签集 |
| 文字 + 图片记录 | 提供扣分证据，有争议可回溯 |
| 每日小结 + 教师通知 | 班主任及时了解 |
| 多维度统计排名 | 自动计算周排名 |
| 数据导出 CSV | 存档与二次分析 |
| 申诉流程 | 规范异议处理 |
| 流动红旗 | 班级正向激励 |
| 多校区管理 | 各校区独立运行互不干扰 |
| 数字大屏 | 校园信息化展示（实时排名 + 记录流） |

## 功能之间的关系
```
配置(校区/年级/班级/标签/模板) → 值周记录(打分) → 统计(排名/趋势)
                                                     ├── 申诉(班主任→管理员)
                                                     ├── 流动红旗(自动评选)
                                                     ├── 每日小结(通知教师)
                                                     └── 数字大屏(实时展示)
```

## 安装与运行
- **前置要求**：Node.js >= 22.5、pnpm
- **安装步骤**：
  ```bash
  pnpm install
  cp apps/server/.env.example apps/server/.env   # 填入 SESSION_SECRET（>=32 bytes）
  pnpm db:seed          # 建表（drizzle 迁移）+ 灌种子数据
  ```
- **启动（开发模式）**：
  ```bash
  pnpm dev:server       # 后端 http://localhost:3000
  pnpm dev:web          # 前端 http://localhost:5173（Vite proxy 转发 /api、/auth、/files）
  ```
- **测试**：`pnpm test`（后端 99 tests：值周 E2E + 审查回归）
- 测试账号：admin / teacher1 / student1（值周生）等，密码均为 `123456`

## 当前状态
- **阶段**：原型（已完成 @homurajs 底层替换；自二合一仓库拆分）
- **数据方言**：默认 sqlite；schema 三轨全写（sqlite / pg / rest 派生），保留 standalone 与 qw-pages 双形态部署能力
- **已知限制**：
  - 通知仅做数据记录，未对接真实推送通道（非目标）
  - rest 轨（qw-pages）repo 为 P4 规划项，当前 standalone(sqlite/pg) 为完整验证主路径

## 核心技术
- **应用底座**：[@homurajs](https://www.npmjs.com/org/homurajs) 五模块
  - `app-kit`：createApp 中间件链装配 + 双形态 RuntimeAdapter（standalone / qw-pages）
  - `core`：运行形态探测、配置装载（defineConfig，配置即文档）、结构化日志、TTL-KV
  - `db`：Drizzle 双方言（node:sqlite / postgres-js）+ PostgREST rest 轨 + schema parity 门禁
  - `auth`：OAuth2/TextPassword(scrypt) + 自管 session（HS256 短 JWT + refresh rotate + 族吊销）
  - `storage`：local-fs 对象存储 + `/files/<key>` 代理路由
- **后端**：Hono + Drizzle ORM（repository 模式，三轨装配）
- **前端**：Vite + React 19 + shadcn/ui (Tailwind CSS) + react-router + i18next + recharts + sonner
- **类型共享**：pnpm workspace（apps/server + apps/web + packages/shared）
- **认证**：cookie 会话（HttpOnly access+refresh）+ Bearer 兼容；身份(auth users) 与业务档案(userProfiles) 分离
- **实时**：SSE（记录流 + 排名流 + 大屏推送）
- **数据库**：sqlite（默认，零依赖）/ PostgreSQL / PostgREST，迁移由 drizzle-kit 从 schema 生成（双方言）

## 文档
- `docs/PRD.md` — 值周域产品需求
- `docs/ARCHITECTURE.md` — 系统架构
- `docs/REVIEW-PHILOSOPHY.md` — 值周域审查与改良记录
- `docs/MIGRATION-HOMURA.md` — @homurajs 底层替换迁移方案
- `docs/DECISIONS.md` — 架构决策记录（含拆分决策 ADR-6）
