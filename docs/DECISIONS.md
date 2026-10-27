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

## ADR-8：钉钉集成——教师不进系统（推送 + 免登录申诉 + 周报）

- **日期**：2026-10-27
- **状态**：已采纳（**显式修订** AGENTS.md / README.md 的「非目标」与 PRD 原文）

- **背景**：需求 4 的原话是「教师不需要专门进入系统，她们在班级收到评价后都会立刻收到钉钉推送
  （扣分则附带一个申诉链接，填写后管理员收到），每周收到得分扣分总计」。
  这与仓库既有 scope **直接冲突**：AGENTS.md 与 README.md 都把「对接真实推送通道」列为明确非目标，
  ARCHITECTURE.md 写着「通知仅做数据记录」，PRD 的班主任场景是「收到扣分通知，查看详情，发起申诉」
  ——隐含「进系统」。全仓 `grep -iE "钉钉|dingtalk"` 当时零命中，是纯绿地。
  更底层的障碍：`@homurajs/3p` 的钉钉实现经**真实凭证实测四个能力全部不可用**，
  而 spec 与 homura 能力矩阵都标着 ✅（纯 stub 测试造成的假绿灯）。

- **决策**：接入真实钉钉通道，并**推翻**上述 scope 条目。班主任走「钉钉推送 → 免登录链接 → 直接申诉」，
  全程不进系统、不需要系统账号。

- **关键选型**（每项都对应一个被否掉的替代方案）：
  - **推送通道 = 企业应用工作通知 `asyncsend_v2`**（agentId 经实测为合法值）。
    否掉群机器人 webhook：工作通知直达个人会话、可读回执、且能带 link 类型消息承载申诉入口；
    群消息无法定向到某班班主任，也会让扣分公示给全班。
  - **教师身份 = 通讯录反查 userid，不依赖 OAuth 登录**。
    这是本 ADR 最关键的取舍：若把「教师用钉钉 OAuth 登录过」当作推送前置，就与「不进系统」自相矛盾
    ——她从没登录过，就没有 `oauth2_identity_links`，也就找不到推送目标。
    故推送链路只依赖 `classes.teacherDingtalkId`（管理员从同步下来的通讯录里绑定），
    OAuth 关联降级为**可选增强**（仅用于「系统内申诉」这条次要路径）。
  - **绑定键存钉钉 userid（text），不存系统 userId（uuid）**。
    钉钉 userid 形如 `5314054424-444663015`，不是 uuid——存 uuid 列会被 pg 直接拒绝写入。
    存 userid 还让推送链路零转换（`asyncsend_v2` 要的就是它），且教师从未登录也能收到。
    代价（已与产品确认接受）：账密登录的教师无法在系统内证明自己是那位钉钉班主任，
    故系统内申诉 **fail-closed 拒绝**并引导走免登录链接。
  - **申诉入口 = 签名令牌公开链接**，挂 `/api/public/appeal/:token`（在 `/api/v1/*` 登录闸门**之外**），
    前端页面挂 `/appeal/:token`（与 `/bigscreen` 平级，在 ProtectedRoute 之外）。
    令牌绑定 recordId + 教师钉钉 userid + 过期 + **一次性原子消费**，只存 SHA-256（拖库也无法构造可用链接）。
    否掉「教师登录系统申诉」：那正是需求要消灭的动作。
    转发链接 = 转发申诉权，此风险显式接受（工作通知只进本人会话，损害被「一次性 + TTL + 班级绑定校验」
    限制为单条记录的一次申诉）。
  - **取图走令牌作用域端点** `GET /:token/image/:index`，不复用 `/files/*`。
    `/files/*` 自带 requireProfile + 校区校验，免登录教师无会话会全 401；
    而照片正是「扣分必拍照」的证据，看不到照片就无法有效申诉。
    按**序号**而非 objectKey 寻址：教师无法构造 key 去看他班照片，越权面为零。
  - **周报 = 进程内定时器 + 管理员可补发**。项目此前无任何 scheduler 基础设施。
    用「每 5 分钟检查是否到点」而非「setTimeout 算到目标的毫秒差」——后者在进程休眠/时钟调整后
    可能永不触发，前者自愈。幂等靠 `notificationLogs.dedupeKey` 唯一索引。
    否掉外部 cron：原型阶段引入部署依赖不划算，且补发按钮已覆盖「错过就发不出去」的场景。

