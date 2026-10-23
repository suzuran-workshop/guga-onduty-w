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
- **状态**：**已被取代**（superseded，2026-10-23 标记）—— 前端已迁移到 Vite + React 19 + shadcn/ui (Tailwind CSS)，
  见 docs/MIGRATION-HOMURA.md。以下保留原决策记录。
- **背景**：需要现代、洁净的UI框架，支持亮色/暗色主题
- **考虑过的方案**：@m3e/react、Ant Design、纯手写CSS
- **决策**：Fluent UI v9 (`@fluentui/react-components`) + `tokens` + 内联样式
- **为什么选这个**：v9 组件API现代化且稳定、`tokens.color*` 天然支持亮暗主题切换、洁净风格符合教育场景
- **为什么不选其他**：m3e 是 Web Components 封装与 React 范式冲突；Ant Design 风格偏重商业
- **后果**：放弃 makeStyles 而用内联样式（避免 Griffel 类型问题），代码稍长但构建通过率100%
- **何时重新审视**：当需要复杂主题定制或迁移到 React 19 Fluent v10

## ADR-3：图片存储于文件系统而非数据库
- **日期**：2026-10-07
- **状态**：**已被取代**（superseded，2026-10-23 标记）—— 提交 `e74c6d9` 已改用 `@homurajs/storage`
  DB 分块后端（`createDrizzleFileStore`，二进制分块 base64 存 homura_files/homura_file_chunks 表），
  不再落文件系统。ADR-7 移除 rest 轨时评估过是否退回文件系统，结论是保留 DB 后端（分块逻辑完整、
  照常工作，退回属独立决策）。以下保留原决策记录。
- **背景**：值周记录需支持拍照上传作为扣分证据
- **考虑过的方案**：base64存DB、文件系统+DB路径、对象存储
- **决策**：文件系统 `server/uploads/YYYY/MM/uuid.ext` + DB存路径
- **为什么选这个**：避免SQLite膨胀（影响WAL性能）、备份时可选排除图片、原型阶段够用
- **后果**：跨服务器部署需共享文件系统或独立的对象存储
- **何时重新审视**：当需要多服务器部署时（现 DB 后端已天然支持多实例共享，此顾虑部分消解）

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
## ADR-6：拆出独立值班仓库（本仓库聚焦值周）
- **日期**：2026-10-15
- **状态**：已采纳
- **背景**：本仓库原为「值班 / 值周二合一」（`guga-onduty-w`）。融合方案把「教师执勤（粗粒度巡查）」
  与「值周生班级打分（细粒度巡查）」统一为同一套巡查业务，技术上同表同引擎。但对客户而言仍是**两个场景**
  （不同用户、不同试点节奏、不同交付物），合一仓库带来发布/部署耦合、命名混淆、跨域桥接难以独立演进。
- **决策**：拆为两个独立仓库——
  - 本仓库 `guga-onduty-w` 聚焦**值周域**（值周生班级打分：记录/标签/统计/申诉/红旗/大屏），包名 `@guga-onduty-w/*`；
  - 值班域（教师巡查校园地点：区域/排班/打卡/巡查/调班/矩阵/到岗率）迁至 `guga-onduty` 仓库，包名 `@guga-onduty/*`。
- **关键处理**：
  - 值周 13 表保留；值班 7 表（dutyAreas/Locations/TimeSlots/Schedules/Checkins/Inspections/Swaps）移除
    （迁移 `DROP TABLE`）。
  - `userProfiles.canInspect` 列随值班迁出（迁移 `DROP COLUMN`）；`settings.semester_start` 键移出白名单。
  - 移除改良A桥接：`RecordsRepo.listRecorderActivity` 删除（原供值班到岗率读值周 records）。
  - `docs/DUTY-FUSION.md` 移至值班仓库（作为其值班引擎设计文档）。
- **后果**：两仓库共享同一底座骨架（@homurajs + drizzle + shadcn），代码高度相似但产品边界清晰。
- **何时重新审视**：若未来需要两产品数据打通（统一大屏汇总两域），可评估跨服务只读 API。

## ADR-7：移除 PostgREST（rest 轨）与 qw-pages 形态，收敛为 sqlite/pg 双方言

