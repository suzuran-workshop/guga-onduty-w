# REVIEW — 全系统哲学价值通查与改良（D9）

> 对应主人目标后半段：「通查整个系统，判断每个功能的哲学价值，不断对其进行改良」。
> 方法：对每个功能问三件事 —— ①它服务的**真实目的**是什么？②当前实现的**语义**是否对齐该目的？
> ③若未对齐，**最小而正确**的改良是什么？（AGENTS.md 验收标准：哲学层语义对齐 + 高覆盖 E2E）
>
> 系统规模：后端 7229 行 / 前端 5117 行 / 测试 1869 行 / 84 端点 / 153 tests 绿。

---

## 0. 统一哲学（主人洞察的形式化）

主人指出：**「值周只是一种更详细的值班，都是巡查业务」**。形式化为四层同构：

```
排班(Schedule) → 履职(Performance) → 监督(Oversight) → 变更(Workflow)
   谁·何时·何地      到岗并留下记录        上级核查/异议       受控临时变更
```

| 层 | 教师执勤（粗粒度） | 值周生（细粒度） | 领导（监督） |
|----|------|------|------|
| 排班 | duty_schedules(kind=teaching) | duty_schedules(kind=dutyWeek) | — |
| 履职 | dutyCheckins（到岗+照片） | records（打分+标签+图片） | — |
| 监督 | dutyInspections（查在岗） | appeals（申诉扣分） | 两者皆是 |
| 变更 | dutySwaps（调班叠加） | records.status（撤回/申诉状态机） | — |

**这套哲学已在「排班层」完全落地**（同表、同展开引擎、同矩阵）。但通查发现：**融合在履职/监督/报表/展示层尚未贯通**。以下逐功能评判。

---

## 1. 逐功能哲学价值评判

### ✅ 已对齐（高价值，保持）

| 功能 | 真实目的 | 语义对齐度 | 哲学价值 |
|------|---------|-----------|---------|
| **统一排班层** kind 区分 | 让「教师执勤」与「值周巡查」成为同一种可排班的巡查职责 | ✅ 完全 | **最高**——主人洞察的字面落地 |
| **值班大表矩阵** 实时计算 | 排班全景一目了然，且状态永不漂移 | ✅ 完全 | 高——「模板+叠加=最终值班表，不持久化视图」是优秀领域设计 |
| **调班叠加层** 不回改原排班 | 临时变更可审计、可追溯、不污染历史 | ✅ 完全 | 高——不可变模板+叠加层=完整审计链 |
| **打卡精确到人** | 会签多人各自独立履职，不互相顶替 | ✅ 完全 | 中高——防「一人打卡全格变绿」的语义污染 |
| **Excel 导入** 叠加合并 | 一张总表低成本维护，重导不破坏已有 | ✅ 完全 | 中——务实 |
| **三轨数据方言** | 同一业务从单机到 qw-pages 零改代码 | ✅ 完全 | 中——工程弹性 |

### ⚠ 部分对齐（融合断点，需改良）

**断点 1 — 履职层未统一（最深刻的哲学不一致）**
- 现状：值周生排进 `duty_schedules(kind=dutyWeek)`，但其**实际履职**（给班级打分）写入 `records`，而非 `dutyCheckins`。教师履职写 `dutyCheckins`。
- 哲学问题：主人说两者「都是巡查业务」，但**履职记录分裂在两张语义不同的表**，用两套 API、两套状态机。排班层说「你们是同类」，履职层说「你们不同类」。
- 评判：**不应强行合并表**——打分（对班级的评价，含正负分/标签/申诉）与打卡（对自身到岗的确认）是**两种形状的履职**，合并会破坏值周域 71 E2E 和打分语义。正确的改良是**在报表/统计层建立桥接**：值周生在 dutyWeek 排班日提交了 records = 其「履职到岗」，应计入统一到岗率。让哲学统一体现在**度量**上，而非**存储**上。