- **必须记住的三个坑**（`services/notify.ts` 已处理，改动时勿回退）：
  1. **`errcode:0 ≠ 送达`**：`asyncsend_v2` 是异步任务，发给**不存在的 userid 也返 `errcode:0` + task_id**
     （实测确认）。只有 `getsendresult` 的 `invalid_user_id_list` 才暴露失败。
     不查回执 = 推送失败被静默记成成功，而这正是最难被发现的一类故障（教师说没收到，日志说发了）。
  2. **EventBus listener 必须 fire-and-forget**：`emit` 是同步的且发生在 `return created()` 之前，
     listener 里 `await` 钉钉（15s timeout）会**阻塞打分请求**。
     配套地，`EventBus.emit` 现在逐个 listener try/catch + 对返回的 Promise 挂 `.catch`
     ——此前 listener 抛错会冒泡，直接把「创建记录」500 掉。
  3. **凭证缺失要降级不要抛错**：未配 appKey/appSecret/agentId 时 `buildPlatform` 返回
     `platform: null`，通知落库为 `pending`（不阻塞主链路），凭证到位后
     `POST /dingtalk/notifications/flush` 补发。这样「先把业务跑起来、后配钉钉」是安全的。

- **为什么不是家校通讯录**：班主任↔班级关系的**权威**其实在钉钉家校通讯录里，但
  (a) 需额外权限 `qyapi_addresslist_edu_read`（尚未开通）；
  (b) 家校子树 `dept_id=-7` **不能用普通部门 API 递归**（实测返 `40009 不合法的部门id`）。
  故 3p 的 `fetchAllContacts` 自动跳过负数 dept_id，并对家校能力做**探测式降级**
  （未开通时返回 `{available:false, reason}` 而非抛错）。本系统按产品要求**只引入组织通讯录**，
  班主任绑定改由管理员在 ConfigPage 下拉指定（下拉 label 带部门名以消歧重名）。

- **顺带清理的两个撒谎开关**：
  - `settings.auto_notify_teachers`：全仓零消费方（仅 seed/白名单/前端 Switch），关掉它推送照发
    → **下线**，并加用例锁住它不再被接受（免得将来有人加回来又当成功能用）。
  - `settings.appeal_enabled`：同样是死开关 → **接活**（申诉开关是合理的管理需求，比删更合适），
    抽出 `utils/appeal-enabled.ts` 作唯一裁决点，**两个申诉入口都过它**（只管一半仍是撒谎）。
    语义为「只有显式 `'false'` 才禁用」，键缺失一律放行——settings 按校区存，
    新校区从未写过该键，把缺失当禁用会**全员无法申诉**。

- **连带修订的文档**（否则代码与需求互相矛盾）：
  - PRD：班主任场景改「不进系统」；补核心问题 6（教师不会为一条扣分专门登系统）；
    功能表四处实质变更（多标签求和+标签分权威、扣分必拍照、申诉成立即调分、红旗仅人工颁发）
  - AGENTS.md / README.md：「对接真实推送通道」从非目标移入范围内，并显式标注被推翻
  - ARCHITECTURE.md：大图加钉钉外部系统与公开路由；identity link 从「未用」改「已用」；
    数据流三段全改（多班级多标签、score 服务端求和、approve 调分、红旗人工）；表数 18→21；测试数 107→190

- **3p 的前置修复**：本决策依赖 `@homurajs/3p` 钉钉能力可用，而实测其**四个能力全坏**
  （根因是 `request()` 一律只放 header 认证，而 `oapi/topapi` 只认 `?access_token=` query 参数
  → `errcode:88 access_token is blank`；另有三个端点路径本身就是错的）。
  已在 homura 仓库修复并新增 `fetchAllContacts`/`getSendResult`/`listMicroApps` 等公共接口，
  桩测试改为**按完整 URL 精确断言**（含认证方式），并补了 env 门控的真实端点集成测试。

- **后果与后续**：
  - 推送与周报是**进程内**的：多实例部署会重复推送。周报可关 `WEEKLY_REPORT_ENABLED` 靠管理员补发，
    但扣分推送无幂等键（同一记录不该被推两次由「记录只创建一次」保证），
    多实例前需把 EventBus 换成 Redis Pub/Sub 或加投递去重。
  - 教师钉钉 OAuth 登录**尚未装配**（`createAuthRoutes` 未传 `oauth2`）。装配有三个硬缺口：
    JIT 建户不建 `userProfiles`（会 403 PROFILE_NOT_FOUND，且 campusId NOT NULL + role 有 CHECK 约束，
    钉钉身份里都拿不到）→ 需自定义 IdentityResolver 或「管理员预绑定」流程；
    `allowRegister:false` 与 JIT 语义冲突；`oauth2-dingtalk` IdP 仓库不在本机，
    其 `mapUser` 产出的 `sub` 是否等于钉钉企业 userid **无法核实**。
    正因这个未知量，推送链路刻意**不依赖** OAuth（见上「教师身份」选型）。
  - `dailySummaries.notifiedTeachers` 仍恒为 null（唯一写入点从请求体透传，而前端从不传）——
    本轮未接，列为独立后续决策。
