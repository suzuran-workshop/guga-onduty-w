/**
 * SQLite 轨 schema —— 业务表（sqlite 方言）。
 *
 * 与 pg.ts **严格镜像**：表名、列名、主键完全一致（`assertSchemaParity` 门禁校验这三样）。
 * 差异仅在类型映射（homura schema-helpers 已封装）：
 *  - pgCol.id() = uuid defaultRandom  ↔  sqliteCol.id() = text + randomUUID（运行时都是 string uuid）
 *  - pg real  ↔  sqlite real（分数）
 *  - pgJson (jsonb)  ↔  sqliteJson (text + JSON 编解码)
 *  - 引用列 uuid  ↔  text
 *  - pgCol.createdAt = timestamptz  ↔  sqliteCol.createdAt = integer(timestamp_ms)
 *  - pgCol.epochMs = bigint  ↔  sqliteCol.epochMs = integer
 * check 约束列名均为小写单词，SQL 字面量双方言通用（与 enums.ts 共享单一真源）。
 */
import { sqliteCol, sqliteTable, sqliteJson } from '@homurajs/db/schema-helpers';
import { check, index, real, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
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

/** 引用列（NOT NULL text，存 uuid）—— 完整性由 repo 层保证 */
const ref = (name: string) => text(name).notNull();
/** 可空引用列 */
const optRef = (name: string) => text(name);

// ── 校区 ────────────────────────────────────────────────────────────
export const campuses = sqliteTable(
  'campuses',
  {
    id: sqliteCol.id(),
    name: sqliteCol.text('name').notNull(),
    code: sqliteCol.text('code').notNull(),
    createdAt: sqliteCol.createdAt('createdAt'),
  },
  (t) => [uniqueIndex('campuses_code_uidx').on(t.code)],
);

// ── 年级 ────────────────────────────────────────────────────────────
export const grades = sqliteTable(
  'grades',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    name: sqliteCol.text('name').notNull(),
    sortOrder: sqliteCol.int('sortOrder').notNull().default(0),
  },
  (t) => [
    uniqueIndex('grades_campus_name_uidx').on(t.campusId, t.name),
    index('grades_campus_idx').on(t.campusId),
  ],
);

// ── 班级 ────────────────────────────────────────────────────────────
export const classes = sqliteTable(
  'classes',
  {
    id: sqliteCol.id(),
    gradeId: ref('gradeId'),
    campusId: ref('campusId'),
    name: sqliteCol.text('name').notNull(),
    /** 班主任展示名（自由文本，仅展示）。权威关联用 teacherDingtalkId */
    classTeacher: sqliteCol.text('classTeacher'),
    /**
     * 班主任的**钉钉 userid**（2026-10-23 需求 4）。
     *
     * 为什么是钉钉 userid 而非本系统 users.id：班级↔教师关系的权威取自通讯录/家校，
     * 管理员从「引入组织通讯录」的联系人里下拉选人；而推送 asyncsend_v2 要的正是钉钉 userid，
     * 故直接存它——推送链路零转换，且教师**从未登录过系统也能收到扣分推送**。
     *
     * ⚠ sqlite 侧本就是 text；pg 侧同为 text（钉钉 userid 非 uuid，用 uuid 列会被 pg 拒绝）。
     *
     * 代价（已与产品确认接受）：申诉权限校验需把「当前登录教师」解析成钉钉 userid
     * （经 oauth2_identity_links），故账密登录的教师无法在系统内申诉——但扣分推送里的
     * 免登录令牌链接（appealTokens，绑定 teacherDingtalkId）不依赖登录，教师一般走钉钉 OAuth。
     */
    teacherDingtalkId: sqliteCol.text('teacherDingtalkId'),
  },
  (t) => [
    uniqueIndex('classes_campus_grade_name_uidx').on(t.campusId, t.gradeId, t.name),
    index('classes_campus_idx').on(t.campusId),
    index('classes_teacher_idx').on(t.teacherDingtalkId),
  ],
);

// ── 值周小组 ────────────────────────────────────────────────────────
export const dutyGroups = sqliteTable(
  'dutyGroups',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    name: sqliteCol.text('name').notNull(),
    members: sqliteJson<string[]>('members'),
    createdAt: sqliteCol.createdAt('createdAt'),
  },
  (t) => [index('duty_groups_campus_idx').on(t.campusId)],
);

// ── 用户业务档案 ────────────────────────────────────────────────────
export const userProfiles = sqliteTable(
  'userProfiles',
  {
    userId: text('userId').primaryKey(),
    campusId: ref('campusId'),
    displayName: sqliteCol.text('displayName').notNull(),
    role: sqliteCol.text('role').notNull(),
    groupId: optRef('groupId'),
  },
  (t) => [
    check('user_profiles_role_check', sql`role IN (${sql.raw(sqlInList(ROLES))})`),
    index('user_profiles_campus_idx').on(t.campusId),
  ],
);