**断点 2 — 到岗率只算 dutyCheckins，不算值周履职**
- 现状：`getAttendance` 只统计 dutyCheckins。值周生被排了 dutyWeek 班、也打分了，但到岗率报表看不到他们。
- 哲学问题：违背「值周是更详细的值班」——值周生的履职率不被同一把尺子量。
- 改良：到岗率对 kind=dutyWeek 的排班，用「该值周生当日是否提交过 records」判定履职（桥接断点1）。→ **改良 A**

**断点 3 — 旗舰展示面（大屏/看板）只有值周，无值班**
- 现状：BigScreenPage 显示班级排名+值周记录流；DashboardPage 显示值周统计。**都不含值班矩阵/到岗率**。
- 哲学问题：大屏是「校园信息化展示刚需」，是访客/领导第一眼看到的。它展示的是**半个系统**。主人要的是统一巡查职责平台，但门面只挂了值周一半。
- 评判：这是**哲学洞察未兑现到用户可见层**的典型。融合在后端数据层完成了，但没上浮到「一眼看全」的展示层。
- 改良：大屏增值班维度（今日到岗率 + 值班矩阵缩略 + 实时打卡流），看板增值班摘要卡。→ **改良 B（最高可见价值）**

**断点 4 — 两套监督机制并列但未在哲学上说明**
- 现状：领导巡查（dutyInspections，自上而下查在岗）与班主任申诉（appeals，自下而上对扣分异议）各自独立。
- 评判：这**不是缺陷**——两者方向相反（上级核查下级履职 vs 被评价者行使异议权），是监督的两个正当维度。但系统未在文档/导航上体现「它们同属监督层」。→ **改良 C（文档层面澄清，非代码）**

### 🔧 健壮性（哲学对齐但实现有毛刺）

| 项 | 问题 | 改良 |
|----|------|------|
| 值周履职「当日提交」判定 | records 无「归属哪条 dutyWeek 排班」的链接 | 桥接用 (campusId, recorderId, 当日) 匹配，够用 |
| 大屏轮询 vs SSE | 值周记录流已用 SSE，值班打卡流未接 SSE | 改良 B 里值班维度可先轮询，后续 SSE 化 |

---

## 2. 改良决策（按哲学价值 × 风险排序）

| 编号 | 改良 | 哲学价值 | 风险 | 决策 |
|------|------|---------|------|------|
| **B** | 大屏/看板增值班维度（到岗率+矩阵缩略+打卡流），兑现「统一巡查」到可见层 | **最高**（洞察上浮到门面） | 低（纯前端+1聚合端点） | ✅ 做 |
| **A** | 到岗率桥接值周履职（dutyWeek 排班日提交 records = 到岗） | 高（统一度量尺） | 中（改 getAttendance 语义 + 测试） | ✅ 做 |
| **C** | 文档澄清「监督层双维度」 | 中（认知一致） | 零 | ✅ 做（本文即部分） |
| — | 合并 records 进 dutyCheckins | 表面高实则错 | **极高**（破坏值周域+打分语义） | ❌ 不做（两种履职形状，强行合并是过度统一） |

**改良纪律**：主人要「不断改良」，但**过度统一也是违背哲学**——把打分和打卡合并会抹掉「值周是*更详细*的值班」里的「更详细」。正确的融合是**分层统一**：排班层合一、度量层桥接、展示层并陈，而履职形状各自保留其丰富度。

---

## 3. 值班域对抗性审查结果（fork，新鲜怀疑视角）

哲学改良前先保正确性（bug > 哲学）。fork 复查值班域 9 文件，报 **19 项、13 项确认**。
按严重度处置如下（✅已修+回归测试 / ⏸️已论证 deferred）：

