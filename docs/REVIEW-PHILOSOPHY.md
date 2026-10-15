# REVIEW — 值周域哲学价值通查与改良

> 方法：对每个功能问三件事 —— ①它服务的**真实目的**是什么？②当前实现的**语义**是否对齐该目的？
> ③若未对齐，**最小而正确**的改良是什么？（AGENTS.md 验收标准：哲学层语义对齐 + 高覆盖 E2E）
>
> 本仓库由「值班 / 值周二合一」仓库拆分而来（见 `DECISIONS.md` ADR-6）。
> 下列内容聚焦**值周域**；原合一仓库时期关于「值班域审查」「融合改良 A/B」「到岗率桥接值周履职」的条目
> 已随值班域迁至 `guga-onduty` 仓库。

---

## 1. 值周域功能哲学价值评判

| 功能 | 真实目的 | 语义对齐度 | 备注 |
|------|---------|-----------|------|
| **值周记录（打分+图片）** | 替代纸质打分表 | ✅ 完全 | 结构化数据才能自动统计 |
| **标签 / 模板（自定义）** | 各校评分标准可配置 | ✅ 完全 | 卫生/纪律/两操各校不同 |
| **统计排名（实时）** | 自动计算周排名 | ✅ 完全 | 替代手工排序 |
| **申诉流程** | 规范异议处理 | ✅ 完全 | 状态机 + 业务效果断言（见 §3 #1 教训） |
| **流动红旗** | 班级正向激励 | ✅ 完全 | 每年级第一名，幂等（UNIQUE + onConflict） |
| **多校区隔离** | 各校区独立 | ✅ 完全 | 读强制本人校区、写校验归属 |
| **数字大屏** | 校园信息化展示 | ✅ 完全 | SSE 实时 + 60s 兜底轮询 |

---

## 2. 值周域对抗性审查结果（新鲜怀疑视角，实测 + git 考古双重验证）

值周域 71 E2E 但从未经对抗性审查。报 **17 项**，其中 4 个 P1（含一个**迁移时亲手引入的功能回归**）、
6 个 P2、7 个 P3。处置（✅ 已修 + 回归测试 / ⏸️ 已论证 deferred）：

| # | 级别 | 缺陷 | 处置 |
|---|------|------|------|
| 1 | **P1** | **申诉工作流完全失效**：迁移时误把 `appeal_approved` 计入分，导致批准申诉后分数照旧、approve≡reject、申诉全程无效 | ✅ git 考古 ad886f3 确认原始口径 `['active','appealing']`，回退；+2 测试断言**业务效果**（approve 后排名总分回升、reject 保留罚分），补上「只断言状态迁移」的盲区 |
| 3 | P1 | `/statistics/trend` 无 campusId → teacher1(c1) 可查 c2 班级真实扣分（跨校区泄漏） | ✅ 签名加 campusId + repo 过滤 + 路由 resolveCampusId；+2 测试（隔离+admin 不误伤） |
| 2 | P1 | 删用户致其记录静默消失（records `innerJoin(userProfiles)`）+ count/rows 分歧 + CSV 丢行 | ✅ 改 `leftJoin` + recorderName COALESCE('已删除用户')；+2 测试 |
| 4 | P1 | 撤回记录被 reject 复活（reject 无条件 set active）+ revoke 无状态前置 | ✅ reject 加 `WHERE status='appealing'`；revoke 加 `WHERE status IN(active,appealing)`+幂等 log；+2 测试 |
| 6 | P2 | records score 零校验（'abc'→null、'1e308'→Infinity 撑爆 SUM）、tagId 不校验校区 | ✅ Number.isFinite+范围±100、tagId 本校区校验；+5 测试 |
| 8 | P2 | campuses/grades/classes DELETE 无引用守卫（homura 无 DB FK → 孤儿子行） | ✅ 删前查引用有则 409；+4 测试 |
| 7 | P2 | settings PUT 任意 key | ✅ key 白名单 + 值校验；+5 测试 |
| 9 | P2 | appeals GET /:id 无校区校验（靠「id 只能来自已隔离列表」兜底，脆弱） | ✅ 投影带 records.campusId → 非 admin 强制本校区 404；+2 测试 |
| 5 | P2 | /files 跨校区图片泄漏（实测：匿名 401 但 c2 student 读 c1 图 200） | ✅ 命名空间校区限定 + /files 鉴权中间件（O(1) 按 key 段隔离，fail-closed）；+2 测试 |
| 10 | P2 | records.list count(单表) vs rows(4表 join) 结构分歧 → 幻影分页 | ✅ 由 #2 的 leftJoin 从根上消除；#8 的班级删除守卫堵住另一入口 |
| 11 | P3 | revoke 可重复撤回 + 推翻 appeal_approved | ✅ 由 #4 的状态前置一并修复 |
| 17 | P3 | 图片上传全量进内存（9×5MB=45MB/请求）+ 无 bodyLimit → 并发可耗尽内存 | ✅ 见 §3（bodyLimit 中间件） |
| 12 | P3 | users.remove 非原子无回滚（profile 删了但 auth user 删失败 → 账号变砖） | ✅ 见 §3（补对称回滚） |
| 13 | P3 | templates.importMany 静默丢弃跨校区 tagId | ⏸️ deferred：返回 imported 计数，非静默数据损坏 |
| 14 | P3 | appeals-repo 重复构造 cond/countCond（可维护性） | ⏸️ deferred：纯代码整洁 |
| 15 | P3 | groups.assertOwnership 为校验一个 id 加载全校区组（O(n)） | ⏸️ deferred：校内组数量小，无实际影响 |
| 16 | P3 | EventBus setMaxListeners(200)：>200 并发 SSE 触发告警 | ⏸️ deferred：校内并发远低于 200 |

**审查同时确认无误的关键实现**：
- **RBAC 洞真补全了**：grep 全部路由确认各写端点都有 requireRole。
- **事务边界严谨**：records create、appeal 三写、groups 双写、awards 批量+onConflict、templates import、settings upsert 全在 `ctx.tx` 内。
- **重复申诉/审批防护**：appeals.create 有 `WHERE status='active'`、approve/reject 有 `WHERE status='pending'`。
- **isUniqueViolation 正确遍历 .cause 链**（drizzle 包成 DrizzleQueryError，真实 UNIQUE 在 cause）。
- **N+1 修复彻底**：templates attachTags 一次 inArray、appeals list 单 join 投影。
- **CSV 转义**全字段双引号+BOM；**SSE record_revoked 真被 emit**；**onError 不泄栈** + kitLogger 把预期 4xx 降级 warn。

**回归**：每项修复配断言，全套 99 tests 绿（拆分后）。

## 3. 审查后的剩余改良（本轮）

- **#17 bodyLimit**：图片上传 9×5MB 全量进内存、无请求体上限 → 加 hono `bodyLimit` 中间件（全局防 DoS）。
- **#12 users.remove 原子性**：先删 auth 身份锚点再删 profile，避免「profile 删了但 auth user 删失败 → 账号变砖」；
  失败则整体抛错、profile 保留（不 brick），并释放 username。

## 4. 核心教训（跨域通用）

**状态断言通过 ≠ 语义正确**：测试若只断言「状态迁移」（如 approve 后 status 变 X），会漏掉「业务效果」错误
（如 #1：分数未被撤销）。必须补两类测试：① **业务效果的数值断言**；② **同角色跨主体越权**（A 校区动 B 校区）——
happy-path + 角色维度测试测不出这些。本仓库 `wk-review.test.ts` 即为补齐此类盲区而建。

**功能的价值在于它产生的业务效果，而非它经过的状态。**