// ── 评价标签 ────────────────────────────────────────────────────────
export const tags = sqliteTable(
  'tags',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    name: sqliteCol.text('name').notNull(),
    score: real('score').notNull().default(0),
    color: sqliteCol.text('color').notNull().default('#FFAACC'),
    category: sqliteCol.text('category').notNull().default('positive'),
    isSystem: sqliteCol.int('isSystem').notNull().default(0),
    createdAt: sqliteCol.createdAt('createdAt'),
  },
  (t) => [
    check('tags_category_check', sql`category IN (${sql.raw(sqlInList(TAG_CATEGORIES))})`),
    index('tags_campus_idx').on(t.campusId),
  ],
);

// ── 打分模板 ────────────────────────────────────────────────────────
export const templates = sqliteTable(
  'templates',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    name: sqliteCol.text('name').notNull(),
    tagIds: sqliteJson<string[]>('tagIds').notNull(),
    createdAt: sqliteCol.createdAt('createdAt'),
  },
  (t) => [index('templates_campus_idx').on(t.campusId)],
);

// ── 值周记录（核心表）──────────────────────────────────────────────
export const records = sqliteTable(
  'records',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    classId: ref('classId'),
    recorderId: ref('recorderId'),
    /**
     * 评价标签 id 数组。2026-10-23 从单值 `tagId` 改为多值（需求：一次评价可选多个标签）。
     * 照抄 templates.tagIds 的 JSON string[] 先例。
     */
    tagIds: sqliteJson<string[]>('tagIds'),
    /**
     * 分数 = 所选标签分之和，**由服务端按 tagIds 求和写入**，不信任前端传值
     * （需求：「标签是提前设置好的，一旦选中以标签分为权威，不得由评分模块自行修改」）。
     * 故 NOT NULL default 0（未选标签即 0 分）。
     */
    score: real('score').notNull().default(0),
    comment: sqliteCol.text('comment'),
    images: sqliteJson<string[]>('images'),
    week: sqliteCol.text('week').notNull(),
    status: sqliteCol.text('status').notNull().default('active'),
    recordedAt: sqliteCol.epochMs('recordedAt').notNull(),
  },
  (t) => [
    check('records_status_check', sql`status IN (${sql.raw(sqlInList(RECORD_STATUSES))})`),
    index('records_campus_week_idx').on(t.campusId, t.week),
    index('records_class_idx').on(t.classId),
    index('records_status_idx').on(t.status),
  ],
);

// ── 记录操作日志 ────────────────────────────────────────────────────
export const recordLogs = sqliteTable(
  'recordLogs',
  {
    id: sqliteCol.id(),
    recordId: ref('recordId'),
    action: sqliteCol.text('action').notNull(),
    operatorId: ref('operatorId'),
    reason: sqliteCol.text('reason'),
    createdAt: sqliteCol.createdAt('createdAt'),
  },
  (t) => [
    check('record_logs_action_check', sql`action IN (${sql.raw(sqlInList(RECORD_ACTIONS))})`),
    index('record_logs_record_idx').on(t.recordId),
  ],
);

// ── 申诉 ────────────────────────────────────────────────────────────
export const appeals = sqliteTable(
  'appeals',
  {
    id: sqliteCol.id(),
    /**
     * 校区 id。2026-10-23 新增：此前 appeals.create 的 campusId 入参是死参数（insert 不含它），
     * 校区隔离只能靠 join records.campusId 推导。补列后隔离更直接、查询无需 join。
     */
    campusId: ref('campusId'),
    recordId: ref('recordId'),
    teacherId: ref('teacherId'),
    reason: sqliteCol.text('reason').notNull(),
    status: sqliteCol.text('status').notNull().default('pending'),
    reviewerId: optRef('reviewerId'),
    reviewComment: sqliteCol.text('reviewComment'),
    createdAt: sqliteCol.createdAt('createdAt'),
    reviewedAt: sqliteCol.epochMs('reviewedAt'),
  },
  (t) => [
    check('appeals_status_check', sql`status IN (${sql.raw(sqlInList(APPEAL_STATUSES))})`),
    index('appeals_status_idx').on(t.status),
    index('appeals_record_idx').on(t.recordId),
    index('appeals_campus_idx').on(t.campusId),
  ],
);

// ── 每日小结 ────────────────────────────────────────────────────────
export const dailySummaries = sqliteTable(
  'dailySummaries',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    week: sqliteCol.text('week').notNull(),
    date: sqliteCol.text('date').notNull(),
    content: sqliteCol.text('content').notNull(),
    notifiedTeachers: sqliteJson<string[]>('notifiedTeachers'),
    createdAt: sqliteCol.createdAt('createdAt'),
  },
  (t) => [
    uniqueIndex('daily_summaries_campus_date_uidx').on(t.campusId, t.date),
    index('daily_summaries_campus_week_idx').on(t.campusId, t.week),
  ],
);

