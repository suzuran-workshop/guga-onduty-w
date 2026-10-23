/**
 * PostgreSQL 轨 schema —— 业务表（pg 方言）。
 *
 * 设计约束（见 docs/MIGRATION-HOMURA.md §2）：
 *  - 列名一律 camelCase（homura pgCol/sqliteCol 缺省列名 = JS 属性名）；与 sqlite.ts 列名
 *    逐一对齐，由启动期 assertSchemaParity 门禁强制（表名/列名/主键漂移即抛错），
 *    故同一份 drizzle repo 源码对双方言无感。
 *  - 迁移 SQL 由 `drizzle-kit generate` 生成本文件的元数据，**绝不手写 DDL**。
 *  - 主键统一 uuid（pgCol.id() = uuid defaultRandom）；引用列用裸 uuid（不用 drizzle references()，
 *    遵循 @homurajs/auth 先例：跨实体完整性靠应用层 repo + 事务保证，而非 DB 外键，
 *    双方言语义一致且避免级联删除的隐式行为）。
 *  - check 约束的列名均为小写单词（role/status/category/action），SQL 字面量双方言通用。
 *  - auth 5 表由 `pgAuthTables` spread 进 pgSchema（见 ./index.ts），不在本文件重复定义。
 */
import { pgCol, pgTable, pgJson } from '@homurajs/db/schema-helpers';
import { check, index, real, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  ROLES,
  RECORD_STATUSES,
  APPEAL_STATUSES,
  TAG_CATEGORIES,
  RECORD_ACTIONS,
  NOTIFICATION_KINDS,
  NOTIFICATION_STATUSES,
  sqlInList,
} from './enums.js';

/** 引用列（NOT NULL uuid）—— 引用另一表的 uuid 主键，完整性由 repo 层保证 */
const ref = (name: string) => uuid(name).notNull();
/** 可空引用列 */
const optRef = (name: string) => uuid(name);

// ── 校区 ────────────────────────────────────────────────────────────
export const campuses = pgTable(
  'campuses',
  {
    id: pgCol.id(),
    name: pgCol.text('name').notNull(),
    code: pgCol.text('code').notNull(),
    createdAt: pgCol.createdAt('createdAt'),
  },
  (t) => [uniqueIndex('campuses_code_uidx').on(t.code)],
);

// ── 年级 ────────────────────────────────────────────────────────────
export const grades = pgTable(
  'grades',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    name: pgCol.text('name').notNull(),
    sortOrder: pgCol.int('sortOrder').notNull().default(0),
  },
  (t) => [
    uniqueIndex('grades_campus_name_uidx').on(t.campusId, t.name),
    index('grades_campus_idx').on(t.campusId),
  ],
);

// ── 班级 ────────────────────────────────────────────────────────────
export const classes = pgTable(
  'classes',
  {
    id: pgCol.id(),
    gradeId: ref('gradeId'),
    campusId: ref('campusId'),
    name: pgCol.text('name').notNull(),
    /** 班主任展示名（自由文本，仅展示）。权威关联用 teacherDingtalkId */
    classTeacher: pgCol.text('classTeacher'),
    /**
     * 班主任的**钉钉 userid**（2026-10-23 需求 4）。
     *
     * 为什么是钉钉 userid 而非本系统 users.id：班级↔教师关系的权威取自通讯录/家校，
     * 管理员从「引入组织通讯录」的联系人里下拉选人；而推送 asyncsend_v2 要的正是钉钉 userid，
     * 故直接存它——推送链路零转换，且教师**从未登录过系统也能收到扣分推送**。
     *
     * ⚠ 类型是 text 而非 uuid：钉钉 userid 形如 `0252163856461532927016` /
     * `5314054424-444663015`（数字串或带连字符），不是 uuid，用 uuid 列会被 pg 拒绝写入。
     *
     * 代价（已与产品确认接受）：申诉权限校验需把「当前登录教师」解析成钉钉 userid
     * （经 oauth2_identity_links），故**账密登录的教师无法申诉**——教师一般走钉钉 OAuth 登录。
     */
    teacherDingtalkId: pgCol.text('teacherDingtalkId'),
  },
  (t) => [
    uniqueIndex('classes_campus_grade_name_uidx').on(t.campusId, t.gradeId, t.name),
    index('classes_campus_idx').on(t.campusId),
    index('classes_teacher_idx').on(t.teacherDingtalkId),
  ],
);