| # | 级别 | 缺陷 | 处置 |
|---|------|------|------|
| 1 | P1 | POST /swaps 注释称校验本人值班、代码只查 campusId 未查 assigneeIds → 教师可挪他人班次 | ✅ 抽 resolveDutyGuard 共享守卫（展开+叠加→实际值班人），打卡/调班同源复用 |
| 2 | P1 | matrix swapped 按**实例**判定 → 会签格一人换班整格标 swapped，抹掉同事打卡（大表 vs 报表口径矛盾） | ✅ 改按**人**判定（originalIds 排除接手人） |
| 3 | P1 | 8 个配置 PUT/DELETE 无 campusId 归属校验 + DELETE 不存在静默 200 | ✅ 统一 assertEntityOwnership（与值周域一致，消除 5× 重复） |
| 4 | P2 | 单双周锚点用「各排班自身 dateStart」→ 两条 odd 排班 dateStart 不同则错位（右人错周） | ✅ 校区级 parityAnchor（settings.semester_start），矩阵/打卡/到岗率/守卫四处同源 |
| 5 | P2 | excelSerialToDate 用本地 getter → 西区时区 off-by-one | ✅ 改 UTC getter（现代日期恒定） |
| 6 | P2 | Excel 同名地点跨区域合并（loc/slot map 按名键，唯一约束却是 campus+area+name） | ✅ 改 (areaId\|name) 区域限定键 |
| 7 | P2 | 非法日期 query 静默返回空 200（parseDate→Invalid→展开循环不执行） | ✅ assertDateParam 六处端点显式 400 |
| 10 | P2 | 重名教师导入静默取最后一个 | ✅ 检测 dupNames 并告警提示人工核对 |
| 12 | P2 | 配置删除无引用守卫 → 悬挂外键（矩阵「未知地点」、到岗率错算） | ✅ 区域/地点/时段删除前查引用，被引用则 409 |
| 13 | P3 | 巡查照片 `=` 覆盖而非追加（前端预填 photoKeys 会被清空） | ✅ 改追加 |
| 8 | P2 | listApproved 无日期界限，每次全量加载历史调班 | ⏸️ deferred：校内规模(百级/学期)overlay O(1)键足够，加 OR-range 反增正确性风险 |
| 9 | P2 | 导入配置预建与 bulkCreate 非同事务 | ⏸️ deferred：残留空壳配置可重导复用(幂等)，低危 |
| 11 | P2 | 教师调班列表 pageSize:100 后 JS 切片，超 100 静默截断 | ⏸️ deferred：一学期调班量远低于 100，超限再改 SQL 分页 |

**审查同时确认无误的关键实现**（新鲜视角复核，非自评）：
- POST /checkins 本人守卫**先叠加调班再判实际值班人**——接手人能打卡、被换下的人不能，是全文件最对的授权校验（故 #1 复用它）。
- checkin-index 精确到人（scheduleId+date+teacherId），会签 A 打卡不污染 B；串台问题在 matrix 层（#2）不在此。
- expand 日期算术（startOfDay 归一、setDate 本地推进、双向裁剪、DST）无 off-by-one。
- swap-overlay 代理无残留、Set 去重防会签重复、同 key 多调班共存、createdAt 升序「后者覆盖」与文档一致。
- repo 读路径全部带 campusId，无越权读洞；bulkCreate/review 事务原子；swaps.review 的 WHERE status='pending' 防重复审批。

**回归**：每项修复配 duty-review.test.ts 断言（16→20 项），全套 **176 tests 绿**（含专测「同角色跨主体越权」——现有测试的盲区）。

## 4. 哲学改良实施（对应 §2 决策）

| 编号 | 改良 | 状态 |
|------|------|------|
| **B** | 大屏融合值班维度：标题改「值班·值周数字大屏」，加到岗率条+今日值班矩阵缩略（地点×三态pill），与值周排名/记录流同框 | ✅ 已实施 |
| **A′** | 看板（落地页）加「我的今日执勤」条：教师/值周生登录即见今天要不要到岗、是否已打卡、一键跳打卡 | ✅ 已实施（比改良A更贴地气，先做） |
| **A** | 到岗率桥接值周履职：dutyWeek 排班日提交 records = 到岗，统一度量尺 | ⏸️ 规划中（需 records↔schedule 桥接语义，见下） |
| **C** | 文档澄清「监督层双维度」（巡查自上而下 / 申诉自下而上） | ✅ 本文 §1 断点4 即澄清 |

**改良纪律复盘**：§2 拒绝的「合并 records 进 dutyCheckins」经实现验证是**正确克制**——
值班域落地后，打分（对班级评价，含正负分/标签/申诉状态机）与打卡（对自身到岗确认，含照片必填）
确是两种履职形状，强行合并会破坏值周域 71 E2E 与打分语义。分层统一（排班合表 / 展示并陈 /
度量桥接）才是「值周是更详细的值班」的正确工程表达。

