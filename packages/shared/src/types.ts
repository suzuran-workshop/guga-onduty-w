/**
 * 前后端共享类型契约 —— 值周管理领域模型。
 *
 * ⚠ 迁移说明（docs/MIGRATION-HOMURA.md §2.2）：
 *  - 所有实体 id 从 integer 改为 **uuid string**（身份模型统一到 auth SDK 的 uuid 锚点）。
 *  - 字段一律 **camelCase**，与 drizzle schema / PostgREST 列名 / API wire 三者一致，消除映射层。
 *  - 用户拆分为 `User`（auth 身份锚点：id/username/nickname/avatarUrl）+
 *    `UserProfile`（业务档案：campusId/role/displayName/groupId）。
 *  - 时间戳统一 epoch 毫秒（number）。
 */

// ── 枚举（与 server/src/schema/enums.ts 单一真源对齐）──────────────────
export type UserRole = 'admin' | 'teacher' | 'student';
export type RecordStatus = 'active' | 'revoked' | 'appealing' | 'appeal_approved';
export type AppealStatus = 'pending' | 'approved' | 'rejected';
export type TagCategory = 'positive' | 'negative' | 'neutral';
export type RecordAction = 'create' | 'revoke' | 'appeal' | 'appeal_approve' | 'appeal_reject';

// ── 实体 ────────────────────────────────────────────────────────────
export interface Campus {
  id: string;
  name: string;
  code: string;
  createdAt: number;
}

export interface Grade {
  id: string;
  campusId: string;
  name: string;
  sortOrder: number;
  campusName?: string;
}

export interface Class {
  id: string;
  gradeId: string;
  campusId: string;
  name: string;
  classTeacher: string | null;
  gradeName?: string;
  campusName?: string;
}

/** auth SDK 身份锚点（users 表） */
export interface User {
  id: string;
  username: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 业务档案（userProfiles 表）——「你能做什么」 */
export interface UserProfile {
  userId: string;
  campusId: string;
  displayName: string;
  role: UserRole;
  groupId: string | null;
  /** 领导巡查权限（0/1）：teacher 且被授权者可巡查在岗（值班融合，DUTY-FUSION §1） */
  canInspect: number;
}

/** 列表页返回的用户视图（身份 + 档案 + 关联名） */
export interface UserView {
  id: string;
  username: string | null;
  campusId: string;
  displayName: string;
  role: UserRole;
  groupId: string | null;
  groupName: string | null;
  campusName: string;
  /** 领导巡查权限（0/1） */
  canInspect: number;
  createdAt: number;
}

export interface DutyGroup {
  id: string;
  campusId: string;
  name: string;
  /** 成员 userId(uuid) 数组 */
  members: string[] | null;
  createdAt: number;
}

export interface Tag {
  id: string;
  campusId: string;
  name: string;
  score: number;
  color: string;
  category: TagCategory;
  isSystem: number;
  createdAt: number;
}

export interface Template {
  id: string;
  campusId: string;
  name: string;
  /** tag id(uuid) 数组 */
  tagIds: string[];
  createdAt: number;
  /** 展开的标签（列表接口附带） */
  tags?: Tag[];
}

/**
 * 值周记录领域对象。
 * ⚠ 命名为 DutyRecord（非 Record）—— 避免遮蔽 TS 内置 Record<K,V> 工具类型
 *   （遮蔽会让同文件/导入方的 Record<string,string> 等写法全部失效）。
 */
export interface DutyRecord {
  id: string;
  campusId: string;
  classId: string;
  recorderId: string;
  tagId: string | null;
  score: number | null;
  comment: string | null;
  /** 图片 storage objectKey 数组；读取走 /files/<key> 代理 */
  images: string[] | null;
  week: string;
  status: RecordStatus;
  recordedAt: number;
}

export interface RecordWithDetails extends DutyRecord {
  className: string;
  gradeName: string;
  recorderName: string;
  tagName: string | null;
  tagColor: string | null;
}

export interface Appeal {
  id: string;
  recordId: string;
  teacherId: string;
  reason: string;
  status: AppealStatus;
  reviewerId: string | null;
  reviewComment: string | null;
  createdAt: number;
  reviewedAt: number | null;
}

export interface AppealRecordInfo {
  score: number | null;
  comment: string | null;
  week: string;
  recordedAt: number;
  recordStatus: RecordStatus;
  className: string;
  tagName: string | null;
}

export interface AppealWithDetails extends Appeal {
  teacherName: string;
  reviewerName: string | null;
  recordInfo: AppealRecordInfo | null;
  /** 关联记录的校区（详情端点做跨校区隔离用，REVIEW #9；来自 join records.campusId） */
  campusId: string | null;
}

export interface RecordLog {
  id: string;
  recordId: string;
  action: RecordAction;
  operatorId: string;
  reason: string | null;
  createdAt: number;
}

export interface DailySummary {
  id: string;
  campusId: string;
  week: string;
  date: string;
  content: string;
  notifiedTeachers: string[] | null;
  createdAt: number;
}

export interface Award {
  id: string;
  campusId: string;
  classId: string;
  week: string;
  category: string;
  note: string | null;
  awardedAt: number;
  className?: string;
  gradeName?: string;
}

export interface Setting {
  id: string;
  campusId: string;
  key: string;
  value: string;
}

// ── 统计 ────────────────────────────────────────────────────────────
export interface ClassRanking {
  rank: number;
  classId: string;
  className: string;
  gradeId: string;
  gradeName: string;
  totalScore: number;
  positiveCount: number;
  negativeCount: number;
  recordCount: number;
}

export interface TrendPoint {
  week: string;
  totalScore: number;
}

export interface DashboardStats {
  todayRecords: number;
  todayPositive: number;
  todayNegative: number;
  weekTopClass: string | null;
  weekTopScore: number | null;
}

// ── API 契约 ────────────────────────────────────────────────────────
export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: true;
  data: T;
  pagination?: Pagination;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

// ── 请求体 ──────────────────────────────────────────────────────────
export interface LoginRequest {
  username: string;
  password: string;
}

/** GET /api/v1/auth/me —— 身份 + 档案 + 校区名 */
export interface MeResponse {
  user: User;
  profile: UserProfile;
  campusName: string;
}

export interface CreateUserRequest {
  campusId: string;
  username: string;
  password?: string;
  displayName: string;
  role: UserRole;
  groupId?: string | null;
}

export interface UpdateUserRequest {
  displayName: string;
  role: UserRole;
  groupId?: string | null;
}

export interface CreateRecordRequest {
  classId: string;
  tagId?: string | null;
  score?: number;
  comment?: string | null;
  week: string;
}

export interface CreateAppealRequest {
  reason: string;
}

export interface AppealReviewRequest {
  reviewComment?: string | null;
}

export interface CreateSummaryRequest {
  week: string;
  date: string;
  content: string;
  notifiedTeachers?: string[] | null;
}

export interface AwardRequest {
  week: string;
  gradeId?: string | null;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

// ── SSE 事件 ────────────────────────────────────────────────────────
export interface RecordCreatedEvent {
  recordId: string;
  className: string;
  tagName: string | null;
  points: number;
  timestamp: number;
  campusId: string;
}

// ── 值班域 wire 契约（融合方案 DUTY-FUSION.md）─────────────────────────
// 单一 import 路径：前端从 '@class-duty/shared' 一并取值周 + 值班类型。
export * from './duty.js';