// ── 值周小组 ────────────────────────────────────────────────────────
export const dutyGroups = pgTable(
  'dutyGroups',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    name: pgCol.text('name').notNull(),
    /** 成员 userId(uuid) 数组；与 userProfiles.groupId 双写，repo 层用事务保证一致 */
    members: pgJson<string[]>('members'),
    createdAt: pgCol.createdAt('createdAt'),
  },
  (t) => [index('duty_groups_campus_idx').on(t.campusId)],
);

// ── 用户业务档案（身份锚点 users 由 auth SDK 提供，此处存 role/campus 等业务属性）──
export const userProfiles = pgTable(
  'userProfiles',
  {
    /** PK = auth users.id（uuid），1:1 */
    userId: uuid('userId').primaryKey(),
    campusId: ref('campusId'),
    displayName: pgCol.text('displayName').notNull(),
    role: pgCol.text('role').notNull(),
    groupId: optRef('groupId'),
  },
  (t) => [
    check('user_profiles_role_check', sql`role IN (${sql.raw(sqlInList(ROLES))})`),
    index('user_profiles_campus_idx').on(t.campusId),
  ],
);

// ── 评价标签 ────────────────────────────────────────────────────────
export const tags = pgTable(
  'tags',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    name: pgCol.text('name').notNull(),
    score: real('score').notNull().default(0),
    color: pgCol.text('color').notNull().default('#FFAACC'),
    category: pgCol.text('category').notNull().default('positive'),
    isSystem: pgCol.int('isSystem').notNull().default(0),
    createdAt: pgCol.createdAt('createdAt'),
  },
  (t) => [
    check('tags_category_check', sql`category IN (${sql.raw(sqlInList(TAG_CATEGORIES))})`),
    index('tags_campus_idx').on(t.campusId),
  ],
);

// ── 打分模板 ────────────────────────────────────────────────────────
export const templates = pgTable(
  'templates',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    name: pgCol.text('name').notNull(),
    /** tag id(uuid) 数组 */
    tagIds: pgJson<string[]>('tagIds').notNull(),
    createdAt: pgCol.createdAt('createdAt'),
  },
  (t) => [index('templates_campus_idx').on(t.campusId)],
);

// ── 值周记录（核心表）──────────────────────────────────────────────
export const records = pgTable(
  'records',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    classId: ref('classId'),
    recorderId: ref('recorderId'),
    /**
     * 评价标签 id 数组。2026-10-23 从单值 `tagId` 改为多值（需求：一次评价可选多个标签）。
     * 照抄 templates.tagIds 的 JSON string[] 先例。
     */
    tagIds: pgJson<string[]>('tagIds'),
    /**
     * 分数 = 所选标签分之和，**由服务端按 tagIds 求和写入**，不信任前端传值
     * （需求：「标签是提前设置好的，一旦选中以标签分为权威，不得由评分模块自行修改」）。
     * 故 NOT NULL default 0（未选标签即 0 分）。
     */
    score: real('score').notNull().default(0),
    comment: pgCol.text('comment'),
    /** 图片 storage objectKey 数组（读取走 /files/<key> 代理） */
    images: pgJson<string[]>('images'),
    week: pgCol.text('week').notNull(),
    status: pgCol.text('status').notNull().default('active'),
    recordedAt: pgCol.epochMs('recordedAt').notNull(),
  },
  (t) => [
    check('records_status_check', sql`status IN (${sql.raw(sqlInList(RECORD_STATUSES))})`),
    index('records_campus_week_idx').on(t.campusId, t.week),
    index('records_class_idx').on(t.classId),
    index('records_status_idx').on(t.status),
  ],
);

// ── 记录操作日志 ────────────────────────────────────────────────────
export const recordLogs = pgTable(
  'recordLogs',
  {
    id: pgCol.id(),
    recordId: ref('recordId'),
    action: pgCol.text('action').notNull(),
    operatorId: ref('operatorId'),
    reason: pgCol.text('reason'),
    createdAt: pgCol.createdAt('createdAt'),
  },
  (t) => [
    check('record_logs_action_check', sql`action IN (${sql.raw(sqlInList(RECORD_ACTIONS))})`),
    index('record_logs_record_idx').on(t.recordId),
  ],
);

