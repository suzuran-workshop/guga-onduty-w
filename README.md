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
| 多标签求和 + 标签分权威 | 替代纸质打分表（分数由标签求和，评分环节不得改分） |
| 班级平铺多选 | 一次给多个班级同一批评价，贴合走廊巡查节奏 |
| 自定义值周小组 | 不同学校/周次值周安排不同 |
| 自定义评价标签与分值 | 卫生/纪律/两操各校标准不同 |
| 标签模板 | 快速套用常用标签集 |
| 文字 + 图片记录（扣分必拍照） | 提供扣分证据，有争议可回溯 |
| 钉钉推送（扣分即时 + 每周总计） | 班主任**不进系统**也能及时了解；扣分附免登录申诉链接 |
| 每日小结 | 校内留档与复盘 |
| 多维度统计排名 | 自动计算周排名 |
| 数据导出 CSV | 存档与二次分析 |
| 申诉流程（成立即调分，非撤销） | 规范异议处理；管理员调整标签集，分数随之重算 |
| 流动红旗（仅管理员人工颁发） | 班级正向激励；系统只提供候选参考，颁发权归人 |
| 多校区管理 | 各校区独立运行互不干扰 |
| 数字大屏 | 校园信息化展示（实时排名 + 记录流） |

## 功能之间的关系
```
配置(校区/年级/班级/标签/模板) → 值周记录(多班级×多标签) → 统计(排名/趋势)
      │                                    ├── 申诉(班主任→管理员，成立即调分)
      │                                    ├── 流动红旗(候选参考→人工颁发)
      │                                    ├── 每日小结(校内留档)
      │                                    └── 数字大屏(实时展示)
      └─ 引入钉钉组织通讯录 → 绑定班主任(钉钉 userid)
                                      ├── 扣分即时推送 ─→ 免登录申诉链接 ─→ 申诉
                                      └── 每周得分扣分总计（定时器 + 管理员可补发）
```

## 安装与运行
- **前置要求**：Node.js >= 22.5、pnpm
- **安装步骤**：
  ```bash
  pnpm install
  pnpm db:seed          # 建表（drizzle 迁移）+ 灌种子数据
  ```
  > 无需手建 `.env`：`pnpm db:seed` / `pnpm dev:server` 会经 `ensure-env` 自愈——
  > 真实 env 优先，否则自动生成 `>=32` 字节的 `SESSION_SECRET` 并落盘（已被 .gitignore 忽略）。
  > 要自定义端口/方言等配置，再 `cp apps/server/.env.example apps/server/.env` 修改。
- **启动（开发模式）**：
  ```bash
  pnpm dev:server       # 后端 http://localhost:3000
  pnpm dev:web          # 前端 http://localhost:5173（Vite proxy 转发 /api、/auth、/files）
  ```
- **测试**：`pnpm test`（后端 190 tests：值周 E2E + 审查回归 + 配置自愈 + 钉钉推送 + 免登录申诉 + SPA 深链）
- 测试账号：admin / teacher1 / student1（值周生）等，密码均为 `123456`

## 当前状态
- **阶段**：原型（已完成 @homurajs 底层替换；自二合一仓库拆分）
- **数据方言**：默认 sqlite；schema 双方言手写（sqlite / pg），`assertSchemaParity` 启动期门禁防漂移
- **已知限制**：
  - 教师钉钉 OAuth 登录尚未装配（账密登录仍可用）。扣分推送与免登录申诉**不依赖** OAuth ——
    教师身份经「组织通讯录 → 班主任绑定（钉钉 userid）」解析，从未登录过系统也能收到推送
  - 推送为进程内 EventBus + 进程内周报定时器：多实例部署会重复推送，需关掉
    `WEEKLY_REPORT_ENABLED` 并靠管理员补发（见 ADR-8）
  - 历史第三轨 `rest`（PostgREST / qw-pages 托管形态）已于 2026-10-23 移除，聚焦 standalone 独立部署（见 ADR-7）

## 核心技术
- **应用底座**：[@homurajs](https://www.npmjs.com/org/homurajs) 五模块
  - `app-kit`：createApp 中间件链装配 + RuntimeAdapter（standalone）
  - `core`：配置装载（defineConfig，配置即文档）、结构化日志、TTL-KV、env-file
  - `db`：Drizzle 双方言（node:sqlite / postgres-js）+ schema parity 门禁
  - `auth`：OAuth2/TextPassword(scrypt) + 自管 session（HS256 短 JWT + refresh rotate + 族吊销）
  - `storage`：DB 分块对象存储（`createDrizzleFileStore`，运行时自建表）+ `/files/<key>` 代理路由
  - `3p`：钉钉工作通知（asyncsend_v2 + 投递回执）/ 通讯录（`fetchAllContacts` 递归部门树）/ 企业应用发现
- **后端**：Hono + Drizzle ORM（repository 模式，双方言装配）
- **前端**：Vite + React 19 + shadcn/ui (Tailwind CSS) + react-router + i18next + recharts + sonner
- **类型共享**：pnpm workspace（apps/server + apps/web + packages/shared）
- **认证**：cookie 会话（HttpOnly access+refresh）+ Bearer 兼容；身份(auth users) 与业务档案(userProfiles) 分离
- **实时**：SSE（记录流 + 排名流 + 大屏推送）
- **外部集成**：钉钉企业应用（工作通知推送 + 组织通讯录同步 + 免登录申诉令牌）
- **数据库**：sqlite（默认，零依赖）/ PostgreSQL，迁移由 drizzle-kit 从 schema 生成（双方言）

## 文档
- `docs/PRD.md` — 值周域产品需求
- `docs/ARCHITECTURE.md` — 系统架构
- `docs/REVIEW-PHILOSOPHY.md` — 值周域审查与改良记录
- `docs/MIGRATION-HOMURA.md` — @homurajs 底层替换迁移方案
- `docs/DECISIONS.md` — 架构决策记录（含拆分决策 ADR-6）