**改良 A 的待决语义**：值周生「到岗」= 当日提交过 records。但 records 无「归属哪条 dutyWeek 排班」的链接，
桥接只能用 (campusId, recorderId, 当日) 匹配——够用于报表口径，但不是强关联。是否给 records 加
可选 scheduleId 外键（强关联但侵入值周域 schema），留待主人定夺（这是「不断改良」的下一个决策点）。

## 5. 值周域对抗性审查结果（fork，实测 + git 考古双重验证）

同一怀疑视角转向**值周域**（71 E2E 但从未经对抗性审查）。报 **17 项**，其中 4 个 P1（含一个
**我迁移时亲手引入的功能回归**）、6 个 P2、7 个 P3。处置：

| # | 级别 | 缺陷 | 处置 |
|---|------|------|------|
| 1 | **P1** | **申诉工作流完全失效**：迁移时误把 `appeal_approved` 计入分，导致批准申诉后分数照旧、approve≡reject、申诉全程无效 | ✅ git 考古 ad886f3 确认原始口径 `['active','appealing']`，回退；+2 测试断言**业务效果**（approve 后排名总分回升、reject 保留罚分），补上「只断言状态迁移」的盲区 |
| 3 | P1 | `/statistics/trend` 无 campusId → teacher1(c1) 可查 c2 班级真实扣分（跨校区泄漏） | ✅ 签名加 campusId + repo 过滤 + 路由 resolveCampusId；+2 测试（隔离+admin不误伤） |
| 2 | P1 | 删用户致其记录静默消失（records `innerJoin(userProfiles)`）+ count/rows 分歧 + CSV 丢行 | ✅ 改 `leftJoin` + recorderName COALESCE('已删除用户')；+2 测试 |
| 4 | P1 | 撤回记录被 reject 复活（reject 无条件 set active）+ revoke 无状态前置 | ✅ reject 加 `WHERE status='appealing'`；revoke 加 `WHERE status IN(active,appealing)`+幂等 log；+2 测试 |
| 6 | P2 | records score 零校验（'abc'→null、'1e308'→Infinity 撑爆 SUM）、tagId 不校验校区 | ✅ Number.isFinite+范围±100、tagId 本校区校验；+5 测试 |
| 8 | P2 | campuses/grades/classes DELETE 无引用守卫（homura 无 DB FK → 孤儿子行） | ✅ 删前查引用有则 409（与值班域 #12 一致）；+4 测试 |
| 7 | P2 | settings PUT 任意 key（semester_start 现驱动单双周锚点，写错静默错乱） | ✅ key 白名单 + 值校验；+5 测试 |
| 9 | P2 | appeals GET /:id 无校区校验（靠「id 只能来自已隔离列表」兜底，脆弱） | ✅ 投影带 records.campusId → 非 admin 强制本校区 404；+2 测试 |
| 5 | P2 | /files 跨校区图片泄漏（实测：匿名401 但 student2(c2) 读 c1 图 200） | ✅ 命名空间校区限定 + /files 鉴权中间件（O(1) 按 key 段隔离，fail-closed）；+2 测试 |
| 10 | P2 | records.list count(单表) vs rows(4表join) 结构分歧 → 幻影分页 | ✅ 由 #2 的 leftJoin 从根上消除（rows 不再因 join 落空而少于 count）；#8 的班级删除守卫堵住另一入口 |
| 11 | P3 | revoke 可重复撤回 + 推翻 appeal_approved | ✅ 由 #4 的状态前置一并修复 |
| 17 | P3 | 图片上传全量进内存（9×5MB=45MB/请求）+ 无 bodyLimit → 并发可耗尽内存 | ✅ 见 §6（bodyLimit 中间件） |
| 12 | P3 | users.remove 非原子无回滚（profile 删了但 auth user 删失败 → 账号变砖） | ✅ 见 §6（补对称回滚） |
| 13 | P3 | templates.importMany 静默丢弃跨校区 tagId（值班域 Excel 导入是收集 warnings 的，两域不一致） | ⏸️ deferred：返回 imported 计数，非静默数据损坏；对齐 warnings 是增强非修复 |
| 14 | P3 | appeals-repo 重复构造 cond/countCond（可维护性） | ⏸️ deferred：纯代码整洁，无行为影响 |
| 15 | P3 | groups.assertOwnership 为校验一个 id 加载全校区组（O(n)） | ⏸️ deferred：校内组数量小（个位数），O(n) 无实际影响；补 findById 是 API 一致性增强 |
| 16 | P3 | EventBus setMaxListeners(200)：>200 并发 SSE 触发告警（静默悬崖） | ⏸️ deferred：校内并发远低于 200；多实例部署本就要改 Redis Pub/Sub（见 ARCHITECTURE 边界） |