// ── 申诉 ────────────────────────────────────────────────────────────
export const appeals = pgTable(
  'appeals',
  {
    id: pgCol.id(),
    /**
     * 校区 id。2026-10-23 新增：此前 appeals.create 的 campusId 入参是死参数（insert 不含它），
     * 校区隔离只能靠 join records.campusId 推导。补列后隔离更直接、查询无需 join。
     */
    campusId: ref('campusId'),
    recordId: ref('recordId'),
    teacherId: ref('teacherId'),
    reason: pgCol.text('reason').notNull(),
    status: pgCol.text('status').notNull().default('pending'),
    reviewerId: optRef('reviewerId'),
    reviewComment: pgCol.text('reviewComment'),
    createdAt: pgCol.createdAt('createdAt'),
    reviewedAt: pgCol.epochMs('reviewedAt'),
  },
  (t) => [
    check('appeals_status_check', sql`status IN (${sql.raw(sqlInList(APPEAL_STATUSES))})`),
    index('appeals_status_idx').on(t.status),
    index('appeals_record_idx').on(t.recordId),
    index('appeals_campus_idx').on(t.campusId),
  ],
);

// ── 每日小结 ────────────────────────────────────────────────────────
export const dailySummaries = pgTable(
  'dailySummaries',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    week: pgCol.text('week').notNull(),
    date: pgCol.text('date').notNull(),
    content: pgCol.text('content').notNull(),
    notifiedTeachers: pgJson<string[]>('notifiedTeachers'),
    createdAt: pgCol.createdAt('createdAt'),
  },
  (t) => [
    // 修复：现有 schema 缺 UNIQUE(campus,date)，同日可重复插入
    uniqueIndex('daily_summaries_campus_date_uidx').on(t.campusId, t.date),
    index('daily_summaries_campus_week_idx').on(t.campusId, t.week),
  ],
);

// ── 流动红旗 ────────────────────────────────────────────────────────
export const awards = pgTable(
  'awards',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    classId: ref('classId'),
    week: pgCol.text('week').notNull(),
    category: pgCol.text('category').notNull().default('overall'),
    note: pgCol.text('note'),
    awardedAt: pgCol.epochMs('awardedAt').notNull(),
  },
  (t) => [
    // 修复：现有 schema 缺 UNIQUE，重复调用产生重复奖项（无幂等）
    uniqueIndex('awards_campus_class_week_uidx').on(t.campusId, t.classId, t.week),
    index('awards_campus_week_idx').on(t.campusId, t.week),
  ],
);

// ── 系统设置（key-value）────────────────────────────────────────────
export const settings = pgTable(
  'settings',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    key: pgCol.text('key').notNull(),
    value: pgCol.text('value').notNull(),
  },
  (t) => [
    uniqueIndex('settings_campus_key_uidx').on(t.campusId, t.key),
    index('settings_campus_idx').on(t.campusId),
  ],
);

// ── 钉钉通讯录缓存（2026-10-23，需求 4）─────────────────────────────
// 管理员在设置里「引入整个组织通讯录」（**不含家校通讯录**）后落本地：
// 钉钉无「按姓名查 userid」API，推送与班主任下拉选人都必须依赖这份本地索引。
// 每次同步按 userid upsert（钉钉侧离职/改名后以最新为准）。
export const dingtalkContacts = pgTable(
  'dingtalkContacts',
  {
    userId: pgCol.text('userId').primaryKey(), // 钉钉 userid（企业内唯一，非本系统 users.id）
    unionId: pgCol.text('unionId'),
    name: pgCol.text('name').notNull(),
    mobile: pgCol.text('mobile'),
    title: pgCol.text('title'),
    avatarUrl: pgCol.text('avatarUrl'),
    /** 所属部门 id 列表（同一人可属多部门，实测最多 4 个） */
    deptIds: pgJson<number[]>('deptIds'),
    /** 部门名路径（冗余存储，避免每次展示都重建部门树） */
    deptNames: pgJson<string[]>('deptNames'),
    syncedAt: pgCol.epochMs('syncedAt').notNull(),
  },
  (t) => [index('dingtalk_contacts_name_idx').on(t.name)],
);

