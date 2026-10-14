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
  sqlInList,
} from './enums.js';
import {
  dutyAreas, dutyLocations, dutyTimeSlots, dutySchedules,
  dutyCheckins, dutyInspections, dutySwaps,
} from './sqlite.duty.js';

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
    classTeacher: sqliteCol.text('classTeacher'),
  },
  (t) => [
    uniqueIndex('classes_campus_grade_name_uidx').on(t.campusId, t.gradeId, t.name),
    index('classes_campus_idx').on(t.campusId),
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
    canInspect: sqliteCol.int('canInspect').notNull().default(0),
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
    tagId: optRef('tagId'),
    score: real('score'),
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
  // ── 值班域（融合方案，docs/DUTY-FUSION.md §2）──
  dutyAreas,
  dutyLocations,
  dutyTimeSlots,
  dutySchedules,
  dutyCheckins,
  dutyInspections,
  dutySwaps,
};
