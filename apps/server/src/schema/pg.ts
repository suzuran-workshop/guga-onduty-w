/**
 * PostgreSQL 轨 schema —— 业务表（pg 方言）。
 *
 * 设计约束（见 docs/MIGRATION-HOMURA.md §2）：
 *  - 列名一律 camelCase（homura pgCol/sqliteCol 缺省列名 = JS 属性名；rest 轨 restSchemaFromPg 派生同名）。
 *  - 迁移 SQL 由 `drizzle-kit generate` 生成本文件的元数据，**绝不手写 DDL**。
 *  - 主键统一 uuid（pgCol.id() = uuid defaultRandom）；引用列用裸 uuid（不用 references，
 *    遵循 @homurajs/auth 先例：rest 轨无 FK 概念，三轨语义一致靠应用层 repo+事务保证完整性）。
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
  sqlInList,
} from './enums.js';
import {
  dutyAreas, dutyLocations, dutyTimeSlots, dutySchedules,
  dutyCheckins, dutyInspections, dutySwaps,
} from './pg.duty.js';

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
    classTeacher: pgCol.text('classTeacher'),
  },
  (t) => [
    uniqueIndex('classes_campus_grade_name_uidx').on(t.campusId, t.gradeId, t.name),
    index('classes_campus_idx').on(t.campusId),
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
    /** 领导巡查权限（0/1）：teacher 且被授权者可巡查在岗（DUTY-FUSION §1） */
    canInspect: pgCol.int('canInspect').notNull().default(0),
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
    tagId: optRef('tagId'),
    score: real('score'),
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
  // ── 值班域（融合方案，docs/DUTY-FUSION.md §2）──
  dutyAreas,
  dutyLocations,
  dutyTimeSlots,
  dutySchedules,
  dutyCheckins,
  dutyInspections,
  dutySwaps,
};
