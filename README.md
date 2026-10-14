# 校园值班·值周管理平台

面向中小学的**统一巡查职责平台**——把「教师执勤值班」与「值周生班级打分」统一为同一种可排班、可履职、可监督、可变更的巡查业务。值周生记录班级表现、系统自动统计排名、班主任申诉、流动红旗颁发；教师按排班到岗执勤打卡、领导巡查在岗、临时调班审批。

> 设计洞察：**值周只是一种更详细的值班，都是巡查业务**。两者共享「排班 → 履职 → 监督 → 变更」四层结构，在排班层落同一张表、同一展开引擎、同一大表矩阵。详见 `docs/DUTY-FUSION.md`、`docs/REVIEW-PHILOSOPHY.md`。

## 这是什么？
- **定位**：校内值周评分 + 教师执勤值班的一站式数字化工具，替代纸质打分表与纸质值班表
- **解决的核心问题**：
  - 值周打分靠纸笔易丢失难统计、跨周汇总手工算、申诉无流程追踪、多校区数据割裂
  - 教师执勤排班靠 Excel 难维护、到岗无记录、临时调班无审批留痕、领导巡查无抽样工具

## 为什么存在？
- 传统值周打分依赖纸质表格，数据分散在各值周生手里
- 每周汇总排名耗时且容易出错；班主任对扣分有异议时缺乏规范申诉通道
- 教师值班排班「一张总表」维护成本高，调班靠口头、无叠加追溯
- 数字大屏是校园信息化展示的刚需（值周排名 + 值班到岗率同框）

## 如何安装和运行？
- **前置要求**：Node.js >= 22.5、pnpm
- **安装步骤**：
  ```bash
  pnpm install
  cp apps/server/.env.example apps/server/.env   # 填入 SESSION_SECRET（>=32 bytes）
  pnpm db:seed          # 建表（drizzle 迁移）+ 灌种子数据（值周 + 值班融合）
  ```
- **启动（开发模式）**：
  ```bash
  pnpm dev:server       # 后端 http://localhost:3000
  pnpm dev:web          # 前端 http://localhost:5173（Vite proxy 转发 /api、/auth、/files）
  ```
- **测试**：`pnpm test`（后端 176 tests：值周 E2E + 值班引擎/repo/HTTP/导入 + 审查回归）
- 测试账号：admin / teacher1（领导，有巡查权）/ student1（值周生），密码均为 `123456`

## 当前状态
- **阶段**：原型（已完成 @homurajs 底层替换 + 值班/值周融合）
- **数据方言**：默认 sqlite；schema 三轨全写（sqlite / pg / rest），保留 standalone 与 qw-pages 双形态部署能力
- **已知限制**：
  - 通知仅做数据记录，未对接真实推送通道（AGENTS.md 非目标）
  - rest 轨（qw-pages）repo 为 P4 规划项，当前 standalone(sqlite/pg) 为完整验证主路径
  - 到岗率对值周履职的桥接（改良 A）语义待定，见 `docs/REVIEW-PHILOSOPHY.md §4`

## 核心技术
- **应用底座**：[@homurajs](https://www.npmjs.com/org/homurajs) 五模块
  - `app-kit`：createApp 中间件链装配 + 双形态 RuntimeAdapter（standalone / qw-pages）
  - `core`：运行形态探测、配置装载（defineConfig，配置即文档）、结构化日志、TTL-KV
  - `db`：Drizzle 双方言（node:sqlite / postgres-js）+ PostgREST rest 轨 + schema parity 门禁
  - `auth`：OAuth2/TextPassword(scrypt) + 自管 session（HS256 短 JWT + refresh rotate + 族吊销）
  - `storage`：local-fs 对象存储 + `/files/<key>` 代理路由
- **后端**：Hono + Drizzle ORM（repository 模式，三轨装配）
- **前端**：Vite 8 + React 19 + shadcn/ui (Tailwind CSS 3) + react-router 7 + i18next + recharts + sonner
- **类型共享**：pnpm workspace（apps/server + apps/web + packages/shared）；值周 + 值班域 wire 契约
- **认证**：cookie 会话（HttpOnly access+refresh）+ Bearer 兼容；身份(auth users) 与业务档案(userProfiles) 分离
- **实时**：SSE（记录流 + 排名流 + 大屏推送）
- **数据库**：sqlite（默认，零依赖）/ PostgreSQL / PostgREST，迁移由 drizzle-kit 从 schema 生成（双方言）

## 文档
- `docs/PRD.md` — 值周域产品需求
- `docs/ARCHITECTURE.md` — 系统架构
- `docs/DUTY-FUSION.md` — 值班/值周统一巡查职责融合方案
- `docs/REVIEW-PHILOSOPHY.md` — 全系统哲学价值通查与改良
- `docs/MIGRATION-HOMURA.md` — @homurajs 底层替换迁移方案
- `docs/DECISIONS.md` — 架构决策记录