// ── 流动红旗 ────────────────────────────────────────────────────────
export const awards = sqliteTable(
  'awards',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    classId: ref('classId'),
    week: sqliteCol.text('week').notNull(),
    category: sqliteCol.text('category').notNull().default('overall'),
    note: sqliteCol.text('note'),
    awardedAt: sqliteCol.epochMs('awardedAt').notNull(),
  },
  (t) => [
    uniqueIndex('awards_campus_class_week_uidx').on(t.campusId, t.classId, t.week),
    index('awards_campus_week_idx').on(t.campusId, t.week),
  ],
);

// ── 系统设置（key-value）────────────────────────────────────────────
export const settings = sqliteTable(
  'settings',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    key: sqliteCol.text('key').notNull(),
    value: sqliteCol.text('value').notNull(),
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
export const dingtalkContacts = sqliteTable(
  'dingtalkContacts',
  {
    userId: text('userId').primaryKey(), // 钉钉 userid（企业内唯一，非本系统 users.id）
    unionId: sqliteCol.text('unionId'),
    name: sqliteCol.text('name').notNull(),
    mobile: sqliteCol.text('mobile'),
    title: sqliteCol.text('title'),
    avatarUrl: sqliteCol.text('avatarUrl'),
    /** 所属部门 id 列表（同一人可属多部门，实测最多 4 个） */
    deptIds: sqliteJson<number[]>('deptIds'),
    /** 部门名路径（冗余存储，避免每次展示都重建部门树） */
    deptNames: sqliteJson<string[]>('deptNames'),
    syncedAt: sqliteCol.epochMs('syncedAt').notNull(),
  },
  (t) => [index('dingtalk_contacts_name_idx').on(t.name)],
);

// ── 通知日志（2026-10-23，需求 4）───────────────────────────────────
// 推送的异步队列 + 幂等 + 审计。缺它则：凭证未配时无法落库补发、失败无法重试、
// 周报无法防重复推送（「管理员可补发」要求幂等）。
export const notificationLogs = sqliteTable(
  'notificationLogs',
  {
    id: sqliteCol.id(),
    campusId: ref('campusId'),
    /** 收件人：本系统 users.id（可空——通讯录里的人可能还没有系统账号） */
    recipientUserId: optRef('recipientUserId'),
    /** 收件人钉钉 userid（推送实际目标） */
    recipientPlatformId: sqliteCol.text('recipientPlatformId').notNull(),
    kind: sqliteCol.text('kind').notNull(),
    status: sqliteCol.text('status').notNull().default('pending'),
    /** 关联记录（扣分推送用；周报为 null） */
    recordId: optRef('recordId'),
    /** 关联周次（周报聚合用；扣分推送也带记录所属周，便于按周查询） */
    week: sqliteCol.text('week'),
    /** 消息摘要（便于管理员在后台看到推了什么，不存敏感全文） */
    title: sqliteCol.text('title'),
    /**
     * 幂等键（仅周报填写，形如 `weekly:<campusId>:<platformId>:<week>`）。
     * ⚠ 不能用 (campusId,recipientPlatformId,week,kind) 组合唯一索引去重——
     * record_deduction 也带 week，同一教师一周内第二次扣分推送会撞约束。
     * 故用独立可空列 + 唯一索引：其余类型为 NULL，sqlite/pg 下 NULL 互不冲突。
     */
    dedupeKey: sqliteCol.text('dedupeKey'),
    /** 钉钉 asyncsend_v2 返回的 task_id（查回执用） */
    providerTaskId: sqliteCol.text('providerTaskId'),
    /** 失败原因（钉钉 errmsg 或回执里的 invalid/failed 归类） */
    error: sqliteCol.text('error'),
    createdAt: sqliteCol.createdAt('createdAt'),
    sentAt: sqliteCol.epochMs('sentAt'),
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
export const appealTokens = sqliteTable(
  'appealTokens',
  {
    /** 令牌哈希（SHA-256 hex），不存明文——泄漏数据库也无法直接构造可用链接 */
    tokenHash: text('tokenHash').primaryKey(),
    recordId: ref('recordId'),
    /**
     * 令牌归属教师的**钉钉 userid**（非本系统 users.id）；提交时与班级 teacherDingtalkId 校验一致，
     * 防他人代填。教师可能根本没有系统账号（免登录申诉正是为此），故用 text 存钉钉 userid。
     */
    teacherDingtalkId: sqliteCol.text('teacherDingtalkId').notNull(),
    expiresAt: sqliteCol.epochMs('expiresAt').notNull(),
    /** 一次性消费标记 */
    consumedAt: sqliteCol.epochMs('consumedAt'),
    createdAt: sqliteCol.createdAt('createdAt'),
  },
  (t) => [
    index('appeal_tokens_record_idx').on(t.recordId),
    index('appeal_tokens_expires_idx').on(t.expiresAt),
  ],
);

/** sqlite 业务表集合（auth 表在 ./index.ts spread 合并） */
export const sqliteBusinessSchema = {
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