// ── 通知日志（2026-10-23，需求 4）───────────────────────────────────
// 推送的异步队列 + 幂等 + 审计。缺它则：凭证未配时无法落库补发、失败无法重试、
// 周报无法防重复推送（「管理员可补发」要求幂等）。
export const notificationLogs = pgTable(
  'notificationLogs',
  {
    id: pgCol.id(),
    campusId: ref('campusId'),
    /** 收件人：本系统 users.id（可空——通讯录里的人可能还没有系统账号） */
    recipientUserId: optRef('recipientUserId'),
    /** 收件人钉钉 userid（推送实际目标） */
    recipientPlatformId: pgCol.text('recipientPlatformId').notNull(),
    kind: pgCol.text('kind').notNull(),
    status: pgCol.text('status').notNull().default('pending'),
    /** 关联记录（扣分推送用；周报为 null） */
    recordId: optRef('recordId'),
    /** 关联周次（周报聚合用；扣分推送也带记录所属周，便于按周查询） */
    week: pgCol.text('week'),
    /** 消息摘要（便于管理员在后台看到推了什么，不存敏感全文） */
    title: pgCol.text('title'),
    /**
     * 幂等键（仅周报填写，形如 `weekly:<campusId>:<platformId>:<week>`）。
     * ⚠ 不能用 (campusId,recipientPlatformId,week,kind) 组合唯一索引去重——
     * record_deduction 也带 week，同一教师一周内第二次扣分推送会撞约束。
     * 故用独立可空列 + 唯一索引：其余类型为 NULL，sqlite/pg 下 NULL 互不冲突。
     */
    dedupeKey: pgCol.text('dedupeKey'),
    /** 钉钉 asyncsend_v2 返回的 task_id（查回执用） */
    providerTaskId: pgCol.text('providerTaskId'),
    /** 失败原因（钉钉 errmsg 或回执里的 invalid/failed 归类） */
    error: pgCol.text('error'),
    createdAt: pgCol.createdAt('createdAt'),
    sentAt: pgCol.epochMs('sentAt'),
  },
  (t) => [
    check('notification_logs_kind_check', sql`kind IN (${sql.raw(sqlInList(NOTIFICATION_KINDS))})`),
    check('notification_logs_status_check', sql`status IN (${sql.raw(sqlInList(NOTIFICATION_STATUSES))})`),
    uniqueIndex('notification_logs_dedupe_uidx').on(t.dedupeKey),
    index('notification_logs_campus_idx').on(t.campusId),
    index('notification_logs_status_idx').on(t.status),
    index('notification_logs_record_idx').on(t.recordId),
  ],
);

// ── 申诉令牌（2026-10-23，需求 4）───────────────────────────────────
// 教师免登录申诉：钉钉推送里的链接带 token，点开即申诉表单（不进系统、不用账密）。
// 签名 token 而非 URL 明文参数——绑定 recordId + 教师身份 + 过期 + 一次性，
// 转发链接也无法冒用（已消费或过期即失效）。
export const appealTokens = pgTable(
  'appealTokens',
  {
    /** 令牌哈希（SHA-256 hex），不存明文——泄漏数据库也无法直接构造可用链接 */
    tokenHash: pgCol.text('tokenHash').primaryKey(),
    recordId: ref('recordId'),
    /**
     * 令牌归属教师的**钉钉 userid**（非本系统 users.id）；提交时与班级 teacherDingtalkId 校验一致，
     * 防他人代填。教师可能根本没有系统账号（免登录申诉正是为此），故用 text 存钉钉 userid。
     * ⚠ 用 text 而非 ref()：ref() 在 pg 是 uuid，而钉钉 userid 形如 `5314054424-444663015` 非 uuid，
     * 用 uuid 列会被 pg 拒绝写入。
     */
    teacherDingtalkId: pgCol.text('teacherDingtalkId').notNull(),
    expiresAt: pgCol.epochMs('expiresAt').notNull(),
    /** 一次性消费标记 */
    consumedAt: pgCol.epochMs('consumedAt'),
    createdAt: pgCol.createdAt('createdAt'),
  },
  (t) => [
    index('appeal_tokens_record_idx').on(t.recordId),
    index('appeal_tokens_expires_idx').on(t.expiresAt),
  ],
);

/** pg 业务表集合（auth 表在 ./index.ts spread 合并） */
export const pgBusinessSchema = {
  campuses,
  grades,
  classes,
  dutyGroups,
  userProfiles,
  tags,
  templates,
  records,
  recordLogs,
  appeals,
  dailySummaries,
  awards,
  settings,
  dingtalkContacts,
  notificationLogs,
  appealTokens,
};