- **日期**：2026-10-23
- **状态**：已采纳
- **背景**：仓库曾支持三轨数据方言（sqlite / pg / rest），其中 rest 轨（PostgREST）是为
  qw-pages 托管形态服务的——该平台不提供 PG 凭据、应用根只读，PostgREST 是其唯一可行的数据路径。
  上一笔提交 `e74c6d9` 刚把 rest 轨 repo（15 文件）与 DB 分块 storage 落地。但值周域确定走
  **独立部署**（自建 Node 服务 + sqlite/pg），不再需要 qw-pages 托管；rest 轨成为纯维护负担：
  每个 repo 要写两遍、无事务需靠幂等补偿、无法本地端到端验证（只能靠 mock-rest 内存桩）。
- **决策**：移除 rest 轨与 qw-pages 入口，`DbHandle` 从 `DrizzleHandle | RestHandle` 收敛为单一
  `DrizzleHandle`（`handle.kind` 恒为 `'drizzle'`）。
- **关键处理**：
  - 删除：`src/repos/rest/`（15 文件）、`src/db/seed-rest.ts`、`src/qw-pages.ts`、
    `tests/rest-repos.test.ts`、`tests/helpers/mock-rest.ts`。
  - 分支收敛 9 文件：`db/client.ts`（核心，类型收窄后所有 `handle.rest` 访问编译报错，是天然安全网）、
    `repos/index.ts`、`auth/build.ts`（三个 `createRest*Store` 三元收敛）、`storage/build.ts`、
    `bootstrap.ts`、`db/seed.ts`、`app.ts`、`schema/index.ts`（删 `restSchema` 派生）、`scripts/verify-p1.ts`。
  - 配置清理：`config.ts` 删 `supabaseUrl`/`supabaseAnonKey`/`runtime`（app.ts 改为硬写 `standalone`，
    不用 `'auto'` 以避免部署机恰好有 `QWENWORK_WRITABLE_DIR`/`SUPABASE_INSTANCE_ID` 时被误判）；
    `.env.example` 删对应项；`package.json` 删 `dev:qw`，根删 `dev:server:qw`。
  - **`postgres` 依赖保留**：它服务 **pg 轨**（`db/client.ts` 仅在 `dialect==='pg'` 分支
    `await import('@homurajs/db/pg')`），rest 轨只用裸 `fetch`（全仓无 supabase client）。
  - **`assertSchemaParity` 保留且重要性上升**：原 rest 轨靠 `restSchemaFromPg(pgSchema)` 从 pg 派生
    天然一致；移除后 pg/sqlite 双方言列名一致的唯一保障就是这道启动期门禁。
- **为什么选这个**：值周域独立部署后 rest 轨零收益、双份维护成本；收敛后每个 repo 只写一遍，
  事务语义统一，可本地端到端验证。
- **为什么不选其他**：保留 rest 轨「以防将来上 qw-pages」= 为不确定的未来付确定的双份维护税；
  且 rest 轨无事务，与值周域「记录+日志原子写入」「申诉状态机事务联动」的强一致需求本就冲突。
- **后果**：
  - `pnpm db:generate` 双方言迁移不受影响（`.migrate.ts` 只 `export * from './{sqlite,pg}.js'`，无 rest 触点）。
  - 测试数 111 − 12（rest-repos）= **99**（+ 本轮 ensure-env 8 = 107）。
  - **分块上传保留**：其两个前提（qw-pages 网关 ~1MB、PostgREST 单值 ~1MB）在 standalone 下均不成立
    （`app.ts` bodyLimit 50MB），但 `routes/files.ts` + 前端 chunk-client 在 drizzle 轨照常工作、
    实现完整，故本轮最小改动保留。是否退回纯 multipart + 恢复 ADR-3「图片存文件系统」一致性
    （ADR-3 与 e74c6d9 的 DB 分块后端已矛盾），列为**独立后续决策**，不与本次变更混淆。
- **何时重新审视**：若将来确需 qw-pages 托管形态，应重新评估——但届时 storage 与 repo 需按新平台契约重写，
  而非恢复本次删除的 rest 轨代码。