**审查同时确认无误的关键实现**（新鲜视角复核）：
- **RBAC 12 个洞真补全了**：grep 全部路由确认 grades/classes/groups/tags/templates/summary/awards/settings/users/campuses 写端点都有 requireRole（summary 为 admin+teacher）。
- **事务边界严谨**：records create、appeal 三写、groups 双写、awards 批量+onConflict、templates import、settings upsert 全在 ctx.tx 内。旧代码「状态改了但无申诉单 → appealing 永远无法 approve」的 bug 确实修复（实测同事务）。
- **重复申诉/审批防护**：appeals.create 有 WHERE status='active'、approve/reject 有 WHERE status='pending'，实测有效。
- **isUniqueViolation 正确遍历 .cause 链**（drizzle 包成 DrizzleQueryError，真实 UNIQUE 在 cause），users 重名→409 实测通过。
- **N+1 修复彻底**：templates attachTags 一次 inArray、appeals list 单 join 投影，无新 N+1。
- **CSV 转义**全字段双引号+BOM（旧「只转义 comment」bug 已修）；**SSE record_revoked 真被 emit**（旧死代码复活）；**onError 不泄栈** + kitLogger 把预期 4xx 降级 warn。

**最重要的教训（#1）**：我在迁移时把「appeal_approved 不计分」当成 bug「修复」了，注释还写得理直气壮，
轻松通过了自己的 code review 和 71 个 E2E——因为那些测试只断言「approve 后 status 变 appeal_approved」
（状态对了），从未断言「分数被撤销」（效果错了）。**状态断言通过 ≠ 语义正确**。这类回归只能靠
① 业务效果的数值断言、② 对拍原始行为（git 考古）发现。已补两类测试。这也印证了主人要求
「判断每个功能的哲学价值」的深意：功能的价值在于它产生的**业务效果**，而非它经过的**状态**。

**回归**：每项修复配断言，值周 E2E 71→ 全套 **202 tests 绿**（新增 records-appeals +2、wk-review +22）。

## 6. 值周审查后的剩余改良（本轮）

- **#17 bodyLimit**：图片上传 9×5MB 全量进内存、无请求体上限 → 加 hono `bodyLimit` 中间件（全局防 DoS）。
- **#12 users.remove 原子性**：profile 删成功但 auth user 删失败 → 账号变砖（auth user 在、profile 不在，
  requireProfile 永久 403）且 username 被占。补对称回滚（对齐 create 的补偿清理模式）。

## 7. 两域健壮性对比（审查结论）

| 维度 | 值周域 | 值班域 |
|------|--------|--------|
| 事务原子性 | **更强**（appeal 三写、groups 双写同事务） | Excel 导入配置预建仍不在事务内（#9 值班，deferred） |
| 引用完整性 | 迁移后补齐（#8 删除守卫） | 一开始就有（#12 值班） |
| 授权一致性 | trend 曾漏隔离（#3，已修） | by-id 写端点曾整片漏（值班 #3，已修） |
| 打卡/履职状态 | — | 按人判定（值班 #2，会签不串台） |
| 测试盲区 | 曾只测角色维度、缺业务效果断言（#1 教训） | 审查后补同角色跨主体越权 |

两域经交叉审查后健壮性已对齐。共同的最大教训：**授权与语义的正确性，靠 happy-path + 角色维度测试测不出来**，
必须补「同角色跨主体越权」和「业务效果数值断言」两类测试。
